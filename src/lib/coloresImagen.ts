/**
 * Los colores de la imagen, en cada trozo del dibujo.
 *
 * Cada producto recoloca el dibujo a su manera (lo escala para que quepa, lo
 * mueve, lo pone en espejo...), así que no se puede saber de antemano dónde cae
 * cada trozo en la imagen. Se averigua: la caja de los trozos del dibujo de una
 * pieza se encaja en la caja del dibujo de la imagen (derecho o en espejo), y el
 * encaje solo vale si casi todos los puntos de los trozos caen sobre el dibujo.
 * Si no cuadra (un rodillo que repite el dibujo, piezas sin dibujo), esa pieza
 * se queda con sus colores de siempre.
 *
 * El color de un trozo es el que más se repite en su cara de arriba. Los tonos
 * casi iguales (el ruido de un JPG, el borde suavizado) se juntan en uno; los
 * distintos se quedan distintos, sin límite de colores.
 */

import type { Piece, Pt, Silhouette } from '../types';

type RGB = [number, number, number];

const hex = ([r, g, b]: RGB) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Tonos más cerca que esto son el mismo color. */
const MISMO = 34;

/**
 * ¿La imagen tiene color de verdad? Cuenta los píxeles visibles que no son casi
 * blancos ni grises. Un dibujo en negro (o un escaneo amarillento) no cuenta.
 */
export function esColorida(img: ImageData): boolean {
  const d = img.data;
  const paso = Math.max(1, Math.floor((img.width * img.height) / 40000));
  let visibles = 0;
  let color = 0;
  for (let i = 0; i < img.width * img.height; i += paso) {
    const k = i * 4;
    if (d[k + 3] < 128) continue;
    const r = d[k], g = d[k + 1], b = d[k + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (min > 235) continue; // fondo blanco
    visibles++;
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat > 0.28 && max > 60) color++;
  }
  return visibles > 0 && color / visibles > 0.04;
}

/** Puntos de la cara de arriba de un trozo: centros de sus triángulos que miran hacia arriba. */
function puntosArriba(pos: number[], max = 60): Pt[] {
  const tri: { p: Pt; a: number }[] = [];
  for (let i = 0; i + 8 < pos.length; i += 9) {
    const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2];
    const vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9 || nz / len < 0.7) continue;
    tri.push({ p: [(pos[i] + pos[i + 3] + pos[i + 6]) / 3, (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3], a: len / 2 });
  }
  tri.sort((x, y) => y.a - x.a);
  return tri.slice(0, max).map((t) => t.p);
}

function cajaDe(pts: Pt[]) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

function verticesXY(pos: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 2 < pos.length; i += 3) out.push([pos[i], pos[i + 1]]);
  return out;
}

/** El color que más se repite (con los tonos parecidos juntos), y su media. */
function colorMayoritario(cs: RGB[]): RGB | null {
  if (!cs.length) return null;
  let mejor = 0, idx = 0;
  for (let i = 0; i < cs.length; i++) {
    let n = 0;
    for (const c of cs) if (dist(cs[i], c) < MISMO) n++;
    if (n > mejor) { mejor = n; idx = i; }
  }
  const grupo = cs.filter((c) => dist(cs[idx], c) < MISMO);
  return [0, 1, 2].map((k) => grupo.reduce((s, c) => s + c[k], 0) / grupo.length) as RGB;
}

/**
 * Color detectado de cada trozo del dibujo, por zona: `idPieza#pN`. Los trozos
 * que ya traen su color propio (un icono, un texto elegido en la web) no se tocan.
 *
 * Dónde cae cada trozo en la imagen se busca así: se empareja un trozo grande de
 * la pieza con una mancha del dibujo (mismo aspecto), eso da escala y posición,
 * y se puntúa cuántos puntos de TODOS los trozos caen sobre tinta de la imagen.
 * Gana el mejor emparejamiento; un trozo solo coge color si casi todo él cae
 * sobre tinta (así la anilla de un llavero o una placa no se pintan de nada).
 */
export function coloresDeZonas(piezas: Piece[], sil: Silhouette, img: ImageData): Record<string, string> {
  const m = sil.muestreo;
  if (!m || !sil.detail.length) return {};

  const pixel = ([x, y]: Pt): RGB | null => {
    const px = Math.floor((x + m.cx) / m.mmPerPx);
    const py = Math.floor(-(y + m.cy) / m.mmPerPx);
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) return null;
    const k = (py * img.width + px) * 4;
    if (img.data[k + 3] < 128) return null;
    const c: RGB = [img.data[k], img.data[k + 1], img.data[k + 2]];
    // Fondo blanco: no es dibujo.
    return Math.min(...c) > 235 ? null : c;
  };

  // Las manchas del dibujo (en mm), las más grandes primero.
  const islas = sil.detail
    .filter((l) => !l.hole)
    .map((l) => cajaDe(l.pts))
    .filter((b) => b.w > 0.5 && b.h > 0.5)
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, 40);
  if (!islas.length) return {};

  const crudos: { clave: string; c: RGB }[] = [];
  for (const pz of piezas) {
    const partes = pz.overlayParts ?? [];
    const trozos = partes
      .map((pm, i) => ({ i, pm }))
      .filter(({ i, pm }) => esDeImagen(pz, i) && pm.positions.length)
      .map(({ i, pm }) => ({ i, caja: cajaDe(verticesXY(pm.positions)), pts: puntosArriba(pm.positions) }))
      .filter((t) => t.pts.length && t.caja.w > 0 && t.caja.h > 0);
    if (!trozos.length) continue;
    const todos = trozos.flatMap((t) => t.pts);
    const prueba = todos.filter((_, k) => k % Math.max(1, Math.floor(todos.length / 300)) === 0);

    type Encaje = (p: Pt) => Pt;
    const encaje = (t: (typeof trozos)[number], d: (typeof islas)[number], espejo: boolean): Encaje | null => {
      const sx = d.w / t.caja.w, sy = d.h / t.caja.h;
      if (Math.abs(sx / sy - 1) > 0.15) return null;
      const s = Math.sqrt(sx * sy);
      return ([x, y]) => [d.cx + (espejo ? -1 : 1) * (x - t.caja.cx) * s, d.cy + (y - t.caja.cy) * s];
    };
    const tinta = (f: Encaje, pts: Pt[]) => pts.filter((p) => pixel(f(p))).length;

    let mejor: Encaje | null = null;
    let nota = 0;
    const grandes = [...trozos].sort((a, b) => b.caja.w * b.caja.h - a.caja.w * a.caja.h).slice(0, 6);
    for (const t of grandes)
      for (const d of islas)
        for (const espejo of [false, true]) {
          const f = encaje(t, d, espejo);
          if (!f) continue;
          const n = tinta(f, prueba);
          if (n > nota) { nota = n; mejor = f; }
        }
    if (!mejor || nota < prueba.length * 0.5) continue;

    for (const t of trozos) {
      const cs = t.pts.map((p) => pixel(mejor!(p))).filter((c): c is RGB => !!c);
      if (cs.length < t.pts.length * 0.6) continue;
      const c = colorMayoritario(cs);
      if (c) crudos.push({ clave: `${pz.id}#p${t.i}`, c });
    }
  }

  // Los tonos casi iguales de trozos distintos, a un mismo color: si no, cada
  // mancha blanca saldría de un blanco un poco distinto (y un filamento cada una).
  const finales: RGB[] = [];
  const out: Record<string, string> = {};
  for (const { clave, c } of crudos) {
    let f = finales.find((x) => dist(x, c) < MISMO);
    if (!f) finales.push((f = c));
    out[clave] = hex(f);
  }
  return out;
}

/**
 * Cada trozo del dibujo, en sus partes sueltas: dos manchas que no se tocan son
 * dos trozos (cada una puede ir de su color). Se queda entero si saldrían
 * demasiados (una trama de puntitos, una textura) o si ya trae su color.
 */
export function separarTrozos(pc: Piece): Piece {
  const partes = pc.overlayParts;
  if (!partes?.length) return pc;
  const nuevas: typeof partes = [];
  const tintes: (string | undefined)[] = [];
  const img: boolean[] = [];
  let cambia = false;
  partes.forEach((pm, i) => {
    // Lo que no sale de la imagen (un texto, un icono, el borde) se queda entero.
    const comps = esDeImagen(pc, i) ? componentes(pm.positions) : [pm.positions];
    const trozos = comps.length > 1 && comps.length <= 120 ? comps : [pm.positions];
    if (trozos.length > 1) cambia = true;
    for (const c of trozos) {
      nuevas.push(trozos.length > 1 ? { positions: c } : pm);
      tintes.push(pc.partTints?.[i]);
      img.push(esDeImagen(pc, i));
    }
  });
  if (!cambia) return pc;
  return {
    ...pc,
    overlayParts: nuevas,
    partTints: pc.partTints ? tintes : undefined,
    deImagen: pc.deImagen ? img : undefined,
  };
}

/** ¿Este trozo sale de la imagen? Si la pieza no lo dice, los que no traen color propio. */
function esDeImagen(pc: Piece, i: number): boolean {
  return pc.deImagen ? !!pc.deImagen[i] : !pc.partTints?.[i];
}

/** Triángulos agrupados por piezas conectadas (comparten algún vértice). */
function componentes(pos: number[]): number[][] {
  const n = Math.floor(pos.length / 9);
  if (n < 2) return [pos];
  const padre = Array.from({ length: n }, (_, i) => i);
  const raiz = (a: number): number => {
    while (padre[a] !== a) a = padre[a] = padre[padre[a]];
    return a;
  };
  const visto = new Map<string, number>();
  for (let t = 0; t < n; t++)
    for (let v = 0; v < 3; v++) {
      const k = t * 9 + v * 3;
      const clave = `${Math.round(pos[k] * 1e4)},${Math.round(pos[k + 1] * 1e4)},${Math.round(pos[k + 2] * 1e4)}`;
      const otro = visto.get(clave);
      if (otro === undefined) visto.set(clave, t);
      else {
        const a = raiz(otro), b = raiz(t);
        if (a !== b) padre[a] = b;
      }
    }
  const grupos = new Map<number, number[]>();
  for (let t = 0; t < n; t++) {
    const r = raiz(t);
    let g = grupos.get(r);
    if (!g) grupos.set(r, (g = []));
    for (let k = t * 9; k < t * 9 + 9; k++) g.push(pos[k]);
  }
  return [...grupos.values()];
}
