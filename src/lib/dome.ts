/**
 * Abombar una pieza plana: lo que le pasa a la plancha del termoformado al
 * prensarla en su molde.
 *
 * La cúpula sube según la DISTANCIA AL BORDE, como un cojín que se infla: cero
 * en el contorno y lo más alto en el punto más alejado de él. Vale igual para
 * un círculo —sale una cúpula redonda— que para un corazón o una estrella, que
 * salen con su cresta suave por el medio de cada lóbulo y cada pico.
 *
 * La primera versión estiraba desde el centro (cada ángulo con su radio), y en
 * las formas con pico eso hacía un pliegue afilado a lo largo de cada punta: un
 * paso de un milímetro de lado a lado de la punta cambiaba la altura de golpe.
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
 * El perfil: cuánto sube, de 0 a 1, un punto que está a la fracción `r` del
 * borde (0 en lo más alto, 1 en el borde).
 *
 * (1 − r²)²: arranca PLANO desde el borde y sube suave. Un perfil que sale del
 * borde en vertical —el cuarto de circunferencia de la primera versión— hacía
 * que los triángulos que cruzaban el borde subieran de golpe varios milímetros,
 * y al prensar de verdad una pared vertical es justo donde el plástico caliente
 * no estira y se rasga. Así la plancha se curva sin pliegue.
 *
 * Lo comparten la plancha y los dos moldes: si cada uno usara el suyo, la
 * plancha abombada no casaría con su molde.
 */
export function perfil(r: number): number {
  const c = Math.min(1, Math.max(0, r));
  const u = 1 - c * c;
  return u * u;
}

/**
 * Lo que hay que meter hacia dentro del borde para cortar la cúpula a una
 * fracción `f` de su alto (0 en la base, 1 en la cima). Es el perfil al revés:
 * con eso, el corte de la cúpula a cualquier altura es el contorno encogido esa
 * distancia, y los moldes se apilan losa a losa con offsets de Clipper.
 */
export function entradaA(f: number, dmax: number): number {
  const ff = Math.min(1, Math.max(0, f));
  const r = Math.sqrt(Math.max(0, 1 - Math.sqrt(ff)));
  return dmax * (1 - r);
}

/** Lo que hace falta saber para abombar sobre una forma. */
export interface Dome {
  /** Alto de la cúpula en su punto más alto. */
  alto: number;
  /** Distancia del punto más alejado del borde: ahí está la cima. */
  dmax: number;
  /** Rejilla de distancias al borde, para no recorrer el contorno por vértice. */
  x0: number;
  y0: number;
  paso: number;
  nx: number;
  ny: number;
  dist: Float32Array;
}

/** Distancia de un punto a un segmento. */
function aSegmento(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Prepara la cúpula de un contorno: la distancia al borde de cada punto de una
 * rejilla fina. Fuera del contorno vale cero, así que lo de fuera —el borde
 * plano, el cuello— no sube.
 */
export function domeOf(outer: Pt[], alto: number, celdas = 180): Dome {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of outer) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const paso = Math.max(maxX - minX, maxY - minY) / celdas || 1;
  // Una celda de margen por cada lado: la interpolación de los vértices del
  // borde tiene que tener vecinos a los dos lados.
  const x0 = minX - paso;
  const y0 = minY - paso;
  const nx = Math.ceil((maxX - minX) / paso) + 3;
  const ny = Math.ceil((maxY - minY) / paso) + 3;
  const dist = new Float32Array(nx * ny);
  let dmax = 0;

  for (let j = 0; j < ny; j++) {
    const y = y0 + j * paso;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * paso;
      if (!pointInPolygon([x, y], outer)) continue;
      let d = Infinity;
      for (let a = 0, b = outer.length - 1; a < outer.length; b = a++) {
        const s = aSegmento(x, y, outer[b][0], outer[b][1], outer[a][0], outer[a][1]);
        if (s < d) d = s;
      }
      dist[j * nx + i] = d;
      if (d > dmax) dmax = d;
    }
  }
  return { alto, dmax, x0, y0, paso, nx, ny, dist };
}

/** Distancia al borde en un punto cualquiera, interpolada en la rejilla. */
function distanciaEn(d: Dome, x: number, y: number): number {
  const fx = (x - d.x0) / d.paso;
  const fy = (y - d.y0) / d.paso;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= d.nx - 1 || j >= d.ny - 1) return 0;
  const u = fx - i;
  const v = fy - j;
  const g = (a: number, b: number) => d.dist[b * d.nx + a];
  return (
    g(i, j) * (1 - u) * (1 - v) +
    g(i + 1, j) * u * (1 - v) +
    g(i, j + 1) * (1 - u) * v +
    g(i + 1, j + 1) * u * v
  );
}

/** Cuánto sube un punto de la plancha al abombarla. */
export function subida(d: Dome, x: number, y: number): number {
  if (d.dmax <= 0) return 0;
  const dist = distanciaEn(d, x, y);
  if (dist <= 0) return 0; // fuera de la cúpula: el borde plano y el cuello no suben
  return d.alto * perfil(1 - dist / d.dmax);
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
  sube?: (x: number, y: number) => number,
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
      const ha = sube ? sube(ax, ay) : 0;
      const hb = sube ? sube(bx, by) : 0;
      const hc = sube ? sube(cx, cy) : 0;
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
export function abombar(m: Mesh, d: Dome, largo = 3.5): Mesh {
  const fina = subdividir(m, largo, 9, (x, y) => subida(d, x, y));
  const p = fina.positions;
  const out = new Array<number>(p.length);
  for (let i = 0; i < p.length; i += 3) {
    out[i] = p[i];
    out[i + 1] = p[i + 1];
    out[i + 2] = p[i + 2] + subida(d, p[i], p[i + 1]);
  }
  return { positions: out };
}
