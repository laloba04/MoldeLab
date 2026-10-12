/**
 * Rodillo con mango, como un rodillo de pintor: un cilindro con el dibujo en
 * relieve alrededor, un mango en U que lo sujeta por los dos lados y dos
 * tapones que hacen de eje. Al pasarlo por la masa, el fondant o la arcilla
 * deja el estampado repetido.
 *
 * Tres piezas que se imprimen cada una como mejor sale:
 *
 * - El RODILLO, de pie (eje vertical): el relieve sale de lado, sin soportes, y
 *   el cilindro sale redondo de verdad.
 * - El MANGO, tumbado: una U plana con el puño arriba. Los agujeros del eje
 *   atraviesan las patas de lado, en horizontal, y son pequeños: se imprimen sin
 *   soportes.
 * - Los TAPONES, de pie con la cabeza abajo: entran por las patas del mango y
 *   se clavan en el rodillo. Van justos en el rodillo y sueltos en el mango, así
 *   que el rodillo gira con ellos.
 *
 * Cada pieza trae también dónde va con todo montado (`Piece.montaje`): el visor
 * la enseña así al darle a «Juntar».
 *
 * El dibujo, sin booleanas 3D: se extruye PLANO en un plano «desenrollado» (u a
 * lo largo de la vuelta, v a lo largo del eje) y luego se enrolla sobre el
 * cilindro punto a punto. Antes se parten las aristas largas en trozos de 2 mm:
 * una recta que se enrolla tiene que curvarse, y con sus dos puntas solas
 * cortaría por dentro del cilindro. Cada arista se parte mirando solo sus dos
 * puntas, así que los dos triángulos que la comparten la parten igual y la malla
 * sigue cerrada.
 *
 * Y va ESPEJADO: lo que queda marcado en la masa es el espejo de lo que hay en
 * el rodillo, así que se espeja aquí para que en la masa se lea derecho.
 */

import type { Loop, Mesh, Params, Piece, Pt, Silhouette } from '../../types';
import { emptyMesh, extrudeRegion, merge } from '../mesh';
import { intersectRegions, offsetRegions, sanitize, subtract, union, type Region } from '../clipper';
import { subdividir } from '../dome';
import { simplify } from '../polygon';
import { boxOf, circle, roundedRect } from '../shapes';
import { fitDetailToBase } from './catalog-parts';

const rev = (pts: Pt[]) => [...pts].reverse() as Pt[];

function solid(regions: Region[], zLo: number, zHi: number): Mesh {
  const m = emptyMesh();
  for (const r of regions) extrudeRegion(m, r, zLo, zHi);
  return m;
}

/** Espejo en X. Al espejar un contorno se invierte su sentido: se le da la vuelta. */
const espejo = (ls: Loop[]): Loop[] =>
  ls.map((l) => ({ ...l, pts: rev(l.pts.map(([x, y]) => [-x, y] as Pt)) }));

/** El dibujo girado sobre su centro, en grados. */
function girar(ls: Loop[], grados: number): Loop[] {
  if (!grados || !ls.length) return ls;
  const b = boxOf(ls);
  const a = (grados * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return ls.map((l) => ({
    ...l,
    pts: l.pts.map(([x, y]) => {
      const dx = x - b.cx;
      const dy = y - b.cy;
      return [b.cx + dx * c - dy * s, b.cy + dx * s + dy * c] as Pt;
    }),
  }));
}

/**
 * Enrolla una malla plana (u, v, h) sobre un cilindro de radio `R` y eje Z: u
 * es la distancia a lo largo de la vuelta, v la altura y h lo que sobresale. Es
 * un giro de coordenadas, no un espejo: las caras siguen mirando afuera.
 */
function enrollar(m: Mesh, R: number): Mesh {
  const q = m.positions;
  const out = new Array<number>(q.length);
  for (let i = 0; i < q.length; i += 3) {
    const a = q[i] / R;
    const r = R + q[i + 2];
    out[i] = r * Math.cos(a);
    out[i + 1] = r * Math.sin(a);
    out[i + 2] = q[i + 1];
  }
  return { positions: out };
}

/**
 * Extruye regiones dibujadas en el plano (y, z) a lo largo de X. Se extruye en
 * XY y se rotan los ejes en ciclo (a, b, c) → (c, a, b): es un giro, no un
 * espejo, así que las caras siguen mirando afuera.
 */
function extruirEnX(rs: Region[], x0: number, x1: number): Mesh {
  const q = solid(rs, x0, x1).positions;
  const out = new Array<number>(q.length);
  for (let i = 0; i < q.length; i += 3) {
    out[i] = q[i + 2];
    out[i + 1] = q[i];
    out[i + 2] = q[i + 1];
  }
  return { positions: out };
}

/** Anillo de `r0` a `r1`, entero o a trozos (un trozo sí y otro no). */
function aro(r0: number, r1: number, trozos: number): Region[] {
  if (trozos <= 0) {
    const seg = Math.max(96, Math.round(2 * Math.PI * r1));
    return sanitize([circle(0, 0, r1, seg)], [rev(circle(0, 0, r0, seg))]);
  }
  const out: Pt[][] = [];
  const paso = (2 * Math.PI) / trozos;
  for (let k = 0; k < trozos; k++) {
    const a0 = k * paso;
    const a1 = a0 + paso / 2;
    const n = 6;
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([r1 * Math.cos(a), r1 * Math.sin(a)]);
    }
    for (let i = n; i >= 0; i--) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([r0 * Math.cos(a), r0 * Math.sin(a)]);
    }
    out.push(pts);
  }
  return sanitize(out, []);
}

// --- Medidas del eje y del mango ----------------------------------------------

/** Radio del tapón que hace de eje. */
const R_EJE = 3;
/** Agujero del rodillo: justo, para que el tapón se quede clavado. */
const R_AGUJERO_RODILLO = R_EJE + 0.15;
/** Agujero de las patas del mango: suelto, para que gire. */
const R_AGUJERO_MANGO = R_EJE + 0.35;
/** Grosor del mango (lo que mide tumbado en la cama). */
const GROSOR_MANGO = 10;
/** Ancho de cada pata. */
const PATA = 9;
/** Aire entre el rodillo y cada pata. */
const AIRE = 1;
/** Lo que se mete cada tapón en el rodillo. */
const CLAVA = 10;

/** Matriz 3×4 (por filas) de una pieza montada. */
type Montaje = number[];

/** Copia una pieza con su sitio de montaje. */
const montada = (p: Piece, m: Montaje): Piece => ({ ...p, montaje: m });

export function buildRoller(s: Silhouette, p: Params): Piece[] {
  const R = p.rollerDia / 2;
  const W = p.rollerWidth;
  const h = p.reliefHeight;
  const vuelta = 2 * Math.PI * R;
  // Montado, el rodillo apoya en la mesa por el relieve: su eje queda a R + h.
  const zEje = R + h;
  const piezas: Piece[] = [];

  // ---------------------------------------------------------------- el rodillo
  if (p.rollerPart !== 'handle') {
    const seg = Math.max(96, Math.round(vuelta / 1.2));
    const tubo = solid(sanitize([circle(0, 0, R, seg)], [rev(circle(0, 0, R_AGUJERO_RODILLO, 40))]), 0, W);

    // Bordes en los extremos, a la altura del relieve: lisos marcan una raya a
    // cada lado; a trozos, un punteado, como una costura.
    const ancho = 3;
    const bordes =
      p.rollerEdges === 'none'
        ? emptyMesh()
        : (() => {
            const r = aro(R - 0.4, R + h, p.rollerEdges === 'dashed' ? Math.max(8, Math.round(vuelta / 6)) : 0);
            return merge(solid(r, 0, ancho), solid(r, W - ancho, W));
          })();

    // El dibujo, en celdas: tantas por vuelta como se pida, en las filas pedidas.
    const fuente = espejo(girar([...s.detail, ...(s.textLoops ?? [])], p.rollerRot));
    const margen = p.rollerEdges === 'none' ? 1.5 : ancho + 1.5;
    const util = W - 2 * margen;
    const n = Math.max(1, Math.round(p.rollerRepeats));
    const filas = Math.max(1, Math.round(p.rollerRows));
    const celdaU = vuelta / n;
    const celdaV = util / filas;

    const zonas: Mesh[] = [];
    if (fuente.length && util > 2) {
      // El dibujo llena su celda, con algo de aire para que no se toquen.
      const hueco = offsetRegions([roundedRect(0, 0, celdaU * 0.86, celdaV * 0.86, 0)], [], 0);
      // El contorno se aligera una décima de milímetro: a esa escala no se ve en
      // la masa, y cada punto menos son triángulos menos en cada copia.
      const dibujo = fitDetailToBase(fuente, hueco, true).map((l) => ({
        ...l,
        pts: simplify(l.pts, 0.1),
      }));
      const caja = boxOf(dibujo);
      const regs = sanitize(
        dibujo.filter((l) => !l.hole).map((l) => l.pts),
        dibujo.filter((l) => l.hole).map((l) => l.pts),
      );
      // Una copia plana centrada en el origen, metida 0,4 mm en el cilindro para
      // soldarse.
      //
      // Se corta en franjas de 2 mm a lo largo de la vuelta. Lo que se curva al
      // enrollar es solo esa dirección; a lo largo del eje el cilindro es recto.
      // Sin franjas, las tapas salían en triángulos largos de punta a punta del
      // dibujo, y partirlos todos daba mallas de cientos de miles de triángulos.
      // Con franjas ninguna arista cruza más de 2 mm de vuelta, y lo poco que
      // queda largo lo parte `subdividir`. En un rodillo de 40, una cuerda de
      // 2 mm se separa del arco tres centésimas.
      const centrado = regs.map((r) => ({
        outer: r.outer.map(([x, y]) => [x - caja.cx, y - caja.cy] as Pt),
        holes: r.holes.map((hh) => hh.map(([x, y]) => [x - caja.cx, y - caja.cy] as Pt)),
      }));
      const franja = 2;
      const anchoDibujo = caja.w / 2 + 1;
      const franjas: Pt[][] = [];
      for (let x = -anchoDibujo; x < anchoDibujo; x += franja) {
        franjas.push([
          [x, -caja.h],
          [x + franja, -caja.h],
          [x + franja, caja.h],
          [x, caja.h],
        ]);
      }
      const plana = subdividir(solid(intersectRegions(centrado, sanitize(franjas, [])), -0.4, h), 2.5);

      for (let f = 0; f < filas; f++) {
        const corre =
          p.rollerLayout === 'staggered'
            ? (f % 2) * (celdaU / 2)
            : p.rollerLayout === 'diagonal'
              ? f * p.rollerShift * celdaU
              : 0;
        const v = margen + celdaV * (f + 0.5);
        for (let i = 0; i < n; i++) {
          const u = celdaU * (i + 0.5) + corre;
          const q = plana.positions;
          const mov = new Array<number>(q.length);
          for (let k = 0; k < q.length; k += 3) {
            mov[k] = q[k] + u;
            mov[k + 1] = q[k + 1] + v;
            mov[k + 2] = q[k + 2];
          }
          zonas.push(enrollar({ positions: mov }, R));
        }
      }
    }

    const overlay = zonas.length ? merge(...zonas) : undefined;
    piezas.push(
      montada(
        {
          id: 'roller',
          label: 'Rodillo',
          role: 'body',
          mesh: merge(tubo, bordes, overlay ?? emptyMesh()),
          overlay,
          overlayParts: zonas.length ? zonas : undefined,
          noMark: true,
        },
        // De pie a tumbado: (x, y, z) → (z − W/2, y, zEje − x).
        [0, 0, 1, -W / 2, 0, 1, 0, 0, -1, 0, 0, zEje],
      ),
    );
  }

  // ------------------------------------------------------- el mango y los tapones
  if (p.rollerPart !== 'roller') {
    const T = GROSOR_MANGO;
    // Centro de cada pata, a cada lado del rodillo.
    const xa = W / 2 + AIRE + PATA / 2;
    // El travesaño pasa por encima del rodillo, con aire.
    const yc = R + h + 7;
    const barra = 10;
    const puno = 24;
    const largoPuno = 75;
    const mediaCubo = 6.5;

    // La U plana: dos patas, el travesaño y el puño con su ranura para colgar.
    const plano = union(
      sanitize(
        [
          roundedRect(-xa, (mediaCubo - 0.5 + yc) / 2, PATA, yc - mediaCubo + 0.5, 0),
          roundedRect(xa, (mediaCubo - 0.5 + yc) / 2, PATA, yc - mediaCubo + 0.5, 0),
          roundedRect(0, yc, 2 * xa + PATA, barra, 3),
          roundedRect(0, yc + largoPuno / 2, puno, largoPuno, puno / 2),
        ],
        [],
      ),
      [],
    );
    const ranura = sanitize([roundedRect(0, yc + largoPuno - 18, 9, 26, 4.5)], []);
    const forma = subtract(plano, ranura);

    // Los cubos de abajo de las patas, con el agujero del eje atravesándolos de
    // lado (a lo largo de X), a media altura del mango.
    const perfilCubo = sanitize(
      [roundedRect(0, T / 2, mediaCubo * 2, T, 0)],
      [rev(circle(0, T / 2, R_AGUJERO_MANGO, 32))],
    );
    const mango = merge(
      solid(forma, 0, T),
      extruirEnX(perfilCubo, -xa - PATA / 2, -xa + PATA / 2),
      extruirEnX(perfilCubo, xa - PATA / 2, xa + PATA / 2),
    );
    piezas.push(
      montada(
        { id: 'handle', label: 'Mango', role: 'body', mesh: mango, noMark: true },
        // Tumbado a de pie: (x, y, z) → (x, T/2 − z, y + zEje).
        [1, 0, 0, 0, 0, 0, -1, T / 2, 0, 1, 0, zEje],
      ),
    );

    // Los tapones: cabeza abajo, el eje hacia arriba.
    const cabeza = 3;
    const largo = PATA + AIRE + CLAVA;
    const tapon = (): Mesh =>
      merge(
        solid(sanitize([circle(0, 0, R_EJE + 3, 48)], []), 0, cabeza),
        solid(sanitize([circle(0, 0, R_EJE, 32)], []), cabeza - 0.01, cabeza + largo),
      );
    const fuera = xa + PATA / 2 + cabeza;
    piezas.push(
      montada(
        { id: 'cap-l', label: 'Tapón', role: 'body', mesh: tapon(), noMark: true },
        // Por la izquierda, apuntando a +X.
        [0, 0, 1, -fuera, 0, -1, 0, 0, 1, 0, 0, zEje],
      ),
      montada(
        { id: 'cap-r', label: 'Tapón', role: 'body', mesh: tapon(), noMark: true },
        // Por la derecha, apuntando a −X.
        [0, 0, -1, fuera, 0, 1, 0, 0, 1, 0, 0, zEje],
      ),
    );
  }

  return piezas;
}
