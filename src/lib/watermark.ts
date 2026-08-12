/**
 * Marca de agua grabada en la pieza.
 *
 * No es un overlay de pantalla: es geometría real que viaja dentro del STL y
 * del 3MF. Se busca un hueco donde el texto quepa ENTERO dentro del material
 * —medio texto grabado al aire no vale— y ahí se hunde o se levanta.
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
 * En el navegador el texto se rasteriza con las tipografías empaquetadas
 * (`font.ts`) y se vectoriza. Fuera del navegador no hay canvas, así que se cae
 * a la fuente de trazo del mismo módulo: los tests recorren en Node todo el
 * camino de la marca sin montar un navegador.
 */

import type { Loop, Mesh, Piece, Pt } from '../types';
import { area, orient } from './polygon';
import { emptyMesh, extrudeRegion, merge } from './mesh';
import { intersect, offsetRegions, sanitize, strokeOpen } from './clipper';
import { bendPaths, fontCss, fontOf, textPaths, type FontStyle } from './font';
import { binarize, cleanupMask, pad, type Mask } from './image';
import { traceContours } from './contours';
import { dedupe, pointInPolygon, resample, simplify, smooth } from './polygon';
import { boxOf } from './shapes';

export interface WatermarkOpts {
  text: string;
  /** 'engrave' hunde el texto en la base; 'emboss' lo levanta. */
  mode: 'engrave' | 'emboss';
  depth: number; // mm
  heightMm: number; // altura de la mayúscula en la pieza
  /** Tipografía. Por defecto, la redonda. */
  style?: FontStyle;
  /** Curvar el texto sobre un arco. */
  arc?: boolean;
  /**
   * Texto -> máscara binaria, con las fuentes de verdad. Lo inyecta el
   * navegador (`rasterizeText`, necesita canvas). Sin él se usa la fuente de
   * trazo de `font.ts`, que corre en Node y es la que ven los tests.
   */
  raster?: (text: string, style: FontStyle) => Mask;
}

/**
 * Texto -> máscara binaria, con la tipografía empaquetada. Solo navegador.
 *
 * Además de rellenar la letra se la repasa con un trazo redondo. No es un
 * capricho estético: el surco grabado tiene que medir por lo menos dos pasadas
 * de boquilla o el laminador no lo rellena, y los palos finos de una tipografía
 * a 5 mm de altura se quedan justos. El repaso los engorda lo justo sin cerrar
 * las tripas de las letras.
 */
export function rasterizeText(text: string, style: FontStyle): Mask {
  const px = 260;
  const margen = 40;
  const font = fontCss(style, px);

  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + margen * 2;
  const h = Math.ceil(px * 1.7) + margen * 2;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = px * fontOf(style).fatten;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  if (ctx.lineWidth > 0) ctx.strokeText(text, w / 2, h / 2);
  ctx.fillText(text, w / 2, h / 2);

  return binarize(ctx.getImageData(0, 0, w, h), 128, false);
}

/** Contornos de una máscara de texto, escalados para medir `heightMm`. */
function loopsFromMask(mask: Mask, heightMm: number): Loop[] {
  let loops: Loop[] = [];
  for (const c of traceContours(pad(cleanupMask(mask, 1), 2))) {
    let pts: Pt[] = dedupe(c.map(([x, y]) => [x, -y] as Pt));
    if (pts.length < 3) continue;
    pts = resample(dedupe(smooth(simplify(pts, 0.5), 1)), 1.2);
    if (pts.length >= 3) loops.push({ pts, hole: false });
  }
  if (!loops.length) return [];

  const box = boxOf(loops);
  const escala = heightMm / box.h;
  loops = loops.map((l) => ({
    hole: false,
    pts: l.pts.map(([x, y]) => [(x - box.cx) * escala, (y - box.cy) * escala] as Pt),
  }));

  // Anidar: la tripa de una «a» o de una «o» es un agujero.
  for (const l of loops) {
    let dentro = 0;
    for (const o of loops) if (o !== l && pointInPolygon(l.pts[0], o.pts)) dentro++;
    l.hole = dentro % 2 === 1;
    l.pts = orient(l.pts, !l.hole);
  }
  return loops;
}

/** Una línea de texto convertida en material, centrada en el origen. */
function textLoops(text: string, heightMm: number, opts: WatermarkOpts): Loop[] {
  const style = opts.style ?? 'redonda';
  const loops = opts.raster
    ? loopsFromMask(opts.raster(text, style), heightMm)
    : loopsDeTrazo(text, heightMm);
  if (!loops.length || !opts.arc) return loops;

  // Curvar se hace sobre los contornos ya trazados, así vale igual para las
  // tipografías empaquetadas que para la fuente de trazo de respaldo.
  const b = boxOf(loops);
  const curvo = bendPaths(loops.map((l) => l.pts), b.w).map((pts, i) => ({
    hole: loops[i].hole,
    pts,
  }));
  const c = boxOf(curvo);
  return curvo.map((l) => ({
    hole: l.hole,
    pts: l.pts.map(([x, y]) => [x - c.cx, y - c.cy] as Pt),
  }));
}

/** El respaldo sin canvas: la fuente de trazo propia, que corre en Node y es la
 *  que ven los tests. */
function loopsDeTrazo(text: string, heightMm: number): Loop[] {
  const { paths } = textPaths(text);
  if (!paths.length) return [];
  const enMm = paths.map((p) => p.map(([x, y]) => [x * heightMm, y * heightMm] as Pt));
  const regions = strokeOpen(enMm, Math.max(0.8, heightMm * 0.17));

  const loops: Loop[] = [];
  for (const r of regions) {
    loops.push({ pts: orient(r.outer, true), hole: false });
    for (const h of r.holes) loops.push({ pts: orient(h, false), hole: true });
  }
  if (!loops.length) return [];

  const box = boxOf(loops);
  return loops.map((l) => ({
    hole: l.hole,
    pts: l.pts.map(([x, y]) => [x - box.cx, y - box.cy] as Pt),
  }));
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

/**
 * Por debajo de esto la marca deja de leerse.
 *
 * El trazo tiene un mínimo de 0,8 mm porque si no la impresora no lo rellena;
 * con la mayúscula por debajo de 3,2 mm ese trazo se come la letra y el texto
 * se convierte en un borrón. Antes se encogía hasta la mitad con tal de que
 * cupiera, y por eso salía ilegible. Más vale partirlo en dos líneas —o no
 * ponerlo— que grabar una mancha.
 */
const MIN_CAP_MM = 3.2;

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
function textBlock(lines: string[], heightMm: number, opts: WatermarkOpts): TextBlock | null {
  const pitch = heightMm * 1.3; // interlineado
  const all: Loop[] = [];

  for (let i = 0; i < lines.length; i++) {
    const loops = textLoops(lines[i], heightMm, opts);
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
      const block = textBlock(lines, opts.heightMm, opts);
      if (block) blocks.push(block);
    }
    if (!blocks.length) return null;

    // Solo las escalas que dejan la letra legible; si ninguna llega, se prueba
    // al menos la más pequeña antes de rendirse.
    const escalas = FITS.filter((f) => opts.heightMm * f >= MIN_CAP_MM);
    if (!escalas.length) escalas.push(FITS[FITS.length - 1]);

    let placed: { block: TextBlock; fit: number; cx: number; cy: number } | null = null;
    for (const f of escalas) {
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
    const block = textBlock([opts.text], opts.heightMm, opts);
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
    // Solo se talla en la placa donde de verdad cae el texto. Si se intentara en
    // todas, cada trozo suelto de la pieza acabaría con restos del grabado.
    const aqui = intersect([{ outer: r.outer, holes: r.holes }], text.outer).length > 0;
    const carved = !aqui
      ? [{ outer: r.outer, holes: r.holes }]
      : sanitize(
          [r.outer, ...text.holes],
          [...r.holes, ...text.outer.map((o) => [...o].reverse() as Pt[])],
        );
    const layer = emptyMesh();
    for (const c of carved) extrudeRegion(layer, c, plate.zLo, zCut);
    parts.push(layer);
  }

  // El orden se respeta: placa, cuerpo, y el relieve SIEMPRE al final, que es
  // como el visor y el 3MF distinguen el dibujo del resto.
  return {
    ...piece,
    mesh: merge(...parts, piece.keep ?? emptyMesh(), piece.overlay ?? emptyMesh()),
  };
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
