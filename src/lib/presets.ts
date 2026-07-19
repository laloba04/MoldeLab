/**
 * Ajustes guardados («presets»): la configuración completa (producto + todos
 * los parámetros) bajo un nombre, para recuperarla con un clic. Se guardan en
 * el navegador (localStorage), así que sobreviven a recargar la página pero son
 * de este equipo: no viajan a otro ordenador.
 */

import type { Params } from '../types';

const KEY = 'moldelab-presets';

export interface Preset {
  name: string;
  params: Params;
}

export function loadPresets(): Preset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function save(list: Preset[]): Preset[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Modo incógnito o cuota llena: no se puede guardar, pero no rompemos nada.
  }
  return list;
}

/** Crea o reemplaza el preset con ese nombre y devuelve la lista ordenada. */
export function upsertPreset(name: string, params: Params): Preset[] {
  const clean = name.trim();
  if (!clean) return loadPresets();
  const list = loadPresets().filter((p) => p.name !== clean);
  list.push({ name: clean, params });
  list.sort((a, b) => a.name.localeCompare(b.name));
  return save(list);
}

export function deletePreset(name: string): Preset[] {
  return save(loadPresets().filter((p) => p.name !== name));
}
