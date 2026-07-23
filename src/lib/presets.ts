/**
 * Ajustes guardados («presets»): la configuración completa (producto + todos
 * los parámetros) bajo un nombre, para recuperarla con un clic. Se guardan en
 * el navegador (localStorage), así que sobreviven a recargar la página pero son
 * de este equipo: no viajan a otro ordenador.
 */

import { DEFAULTS, type Params } from '../types';
import { PRODUCTS } from './catalog';

const KEY = 'moldelab-presets';

export interface Preset {
  name: string;
  params: Params;
}

const MAX_NAME = 60;

/**
 * El nombre, reducido a lo que un nombre puede ser: letras (con tildes y ñ),
 * números, espacios y poco más. Se limpia tanto al guardar como al leer, así
 * que en el almacén del navegador nunca llega a haber nada raro — ni caracteres
 * de control, ni etiquetas, ni un nombre de mil letras.
 */
function cleanName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .trim()
    .slice(0, MAX_NAME);
}
const MAX_TEXT = 2000; // tope de los campos de texto (nombre, contenido del QR…)

/**
 * Lo que sale de localStorage no es de fiar: lo puede haber tocado cualquiera
 * desde las herramientas del navegador, y además puede venir de una versión
 * vieja de MoldeLab con parámetros que ya no existen. Así que no se acepta tal
 * cual, se RECONSTRUYE: se parte de los valores por defecto y solo se copia lo
 * que existe y es del tipo correcto. Cualquier cosa rara se queda fuera sola.
 */
function cleanParams(raw: unknown): Params {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const k of Object.keys(DEFAULTS) as (keyof Params)[]) {
    const v = src[k];
    if (typeof v !== typeof DEFAULTS[k]) continue;
    // Un número que no es número (NaN, infinito) reventaría la geometría.
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    // Con los textos no basta el tipo: «product» tiene que ser un producto que
    // exista de verdad, o la app intentaría construir algo que no está.
    if (k === 'product' && !PRODUCTS.some((prod) => prod.id === v)) continue;
    if (typeof v === 'string' && v.length > MAX_TEXT) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function cleanPreset(raw: unknown): Preset | null {
  if (!raw || typeof raw !== 'object') return null;
  const { name, params } = raw as { name?: unknown; params?: unknown };
  if (typeof name !== 'string') return null;
  const clean = cleanName(name);
  return clean ? { name: clean, params: cleanParams(params) } : null;
}

export function loadPresets(): Preset[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(cleanPreset).filter((p): p is Preset => p !== null);
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
  const clean = cleanName(name);
  if (!clean) return loadPresets();
  const list = loadPresets().filter((p) => p.name !== clean);
  // También se sanea al guardar: lo que entra al almacén ya viene limpio, no
  // se confía en que alguien lo limpie al salir.
  list.push({ name: clean, params: cleanParams(params) });
  list.sort((a, b) => a.name.localeCompare(b.name));
  return save(list);
}

export function deletePreset(name: string): Preset[] {
  const clean = cleanName(name);
  return save(loadPresets().filter((p) => p.name !== clean));
}
