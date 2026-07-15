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
import { emptyMesh, loft, quad, merge } from '../mesh';
import { offset } from '../polygon';

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

/** Un tubo siguiendo un anillo. `hole` invierte hacia dónde es "fuera". */
function tube(line: Pt[], rings: Ring[], hole: boolean): Mesh {
  const m = emptyMesh();
  const s = hole ? -1 : 1;

  const outer = rings.map((r) => offset(line, r.out * s));
  const inner = rings.map((r) => offset(line, -r.in * s));

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

export function buildCutter(loops: Loop[], p: Params): Mesh {
  const rings = profile(p);
  const parts: Mesh[] = [];

  for (const loop of loops) {
    if (loop.hole && !p.cutHoles) continue;
    parts.push(tube(loop.pts, rings, loop.hole));
  }

  return merge(...parts);
}
