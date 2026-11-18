/**
 * Manda el cálculo pesado a un Worker y devuelve una promesa.
 *
 * Un cálculo que ya no hace falta (se ha tocado otra cosa mientras tanto) no se
 * espera: se mata el Worker y se arranca otro. Si no, cada clic se encolaba
 * detrás del anterior y la página parecía colgada para siempre.
 *
 * Si el navegador no puede arrancar el Worker, se calcula en la página como
 * antes: más lento, pero funciona.
 */
import { buildPieces, vectorize } from './pipeline';
import type { Params, Piece, Silhouette } from '../types';

export const CANCELADO = 'cancelado';

type Pendiente = { id: number; ok: (v: unknown) => void; ko: (e: unknown) => void };

class Calculador {
  private w: Worker | null = null;
  private roto = false;
  private pendiente: Pendiente | null = null;
  private n = 0;

  private worker(): Worker | null {
    if (this.roto) return null;
    if (this.w) return this.w;
    try {
      const w = new Worker(new URL('./calculo.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        const p = this.pendiente;
        if (!p || e.data.id !== p.id) return;
        this.pendiente = null;
        if (e.data.ok) p.ok(e.data.resultado);
        else p.ko(e.data.error);
      };
      w.onerror = (e) => {
        // El Worker no ha podido ni cargar: a partir de aquí, en la página.
        e.preventDefault?.();
        this.roto = true;
        this.w = null;
        const p = this.pendiente;
        this.pendiente = null;
        p?.ko('worker');
      };
      this.w = w;
      return w;
    } catch {
      this.roto = true;
      return null;
    }
  }

  /** Cancela lo que esté en marcha (si lo hay) matando el Worker. */
  cancelar(): void {
    if (!this.pendiente) return;
    this.pendiente.ko(CANCELADO);
    this.pendiente = null;
    this.w?.terminate();
    this.w = null;
  }

  pedir<T>(pedido: Record<string, unknown>, enPagina: () => T): Promise<T> {
    this.cancelar();
    const w = this.worker();
    if (!w) {
      // Sin Worker: en la página, pero tras un respiro para que se pinte el aviso.
      return new Promise((ok, ko) => setTimeout(() => {
        try { ok(enPagina()); } catch (e) { ko(e); }
      }, 30));
    }
    const id = ++this.n;
    return new Promise<T>((ok, ko) => {
      this.pendiente = {
        id,
        ok: ok as (v: unknown) => void,
        // Si el Worker no ha podido cargar, se repite en la página.
        ko: (e) => {
          if (e === 'worker') {
            try { ok(enPagina()); } catch (err) { ko(err); }
          } else ko(e);
        },
      };
      try {
        w.postMessage({ ...pedido, id });
      } catch {
        // Algo del pedido no se puede copiar al Worker: en la página.
        this.pendiente = null;
        try { ok(enPagina()); } catch (err) { ko(err); }
      }
    });
  }
}

// Uno para vectorizar y otro para las piezas: si cambian las dos cosas a la vez,
// pedir piezas no debe matar la vectorización (ni al revés).
const vec = new Calculador();
const pzs = new Calculador();

export function vectorizarAparte(source: ImageData, params: Params, textSource: ImageData | null): Promise<Silhouette> {
  return vec.pedir({ tipo: 'vectorizar', source, params, textSource }, () => vectorize(source, params, textSource));
}

export function piezasAparte(silhouette: Silhouette, params: Params): Promise<Piece[]> {
  return pzs.pedir({ tipo: 'piezas', silhouette, params }, () => buildPieces(silhouette, params));
}
