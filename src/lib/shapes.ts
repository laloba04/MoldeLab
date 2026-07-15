/**
 * Primitivas 2D en milímetros.
 *
 * Todo lo que no sale de la imagen sale de aquí: los cuerpos redondos y
 * cuadrados del eyector, las anillas de los llaveros, las púas del topper.
 * Salen siempre en CCW, que es lo que espera el mallador.
 */

import type { Loop, Pt } from '../types';
import { orient } from './polygon';

export function circle(cx: number, cy: number, r: number, seg = 64): Pt[] {
  const p: Pt[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return orient(p, true);
}

/** Rectángulo con esquinas redondeadas. r = 0 → esquinas vivas. */
export function roundedRect(
  cx: number,
  cy: number,
  w: number,
  h: number,
  r: number,
  seg = 12,
): Pt[] {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const x1 = cx + w / 2;
  const y1 = cy + h / 2;

  if (rr < 1e-3) {
    return orient(
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
      true,
    );
  }

  const pts: Pt[] = [];
  const corners: [number, number, number][] = [
    [x1 - rr, y0 + rr, -Math.PI / 2], // abajo-derecha
    [x1 - rr, y1 - rr, 0], // arriba-derecha
    [x0 + rr, y1 - rr, Math.PI / 2], // arriba-izquierda
    [x0 + rr, y0 + rr, Math.PI], // abajo-izquierda
  ];

  for (const [ccx, ccy, start] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = start + (i / seg) * (Math.PI / 2);
      pts.push([ccx + Math.cos(a) * rr, ccy + Math.sin(a) * rr]);
    }
  }
  return orient(pts, true);
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export function boxOf(loops: Loop[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const l of loops) {
    for (const [x, y] of l.pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, cx: 0, cy: 0, w: 0, h: 0 };

  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
  };
}

export function shiftLoops(loops: Loop[], dx: number, dy: number): Loop[] {
  return loops.map((l) => ({
    hole: l.hole,
    pts: l.pts.map(([x, y]) => [x + dx, y + dy] as Pt),
  }));
}

/**
 * Púas del topper: se pinchan en la tarta, así que van repartidas por la
 * mitad inferior de la silueta y solapan hacia arriba para soldarse a ella.
 */
export function spikes(box: Box, count: number, width: number, length: number): Pt[][] {
  const out: Pt[][] = [];
  const overlap = 4; // se meten dentro de la silueta para que suelden

  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    const x = box.minX + box.w * t;
    const top = box.minY + overlap;
    const bottom = top - length;

    out.push(
      orient(
        [
          [x - width / 2, bottom + width], // punta achaflanada: entra sin romper
          [x, bottom],
          [x + width / 2, bottom + width],
          [x + width / 2, top],
          [x - width / 2, top],
        ],
        true,
      ),
    );
  }
  return out;
}

/** Estadio: rectángulo con los extremos en semicírculo. El agujero del abridor. */
export function stadium(cx: number, cy: number, w: number, h: number, seg = 16): Pt[] {
  const r = h / 2;
  const half = Math.max(0, w / 2 - r);
  const pts: Pt[] = [];

  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (i / seg) * Math.PI;
    pts.push([cx + half + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI / 2 + (i / seg) * Math.PI;
    pts.push([cx - half + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return orient(pts, true);
}
