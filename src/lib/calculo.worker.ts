/**
 * El cálculo pesado (vectorizar la imagen y construir las piezas) fuera de la
 * página. Con Termoformado 2 y una imagen de colores tarda varios segundos; en
 * el hilo de la página la dejaba colgada todo ese rato, sin poder ni hacer
 * scroll. Aquí la página sigue respondiendo mientras tanto.
 */
import { buildPieces, vectorize } from './pipeline';
import type { Params, Silhouette } from '../types';

export type Pedido =
  | { id: number; tipo: 'vectorizar'; source: ImageData; params: Params; textSource: ImageData | null }
  | { id: number; tipo: 'piezas'; silhouette: Silhouette; params: Params };

self.onmessage = (e: MessageEvent<Pedido>) => {
  const m = e.data;
  try {
    const resultado =
      m.tipo === 'vectorizar' ? vectorize(m.source, m.params, m.textSource) : buildPieces(m.silhouette, m.params);
    self.postMessage({ id: m.id, ok: true, resultado });
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err) });
  }
};
