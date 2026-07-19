/**
 * Orquestador. Imagen dentro, piezas fuera.
 *
 *   imagen -> máscara -> limpieza -> relleno -> contornos -> mm ->
 *   simplificado -> suavizado -> anidamiento -> centrado -> producto
 *
 * Se separa en dos pasos porque cambiar la altura de un cortador no debería
 * obligar a re-vectorizar la imagen: `vectorize` es lo caro, `buildProduct` es
 * lo que se re-ejecuta con cada movimiento de un slider.
 */

import type { Loop, Params, Piece, Pt, Silhouette } from '../types';
import { binarize, cleanupMask, fillEnclosed, pad, type Mask } from './image';
import { traceContours } from './contours';
import { area, dedupe, orient, pointInPolygon, resample, simplify, smooth } from './polygon';
import { boxOf, shiftLoops } from './shapes';
import { buildProduct, byId } from './catalog';

const BORDER = 2;

/**
 * Contornos de una máscara -> lazos en mm, orientados y clasificados.
 * `resampleMm` es el paso al que se reparten los puntos del contorno: fino
 * (≈0.5) conserva los detalles pequeños; grueso (≈1.2) da menos triángulos.
 */
function loopsFromMask(
  mask: Mask,
  p: Params,
  mmPerPx: number,
  minAreaMm2: number,
  resampleMm = 1.2,
): Loop[] {
  const raw = traceContours(pad(mask, BORDER));
  const loops: Loop[] = [];

  for (const c of raw) {
    // A milímetros. Se invierte Y para pasar de coordenadas de imagen a las del
    // mundo 3D, donde Y sube.
    let pts: Pt[] = c.map(([x, y]) => [(x - BORDER) * mmPerPx, -(y - BORDER) * mmPerPx]);

    pts = dedupe(pts);
    if (pts.length < 3 || area(pts) < minAreaMm2) continue;

    pts = simplify(pts, p.simplify);
    pts = smooth(pts, p.smooth);
    pts = dedupe(pts);
    pts = resample(pts, resampleMm);
    if (pts.length < 3) continue;

    loops.push({ pts, hole: false });
  }

  // Anidamiento: un lazo dentro de un número impar de otros es un agujero.
  for (const l of loops) {
    let depth = 0;
    for (const other of loops) {
      if (other !== l && pointInPolygon(l.pts[0], other.pts)) depth++;
    }
    l.hole = depth % 2 === 1;
    l.pts = orient(l.pts, !l.hole); // islas CCW, agujeros CW
  }

  return loops;
}

export function vectorize(img: ImageData, p: Params): Silhouette {
  const mmPerPx = p.targetWidthMm / img.width;

  // La silueta y el relieve pueden salir de umbrales distintos. En una foto eso
  // marca la diferencia entre un contorno limpio y un contorno con detalle.
  const solidBin = binarize(img, p.threshold, p.invert);
  const detailBin = p.useDetailThreshold
    ? binarize(img, p.detailThreshold, p.invert)
    : solidBin;

  const solidMask = fillEnclosed(p.cleanup > 0 ? cleanupMask(solidBin, p.cleanup) : solidBin);
  const detailMask = p.cleanup > 0 ? cleanupMask(detailBin, p.cleanup) : detailBin;

  const all = loopsFromMask(solidMask, p, mmPerPx, 0);

  // Descarta islas de ruido, y con ellas los agujeros que vivían dentro.
  const islands = all.filter((l) => !l.hole);
  const biggest = islands.reduce((m, l) => Math.max(m, area(l.pts)), 0);
  const minArea = (biggest * p.minIslandPct) / 100;

  const kept = islands.filter((l) => area(l.pts) >= minArea);
  const kholes = all.filter(
    (l) => l.hole && kept.some((i) => pointInPolygon(l.pts[0], i.pts)),
  );

  let loops = [...kept, ...kholes];
  // El detalle lleva las líneas finas (venas, filigranas): se remuestrea a un
  // paso fino (0.5 mm) para que no se redondeen ni se emborronen.
  let detail = loopsFromMask(detailMask, p, mmPerPx, minArea * 0.02, 0.5);

  // Bandas por umbral para los productos en capas: la capa 0 es la silueta
  // entera y cada banda siguiente es lo que queda por debajo de un umbral más
  // exigente — la zona más oscura de la imagen, cada vez más pequeña.
  let bands: Loop[][] | undefined;
  if (byId(p.product).needsBands) {
    bands = [loops];
    const nExtra = Math.max(1, p.layers - 1);
    for (let i = 1; i <= nExtra; i++) {
      const t = Math.max(10, Math.round(p.threshold * (1 - i / (nExtra + 1))));
      const bin = binarize(img, t, p.invert);
      const m = p.cleanup > 0 ? cleanupMask(bin, p.cleanup) : bin;
      bands.push(loopsFromMask(m, p, mmPerPx, minArea * 0.05, 0.6));
    }
  }

  // Todo centrado en el origen: los productos con marco, peana o púas necesitan
  // un bounding box con el que contar, y el visor lo agradece.
  const box = boxOf(loops.length ? loops : detail);
  loops = shiftLoops(loops, -box.cx, -box.cy);
  detail = shiftLoops(detail, -box.cx, -box.cy);
  bands = bands?.map((b) => shiftLoops(b, -box.cx, -box.cy));

  return { loops, detail, bands, widthMm: box.w, heightMm: box.h };
}

export function buildPieces(s: Silhouette, p: Params): Piece[] {
  if (!s.loops.length) return [];
  return buildProduct(s, p);
}
