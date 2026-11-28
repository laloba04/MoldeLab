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
import { fillEnclosed } from './image';

type RGB = [number, number, number];

const hex = ([r, g, b]: RGB) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Tonos más cerca que esto son el mismo color. */
const MISMO = 30;

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

  // Dónde hay dibujo en la imagen: lo que no es papel (ni transparente) y lo
  // que queda encerrado dentro (la tripa blanca de un osito sí; el papel no).
  const W = img.width, H = img.height;
  const tinta = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const k = i * 4;
    tinta[i] = img.data[k + 3] >= 128 && Math.min(img.data[k], img.data[k + 1], img.data[k + 2]) <= 235 ? 1 : 0;
  }
  const dibujo = fillEnclosed({ data: tinta, w: W, h: H }).data;

  /** Color de la imagen en un punto (mm), o nada si cae fuera del dibujo. */
  const pixel = ([x, y]: Pt): RGB | null => {
    const px = Math.floor((x + m.cx) / m.mmPerPx);
    const py = Math.floor(-(y + m.cy) / m.mmPerPx);
    if (px < 0 || py < 0 || px >= W || py >= H || !dibujo[py * W + px]) return null;
    const k = (py * W + px) * 4;
    return [img.data[k], img.data[k + 1], img.data[k + 2]];
  };

  // Las manchas del dibujo (en mm), las más grandes primero.
  const islas = sil.detail
    .filter((l) => !l.hole)
    .map((l) => cajaDe(l.pts))
    .filter((b) => b.w > 0.5 && b.h > 0.5)
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, 30);
  if (!islas.length) return {};
  const cajaDibujo = cajaDe(sil.detail.flatMap((l) => l.pts));
  islas.push(cajaDibujo);

  const crudos: { clave: string; c: RGB }[] = [];
  for (const pz of piezas) {
    const partes = pz.overlayParts ?? [];
    const trozos = partes
      .map((pm, i) => ({ i, pm }))
      .filter(({ i, pm }) => esDeImagen(pz, i) && pm.positions.length)
      .map(({ i, pm }) => ({ i, caja: cajaDe(verticesXY(pm.positions)), pts: puntosArriba(pm.positions, 40) }))
      .filter((t) => t.pts.length && t.caja.w > 0 && t.caja.h > 0);
    // El encaje, solo con los trozos de verdad (las rendijas rellenas caen sobre
    // el contorno y lo despistan); el color, luego, a todos.
    const todos = trozos;
    const base = trozos.filter((t) => !pz.rendijas?.[t.i]);
    if (!base.length) continue;
    const cajaTrozos = cajaDe(base.flatMap((t) => [[t.caja.x0, t.caja.y0], [t.caja.x1, t.caja.y1]] as Pt[]));

    type Encaje = (p: Pt) => Pt;
    // Derecho, en espejo, volteado o girado media vuelta.
    const encaje = (c: ReturnType<typeof cajaDe>, d: ReturnType<typeof cajaDe>, [ex, ey]: [number, number]): Encaje | null => {
      const sx = d.w / c.w, sy = d.h / c.h;
      if (Math.abs(sx / sy - 1) > 0.15) return null;
      const s = Math.sqrt(sx * sy);
      return ([x, y]) => [d.cx + ex * (x - c.cx) * s, d.cy + ey * (y - c.cy) * s];
    };
    /**
     * Nota de un encaje: cuántos puntos de cada trozo coinciden con el color
     * mayoritario de su trozo. Bien encajado, cada trozo cae entero en un color;
     * mal encajado, los trozos caen mezclando colores (o fuera de la imagen).
     */
    const nota = (f: Encaje) => {
      let n = 0;
      for (const t of base) {
        const cuenta = new Map<string, number>();
        for (const p of t.pts) {
          const c = pixel(f(p));
          if (!c) continue;
          const k = c.map((v) => v >> 5).join(',');
          cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
        }
        let max = 0;
        for (const v of cuenta.values()) if (v > max) max = v;
        n += max;
      }
      return n;
    };

    let mejor: Encaje | null = null;
    let puntos = 0;
    const candidatos: [ReturnType<typeof cajaDe>, ReturnType<typeof cajaDe>][] = [[cajaTrozos, cajaDibujo]];
    const grandes = [...base].sort((a, b) => b.caja.w * b.caja.h - a.caja.w * a.caja.h).slice(0, 6);
    for (const t of grandes) for (const d of islas) candidatos.push([t.caja, d]);
    const total = base.reduce((t, x) => t + x.pts.length, 0);
    const areaDibujo = cajaDibujo.w * cajaDibujo.h;
    for (const [c, d] of candidatos)
      for (const giro of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as [number, number][]) {
        const f = encaje(c, d, giro);
        if (!f) continue;
        // Un encaje que encoge los trozos hasta meterlos todos en una mancha
        // (el campo azul de un escudo) sale con nota casi perfecta y todo del
        // mismo color. Se pondera por cuánto del dibujo cubren los trozos así.
        const escala2 = (d.w / c.w) * (d.h / c.h);
        const cubre = Math.min(1, (cajaTrozos.w * cajaTrozos.h * escala2) / areaDibujo);
        const n = nota(f) * cubre;
        if (n > puntos) { puntos = n; mejor = f; }
      }
    if (!mejor || puntos < total * 0.5) continue;

    for (const t of todos) {
      const sitios = t.pts.map((p) => mejor!(p));
      const cs = sitios.map((p) => pixel(p)).filter((c): c is RGB => !!c);
      const c = colorMayoritario(cs);
      if (!c) continue;
      // Un trozo con casi todos sus puntos fuera del dibujo no es del dibujo.
      if (cs.length < t.pts.length * 0.5) continue;
      crudos.push({ clave: `${pz.id}#p${t.i}`, c });
    }
  }

  // Los tonos casi iguales de trozos distintos, a un mismo color: si no, cada
  // mancha blanca saldría de un blanco un poco distinto (y un filamento cada una).
  // Antes, cada color se pega al más cercano de los colores de verdad de la
  // imagen (los que ocupan una parte apreciable del dibujo): un trozo fino del
  // borde cae entre dos colores y saldría de un tono mezclado que no existe.
  const paleta = paletaDeImagen(img, dibujo);
  const alPaleta = (c: RGB): RGB => {
    let mejor = c, d0 = Infinity;
    for (const q of paleta) {
      const d = dist(q, c);
      if (d < d0) { d0 = d; mejor = q; }
    }
    return mejor;
  };
  const finales: RGB[] = [];
  const out: Record<string, string> = {};
  for (const { clave, c: crudo } of crudos) {
    const c = alPaleta(crudo);
    let f = finales.find((x) => dist(x, c) < MISMO);
    if (!f) finales.push((f = c));
    out[clave] = hex(f);
  }
  return out;
}

/**
 * Los colores de verdad de la imagen: los tonos (agrupados) que ocupan al menos
 * el 0,2 % del dibujo. Los intermedios del borde suavizado quedan fuera.
 */
function paletaDeImagen(img: ImageData, dibujo: Uint8Array): RGB[] {
  const W = img.width, H = img.height;
  const paso = Math.max(1, Math.floor((W * H) / 120000));
  const grupos: { c: RGB; n: number }[] = [];
  let total = 0;
  for (let i = 0; i < W * H; i += paso) {
    if (!dibujo[i]) continue;
    const k = i * 4;
    const c: RGB = [img.data[k], img.data[k + 1], img.data[k + 2]];
    total++;
    let g = grupos.find((x) => dist(x.c, c) < MISMO);
    if (!g) grupos.push((g = { c: [...c] as RGB, n: 0 }));
    g.n++;
    g.c = g.c.map((v, j) => v + (c[j] - v) / g.n) as RGB;
  }
  // De mayor a menor: un tono que cae sobre la línea entre dos colores ya
  // aceptados es una mezcla del borde suavizado, no un color de la imagen.
  const paleta: RGB[] = [];
  for (const g of grupos.filter((x) => x.n >= total * 0.002).sort((a, b) => b.n - a.n)) {
    let mezcla = false;
    for (let i = 0; i < paleta.length && !mezcla; i++)
      for (let j = i + 1; j < paleta.length && !mezcla; j++) {
        const a = paleta[i], b = paleta[j];
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
        if (l2 < 1) continue;
        const t = Math.max(0, Math.min(1, ((g.c[0] - a[0]) * ab[0] + (g.c[1] - a[1]) * ab[1] + (g.c[2] - a[2]) * ab[2]) / l2));
        const q: RGB = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
        if (dist(q, g.c) < 30) mezcla = true;
      }
    if (!mezcla) paleta.push(g.c);
  }
  return paleta.length ? paleta : grupos.map((g) => g.c);
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
  const rend: boolean[] = [];
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
      rend.push(!!pc.rendijas?.[i]);
    }
  });
  if (!cambia) return pc;
  return {
    ...pc,
    overlayParts: nuevas,
    partTints: pc.partTints ? tintes : undefined,
    deImagen: pc.deImagen ? img : undefined,
    rendijas: pc.rendijas ? rend : undefined,
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
