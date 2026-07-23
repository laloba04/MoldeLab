/**
 * Colocación de las piezas para exportar.
 *
 * Los generadores modelan cada pieza en su sitio del CONJUNTO, no en el de
 * imprimir: el sello lleva el reborde por debajo del cero porque encaja dentro
 * del cortador, el émbolo del eyector baja 34 mm, y las capas de color van
 * apiladas una sobre otra. Eso está bien para verlo en pantalla y fatal para
 * laminar: el laminador baja TODO el conjunto hasta que la pieza más honda
 * toca la cama, y las demás se quedan flotando en el aire. Sale el aviso de
 * «voladizo flotante» y la impresión se va al traste.
 *
 * Aquí se traduce del sitio del conjunto al sitio de la cama.
 */

import type { Piece } from '../types';
import { translate } from './mesh';

/** El punto más bajo de una pieza. */
export function floorOf(p: Piece): number {
  const q = p.mesh.positions;
  let min = Infinity;
  for (let i = 2; i < q.length; i += 3) if (q[i] < min) min = q[i];
  return Number.isFinite(min) ? min : 0;
}

function move(p: Piece, dx: number, dz: number): Piece {
  if (!dx && !dz) return p;
  return {
    ...p,
    mesh: translate(p.mesh, dx, 0, dz),
    overlay: p.overlay ? translate(p.overlay, dx, 0, dz) : undefined,
  };
}

/**
 * En fila sobre la cama, sin solaparse y cada una apoyada por su cuenta.
 * Es como se van a imprimir de verdad.
 */
export function spreadPieces(pieces: Piece[], gap = 6): Piece[] {
  if (!pieces.length) return pieces;
  if (pieces.length === 1) return [move(pieces[0], 0, -floorOf(pieces[0]))];

  const info = pieces.map((p) => {
    let minX = Infinity;
    let maxX = -Infinity;
    const q = p.mesh.positions;
    for (let i = 0; i < q.length; i += 3) {
      if (q[i] < minX) minX = q[i];
      if (q[i] > maxX) maxX = q[i];
    }
    return { minX, w: maxX - minX };
  });

  const total = info.reduce((s, b) => s + b.w, 0) + gap * (pieces.length - 1);
  let cursor = -total / 2;
  return pieces.map((p, i) => {
    const dx = cursor - info[i].minX;
    cursor += info[i].w + gap;
    return move(p, dx, -floorOf(p));
  });
}

/**
 * Sin separar: el conjunto conserva su montaje (para ver cómo encaja), pero se
 * apoya en la cama entero, que nada quede por debajo del cero.
 */
export function dropToBed(pieces: Piece[]): Piece[] {
  if (!pieces.length) return pieces;
  const dz = -Math.min(...pieces.map(floorOf));
  return Math.abs(dz) < 1e-6 ? pieces : pieces.map((p) => move(p, 0, dz));
}
