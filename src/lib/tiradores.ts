/**
 * Los tiradores de la vista: puntos que se arrastran con el ratón para mover la
 * anilla de un llavero o el nombre (y girarlo). Aquí está la cuenta de dónde va
 * cada tirador y qué ajuste cambia al arrastrarlo; el visor solo lo dibuja.
 */

import type { Params, Silhouette } from '../types';
import { byId } from './catalog';
import { boxOf } from './shapes';
import { ringHandle } from './generators/catalog-parts';
import { textLayout } from './sources';

type P3 = { x: number; y: number; z: number };
/** Cambia los ajustes a partir de los anteriores (como `setParams(prev => …)`). */
type Actualizar = (f: (prev: Params) => Params) => void;

/**
 * Tirador de la anilla: solo en llaveros (los que exponen «ringPos»).
 * Arrastrarlo mueve la anilla a mano, como en MakerLab.
 *
 * No se exige que la pieza sea una sola. El llavero en capas son varias —una
 * por tono— y esa condición lo dejaba sin tirador; la anilla va en la capa de
 * abajo, y el visor pone el tirador donde esté esa capa.
 */
export function tiradorAnilla(
  silhouette: Silhouette | null,
  params: Params,
  hayPiezas: boolean,
  actualizar: Actualizar,
): { pos: P3; move: (x: number, y: number) => void } | null {
  if (!silhouette || !byId(params.product).fields.includes('ringPos') || !hayPiezas) return null;
  const box = boxOf(silhouette.loops);
  const [hx, hy] = ringHandle(silhouette.loops, params);
  const holeDefault = box.maxY + Math.max(4, box.h * 0.06);
  return {
    pos: { x: hx, y: hy, z: params.thickness },
    move: (x, y) => {
      const nx = box.w ? (x - box.cx) / (box.w / 2) : 0;
      const ny = box.h ? (y - holeDefault) / (box.h / 2) : 0;
      actualizar((prev) => ({
        ...prev,
        ringPos: Math.max(-1, Math.min(1, Math.round(nx * 1000) / 1000)),
        ringPosY: Math.max(-1.5, Math.min(1.5, Math.round(ny * 1000) / 1000)),
      }));
    },
  };
}

/**
 * Tirador del nombre: el mismo gesto que la anilla, pero para el texto.
 *
 * Va donde está el nombre DE VERDAD, no donde diga una aproximación. Antes lo
 * colocaba a ojo desde la caja de la pieza y aparecía muy por debajo, flotando
 * fuera del llavero, porque esa caja ya incluye el propio nombre.
 *
 * La cuenta buena: el nombre se compone en un lienzo, `textLayout` dice en qué
 * píxel de ese lienzo cae, y el pipeline lo pasa a milímetros con una regla de
 * tres —el ancho pedido entre el ancho del lienzo— centrando luego en la caja
 * de tinta. Se rehace ese mismo camino, así que el tirador cae sobre la
 * palabra.
 */
export function tiradorTexto(
  silhouette: Silhouette | null,
  source: ImageData | null,
  img: ImageData | null,
  params: Params,
  numPiezas: number,
  actualizar: Actualizar,
): {
  pos: P3;
  rot: P3;
  move: (x: number, y: number) => void;
  girar: (x: number, y: number) => void;
} | null {
  if (!silhouette || !source || !img || !byId(params.product).fields.includes('textX') || numPiezas !== 1)
    return null;
  if (!params.textContent.trim()) return null;

  const L = textLayout(img, params.textContent, params.textScale, params.textX / 100, params.textY / 100, params.textRot);
  const mmPerPx = params.targetWidthMm / source.width;

  // Centro de la caja de tinta del lienzo: es el punto que el pipeline lleva
  // al origen al centrar la pieza.
  const d = source.data;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const i = (y * source.width + x) * 4;
      if (d[i + 3] > 40 && (d[i] + d[i + 1] + d[i + 2]) / 3 < 150) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  const inkCx = (minX + maxX) / 2;
  const inkCy = (minY + maxY) / 2;

  const ax = L.textCx + L.shiftX;
  const ay = L.textCy + L.shift;

  const cx = (ax - inkCx) * mmPerPx;
  const cy = -(ay - inkCy) * mmPerPx;

  // El tirador de girar orbita alrededor del de mover, a la altura de la
  // coronilla de las letras y un poco más allá. Con el nombre en recto queda
  // justo encima; al girarlo, lo acompaña.
  //
  // El giro se cuenta como en el lienzo (a favor del reloj visto desde
  // arriba), así que la «vertical» del nombre apunta a 90° menos el giro.
  const radio = Math.max(9, (L.textH / 2) * mmPerPx + 6);
  const aUp = ((90 - params.textRot) * Math.PI) / 180;

  return {
    pos: { x: cx, y: cy, z: params.thickness },
    rot: {
      x: cx + Math.cos(aUp) * radio,
      y: cy + Math.sin(aUp) * radio,
      z: params.thickness,
    },
    girar: (wx, wy) => {
      const a = (Math.atan2(wy - cy, wx - cx) * 180) / Math.PI;
      // El inverso: del ángulo del tirador al giro del nombre.
      let g = Math.round((90 - a) / 5) * 5;
      while (g > 180) g -= 360;
      while (g < -180) g += 360;
      actualizar((prev) => ({ ...prev, textRot: g }));
    },
    move: (wx, wy) => {
      // Del mundo al lienzo, y de ahí a los porcentajes que guardan los
      // deslizadores. Se usa el desplazamiento actual del lienzo: como el
      // arrastre va paso a paso, se recalcula en cada movimiento y converge.
      const nax = wx / mmPerPx + inkCx;
      const nay = -wy / mmPerPx + inkCy;
      // textCx = 900/2 + tx * (900/2)  ->  se despeja tx.
      const ntx = ((nax - L.shiftX - 450) / 450) * 100;
      // El inverso de `cae`: hacia arriba se mide contra el dibujo, hacia
      // abajo en alturas de letra.
      const base = L.imgH + 20 + L.textH / 2;
      const dd = nay - L.shift - base;
      const nty = (dd < 0 ? dd / L.imgH : dd / (L.textH * 1.5)) * 100;
      const clamp = (v: number) => Math.max(-100, Math.min(100, Math.round(v / 5) * 5));
      actualizar((prev) => ({ ...prev, textX: clamp(ntx), textY: clamp(nty) }));
    },
  };
}
