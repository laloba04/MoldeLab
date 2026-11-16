/**
 * Figuras de contorno de las Novedades: nube, escudo, bocadillo, fantasma,
 * calabaza, osito y árbol.
 *
 * Cada una se arma juntando piezas sencillas (círculos, óvalos, polígonos) y
 * después se le redondean las esquinas: una plancha de termoformado se rasga
 * por los picos, y una placa con esquinas vivas se ve dura. Se dibujan en una
 * caja de 1 × 1 (y hacia arriba) y se llevan a la caja que se pida.
 */

import type { Pt } from '../types';
import { offsetRegions, sanitize, union, type Region } from './clipper';
import { orient } from './polygon';

export const FIGURAS = ['cloud', 'shield', 'bubble', 'ghost', 'pumpkin', 'bear', 'tree'] as const;
export type Figura = (typeof FIGURAS)[number];

export const esFigura = (s: string): s is Figura => (FIGURAS as readonly string[]).includes(s);

function ovalo(cx: number, cy: number, rx: number, ry: number, seg = 48): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return orient(pts, true);
}

function caja(x0: number, y0: number, x1: number, y1: number): Pt[] {
  return orient([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true);
}

function piezas(f: Figura): Pt[][] {
  switch (f) {
    case 'cloud':
      return [ovalo(-0.55, -0.12, 0.3, 0.3), ovalo(-0.15, 0.1, 0.42, 0.42), ovalo(0.32, 0.06, 0.36, 0.36), ovalo(0.62, -0.14, 0.27, 0.27), caja(-0.6, -0.42, 0.65, -0.1)];
    case 'shield': {
      // Lados rectos arriba y una curva que baja a la punta.
      const pts: Pt[] = [[-0.5, 0.5], [0.5, 0.5], [0.5, 0.05]];
      for (let i = 1; i < 16; i++) {
        const t = i / 16;
        pts.push([0.5 * (1 - t) ** 2, 0.05 - 0.6 * t * (2 - t)]);
      }
      pts.push([0, -0.55]);
      for (let i = 15; i >= 1; i--) {
        const t = i / 16;
        pts.push([-0.5 * (1 - t) ** 2, 0.05 - 0.6 * t * (2 - t)]);
      }
      pts.push([-0.5, 0.05]);
      return [orient(pts, true)];
    }
    case 'bubble':
      return [ovalo(0, 0.12, 0.55, 0.38), orient([[-0.32, -0.1], [-0.05, -0.15], [-0.42, -0.5]], true)];
    case 'ghost':
      return [ovalo(0, 0.12, 0.4, 0.4), caja(-0.4, -0.32, 0.4, 0.12), ...[-0.267, 0, 0.267].map((x) => ovalo(x, -0.32, 0.134, 0.134))];
    case 'pumpkin':
      return [ovalo(-0.24, -0.05, 0.32, 0.38), ovalo(0.24, -0.05, 0.32, 0.38), ovalo(0, -0.05, 0.3, 0.42), caja(-0.06, 0.3, 0.06, 0.5)];
    case 'bear':
      return [ovalo(0, -0.08, 0.42, 0.4), ovalo(-0.3, 0.27, 0.17, 0.17), ovalo(0.3, 0.27, 0.17, 0.17)];
    case 'tree':
      return [
        orient([[-0.5, -0.3], [0.5, -0.3], [0, 0.08]], true),
        orient([[-0.4, -0.05], [0.4, -0.05], [0, 0.3]], true),
        orient([[-0.3, 0.17], [0.3, 0.17], [0, 0.5]], true),
        caja(-0.09, -0.5, 0.09, -0.28),
      ];
  }
}

/** La mayor región de una lista. */
function mayor(rs: Region[]): Pt[] | null {
  let m: Pt[] | null = null;
  let am = 0;
  for (const r of rs) {
    let a = 0;
    for (let i = 0, j = r.outer.length - 1; i < r.outer.length; j = i++)
      a += (r.outer[j][0] - r.outer[i][0]) * (r.outer[j][1] + r.outer[i][1]);
    if (Math.abs(a) > am) {
      am = Math.abs(a);
      m = r.outer;
    }
  }
  return m;
}

/** La figura `f` dentro de la caja `w × h` centrada en (cx,cy). */
export function figura(f: Figura, cx: number, cy: number, w: number, h: number): Pt[] {
  let juntas: Region[] = [];
  // Se trabaja a escala 100 (como milímetros): el redondeo de clipper va en unidades absolutas.
  for (const p0 of piezas(f)) {
    const p = p0.map(([x, y]) => [x * 100, y * 100] as Pt);
    juntas = juntas.length ? union(juntas, sanitize([p], [])) : sanitize([p], []);
  }
  // Redondear: cerrar las rendijas y quitar los picos (unidades de la caja 1×1).
  const fuera = (rs: Region[]) => rs.map((r) => r.outer);
  const r = 3.5;
  const cerrada = offsetRegions(fuera(offsetRegions(fuera(juntas), [], r, 'round')), [], -r, 'round');
  const suave = offsetRegions(fuera(offsetRegions(fuera(cerrada), [], -r, 'round')), [], r, 'round');
  const borde = mayor(suave) ?? mayor(juntas) ?? ovalo(0, 0, 50, 50);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of borde) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const sx = w / (x1 - x0), sy = h / (y1 - y0), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return orient(borde.map(([x, y]) => [cx + (x - mx) * sx, cy + (y - my) * sy] as Pt), true);
}

/** Proporción alto/ancho natural de cada figura. */
export const PROPORCION: Record<Figura, number> = {
  cloud: 0.62, shield: 1.05, bubble: 0.86, ghost: 1, pumpkin: 0.95, bear: 0.95, tree: 1.05,
};
