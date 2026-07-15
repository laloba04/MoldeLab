/**
 * Sello / marcador.
 *
 * Placa que encaja dentro del cortador, con el dibujo en relieve.
 *
 * El ángulo de salida no se hace deformando las paredes (eso rompería la
 * correspondencia de puntos del loft y dejaría la pieza abierta), sino
 * apilando prismas rectos cada vez más pequeños. A 0,2 mm de capa la escalera
 * resultante es exactamente lo que la impresora iba a hacer de todas formas, y
 * cada escalón es un sólido cerrado por su cuenta.
 *
 *      ▁▁▁      ← nivel 3 (el más estrecho, el que marca)
 *     ▁▛▀▀▜▁    ← nivel 2
 *    ▟▛    ▜▙   ← nivel 1
 *   ▟▛▔▔▔▔▔▔▜▙  ← placa
 */

import type { Loop, Mesh, Params } from '../../types';
import { cylinder, emptyMesh, extrudeRegion, merge } from '../mesh';
import { offsetRegions, type Region } from '../clipper';

const PLATE_CLEARANCE = 0.3; // holgura para que la placa entre en el cortador
const STEPS = 3; // escalones del ángulo de salida

/** La región de la placa base del sello: la misma que extruye stampSolids,
 *  compartida para que la marca de agua pueda recomponerla. */
export function stampBaseRegions(loops: Loop[]): Region[] {
  const outer = loops.filter((l) => !l.hole).map((l) => l.pts);
  const holes = loops.filter((l) => l.hole).map((l) => l.pts);
  if (!outer.length) return [];
  return offsetRegions(outer, holes, -PLATE_CLEARANCE);
}

/** Cada sólido cerrado por separado. La unión la resuelve el laminador. */
export function stampSolids(loops: Loop[], detail: Loop[], p: Params): Mesh[] {
  const solids: Mesh[] = [];

  // --- Placa base ---
  const base = stampBaseRegions(loops);
  if (!base.length) return solids;
  for (const region of base) {
    const m = emptyMesh();
    extrudeRegion(m, region, 0, p.stampBase);
    solids.push(m);
  }

  // --- Relieve, escalón a escalón ---
  const dOuter = detail.filter((l) => !l.hole).map((l) => l.pts);
  const dHoles = detail.filter((l) => l.hole).map((l) => l.pts);

  if (dOuter.length) {
    const steps = p.reliefTaper > 0.01 ? STEPS : 1;
    const dz = p.reliefHeight / steps;

    for (let s = 0; s < steps; s++) {
      const shrink = -p.reliefTaper * s;
      const zLo = p.stampBase + dz * s - (s === 0 ? 0.01 : 0);
      const zHi = p.stampBase + dz * (s + 1);

      for (const region of offsetRegions(dOuter, dHoles, shrink)) {
        const m = emptyMesh();
        // Cada escalón arranca en la base: son prismas apilados, no un cono.
        extrudeRegion(m, region, zLo, zHi);
        solids.push(m);
      }
    }
  }

  // --- Tirador ---
  if (p.handle) {
    const c = centroidOf(base[0].outer);
    const m = emptyMesh();
    cylinder(m, c[0], c[1], 6, -18, 0.01, 40);
    solids.push(m);
  }

  return solids;
}

export function buildStamp(loops: Loop[], detail: Loop[], p: Params): Mesh {
  return merge(...stampSolids(loops, detail, p));
}

function centroidOf(pts: [number, number][]): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}
