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

import type { Loop, Mesh, Params, Pt } from '../../types';
import { cylinder, emptyMesh, extrudeRegion, merge } from '../mesh';
import { offsetRegions, type Region } from '../clipper';
import { pointInPolygon } from '../polygon';

/**
 * Cuánto se encoge la placa del sello respecto al contorno dibujado.
 *
 * No basta con una holgura de impresión: la pared del cortador se levanta
 * CENTRADA en la línea de corte, así que se mete media pared hacia dentro. Si
 * el sello solo descuenta la holgura, mide más que el hueco del cortador y no
 * entra — que es justo lo que pasaba. Se descuentan las dos cosas.
 */
function plateInset(p: Params): number {
  return p.wallThickness / 2 + Math.max(0, p.stampFit);
}
const STEPS = 3; // escalones del ángulo de salida
const RIM_H = 1.6; // grosor del reborde de agarre

/** La región de la placa base del sello: la misma que extruye stampSolids,
 *  compartida para que la marca de agua pueda recomponerla. */
export function stampBaseRegions(loops: Loop[], p: Params): Region[] {
  const outer = loops.filter((l) => !l.hole).map((l) => l.pts);
  const holes = loops.filter((l) => l.hole).map((l) => l.pts);
  if (!outer.length) return [];
  return offsetRegions(outer, holes, -plateInset(p));
}

/** El reborde de agarre: una pestaña que SOBRESALE del contorno, en la cara de
 *  atrás (la que no estampa). Al meter el sello en el cortador queda apoyado en
 *  el filo en vez de colarse dentro, y deja un saliente donde meter el dedo
 *  para levantarlo y sacarlo. Con 0 no se genera. */
export function stampRimRegions(loops: Loop[], p: Params): Region[] {
  if (p.stampRim <= 0) return [];
  const outer = loops.filter((l) => !l.hole).map((l) => l.pts);
  const holes = loops.filter((l) => l.hole).map((l) => l.pts);
  if (!outer.length) return [];
  if (outer.length === 1) return offsetRegions(outer, holes, p.stampRim);

  // El reborde crece hacia FUERA. Con formas cercanas —la cabeza y el cuerpo de
  // un muñeco— el de una alcanza al de la otra y el sello sale como una plancha
  // que tapa el hueco. Ahí van las paredes del cortador, así que esa plancha no
  // entraría; y de paso se pierde la forma del dibujo.
  //
  // Cada forma engorda por su cuenta, y solo hasta la mitad de lo que la separa
  // de su vecina más cercana. El reborde sigue estando —para eso es, para sacar
  // el sello con el dedo— pero las formas nunca llegan a tocarse.
  const out: Region[] = [];
  for (let i = 0; i < outer.length; i++) {
    let gap = Infinity;
    for (let j = 0; j < outer.length; j++) {
      if (i !== j) gap = Math.min(gap, minDistance(outer[i], outer[j]));
    }
    const room = Number.isFinite(gap) ? gap / 2 - 0.5 : p.stampRim;
    const rim = Math.min(p.stampRim, room);
    if (rim <= 0.05) continue;
    const mine = holes.filter((h) => pointInPolygon(h[0], outer[i]));
    for (const r of offsetRegions([outer[i]], mine, rim)) out.push(r);
  }
  return out;
}

/** Lo más cerca que llegan a estar dos contornos. */
function minDistance(a: Pt[], b: Pt[]): number {
  let best = Infinity;
  for (const x of a) {
    for (const y of b) {
      const d = Math.hypot(x[0] - y[0], x[1] - y[1]);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Puentes que cosen las placas del sello, a la altura del REBORDE.
 *
 * Con formas sueltas el sello saldrían dos placas que hay que colocar a ojo una
 * a una. Aquí se unen, y el sitio no es casual: el reborde es lo único del sello
 * que queda por ENCIMA del filo del cortador cuando se mete. Un puente ahí se
 * apoya en el canto del cortador igual que el propio reborde, y no estorba a la
 * masa. A la altura de la placa, en cambio, chocaría con las paredes.
 */
function rimWeb(regions: Region[], zLo: number, zHi: number): Mesh {
  const m = emptyMesh();
  if (regions.length < 2) return m;

  const rings = regions.map((r) => r.outer);
  const bars: Pt[][] = [];
  const linked = [0];
  const left = rings.map((_, i) => i).slice(1);

  while (left.length) {
    let best = { to: 0, at: 0, d: Infinity, pa: rings[0][0], pb: rings[0][0] };
    for (const i of linked) {
      for (let k = 0; k < left.length; k++) {
        const n = closestPair(rings[i], rings[left[k]]);
        if (n.d < best.d) best = { to: left[k], at: k, d: n.d, pa: n.pa, pb: n.pb };
      }
    }

    // Ancho atado al tamaño de las placas: una barra fina se lee como rebaba.
    const w = Math.max(4, Math.min(spanOf(rings[best.to]) * 0.4, 14));
    const dx = best.pb[0] - best.pa[0];
    const dy = best.pb[1] - best.pa[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy * (w / 2);
    const ny = ux * (w / 2);
    const grip = 2; // se mete en las dos placas para soldar
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

  for (const r of offsetRegions(bars, [], 0)) extrudeRegion(m, r, zLo, zHi);
  return m;
}

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

function spanOf(pts: Pt[]): number {
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
 * La cara de atrás del sello: la que toca la cama al imprimir y la única donde
 * se puede grabar la marca. Con reborde es la del reborde, porque tapa la placa
 * por debajo; sin reborde, la de la placa. Grabar en la equivocada deja el
 * texto enterrado dentro del sólido: ni se ve ni se imprime.
 */
export function stampPlate(loops: Loop[], p: Params): { regions: Region[]; zLo: number; zHi: number } {
  const rim = stampRimRegions(loops, p);
  return rim.length
    ? { regions: rim, zLo: -RIM_H, zHi: 0.01 }
    : { regions: stampBaseRegions(loops, p), zLo: 0, zHi: p.stampBase };
}

/**
 * Las piezas del sello, cada una por lo que es y no por el orden en que salen:
 *
 *  - `plate`: la cara de atrás, la que se graba (ver `stampPlate`).
 *  - `keep`: el resto del cuerpo, que no se graba pero tampoco es dibujo.
 *  - `overlay`: el relieve y el tirador, o sea el dibujo. Es lo que se pinta
 *    con el color del trazo.
 */
export function stampSolids(loops: Loop[], detail: Loop[], p: Params): Mesh[] {
  const { plate, keep, overlay } = stampParts(loops, detail, p);
  return [...plate, ...keep, ...overlay];
}

export function stampParts(
  loops: Loop[],
  detail: Loop[],
  p: Params,
): { plate: Mesh[]; keep: Mesh[]; overlay: Mesh[] } {
  const empty = { plate: [], keep: [], overlay: [] };

  const base = stampBaseRegions(loops, p);
  if (!base.length) return empty;

  const slab = (regions: Region[], zLo: number, zHi: number): Mesh[] =>
    regions.map((r) => {
      const m = emptyMesh();
      extrudeRegion(m, r, zLo, zHi);
      return m;
    });

  const rim = stampRimRegions(loops, p);
  const baseSolids = slab(base, 0, p.stampBase);
  // El reborde tapa la placa por debajo, así que la cara grabable es la suya y
  // la placa pasa a ser cuerpo que se conserva tal cual.
  const plate = rim.length ? slab(rim, -RIM_H, 0.01) : baseSolids;
  const keep = rim.length ? baseSolids : [];

  // Con varias formas sueltas, las placas se cosen por el reborde: UNA pieza que
  // se coloca de una vez, en vez de dos que hay que encajar por separado.
  if (rim.length > 1) keep.push(rimWeb(rim, -RIM_H, 0.01));

  const solids: Mesh[] = [];

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

  return { plate, keep, overlay: solids };
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
