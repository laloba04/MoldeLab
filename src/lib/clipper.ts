/**
 * Offsets robustos.
 *
 * El offset por normales (polygon.ts) es rápido y conserva la correspondencia
 * 1:1 entre puntos, que es justo lo que necesita el loft del cortador. Pero en
 * un ángulo muy agudo se autointersecta: el contorno se cruza consigo mismo y
 * genera un lazo del revés. Al cortador eso solo le sale como un pliegue feo;
 * a earcut, en cambio, le rompe la triangulación y deja la pieza abierta.
 *
 * Aquí se usa Clipper, que resuelve esas autointersecciones de verdad. A cambio
 * el número de puntos cambia y hasta puede partir un polígono en varios, así
 * que solo se usa donde no hace falta correspondencia: caras planas y prismas
 * rectos.
 */

import ClipperLib from 'clipper-lib';
import type { Pt } from '../types';

// Clipper trabaja en enteros. 1 unidad = 1 µm: de sobra para impresión 3D.
const S = 1000;

type Path = { X: number; Y: number }[];

const toPath = (pts: Pt[]): Path => pts.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }));
const fromPath = (p: Path): Pt[] => p.map((q) => [q.X / S, q.Y / S]);

export interface Region {
  outer: Pt[]; // CCW
  holes: Pt[][]; // CW
}

/** Agrupa una lista plana de paths en regiones (exterior + sus agujeros). */
function toRegions(paths: Path[]): Region[] {
  const outers: Path[] = [];
  const holes: Path[] = [];

  for (const p of paths) {
    if (p.length < 3) continue;
    (ClipperLib.Clipper.Orientation(p) ? outers : holes).push(p);
  }

  const regions: Region[] = outers.map((o) => ({ outer: fromPath(o), holes: [] }));

  for (const h of holes) {
    const pt = h[0];
    // El agujero pertenece al exterior más pequeño que lo contiene.
    let best = -1;
    let bestArea = Infinity;
    for (let i = 0; i < outers.length; i++) {
      if (ClipperLib.Clipper.PointInPolygon(pt, outers[i]) !== 0) {
        const a = Math.abs(ClipperLib.Clipper.Area(outers[i]));
        if (a < bestArea) {
          bestArea = a;
          best = i;
        }
      }
    }
    if (best >= 0) regions[best].holes.push(fromPath(h));
  }

  return regions;
}

/**
 * Desplaza un conjunto de anillos `delta` mm (negativo = hacia dentro) y
 * devuelve regiones limpias, listas para triangular.
 */
export function offsetRegions(outer: Pt[][], holes: Pt[][], delta: number): Region[] {
  const co = new ClipperLib.ClipperOffset(2, 0.25 * S);

  for (const o of outer) {
    co.AddPath(toPath(o), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  }
  for (const h of holes) {
    co.AddPath(toPath(h), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  }

  const solution: Path[] = [];
  co.Execute(solution, delta * S);

  const clean = ClipperLib.Clipper.SimplifyPolygons(solution, ClipperLib.PolyFillType.pftNonZero);
  return toRegions(clean);
}

/** Sanea sin mover nada: resuelve cruces y orienta islas/agujeros. */
export function sanitize(outer: Pt[][], holes: Pt[][]): Region[] {
  return offsetRegions(outer, holes, 0);
}

/**
 * Intersección booleana 2D: lo que queda de `subject` dentro de `clip`.
 * Es la pieza que faltaba para el puzzle y el llavero articulado: recortar la
 * silueta con una rejilla de celdas sin tocar ninguna malla 3D.
 */
export function intersect(subject: Region[], clip: Pt[][]): Region[] {
  const c = new ClipperLib.Clipper();

  for (const r of subject) {
    c.AddPath(toPath(r.outer), ClipperLib.PolyType.ptSubject, true);
    for (const h of r.holes) c.AddPath(toPath(h), ClipperLib.PolyType.ptSubject, true);
  }
  for (const k of clip) c.AddPath(toPath(k), ClipperLib.PolyType.ptClip, true);

  const solution: Path[] = [];
  c.Execute(
    ClipperLib.ClipType.ctIntersection,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return toRegions(solution);
}

/**
 * Cuánto se ha deformado un offset por normales frente al de verdad.
 * Se usa para avisar en la interfaz de que el contorno tiene picos imposibles.
 */
export function offsetError(pts: Pt[], approx: Pt[], delta: number): number {
  const real = offsetRegions([pts], [], delta);
  if (!real.length) return 1;

  const areaOf = (p: Pt[]) => {
    let a = 0;
    for (let i = 0, n = p.length; i < n; i++) {
      const [x1, y1] = p[i];
      const [x2, y2] = p[(i + 1) % n];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a / 2);
  };

  const realArea = real.reduce((s, r) => s + areaOf(r.outer), 0);
  const approxArea = areaOf(approx);
  if (realArea <= 0) return 1;
  return Math.abs(approxArea - realArea) / realArea;
}
