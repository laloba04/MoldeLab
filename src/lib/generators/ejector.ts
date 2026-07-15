/**
 * Eyector.
 *
 * Dos piezas que se imprimen por separado:
 *  - Cuerpo: tubo abierto arriba y abajo.
 *  - Émbolo: placa que baja por dentro y expulsa la masa, con el dibujo en
 *    relieve para que además la marque, más vástago y pomo.
 *
 * El perfil del cuerpo puede seguir la silueta de la imagen, o ser un círculo
 * o un cuadrado de esquinas redondeadas. En los dos últimos casos la imagen ya
 * no manda en la forma: solo aporta el relieve de la cara del émbolo.
 *
 * La holgura es el único número que importa de verdad: demasiado poca y el
 * émbolo se agarrota, demasiada y la masa se cuela por los lados. 0,35 mm es el
 * punto dulce en FDM con boquilla de 0,4.
 */

import type { Loop, Mesh, Params, Piece, Pt } from '../../types';
import { cylinder, emptyMesh, extrudeRegion, merge } from '../mesh';
import { offsetRegions, sanitize } from '../clipper';
import { boxOf, circle, roundedRect } from '../shapes';
import { reliefSolids } from './catalog-parts';

export type EjectorShape = 'silhouette' | 'round' | 'square';

/** El perfil que define el cuerpo. Es la línea media de la pared. */
function profileOf(loops: Loop[], p: Params, shape: EjectorShape): Pt[][] {
  const box = boxOf(loops);

  if (shape === 'round') {
    return [circle(box.cx, box.cy, Math.max(box.w, box.h) / 2, 72)];
  }
  if (shape === 'square') {
    const side = Math.max(box.w, box.h);
    return [roundedRect(box.cx, box.cy, side, side, p.cornerRadius)];
  }
  return loops.filter((l) => !l.hole).map((l) => l.pts);
}

function solidOf(regions: ReturnType<typeof sanitize>, zLo: number, zHi: number): Mesh {
  const m = emptyMesh();
  for (const r of regions) extrudeRegion(m, r, zLo, zHi);
  return m;
}

export function buildEjector(
  loops: Loop[],
  detail: Loop[],
  p: Params,
  shape: EjectorShape,
): Piece[] {
  const profile = profileOf(loops, p, shape);
  if (!profile.length) return [];

  const half = p.ejectorWall / 2;

  // --- Cuerpo: tubo hueco ---
  const outer = offsetRegions(profile, [], half);
  const innerR = offsetRegions(profile, [], -half);
  const bodyHoles = innerR.map((r) => [...r.outer].reverse() as Pt[]);

  const body = emptyMesh();
  for (const o of outer) {
    for (const r of sanitize([o.outer], bodyHoles)) {
      extrudeRegion(body, r, 0, p.ejectorHeight);
    }
  }

  // --- Émbolo: cara + relieve + vástago + pomo ---
  const faceR = offsetRegions(profile, [], -(half + p.ejectorClearance));
  if (!faceR.length) return [];

  const parts: Mesh[] = [solidOf(faceR, 0, p.plungerThickness)];

  // El relieve mira hacia abajo en la pieza real, pero se genera hacia arriba y
  // el usuario la imprime con la cara buena contra la cama: sin soportes.
  parts.push(...reliefSolids(detail, p, p.plungerThickness - 0.01, p.reliefHeight));

  const c = centroid(faceR[0].outer);
  const zRel = p.plungerThickness + p.reliefHeight;
  const rodTop = zRel + p.rodHeight;

  const rod = emptyMesh();
  cylinder(rod, c[0], c[1], p.rodDiameter / 2, zRel - 0.01, rodTop, 40);
  parts.push(rod);

  const knob = emptyMesh();
  cylinder(knob, c[0], c[1], p.rodDiameter, rodTop - 0.01, rodTop + 4, 40);
  parts.push(knob);

  const pieces: Piece[] = [];
  if (body.positions.length) {
    pieces.push({ id: 'ejector-body', label: 'Cuerpo', role: 'blade', mesh: body });
  }
  const plunger = merge(...parts);
  if (plunger.positions.length) {
    pieces.push({ id: 'ejector-plunger', label: 'Émbolo', role: 'icing', mesh: plunger });
  }
  return pieces;
}

function centroid(pts: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}
