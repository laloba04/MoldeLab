/**
 * Rosca de verdad: el cuello del termoformado y su tuerca.
 *
 * La primera versión eran anillos sueltos y un tapón a presión: ni se parecía a
 * una rosca ni apretaba como una. Esto es una espiral: la tuerca se enrosca.
 *
 * Sin booleanas 3D, como todo el proyecto. Una rosca es un cilindro cuyo radio
 * cambia con el ángulo y con la altura: en cada punto (ángulo θ, avance s) el
 * radio es el del núcleo más lo que mida el filete en esa fase de la espiral. Es
 * una superficie paramétrica, así que se teje directamente en triángulos y se
 * cierra con sus tapas, y sale cerrada siempre.
 *
 * La tuerca es la misma superficie por dentro, separada la holgura: donde el
 * cuello tiene cresta, la tuerca tiene valle. Por eso encajan.
 */

import type { Mesh, Pt } from '../../types';
import { emptyMesh, tri } from '../mesh';

/** Paso de la rosca: lo que avanza en una vuelta. */
export const PASO_ROSCA = 2;
/** Lo que sobresale el filete del núcleo. */
export const FONDO_ROSCA = 0.8;

/**
 * La forma del filete a lo largo de un paso, de 0 (valle) a 1 (cresta).
 * Trapecio: flancos a unos 45° y un poco de meseta arriba y abajo, que es lo que
 * imprime bien sin soportes y no se rompe al apretar.
 */
export function filete(u: number): number {
  const f = u - Math.floor(u);
  if (f < 0.1) return 0;
  if (f < 0.45) return (f - 0.1) / 0.35;
  if (f < 0.55) return 1;
  if (f < 0.9) return 1 - (f - 0.55) / 0.35;
  return 0;
}

/**
 * Radio del cuello en un punto de la espiral.
 *
 * El signo del ángulo no es un descuido: el cuello va tumbado (su eje es Y) y la
 * tuerca de pie (su eje es Z). Con este signo las dos espirales giran hacia el
 * MISMO lado una vez puestas en el mismo eje, que es lo que hace falta para
 * enroscar; con el contrario serían una rosca a derechas y otra a izquierdas.
 */
export function radioCuello(
  r: number,
  s: number,
  theta: number,
  fase: number,
  liso = 0,
): number {
  // Los primeros `liso` milímetros van sin rosca —es el tramo que cruza la
  // muesca, donde la tuerca no llega— y la rosca entra suave en un milímetro,
  // no de golpe. La entrada depende solo de s, así que es igual en las dos
  // mitades y casan.
  const entra = Math.min(1, Math.max(0, s - liso));
  return r + FONDO_ROSCA * entra * filete(s / PASO_ROSCA + theta / (2 * Math.PI) + fase);
}

/**
 * Medio cuello roscado, tumbado sobre la cama, con el eje en +Y desde `y0`.
 *
 * Es la mitad de arriba del cilindro (de θ = 0 a θ = π, z ≥ 0); la cara plana va
 * contra la cama. Cada plancha lleva una mitad. La trasera, al darle la vuelta
 * para juntarla con la delantera, gira media vuelta alrededor del eje del
 * cuello: por eso su espiral va desfasada media vuelta (`fase` = ½), y al
 * juntarlas la rosca sigue de una mitad a la otra sin escalón.
 */
export function medioCuelloRoscado(
  cx: number,
  y0: number,
  r: number,
  largo: number,
  fase: number,
  /** Tramo del principio que va liso, sin rosca. */
  liso = 0,
): Mesh {
  const m = emptyMesh();
  const nT = 36; // pasos de ángulo en media vuelta
  const nS = Math.max(4, Math.round((largo / PASO_ROSCA) * 16));

  const P = (i: number, j: number): number[] => {
    const theta = (i / nT) * Math.PI;
    const s = (j / nS) * largo;
    const rho = radioCuello(r, s, theta, fase, liso);
    // En los bordes la altura es CERO exacta, no sen(π) ≈ 1e-16: así casan con
    // la cara plana de abajo.
    const z = i === 0 || i === nT ? 0 : rho * Math.sin(theta);
    return [cx + rho * Math.cos(theta), y0 + s, z];
  };

  // La superficie roscada. Orden (θ, s+1, θ+1, s+1): la normal sale hacia fuera.
  for (let i = 0; i < nT; i++) {
    for (let j = 0; j < nS; j++) {
      const a = P(i, j);
      const b = P(i, j + 1);
      const c = P(i + 1, j + 1);
      const d = P(i + 1, j);
      tri(m, a, b, c);
      tri(m, a, c, d);
    }
  }

  // La cara plana de abajo, en tres columnas: izquierda, centro y derecha. La
  // columna del centro hace falta porque las tapas de los extremos son abanicos
  // desde el centro: sin ese vértice en la cara de abajo quedaría una grieta.
  const L = (j: number) => P(nT, j);
  const R = (j: number) => P(0, j);
  const M = (j: number) => [cx, y0 + (j / nS) * largo, 0];
  for (let j = 0; j < nS; j++) {
    // Mirando hacia abajo (−Z), que es fuera.
    tri(m, L(j), L(j + 1), M(j + 1));
    tri(m, L(j), M(j + 1), M(j));
    tri(m, M(j), M(j + 1), R(j + 1));
    tri(m, M(j), R(j + 1), R(j));
  }

  // Las dos tapas, en abanico desde el centro del eje.
  const c0 = M(0);
  const c1 = M(nS);
  for (let i = 0; i < nT; i++) {
    tri(m, c0, P(i, 0), P(i + 1, 0)); // mira hacia −Y
    tri(m, c1, P(i + 1, nS), P(i, nS)); // mira hacia +Y
  }
  return m;
}

/**
 * La tuerca: rosca por dentro, cilindro liso por fuera, abierta por abajo y con
 * techo arriba. De pie, eje Z, centrada en el origen.
 *
 * Por dentro es la superficie del cuello más la holgura, en la misma espiral:
 * donde el cuello tiene cresta, la tuerca tiene valle. Abierta por abajo para
 * que se imprima de pie sin soportes; los flancos del filete a 45° se sostienen
 * solos.
 */
export function tuercaRoscada(r: number, alto: number, holgura: number, pared: number, techo: number): Mesh {
  const m = emptyMesh();
  const nT = 72;
  const nZ = Math.max(4, Math.round((alto / PASO_ROSCA) * 16));
  const exterior = r + FONDO_ROSCA + holgura + pared;
  const total = alto + techo;

  // Misma espiral que el cuello, vista desde el eje de la tuerca (ver
  // `radioCuello` para el signo del ángulo).
  const B = (i: number, j: number): number[] => {
    const theta = (i / nT) * 2 * Math.PI;
    const z = (j / nZ) * alto;
    const rho = r + FONDO_ROSCA * filete(z / PASO_ROSCA - theta / (2 * Math.PI)) + holgura;
    return [rho * Math.cos(theta), rho * Math.sin(theta), z];
  };
  const O = (i: number, z: number): number[] => {
    const theta = (i / nT) * 2 * Math.PI;
    return [exterior * Math.cos(theta), exterior * Math.sin(theta), z];
  };
  const sig = (i: number) => (i + 1) % nT;

  for (let i = 0; i < nT; i++) {
    const k = sig(i);
    // El hueco roscado, mirando hacia el eje (eso es «fuera» del material).
    for (let j = 0; j < nZ; j++) {
      const a = B(i, j);
      const b = B(i, j + 1);
      const c = B(k, j + 1);
      const d = B(k, j);
      tri(m, a, b, c);
      tri(m, a, c, d);
    }
    // La pared de fuera, mirando hacia fuera.
    const o0 = O(i, 0);
    const o1 = O(k, 0);
    const p0 = O(i, total);
    const p1 = O(k, total);
    tri(m, o0, o1, p1);
    tri(m, o0, p1, p0);
    // El aro de abajo, entre el hueco y la pared, mirando hacia abajo.
    const i0 = B(i, 0);
    const i1 = B(k, 0);
    tri(m, i0, i1, o1);
    tri(m, i0, o1, o0);
    // El techo, mirando hacia arriba.
    tri(m, [0, 0, total], p0, p1);
    // El fondo del hueco (el techo visto desde dentro), mirando hacia abajo.
    tri(m, [0, 0, alto], B(k, nZ), B(i, nZ));
  }
  return m;
}

/** Radio de fuera de la tuerca, para quien tenga que dejarle sitio. */
export function exteriorTuerca(r: number, holgura: number, pared: number): number {
  return r + FONDO_ROSCA + holgura + pared;
}

export type { Pt };
