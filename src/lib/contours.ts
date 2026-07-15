/**
 * Marching squares.
 *
 * Recorre la rejilla celda a celda, emite segmentos orientados (material a la
 * izquierda) y los encadena en polígonos cerrados. Devuelve todos los
 * contornos: el borde exterior de cada isla y el de cada agujero.
 */

import type { Mask } from './image';
import type { Pt } from '../types';

/** Los 16 casos. Cada segmento es [desde, hasta] usando puntos medios de arista. */
type Edge = 'T' | 'R' | 'B' | 'L';
const CASES: Edge[][][] = [
  [], // 0000
  [['B', 'L']], // 0001
  [['R', 'B']], // 0010
  [['R', 'L']], // 0011
  [['T', 'R']], // 0100
  [
    ['T', 'L'],
    ['B', 'R'],
  ], // 0101 silla
  [['T', 'B']], // 0110
  [['T', 'L']], // 0111
  [['L', 'T']], // 1000
  [['B', 'T']], // 1001
  [
    ['L', 'B'],
    ['R', 'T'],
  ], // 1010 silla
  [['R', 'T']], // 1011
  [['L', 'R']], // 1100
  [['B', 'R']], // 1101
  [['L', 'B']], // 1110
  [], // 1111
];

function edgePoint(e: Edge, x: number, y: number): Pt {
  switch (e) {
    case 'T':
      return [x + 0.5, y];
    case 'R':
      return [x + 1, y + 0.5];
    case 'B':
      return [x + 0.5, y + 1];
    case 'L':
      return [x, y + 0.5];
  }
}

// Los puntos caen siempre en múltiplos de 0.5 -> clave entera exacta.
const key = (p: Pt) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;

/** Contornos en coordenadas de píxel (y hacia abajo). */
export function traceContours(m: Mask): Pt[][] {
  const { w, h, data } = m;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[y * w + x]);

  // Cada punto de partida guarda los segmentos que salen de él.
  const outgoing = new Map<string, Pt[][]>();
  let total = 0;

  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const idx =
        at(x, y) * 8 + at(x + 1, y) * 4 + at(x + 1, y + 1) * 2 + at(x, y + 1) * 1;
      for (const [a, b] of CASES[idx]) {
        const seg: Pt[] = [edgePoint(a, x, y), edgePoint(b, x, y)];
        const k = key(seg[0]);
        const list = outgoing.get(k);
        if (list) list.push(seg);
        else outgoing.set(k, [seg]);
        total++;
      }
    }
  }

  const loops: Pt[][] = [];

  while (total > 0) {
    // Coge cualquier segmento vivo como semilla.
    let seed: Pt[] | undefined;
    let seedKey = '';
    for (const [k, list] of outgoing) {
      if (list.length) {
        seed = list.pop();
        seedKey = k;
        total--;
        break;
      }
    }
    if (!seed) break;
    if (!outgoing.get(seedKey)!.length) outgoing.delete(seedKey);

    const loop: Pt[] = [seed[0]];
    let cursor = seed[1];
    const startKey = seedKey;

    // El guard se fija ANTES de entrar: `total` baja en cada vuelta y usarlo
    // como límite del bucle iba cortando los lazos por la mitad.
    const guardLimit = total + 2;

    // Camina de segmento en segmento hasta volver al punto de partida.
    for (let guard = 0; guard < guardLimit; guard++) {
      if (key(cursor) === startKey) break;
      const list = outgoing.get(key(cursor));
      if (!list || !list.length) break; // cadena rota: la cerramos igualmente
      const next = list.pop()!;
      total--;
      if (!list.length) outgoing.delete(key(cursor));
      loop.push(next[0]);
      cursor = next[1];
    }

    if (loop.length >= 3) loops.push(loop);
  }

  return loops;
}
