/**
 * Las tipografías de la marca, y una fuente de trazo de respaldo.
 *
 * En el navegador la marca se dibuja con las cuatro tipografías empaquetadas en
 * `src/fonts` (licencia SIL OFL). Van dentro de la página a propósito: la marca
 * acaba siendo geometría del STL, así que si dependiera de las fuentes que tenga
 * instaladas cada ordenador, la misma pieza saldría distinta en el del taller y
 * en el de casa.
 *
 * Fuera del navegador no hay canvas y no se puede rasterizar nada. Para eso está
 * la fuente de trazo de este módulo: cada letra es el ESQUELETO que trazaría un
 * rotulador —unas líneas y unos arcos— y el grosor se le da después, en
 * milímetros, con puntas redondas. No es tan bonita como una tipografía de
 * verdad, pero es la que permite que los tests comprueben en Node todo el camino
 * de la marca sin montar un navegador.
 *
 * Sus coordenadas van en «altura de mayúscula»: la base es y = 0 y la coronilla
 * y = 1. La `w` de cada letra es lo que avanza el cursor.
 */

import type { Pt } from '../types';

/** Un trozo de elipse, en grados y con la y hacia arriba. */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Pt[] {
  const pasos = Math.max(4, Math.ceil(Math.abs(a1 - a0) / 12));
  const out: Pt[] = [];
  for (let i = 0; i <= pasos; i++) {
    const a = ((a0 + ((a1 - a0) * i) / pasos) * Math.PI) / 180;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

interface Glyph {
  w: number;
  strokes: Pt[][];
}

const G: Record<string, Glyph> = {
  ' ': { w: 0.42, strokes: [] },

  A: { w: 0.66, strokes: [[[0, 0], [0.33, 1], [0.66, 0]], [[0.11, 0.33], [0.55, 0.33]]] },
  B: {
    w: 0.46,
    strokes: [
      [[0, 0], [0, 1]],
      [[0, 1], ...arc(0, 0.75, 0.3, 0.25, 90, -90), [0, 0.5]],
      [[0, 0.5], ...arc(0, 0.25, 0.34, 0.25, 90, -90), [0, 0]],
    ],
  },
  C: { w: 0.76, strokes: [arc(0.38, 0.5, 0.36, 0.5, 55, 305)] },
  D: { w: 0.52, strokes: [[[0, 0], [0, 1]], [[0, 1], ...arc(0, 0.5, 0.44, 0.5, 90, -90), [0, 0]]] },
  E: { w: 0.62, strokes: [[[0.58, 1], [0, 1], [0, 0], [0.58, 0]], [[0, 0.5], [0.46, 0.5]]] },
  F: { w: 0.6, strokes: [[[0.58, 1], [0, 1], [0, 0]], [[0, 0.52], [0.46, 0.52]]] },
  G: { w: 0.78, strokes: [[...arc(0.38, 0.5, 0.36, 0.5, 55, 315), [0.72, 0.32], [0.72, 0.5], [0.46, 0.5]]] },
  H: { w: 0.66, strokes: [[[0, 0], [0, 1]], [[0.62, 0], [0.62, 1]], [[0, 0.5], [0.62, 0.5]]] },
  I: { w: 0.22, strokes: [[[0.1, 0], [0.1, 1]]] },
  J: { w: 0.56, strokes: [[[0.5, 1], [0.5, 0.26], ...arc(0.25, 0.26, 0.25, 0.26, 0, -180)]] },
  K: { w: 0.64, strokes: [[[0, 0], [0, 1]], [[0.58, 1], [0.02, 0.42]], [[0.2, 0.58], [0.62, 0]]] },
  L: { w: 0.58, strokes: [[[0, 1], [0, 0], [0.55, 0]]] },
  M: { w: 0.86, strokes: [[[0, 0], [0, 1], [0.41, 0.3], [0.82, 1], [0.82, 0]]] },
  N: { w: 0.68, strokes: [[[0, 0], [0, 1], [0.64, 0], [0.64, 1]]] },
  O: { w: 0.78, strokes: [arc(0.39, 0.5, 0.37, 0.5, 0, 360)] },
  P: { w: 0.46, strokes: [[[0, 0], [0, 1]], [[0, 1], ...arc(0, 0.72, 0.34, 0.28, 90, -90), [0, 0.44]]] },
  Q: { w: 0.8, strokes: [arc(0.39, 0.5, 0.37, 0.5, 0, 360), [[0.5, 0.22], [0.76, -0.06]]] },
  R: {
    w: 0.68,
    strokes: [
      [[0, 0], [0, 1]],
      [[0, 1], ...arc(0, 0.72, 0.34, 0.28, 90, -90), [0, 0.44]],
      [[0.26, 0.44], [0.64, 0]],
    ],
  },
  S: {
    w: 0.7,
    strokes: [[...arc(0.35, 0.71, 0.31, 0.29, 60, 250), ...arc(0.35, 0.29, 0.31, 0.29, 70, -110)]],
  },
  T: { w: 0.64, strokes: [[[0, 1], [0.64, 1]], [[0.32, 1], [0.32, 0]]] },
  U: { w: 0.68, strokes: [[[0, 1], [0, 0.32], ...arc(0.32, 0.32, 0.32, 0.32, 180, 360), [0.64, 1]]] },
  V: { w: 0.66, strokes: [[[0, 1], [0.33, 0], [0.66, 1]]] },
  W: { w: 0.92, strokes: [[[0, 1], [0.23, 0], [0.46, 0.6], [0.69, 0], [0.92, 1]]] },
  X: { w: 0.64, strokes: [[[0, 0], [0.62, 1]], [[0, 1], [0.62, 0]]] },
  Y: { w: 0.64, strokes: [[[0, 1], [0.32, 0.5], [0.64, 1]], [[0.32, 0.5], [0.32, 0]]] },
  Z: { w: 0.64, strokes: [[[0, 1], [0.62, 1], [0, 0], [0.62, 0]]] },

  '0': { w: 0.72, strokes: [arc(0.36, 0.5, 0.34, 0.5, 0, 360)] },
  '1': { w: 0.42, strokes: [[[0.04, 0.8], [0.26, 1], [0.26, 0]]] },
  '2': { w: 0.66, strokes: [[...arc(0.33, 0.71, 0.31, 0.29, 165, -35), [0, 0], [0.64, 0]]] },
  '3': {
    w: 0.66,
    strokes: [
      arc(0.31, 0.74, 0.29, 0.26, 150, -75),
      [...arc(0.31, 0.27, 0.32, 0.27, 80, -160)],
    ],
  },
  '4': { w: 0.68, strokes: [[[0.47, 0], [0.47, 1], [0, 0.3], [0.66, 0.3]]] },
  '5': { w: 0.66, strokes: [[[0.6, 1], [0.1, 1], [0.06, 0.56]], [...arc(0.32, 0.3, 0.32, 0.3, 85, -150)]] },
  '6': { w: 0.7, strokes: [[...arc(0.34, 0.62, 0.32, 0.38, 55, 180)], arc(0.34, 0.3, 0.32, 0.3, 180, -180)] },
  '7': { w: 0.64, strokes: [[[0, 1], [0.62, 1], [0.24, 0]]] },
  '8': { w: 0.7, strokes: [arc(0.34, 0.74, 0.28, 0.26, 0, 360), arc(0.34, 0.26, 0.33, 0.26, 0, 360)] },
  '9': { w: 0.7, strokes: [[...arc(0.34, 0.38, 0.32, 0.38, 235, 360)], arc(0.34, 0.7, 0.32, 0.3, 0, 360)] },

  '.': { w: 0.28, strokes: [[[0.12, 0.02], [0.14, 0.02]]] },
  ',': { w: 0.28, strokes: [[[0.16, 0.08], [0.06, -0.14]]] },
  '-': { w: 0.5, strokes: [[[0.06, 0.5], [0.44, 0.5]]] },
  '_': { w: 0.6, strokes: [[[0, -0.08], [0.6, -0.08]]] },
  '!': { w: 0.28, strokes: [[[0.13, 1], [0.13, 0.28]], [[0.13, 0.02], [0.15, 0.02]]] },
  '?': { w: 0.62, strokes: [[...arc(0.31, 0.74, 0.29, 0.26, 175, -30), [0.31, 0.3]], [[0.31, 0.02], [0.33, 0.02]]] },
  ':': { w: 0.28, strokes: [[[0.13, 0.66], [0.15, 0.66]], [[0.13, 0.02], [0.15, 0.02]]] },
  "'": { w: 0.26, strokes: [[[0.14, 1], [0.09, 0.76]]] },
  '/': { w: 0.54, strokes: [[[0, -0.05], [0.5, 1]]] },
  '+': { w: 0.6, strokes: [[[0.06, 0.5], [0.54, 0.5]], [[0.3, 0.26], [0.3, 0.74]]] },
  '&': {
    w: 0.82,
    strokes: [
      [[0.78, 0], [0.24, 0.62], ...arc(0.32, 0.79, 0.19, 0.21, 200, 20)],
      [...arc(0.3, 0.24, 0.3, 0.24, 60, 300), [0.72, 0.34]],
    ],
  },
};

/** Separación entre letras, en altura de mayúscula. */
const TRACKING = 0.16;

/**
 * Quita tildes y pasa a mayúsculas.
 *
 * La fuente es de caja alta a propósito: con un solo trazo de rotulador, una
 * minúscula a 4 mm no se distingue —la panza de una «a» se cierra en cuanto el
 * trazo tiene el grosor que la impresora sabe hacer—, mientras que una
 * mayúscula se lee perfectamente.
 */
export function normalizeForFont(text: string): string {
  let out = '';
  // Descomponer separa la letra de su tilde; luego se tiran los signos sueltos,
  // que en Unicode viven todos en el bloque 0300-036F.
  for (const ch of text.normalize('NFD')) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x0300 && c <= 0x036f) continue;
    out += ch;
  }
  return out.toUpperCase();
}

export interface TextPaths {
  /** Los esqueletos, ya colocados. Altura de mayúscula = 1, base en y = 0. */
  paths: Pt[][];
  /** Lo que ocupa la línea de ancho, también en altura de mayúscula. */
  width: number;
}

/**
 * Las cuatro tipografías de la marca.
 *
 * Van EMPAQUETADAS con la página (`src/fonts`, licencia SIL OFL, que permite
 * incrustarlas), no se piden a la fuente del sistema. Eso importa: la marca es
 * geometría que acaba dentro del STL, así que si la letra dependiera de lo que
 * tenga instalado cada ordenador, la misma pieza saldría distinta en el
 * ordenador del taller y en el de casa.
 *
 * Solo el subconjunto latino de cada una: 95 KB entre las cuatro.
 */
export type FontStyle = 'redonda' | 'manuscrita' | 'recia' | 'gordita';

export const FONT_STYLES: {
  id: FontStyle;
  label: string;
  family: string;
  weight: number;
  /**
   * Cuánto se repasa la letra al rasterizar, en proporción a su altura.
   *
   * Es para que el surco grabado llegue a dos pasadas de boquilla. Cada
   * tipografía necesita lo suyo: una manuscrita tiene los palos finos y hay que
   * engordarla, pero una ya gorda no necesita nada — y si se le repasa, las
   * tripas de la «a» y de la «e» se cierran y la palabra se convierte en una
   * mancha.
   */
  fatten: number;
}[] = [
  { id: 'redonda', label: 'Redonda', family: 'MoldeRedonda', weight: 800, fatten: 0.04 },
  { id: 'manuscrita', label: 'Manuscrita', family: 'MoldeManuscrita', weight: 700, fatten: 0.09 },
  { id: 'recia', label: 'Recia', family: 'MoldeRecia', weight: 600, fatten: 0.01 },
  { id: 'gordita', label: 'Gordita', family: 'MoldeGordita', weight: 400, fatten: 0 },
];

export function fontOf(style: FontStyle) {
  return FONT_STYLES.find((f) => f.id === style) ?? FONT_STYLES[0];
}

/** La orden CSS para pedirle esa letra a un canvas. */
export function fontCss(style: FontStyle, px: number): string {
  const f = fontOf(style);
  return `${f.weight} ${px}px "${f.family}", system-ui, sans-serif`;
}

/**
 * Curva un texto sobre un arco, como el letrero curvo.
 *
 * Vale para cualquier contorno, venga de la fuente de trazo o de una tipografía
 * rasterizada: se le pasan los puntos y el ancho que ocupa la línea. El radio
 * sale de ese ancho para que la curva se note igual con una palabra que con una
 * frase — siempre abarca el mismo ángulo.
 */
export function bendPaths(paths: Pt[][], width: number): Pt[][] {
  if (width < 1e-6) return paths;
  const r = width * 0.85;
  return paths.map((p) =>
    p.map(([x, y]) => {
      const a = (x - width / 2) / r;
      const rr = r + y;
      return [Math.sin(a) * rr, Math.cos(a) * rr - r] as Pt;
    }),
  );
}

/** Los trazos de una línea de texto, empezando en el origen. */
export function textPaths(text: string): TextPaths {
  let paths: Pt[][] = [];
  let x = 0;
  let primera = true;

  for (const ch of normalizeForFont(text)) {
    const g = G[ch];
    if (!g) continue; // un carácter que no tenemos, simplemente no se dibuja
    if (!primera) x += TRACKING;
    primera = false;
    for (const s of g.strokes) paths.push(s.map(([px, py]) => [px + x, py] as Pt));
    x += g.w;
  }

  return { paths, width: x };
}

/** ¿Sabemos dibujar algo de este texto? */
export function hasGlyphs(text: string): boolean {
  return [...normalizeForFont(text)].some((c) => G[c] && G[c].strokes.length);
}
