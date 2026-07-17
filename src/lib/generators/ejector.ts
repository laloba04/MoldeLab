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
import { fitDetailToBase, reliefSolids } from './catalog-parts';

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

  const base = solidOf(faceR, 0, p.plungerThickness);

  // En redondo/cuadrado la cara del émbolo es más pequeña que la imagen, así que
  // el dibujo se encoge para caber ENTERO dentro (nada fuera del círculo). En
  // silueta la cara ya sigue la imagen, así que va a tamaño natural.
  const fitted = shape === 'silhouette' ? detail : fitDetailToBase(detail, faceR);
  const clip = shape === 'silhouette' ? undefined : faceR.map((r) => r.outer);

  // El dibujo (relieve) va en la cara de arriba, que es la que estampa. El
  // vástago y el pomo se llevan a la cara CONTRARIA (por debajo del émbolo), no
  // encima del dibujo: así el mango no tapa lo que tiene que marcar.
  const extras: Mesh[] = [...reliefSolids(fitted, p, p.plungerThickness - 0.01, p.reliefHeight, clip)];

  const c = centroid(faceR[0].outer);

  const rod = emptyMesh();
  cylinder(rod, c[0], c[1], p.rodDiameter / 2, -p.rodHeight, 0.01, 40);
  extras.push(rod);

  const knob = emptyMesh();
  cylinder(knob, c[0], c[1], p.rodDiameter, -p.rodHeight - 4, -p.rodHeight + 0.01, 40);
  extras.push(knob);

  const pieces: Piece[] = [];
  if (body.positions.length) {
    pieces.push({ id: 'ejector-body', label: 'Cuerpo', role: 'blade', mesh: body });
  }
  const overlay = merge(...extras);
  const plunger = merge(base, overlay);
  if (plunger.positions.length) {
    // La placa del émbolo es reconstruible: la marca de agua se graba en su
    // cara inferior (la del vástago), nunca sobre el dibujo estampado.
    pieces.push({
      id: 'ejector-plunger',
      label: 'Émbolo',
      role: 'icing',
      mesh: plunger,
      plate: { regions: faceR, zLo: 0, zHi: p.plungerThickness },
      overlay,
    });
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
