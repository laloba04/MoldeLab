/**
 * Construcción de mallas triangulares.
 *
 * Todo se apoya en dos primitivas: `loft` (une dos anillos con una banda de
 * quads) y `cap` (tapa un polígono con agujeros vía earcut). Con esas dos
 * salen el cortador, el sello y el eyector sin ningún caso especial.
 */

import earcut from 'earcut';
import { sanitize, type Region } from './clipper';
import type { Mesh, Pt } from '../types';
import { offset, orient } from './polygon';

export const emptyMesh = (): Mesh => ({ positions: [] });

export function tri(m: Mesh, a: number[], b: number[], c: number[]) {
  m.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

/** Quad con vértices en orden antihorario visto desde su cara buena. */
export function quad(m: Mesh, a: number[], b: number[], c: number[], d: number[]) {
  tri(m, a, b, c);
  tri(m, a, c, d);
}

export function merge(...meshes: Mesh[]): Mesh {
  const out = emptyMesh();
  for (const m of meshes) {
    // Nada de push(...src): con mallas grandes el spread desborda la pila.
    const dst = out.positions;
    const src = m.positions;
    const off = dst.length;
    dst.length = off + src.length;
    for (let i = 0; i < src.length; i++) dst[off + i] = src[i];
  }
  return out;
}

export function translate(m: Mesh, dx: number, dy: number, dz: number): Mesh {
  const p = m.positions.slice();
  for (let i = 0; i < p.length; i += 3) {
    p[i] += dx;
    p[i + 1] += dy;
    p[i + 2] += dz;
  }
  return { positions: p };
}

/**
 * Banda lateral entre dos anillos del mismo número de puntos.
 * `outward` indica si la cara mira hacia fuera del anillo (pared exterior)
 * o hacia dentro (pared del hueco de un cortador).
 */
export function loft(m: Mesh, lower: Pt[], zLo: number, upper: Pt[], zHi: number, outward: boolean) {
  const n = lower.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = [lower[i][0], lower[i][1], zLo];
    const b = [lower[j][0], lower[j][1], zLo];
    const c = [upper[j][0], upper[j][1], zHi];
    const d = [upper[i][0], upper[i][1], zHi];
    if (outward) quad(m, a, b, c, d);
    else quad(m, a, d, c, b);
  }
}

/**
 * Tapa plana en z. `up` = normal hacia +Z.
 * `outerCcw` debe venir en CCW y los agujeros en CW.
 */
export function cap(m: Mesh, outerCcw: Pt[], holesCw: Pt[][], z: number, up: boolean) {
  const flat: number[] = [];
  const holeIdx: number[] = [];

  for (const [x, y] of outerCcw) flat.push(x, y);
  for (const hole of holesCw) {
    holeIdx.push(flat.length / 2);
    for (const [x, y] of hole) flat.push(x, y);
  }

  const idx = earcut(flat, holeIdx.length ? holeIdx : undefined, 2);
  const at = (i: number) => [flat[i * 2], flat[i * 2 + 1], z];

  // earcut devuelve triángulos CCW en XY, que es justo la normal +Z.
  for (let i = 0; i < idx.length; i += 3) {
    const a = at(idx[i]);
    const b = at(idx[i + 1]);
    const c = at(idx[i + 2]);
    if (up) tri(m, a, b, c);
    else tri(m, a, c, b);
  }
}

/**
 * Prisma recto sobre una región ya saneada. Al usar exactamente el mismo
 * anillo arriba y abajo, la correspondencia de puntos es trivial y el sólido
 * cierra siempre. Un taper por offset partiría esa correspondencia y dejaría la
 * pieza abierta; el ángulo de salida se hace apilando prismas (ver stamp.ts).
 */
export function extrudeRegion(m: Mesh, region: Region, zLo: number, zHi: number) {
  const { outer, holes } = region;
  if (outer.length < 3) return;

  loft(m, outer, zLo, outer, zHi, true);
  // El agujero llega en CW: ese orden ya voltea la cara. Pasarle outward=false
  // encima lo invertiría dos veces y las aristas dejarían de emparejar.
  for (const h of holes) loft(m, h, zLo, h, zHi, true);
  cap(m, outer, holes, zLo, false);
  cap(m, outer, holes, zHi, true);
}

/** Prisma sólido: un polígono (con agujeros) extruido entre dos alturas. */
export function extrude(m: Mesh, outerCcw: Pt[], holesCw: Pt[][], zLo: number, zHi: number) {
  for (const r of sanitize([outerCcw], holesCw)) {
    extrudeRegion(m, r, zLo, zHi);
  }
}

/** Cilindro sólido de eje Z. */
export function cylinder(m: Mesh, cx: number, cy: number, r: number, zLo: number, zHi: number, seg = 48) {
  const ring: Pt[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  extrudeRegion(m, { outer: orient(ring, true), holes: [] }, zLo, zHi);
}

/** Perímetro total, para estimar cuánto filamento se va en la pieza. */
export function triangleCount(m: Mesh) {
  return m.positions.length / 9;
}
