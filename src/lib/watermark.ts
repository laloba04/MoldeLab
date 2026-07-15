/**
 * Marca de agua grabada en la pieza.
 *
 * No es un overlay de pantalla: es geometría real que viaja dentro del STL y
 * del 3MF. El texto se convierte en una máscara binaria, se vectoriza a
 * contornos con el mismo marching squares del pipeline, y se coloca junto al
 * borde inferior de la pieza, en relieve o grabado.
 *
 * Vive aparte del pipeline principal a propósito: la marca es del taller, no
 * del diseño. Se aplica al final, sobre las piezas ya construidas, y solo a las
 * que tienen una base plana donde grabar (las de tipo placa, llavero, etiqueta;
 * no un cortador, que es hueco).
 *
 * El grabado va en la cara de ATRÁS (la que se imprime contra la cama), para no
 * estropear la cara buena: se cala la capa inferior de la placa y el texto se
 * espeja, así se lee bien al dar la vuelta a la pieza.
 *
 * Lo único que necesita navegador es rasterizar el texto con una fuente de
 * verdad (`rasterizeText`, usa canvas): el navegador la inyecta vía
 * `opts.raster`. Sin inyección se usa una máscara sintética de bloques, que
 * corre en Node y basta para los tests. Todo lo demás — colocación, extrusión,
 * resta 2D — es puro y no toca `document`.
 */

import type { Loop, Mesh, Piece, Pt } from '../types';
import { traceContours } from './contours';
import { binarize, cleanupMask, pad, type Mask } from './image';
import { area, dedupe, orient, pointInPolygon, resample, simplify, smooth } from './polygon';
import { emptyMesh, extrudeRegion, merge } from './mesh';
import { intersect, offsetRegions, sanitize } from './clipper';
import { boxOf } from './shapes';

export interface WatermarkOpts {
  text: string;
  /** 'engrave' hunde el texto en la base; 'emboss' lo levanta. */
  mode: 'engrave' | 'emboss';
  depth: number; // mm
  heightMm: number; // altura del texto en la pieza
  /**
   * Texto -> máscara binaria. El navegador debe pasar `rasterizeText` (canvas,
   * fuente real). Si no llega, se usan glifos de bloque sintéticos que
   * funcionan en Node.
   */
  raster?: (text: string) => Mask;
}

/** Texto -> máscara binaria, a través de un canvas. Solo navegador. */
export function rasterizeText(text: string): Mask {
  const pad2 = 24;
  const px = 180;
  const font = `700 ${px}px "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif`;

  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const m = probe.measureText(text);
  const w = Math.ceil(m.width) + pad2 * 2;
  const h = Math.ceil(px * 1.4) + pad2 * 2;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);

  const img = ctx.getImageData(0, 0, w, h);
  return binarize(img, 128, false);
}

/**
 * Máscara sintética sin canvas: cada carácter es un bloque macizo. No es
 * legible, pero ocupa lo mismo que un texto y ejercita todo el camino de
 * vectorizado, colocación y extrusión. Es lo que usan los tests en Node.
 */
function blockTextMask(text: string): Mask {
  const cellW = 12;
  const cellH = 28;
  const glyphW = 8;
  const glyphH = 20;
  const margin = 8;
  const chars = [...text];

  const w = margin * 2 + cellW * Math.max(1, chars.length);
  const h = margin * 2 + cellH;
  const data = new Uint8Array(w * h);

  chars.forEach((ch, i) => {
    if (!ch.trim()) return;
    const x0 = margin + i * cellW + (cellW - glyphW) / 2;
    const y0 = margin + (cellH - glyphH) / 2;
    for (let y = 0; y < glyphH; y++) {
      for (let x = 0; x < glyphW; x++) data[(y0 + y) * w + (x0 + x)] = 1;
    }
  });

  return { data, w, h };
}

/** Contornos del texto en mm, escalados para medir `heightMm` de alto. */
function textLoops(text: string, heightMm: number, raster: (text: string) => Mask): Loop[] {
  const mask = cleanupMask(raster(text), 1);
  const raw = traceContours(pad(mask, 2));

  // Primero en píxeles, para saber la altura real y sacar la escala.
  let loops: Loop[] = [];
  for (const c of raw) {
    let pts: Pt[] = c.map(([x, y]) => [x, -y]);
    pts = dedupe(pts);
    if (pts.length < 3) continue;
    pts = resample(dedupe(smooth(simplify(pts, 0.6), 1)), 1.5);
    if (pts.length >= 3) loops.push({ pts, hole: false });
  }
  if (!loops.length) return [];

  const box = boxOf(loops);
  const scale = heightMm / box.h;

  loops = loops.map((l) => ({
    hole: false,
    pts: l.pts.map(([x, y]) => [(x - box.cx) * scale, (y - box.cy) * scale] as Pt),
  }));

  // Anidar: la tripa de una "a" o una "o" es un agujero.
  for (const l of loops) {
    let depth = 0;
    for (const o of loops) if (o !== l && pointInPolygon(l.pts[0], o.pts)) depth++;
    l.hole = depth % 2 === 1;
    l.pts = orient(l.pts, !l.hole);
  }

  return loops;
}

/** El rango de Z que ocupa una malla: para encontrar su base y su tapa. */
function zRange(mesh: Mesh): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 2; i < mesh.positions.length; i += 3) {
    const z = mesh.positions[i];
    if (z < min) min = z;
    if (z > max) max = z;
  }
  return { min, max };
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Huella en planta de la pieza, para no grabar fuera del material. */
function footprint(mesh: Mesh): Bounds {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const y = mesh.positions[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

/** Planta de la placa base, que es donde de verdad va la marca: la huella de
 *  la malla entera incluiría púas o anillas y descentraría el texto. */
function plateBounds(regions: { outer: Pt[] }[]): Bounds {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const r of regions) {
    for (const [x, y] of r.outer) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY };
}

/**
 * La cara superior de la placa base: la cota Z con más área de caras planas
 * mirando hacia arriba. En una placa con relieve gana la tapa de la placa (área
 * completa) frente a las tapas del relieve (solo el dibujo). Si la malla no
 * tiene caras planas, se cae a la Z máxima.
 */
function topOfBase(mesh: Mesh): number {
  const p = mesh.positions;
  const areas = new Map<number, number>();

  for (let i = 0; i < p.length; i += 9) {
    const z1 = p[i + 2], z2 = p[i + 5], z3 = p[i + 8];
    if (Math.abs(z1 - z2) > 1e-6 || Math.abs(z1 - z3) > 1e-6) continue;
    // Área con signo en planta: positiva = la cara mira hacia arriba.
    const a =
      (p[i + 3] - p[i]) * (p[i + 7] - p[i + 1]) -
      (p[i + 4] - p[i + 1]) * (p[i + 6] - p[i]);
    if (a <= 0) continue;
    const key = Math.round(z1 * 1000);
    areas.set(key, (areas.get(key) ?? 0) + a);
  }

  let best = 0;
  let bestArea = 0;
  for (const [key, a] of areas) {
    if (a > bestArea) {
      bestArea = a;
      best = key / 1000;
    }
  }
  return bestArea > 0 ? best : zRange(mesh).max;
}

interface PlacedText {
  outer: Pt[][]; // CCW
  holes: Pt[][]; // CW
}

/** Área de un conjunto de regiones: exteriores menos agujeros. */
function regionsArea(regions: { outer: Pt[]; holes: Pt[][] }[]): number {
  let a = 0;
  for (const r of regions) {
    a += Math.abs(area(r.outer));
    for (const h of r.holes) a -= Math.abs(area(h));
  }
  return a;
}

/** Escalas que se prueban antes de rendirse: de tamaño completo a la mitad. */
const FITS = [1, 0.9, 0.8, 0.7, 0.6, 0.5];

/** Reparte las palabras en `n` líneas de anchos parecidos, o null si no dan. */
function splitLines(text: string, n: number): string[] | null {
  const clean = text.trim();
  if (n === 1) return [clean];

  const words = clean.split(/\s+/);
  if (words.length < n) return null;

  const target = clean.length / n;
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const joined = cur ? `${cur} ${w}` : w;
    if (cur && lines.length < n - 1 && joined.length > target) {
      lines.push(cur);
      cur = w;
    } else {
      cur = joined;
    }
  }
  lines.push(cur);
  return lines.length === n ? lines : null;
}

interface TextBlock {
  loops: Loop[]; // centrado en el origen
  w: number;
  h: number;
}

/** El texto compuesto en una o varias líneas apiladas, centrado en el origen. */
function textBlock(lines: string[], heightMm: number, raster: (t: string) => Mask): TextBlock | null {
  const pitch = heightMm * 1.3; // interlineado
  const all: Loop[] = [];

  for (let i = 0; i < lines.length; i++) {
    const loops = textLoops(lines[i], heightMm, raster);
    if (!loops.length) return null;
    const dy = ((lines.length - 1) / 2 - i) * pitch;
    for (const l of loops) {
      all.push({ hole: l.hole, pts: l.pts.map(([x, y]) => [x, y + dy] as Pt) });
    }
  }

  const b = boxOf(all);
  return {
    loops: all.map((l) => ({ hole: l.hole, pts: l.pts.map(([x, y]) => [x - b.cx, y - b.cy] as Pt) })),
    w: b.w,
    h: b.h,
  };
}

/**
 * Busca dónde cabe ENTERO un rectángulo de texto dentro del material. La
 * silueta manda: en media mariposa el texto no puede ir centrado en el
 * rectángulo envolvente, porque la mitad caería en el aire y se grabaría medio
 * texto. Se barre la planta de abajo arriba (la marca, cuanto más discreta,
 * mejor) y del centro hacia los lados.
 */
function scanSpot(
  safe: { outer: Pt[]; holes: Pt[][] }[],
  b: Bounds,
  w: number,
  h: number,
): { cx: number; cy: number } | null {
  const spanW = b.maxX - b.minX;
  const spanH = b.maxY - b.minY;
  if (w > spanW || h > spanH) return null;

  const rowStep = Math.max(h * 0.75, (spanH - h) / 10);
  for (let cy = b.minY + h / 2; cy <= b.maxY - h / 2 + 1e-6; cy += rowStep) {
    const slack = (spanW - w) / 2;
    const center = (b.minX + b.maxX) / 2;
    const xs: number[] = [center];
    for (let s = 1; s <= 4; s++) {
      const d = slack * (s / 4);
      xs.push(center - d, center + d);
    }

    for (const cx of xs) {
      const rect: Pt[] = [
        [cx - w / 2, cy - h / 2],
        [cx + w / 2, cy - h / 2],
        [cx + w / 2, cy + h / 2],
        [cx - w / 2, cy + h / 2],
      ];
      // Cabe si la intersección con el material es el rectángulo entero.
      const inside = intersect(safe, [rect]);
      if (regionsArea(inside) >= w * h * 0.995) return { cx, cy };
    }
  }
  return null;
}

/**
 * Contornos del texto ya escalados y colocados sobre la planta de la pieza.
 * Con placa conocida se busca un hueco de verdad, ajustado a la silueta:
 * primero el texto entero en una línea, luego partido en dos y en tres (alguna
 * palabra baja de línea antes que encoger), y solo después se reduce el tamaño.
 * Si ni a la mitad cabe entero, la pieza se queda sin marca: mejor eso que
 * medio texto. Con `mirror` el texto se espeja en X, que es lo que toca al
 * grabar la cara de abajo para que se lea bien al dar la vuelta a la pieza.
 */
function placeText(piece: Piece, opts: WatermarkOpts, mirror: boolean): PlacedText | null {
  const raster = opts.raster ?? blockTextMask;
  if (!opts.text.trim()) return null;

  let loops: Loop[];
  let fit: number;
  let cx: number;
  let cy: number;

  if (piece.plate) {
    // Margen de respeto al borde: el texto no roza el canto de la pieza.
    const safe = offsetRegions(
      piece.plate.regions.map((r) => r.outer),
      piece.plate.regions.flatMap((r) => r.holes),
      -1.2,
    );
    if (!safe.length) return null;
    const bounds = plateBounds(safe);

    const blocks: TextBlock[] = [];
    for (const n of [1, 2, 3]) {
      const lines = splitLines(opts.text, n);
      if (!lines) continue;
      const block = textBlock(lines, opts.heightMm, raster);
      if (block) blocks.push(block);
    }
    if (!blocks.length) return null;

    let placed: { block: TextBlock; fit: number; cx: number; cy: number } | null = null;
    for (const f of FITS) {
      for (const block of blocks) {
        const spot = scanSpot(safe, bounds, block.w * f, block.h * f);
        if (spot) {
          placed = { block, fit: f, ...spot };
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) return null;

    loops = placed.block.loops;
    ({ fit, cx, cy } = placed);
  } else {
    // Sin placa (relieve a ciegas): borde inferior del envolvente, como antes.
    const block = textBlock([opts.text], opts.heightMm, raster);
    if (!block) return null;
    const fp = footprint(piece.mesh);
    if (!Number.isFinite(fp.minX)) return null;
    const maxW = (fp.maxX - fp.minX) * 0.82;
    loops = block.loops;
    fit = block.w > maxW ? maxW / block.w : 1;
    cx = (fp.minX + fp.maxX) / 2;
    cy = fp.minY + opts.heightMm * 0.5 * fit + 2;
  }

  const place = (pts: Pt[]): Pt[] => {
    const out = pts.map(([x, y]) => [x * fit + cx, y * fit + cy] as Pt);
    // El espejo invierte el sentido de giro; recorrerlo al revés lo restaura.
    return mirror ? out.map(([x, y]) => [2 * cx - x, y] as Pt).reverse() : out;
  };

  return {
    outer: loops.filter((l) => !l.hole).map((l) => place(l.pts)),
    holes: loops.filter((l) => l.hole).map((l) => place(l.pts)),
  };
}

/** Relieve: el texto extruido hacia arriba desde la cara superior de la base. */
function embossOnPiece(piece: Piece, text: PlacedText, depth: number): Piece {
  const regions = offsetRegions(text.outer, text.holes, 0);
  if (!regions.length) return piece;

  const zTop = piece.plate ? piece.plate.zHi : topOfBase(piece.mesh);
  const wm = emptyMesh();
  for (const r of regions) extrudeRegion(wm, r, zTop - 0.01, zTop + depth);

  return { ...piece, mesh: merge(piece.mesh, wm) };
}

/**
 * Grabado en 2D, el patrón de `engraved()` en catalog-parts: la placa se
 * recompone en dos capas y en la INFERIOR el texto entra como agujero del
 * polígono, así que el material desaparece de verdad. La pieza se imprime con
 * esa cara contra la cama y la marca queda en la parte de atrás, sin tocar la
 * cara buena. Necesita que la pieza traiga su placa reconstruible
 * (`piece.plate`); si no, devuelve null y el que llama cae a relieve.
 */
function engraveOnPlate(piece: Piece, text: PlacedText, depth: number): Piece | null {
  const plate = piece.plate;
  if (!plate) return null;

  const zCut = plate.zLo + depth;
  if (zCut >= plate.zHi - 0.2) return null; // placa demasiado fina para grabar

  const upper = emptyMesh();
  for (const r of plate.regions) extrudeRegion(upper, r, zCut, plate.zHi);
  const parts: Mesh[] = [upper];

  for (const r of plate.regions) {
    const carved = sanitize(
      [r.outer, ...text.holes],
      [...r.holes, ...text.outer.map((o) => [...o].reverse() as Pt[])],
    );
    const layer = emptyMesh();
    for (const c of carved) extrudeRegion(layer, c, plate.zLo, zCut);
    parts.push(layer);
  }

  return { ...piece, mesh: merge(...parts, piece.overlay ?? emptyMesh()) };
}

function markPiece(piece: Piece, opts: WatermarkOpts): Piece {
  if (opts.mode === 'engrave' && piece.plate) {
    // En la cara de abajo el texto va espejado.
    const mirrored = placeText(piece, opts, true);
    if (!mirrored) return piece;
    const engraved = engraveOnPlate(piece, mirrored, opts.depth);
    if (engraved) return engraved;
    // Sin sitio para grabar (placa demasiado fina): cae a relieve.
  }

  const text = placeText(piece, opts, false);
  if (!text) return piece;
  return embossOnPiece(piece, text, opts.depth);
}

/** ¿Tiene esta pieza una base plana donde grabar? Un cortador no. */
export function canWatermark(piece: Piece): boolean {
  return piece.role !== 'blade' && !piece.noMark;
}

/** Aplica la marca a las piezas que la admiten; el resto pasan intactas. */
export function applyWatermark(pieces: Piece[], opts: WatermarkOpts): Piece[] {
  if (!opts.text.trim()) return pieces;
  return pieces.map((p) => (canWatermark(p) ? markPiece(p, opts) : p));
}
