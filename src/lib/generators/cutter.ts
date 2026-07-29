/**
 * Cortador.
 *
 * La pieza es un tubo cerrado que sigue la silueta. En vez de mallar cada
 * tramo a mano, se define un perfil vertical —una lista de anillos (z, offset
 * exterior, offset interior)— y se hace loft entre anillos consecutivos.
 * Cambiar la forma de la pared es cambiar el perfil, nada más.
 *
 *   z = altura        pestaña ancha abajo (agarra la cama de impresión),
 *   ^                 pared recta en medio, filo fino arriba (el que corta).
 *   |    ▲ filo
 *   |    █
 *   |    █ pared
 *   |  ▄▄█▄▄ pestaña
 *   +--------→
 */

import type { Loop, Mesh, Params, Pt } from '../../types';
import { emptyMesh, extrudeRegion, loft, quad, merge } from '../mesh';
import { offset } from '../polygon';
import { offsetRegions, sanitize, subtract } from '../clipper';

interface Ring {
  z: number;
  out: number; // offset hacia fuera desde la línea de corte
  in: number; // offset hacia dentro (positivo = se aleja de la línea)
}

function profile(p: Params): Ring[] {
  const half = p.wallThickness / 2;
  const blade = Math.max(0.2, Math.min(p.bladeThickness, p.wallThickness)) / 2;
  const h = p.cutterHeight;
  const bladeH = Math.min(p.bladeHeight, h * 0.6);
  const flangeTop = Math.min(p.flangeHeight, h * 0.3);

  const rings: Ring[] = [];

  if (p.flangeWidth > 0 && flangeTop > 0) {
    rings.push({ z: 0, out: half + p.flangeWidth, in: half });
    rings.push({ z: flangeTop, out: half + p.flangeWidth, in: half });
    // Chaflán de 45º: la pestaña se funde con la pared sin voladizo.
    rings.push({ z: flangeTop + p.flangeWidth, out: half, in: half });
  } else {
    rings.push({ z: 0, out: half, in: half });
  }

  rings.push({ z: h - bladeH, out: half, in: half });
  rings.push({ z: h, out: blade, in: blade });

  return rings.filter((r, i, a) => i === 0 || r.z > a[i - 1].z - 1e-6);
}

// Miter bajo: en una esquina puntiaguda, el offset por normales estira el
// vértice hasta MITER_LIMIT×distancia y sale un pincho. Con la pestaña ancha
// (~2 mm) eso es un pincho enorme. Aquí se limita a poco más de 1: la esquina se
// bisela un pelín en vez de pinchar, que en un cortador ni se nota.
const CUT_MITER = 1.15;

/** Un tubo siguiendo un anillo. `hole` invierte hacia dónde es "fuera". */
function tube(line: Pt[], rings: Ring[], hole: boolean): Mesh {
  const m = emptyMesh();
  const s = hole ? -1 : 1;

  const outer = rings.map((r) => offset(line, r.out * s, CUT_MITER));
  const inner = rings.map((r) => offset(line, -r.in * s, CUT_MITER));

  for (let i = 0; i < rings.length - 1; i++) {
    loft(m, outer[i], rings[i].z, outer[i + 1], rings[i + 1].z, !hole);
    loft(m, inner[i], rings[i].z, inner[i + 1], rings[i + 1].z, hole);
  }

  // Anillo de abajo (normal -Z) y filo de arriba (normal +Z).
  band(m, outer[0], inner[0], rings[0].z, false, hole);
  const last = rings.length - 1;
  band(m, outer[last], inner[last], rings[last].z, true, hole);

  return m;
}

/** Corona plana entre el anillo exterior y el interior, a una altura fija. */
function band(m: Mesh, outer: Pt[], inner: Pt[], z: number, up: boolean, hole: boolean) {
  const n = outer.length;
  const faceUp = up !== hole ? up : up; // la orientación ya viene dada por outer/inner
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = [outer[i][0], outer[i][1], z];
    const b = [outer[j][0], outer[j][1], z];
    const c = [inner[j][0], inner[j][1], z];
    const d = [inner[i][0], inner[i][1], z];
    // outer va CCW en una isla: (a,b,c,d) da normal +Z.
    if (faceUp !== hole) quad(m, a, b, c, d);
    else quad(m, a, d, c, b);
  }
}

/** Los dos puntos más cercanos entre dos contornos, y su distancia. */
function closestPair(a: Pt[], b: Pt[]): { pa: Pt; pb: Pt; d: number } {
  let best = { pa: a[0], pb: b[0], d: Infinity };
  for (const x of a) {
    for (const y of b) {
      const d = Math.hypot(x[0] - y[0], x[1] - y[1]);
      if (d < best.d) best = { pa: x, pb: y, d };
    }
  }
  return best;
}

function widthOf(pts: Pt[]): number {
  let a = Infinity;
  let b = -Infinity;
  let c = Infinity;
  let d = -Infinity;
  for (const [x, y] of pts) {
    if (x < a) a = x;
    if (x > b) b = x;
    if (y < c) c = y;
    if (y > d) d = y;
  }
  return Math.min(b - a, d - c);
}

/**
 * Base que cose las formas sueltas.
 *
 * Un dibujo con la cabeza separada del cuerpo daría dos cortadores que hay que
 * imprimir aparte y colocar a ojo cada vez. Aquí se les pone un trozo de base
 * que las une por abajo: una plancha baja, a la altura de la pestaña, que no
 * llega a los filos. Sale UNA pieza, la cabeza queda siempre en su sitio, y la
 * masa se corta igual de limpia porque arriba las dos hojas siguen sueltas.
 *
 * Se le quita el hueco de cada cavidad, para que la base no se meta donde tiene
 * que entrar la masa.
 */
function baseWeb(loops: Loop[], p: Params): Mesh {
  const m = emptyMesh();
  const shapes = loops.filter((l) => !l.hole).map((l) => l.pts);
  if (shapes.length < 2) return m;

  const zTop = Math.max(1, Math.min(p.flangeHeight, p.cutterHeight * 0.25));
  const bars: Pt[][] = [];

  // Árbol de expansión mínima: cada forma se engancha a la más cercana ya unida.
  const linked = [0];
  const left = shapes.map((_, i) => i).slice(1);

  while (left.length) {
    let best = { to: 0, at: 0, d: Infinity, pa: shapes[0][0], pb: shapes[0][0], w: 0 };
    for (const i of linked) {
      for (let k = 0; k < left.length; k++) {
        const n = closestPair(shapes[i], shapes[left[k]]);
        if (n.d < best.d) {
          // Ancho generoso, atado al tamaño de las formas que une: una barra
          // fina se lee como una rebaba; una base ancha, como parte del diseño.
          const w = Math.min(widthOf(shapes[i]), widthOf(shapes[left[k]])) * 0.45;
          best = { to: left[k], at: k, d: n.d, pa: n.pa, pb: n.pb, w };
        }
      }
    }

    const w = Math.max(5, Math.min(best.w, 16));
    const dx = best.pb[0] - best.pa[0];
    const dy = best.pb[1] - best.pa[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy * (w / 2);
    const ny = ux * (w / 2);
    // Se mete dentro de las dos formas para soldar con sus pestañas.
    const grip = p.wallThickness + p.flangeWidth + 1.5;
    const a: Pt = [best.pa[0] - ux * grip, best.pa[1] - uy * grip];
    const b: Pt = [best.pb[0] + ux * grip, best.pb[1] + uy * grip];
    bars.push([
      [a[0] + nx, a[1] + ny],
      [b[0] + nx, b[1] + ny],
      [b[0] - nx, b[1] - ny],
      [a[0] - nx, a[1] - ny],
    ]);

    linked.push(best.to);
    left.splice(best.at, 1);
  }

  // La base, menos las cavidades: donde entra la masa no puede haber material.
  const cavities = offsetRegions(shapes, [], -p.wallThickness / 2);
  const web = subtract(sanitize(bars, []), cavities);
  for (const r of web) extrudeRegion(m, r, 0, zTop);
  return m;
}

export function buildCutter(loops: Loop[], p: Params): Mesh {
  const rings = profile(p);
  const parts: Mesh[] = [];

  for (const loop of loops) {
    if (loop.hole && !p.cutHoles) continue;
    parts.push(tube(loop.pts, rings, loop.hole));
  }

  parts.push(baseWeb(loops, p));

  return merge(...parts);
}
