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
  return offsetRegions(outer, holes, p.stampRim);
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
