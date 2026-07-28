/**
 * Memoria entre visitas.
 *
 * Al volver a abrir la web, lo suyo es no tener que reconfigurarlo todo: se
 * recuerda el último producto, los parámetros que se tocaron y la marca del
 * taller. Es distinto de los «ajustes guardados» (esos se guardan con nombre a
 * mano); esto es automático y solo hay uno: lo último que dejaste.
 *
 * Se guarda en el navegador de este equipo, así que no viaja a otro ordenador.
 * Lo que se lee se sanea igual que los presets: nada de fiarse de lo que haya
 * en el almacén, que lo puede haber tocado cualquiera o venir de una versión
 * vieja de MoldeLab.
 */

import type { Params } from '../types';
import { cleanParams } from './presets';

const KEY = 'moldelab-sesion';
const MARK_MAX = 40;

export interface Session {
  params: Params;
  mark: string;
}

/** La marca, sin caracteres de control ni nada por debajo del espacio, y con
 *  tope de longitud. Se limpia sin regex de control para no meter esos mismos
 *  caracteres en el código. */
function cleanMark(raw: string): string {
  let out = '';
  for (const ch of raw) {
    if (ch >= ' ' && ch.codePointAt(0) !== 0x7f) out += ch;
    if (out.length >= MARK_MAX) break;
  }
  return out;
}

export function loadSession(): Partial<Session> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!raw || typeof raw !== 'object') return {};
    const { params, mark } = raw as { params?: unknown; mark?: unknown };
    const out: Partial<Session> = {};
    if (params) out.params = cleanParams(params);
    if (typeof mark === 'string') out.mark = cleanMark(mark);
    return out;
  } catch {
    return {};
  }
}

export function saveSession(s: Session): void {
  try {
    // Se sanea también al guardar: los parámetros pasan por el mismo filtro que
    // los presets y la marca por cleanMark. Al almacén nunca llega nada raro; no
    // se confía en que alguien lo limpie al leer.
    localStorage.setItem(
      KEY,
      JSON.stringify({ params: cleanParams(s.params), mark: cleanMark(s.mark) }),
    );
  } catch {
    // Modo incógnito o cuota llena: no se puede recordar, pero no rompemos nada.
  }
}
