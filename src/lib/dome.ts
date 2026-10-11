/**
 * Abombar una pieza plana: lo que le pasa a la plancha del termoformado al
 * prensarla en su molde.
 *
 * La cúpula es la de una membrana hinchada (ver `Dome`): cero en el contorno y
 * redonda por dentro, en cualquier forma. Hubo dos versiones antes, y las dos
 * fallaban en las formas con pico: estirar desde el centro plegaba cada punta,
 * y subir según la distancia al borde dejaba una arista por el medio de cada
 * lóbulo.
 *
 * Abombar no es una booleana ni una malla nueva: es mover los vértices que ya
 * hay. Cada punto sube lo que mida la cúpula justo debajo, y nada más. Como solo
 * se mueve en vertical y la subida depende únicamente de (x, y), una malla
 * cerrada sigue cerrada: dos triángulos que compartían un vértice lo siguen
 * compartiendo, porque los dos lo mueven igual.
 */

import type { Mesh, Pt } from '../types';
import { pointInPolygon } from './polygon';

/**
 * Cómo se reparte la subida, de 0 (borde) a 1 (cima). Arranca PLANO desde el
 * borde y llega plano a la cima: t²·(3 − 2t).
 *
 * Que arranque plano importa. Un perfil que sale del borde en vertical —el de la
 * primera versión— hacía que los triángulos que cruzaban el borde subieran de
 * golpe varios milímetros y la plancha salía con hebras; y al prensar de verdad
 * una pared vertical es justo donde el plástico caliente no estira y se rasga.
 */
export function perfil(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Lo que hace falta saber para abombar sobre una forma.
 *
 * La cúpula es la de una MEMBRANA hinchada: lo que hace una plancha fina y
 * caliente cuando se empuja, o una pompa de jabón sobre un aro con forma. Se
 * resuelve la ecuación de esa membrana (∇²u = −1, cero en el borde) en una
 * rejilla fina. Sale suave en cualquier forma —un círculo da una cúpula
 * redonda, un corazón un corazón inflado— sin aristas.
 *
 * Antes se subía según la distancia al borde, y eso deja una arista viva a lo
 * largo del centro de cada lóbulo y de cada punta: la plancha salía como un
 * tejado, con «montañitas», en vez de redonda.
 */
export interface Dome {
  /** Alto de la cúpula en su punto más alto. */
  alto: number;
  /** El valor más alto de la membrana: ahí está la cima. */
  umax: number;
  x0: number;
  y0: number;
  paso: number;
  nx: number;
  ny: number;
  /** La membrana en cada punto de la rejilla. Cero fuera de la forma. */
  u: Float32Array;
}

/**
 * Prepara la cúpula de un contorno. Lo de fuera —el borde plano, el cuello— se
 * queda en cero, así que no sube.
 */
export function domeOf(outer: Pt[], alto: number, celdas = 140): Dome {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of outer) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const paso = Math.max(maxX - minX, maxY - minY) / celdas || 1;
  // Dos celdas de margen: la interpolación de los vértices del borde tiene que
  // tener vecinos a los dos lados, y fuera todo vale cero.
  const x0 = minX - 2 * paso;
  const y0 = minY - 2 * paso;
  const nx = Math.ceil((maxX - minX) / paso) + 5;
  const ny = Math.ceil((maxY - minY) / paso) + 5;

  const dentro = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (pointInPolygon([x0 + i * paso, y0 + j * paso], outer)) dentro[j * nx + i] = 1;
    }
  }

  // Sobrerrelajación sucesiva: Gauss-Seidel acelerado. Con ω cerca de 2 converge
  // en unos pocos cientos de pasadas en vez de miles. Las unidades dan igual
  // —al final se normaliza por el máximo—, así que se resuelve con h² = 1.
  const u = new Float32Array(nx * ny);
  const w = 2 / (1 + Math.sin(Math.PI / Math.max(nx, ny)));
  for (let it = 0; it < 900; it++) {
    let cambio = 0;
    let mayor = 0;
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        if (!dentro[k]) continue;
        const nuevo = (u[k - 1] + u[k + 1] + u[k - nx] + u[k + nx] + 1) / 4;
        const d = w * (nuevo - u[k]);
        u[k] += d;
        if (Math.abs(d) > cambio) cambio = Math.abs(d);
        if (u[k] > mayor) mayor = u[k];
      }
    }
    if (mayor > 0 && cambio < mayor * 1e-5) break;
  }

  let umax = 0;
  for (let k = 0; k < u.length; k++) if (u[k] > umax) umax = u[k];
  return { alto, umax, x0, y0, paso, nx, ny, u };
}

/** La membrana en un punto cualquiera, interpolada en la rejilla. */
function membranaEn(d: Dome, x: number, y: number): number {
  const fx = (x - d.x0) / d.paso;
  const fy = (y - d.y0) / d.paso;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= d.nx - 1 || j >= d.ny - 1) return 0;
  const a = fx - i;
  const b = fy - j;
  const g = (p: number, q: number) => d.u[q * d.nx + p];
  return (
    g(i, j) * (1 - a) * (1 - b) +
    g(i + 1, j) * a * (1 - b) +
    g(i, j + 1) * (1 - a) * b +
    g(i + 1, j + 1) * a * b
  );
}

/** Cuánto sube un punto de la plancha al abombarla. */
export function subida(d: Dome, x: number, y: number): number {
  if (d.umax <= 0) return 0;
  const v = membranaEn(d, x, y);
  if (v <= 0) return 0; // fuera de la cúpula: el borde plano y el cuello no suben
  return d.alto * perfil(v / d.umax);
}

/**
 * Parte las aristas más largas que `largo` por la mitad, hasta que no quede
 * ninguna.
 *
 * Un triángulo se queda plano entre sus tres esquinas: si cruza media cúpula de
 * un salto, la atraviesa en vez de seguirla. Partiéndolo, copia la curva.
 *
 * La decisión es por ARISTA, no por triángulo: los dos triángulos que comparten
 * una arista ven la misma longitud y la parten igual, en el mismo punto. Por eso
 * no aparecen grietas (un vértice de un lado sin pareja en el otro), que es lo
 * que pasaría partiendo triángulo a triángulo.
 */
export function subdividir(
  m: Mesh,
  largo: number,
  rondas = 8,
  /** Altura extra de cada punto, para medir las aristas YA abombadas. */
  sube?: (x: number, y: number, z: number) => number,
): Mesh {
  let p = m.positions;
  const l2 = largo * largo;

  for (let r = 0; r < rondas; r++) {
    const out: number[] = [];
    let partidas = 0;

    for (let i = 0; i < p.length; i += 9) {
      const ax = p[i], ay = p[i + 1], az = p[i + 2];
      const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
      const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];

      // Longitud de cada arista tal como va a quedar, con la subida de cada
      // punta. Depende solo de sus dos puntas, así que los dos triángulos que la
      // comparten la miden igual y la parten igual: no aparecen grietas.
      const ha = sube ? sube(ax, ay, az) : 0;
      const hb = sube ? sube(bx, by, bz) : 0;
      const hc = sube ? sube(cx, cy, cz) : 0;
      const largaAB = (ax - bx) ** 2 + (ay - by) ** 2 + (az + ha - bz - hb) ** 2 > l2;
      const largaBC = (bx - cx) ** 2 + (by - cy) ** 2 + (bz + hb - cz - hc) ** 2 > l2;
      const largaCA = (cx - ax) ** 2 + (cy - ay) ** 2 + (cz + hc - az - ha) ** 2 > l2;

      if (!largaAB && !largaBC && !largaCA) {
        out.push(ax, ay, az, bx, by, bz, cx, cy, cz);
        continue;
      }
      partidas++;
      // (a+b)/2 es igual que (b+a)/2 en coma flotante: los dos triángulos que
      // comparten la arista calculan exactamente el mismo punto.
      const abx = (ax + bx) / 2, aby = (ay + by) / 2, abz = (az + bz) / 2;
      const bcx = (bx + cx) / 2, bcy = (by + cy) / 2, bcz = (bz + cz) / 2;
      const cax = (cx + ax) / 2, cay = (cy + ay) / 2, caz = (cz + az) / 2;

      // Patrones fijos según qué aristas se parten. Todos conservan el sentido
      // de giro, así que las normales siguen mirando hacia fuera.
      if (largaAB && largaBC && largaCA) {
        out.push(ax, ay, az, abx, aby, abz, cax, cay, caz);
        out.push(abx, aby, abz, bx, by, bz, bcx, bcy, bcz);
        out.push(cax, cay, caz, bcx, bcy, bcz, cx, cy, cz);
        out.push(abx, aby, abz, bcx, bcy, bcz, cax, cay, caz);
      } else if (largaAB && !largaBC && !largaCA) {
        out.push(ax, ay, az, abx, aby, abz, cx, cy, cz);
        out.push(abx, aby, abz, bx, by, bz, cx, cy, cz);
      } else if (largaBC && !largaAB && !largaCA) {
        out.push(ax, ay, az, bx, by, bz, bcx, bcy, bcz);
        out.push(ax, ay, az, bcx, bcy, bcz, cx, cy, cz);
      } else if (largaCA && !largaAB && !largaBC) {
        out.push(ax, ay, az, bx, by, bz, cax, cay, caz);
        out.push(cax, cay, caz, bx, by, bz, cx, cy, cz);
      } else if (!largaCA) {
        out.push(ax, ay, az, abx, aby, abz, cx, cy, cz);
        out.push(abx, aby, abz, bx, by, bz, bcx, bcy, bcz);
        out.push(abx, aby, abz, bcx, bcy, bcz, cx, cy, cz);
      } else if (!largaAB) {
        out.push(ax, ay, az, bx, by, bz, bcx, bcy, bcz);
        out.push(ax, ay, az, bcx, bcy, bcz, cax, cay, caz);
        out.push(cax, cay, caz, bcx, bcy, bcz, cx, cy, cz);
      } else {
        out.push(ax, ay, az, abx, aby, abz, cax, cay, caz);
        out.push(abx, aby, abz, bx, by, bz, cx, cy, cz);
        out.push(cax, cay, caz, abx, aby, abz, cx, cy, cz);
      }
    }
    p = out;
    if (!partidas) break;
  }
  return { positions: p };
}

/**
 * La malla abombada. `largo` es el tamaño máximo de arista YA abombada: se
 * parte más donde la cúpula es empinada y menos donde es llana, que es donde
 * los triángulos grandes no se notan. Así la curva sale lisa sin llenar de
 * triángulos las zonas planas.
 */
export function abombar(
  m: Mesh,
  d: Dome,
  largo = 3.5,
  opciones: {
    /**
     * Mover solo lo que esté a esta altura o más arriba. Es para los MOLDES: un
     * bloque plano al que se le deforma solo la cara de arriba —hacia arriba,
     * la cúpula; hacia abajo, el hueco del cuenco— mientras la base sigue
     * plana sobre la cama. Sin esto se movería el bloque entero.
     */
    desde?: number;
    /** +1 abomba hacia arriba; −1 hunde hacia abajo (el hueco del cuenco). */
    signo?: number;
  } = {},
): Mesh {
  const desde = opciones.desde ?? -Infinity;
  const signo = opciones.signo ?? 1;
  // Depende solo de la posición del punto: dos triángulos que comparten un
  // vértice lo mueven igual, y la malla sigue cerrada.
  const mover = (x: number, y: number, z: number) =>
    z >= desde - 1e-6 ? signo * subida(d, x, y) : 0;

  const fina = subdividir(m, largo, 9, mover);
  const p = fina.positions;
  const out = new Array<number>(p.length);
  for (let i = 0; i < p.length; i += 3) {
    out[i] = p[i];
    out[i + 1] = p[i + 1];
    out[i + 2] = p[i + 2] + mover(p[i], p[i + 1], p[i + 2]);
  }
  return { positions: out };
}
