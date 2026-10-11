import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULTS, type Params } from '../types';

/**
 * Los ajustes de la pieza, con deshacer y rehacer.
 *
 * Se guardan los ajustes ENTEROS en cada cambio, no la lista de cosas que se
 * han tocado. Con un puñado de números por paso cuesta nada, y evita el enredo
 * de tener que saber deshacer cada tipo de cambio por separado.
 *
 * Los tirones de deslizador se agrupan: mientras se arrastra llegan decenas de
 * valores, y si cada uno fuera un paso, deshacer una vez movería el deslizador
 * un pelo. Se guarda uno cada 400 ms de quietud, que es lo que dura un gesto.
 *
 * También engancha Ctrl+Z y Ctrl+Y / Ctrl+Shift+Z, como en cualquier programa.
 */
export function useHistorial(inicial: Params) {
  const [params, setParams] = useState<Params>(inicial);
  const pasado = useRef<Params[]>([]);
  const futuro = useRef<Params[]>([]);
  const ultimo = useRef(0);
  const [puedeDeshacer, setPuedeDeshacer] = useState(false);
  const [puedeRehacer, setPuedeRehacer] = useState(false);

  const anotar = useCallback((prev: Params) => {
    const ahora = Date.now();
    if (ahora - ultimo.current > 400) {
      pasado.current.push(prev);
      if (pasado.current.length > 60) pasado.current.shift();
      futuro.current = [];
      setPuedeDeshacer(true);
      setPuedeRehacer(false);
    }
    ultimo.current = ahora;
  }, []);

  /** Cambia un ajuste y lo apunta en el historial. */
  const set = useCallback(<K extends keyof Params>(k: K, v: Params[K]) => {
    setParams((prev) => {
      if (prev[k] === v) return prev;
      anotar(prev);
      return { ...prev, [k]: v };
    });
  }, [anotar]);

  const deshacer = useCallback(() => {
    setParams((prev) => {
      const ant = pasado.current.pop();
      if (!ant) return prev;
      futuro.current.push(prev);
      setPuedeDeshacer(pasado.current.length > 0);
      setPuedeRehacer(true);
      ultimo.current = 0; // el próximo cambio vuelve a ser un paso propio
      return ant;
    });
  }, []);

  const rehacer = useCallback(() => {
    setParams((prev) => {
      const sig = futuro.current.pop();
      if (!sig) return prev;
      pasado.current.push(prev);
      setPuedeDeshacer(true);
      setPuedeRehacer(futuro.current.length > 0);
      ultimo.current = 0;
      return sig;
    });
  }, []);

  /** Restaurar mantiene el producto elegido: solo se limpian los ajustes. */
  const reset = useCallback(() => {
    setParams((prev) => {
      anotar(prev);
      ultimo.current = 0;
      return { ...DEFAULTS, product: prev.product };
    });
  }, [anotar]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement | null;
      // Dentro de un campo de texto manda el deshacer del propio campo.
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && (t as HTMLInputElement).type === 'text') return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); deshacer(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); rehacer(); }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [deshacer, rehacer]);

  return { params, setParams, set, deshacer, rehacer, reset, puedeDeshacer, puedeRehacer };
}
