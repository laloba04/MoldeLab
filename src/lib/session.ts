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

export function loadSession(): Partial<Session> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (!raw || typeof raw !== 'object') return {};
    const { params, mark } = raw as { params?: unknown; mark?: unknown };
    const out: Partial<Session> = {};
    if (params) out.params = cleanParams(params);
    if (typeof mark === 'string') out.mark = mark.slice(0, MARK_MAX);
    return out;
  } catch {
    return {};
  }
}

export function saveSession(s: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ params: s.params, mark: s.mark.slice(0, MARK_MAX) }));
  } catch {
    // Modo incógnito o cuota llena: no se puede recordar, pero no rompemos nada.
  }
}
