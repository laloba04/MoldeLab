/**
 * De las piezas al archivo que se descarga (o se manda al laminador).
 *
 * Cada formato elegido añade uno o varios archivos; si al final hay más de uno,
 * se empaquetan en un ZIP. Lo comparten el botón de descargar y el de mandar al
 * laminador, así que los dos sacan exactamente lo mismo.
 */

import type { Piece, Silhouette } from '../types';
import { toStl } from './stl';
import { toObj, toSvg, zipFiles } from './formats';
import { to3mf } from './threemf';
import { planBambu, toBambu3mf } from './bambu';
import { ajustesProyecto, leerDeBambu, type Leer } from './bambuPerfiles';
import { dropToBed, spreadPieces } from './layout';

export type Fmt = '3mf' | 'stl' | 'obj' | 'svg';

export const FORMATS: { id: Fmt; label: string; hint: string }[] = [
  { id: '3mf', label: '3MF (color)', hint: 'Todas las piezas y los colores, para Bambu/Orca.' },
  { id: 'stl', label: 'STL', hint: 'El clásico. Varias piezas van en un ZIP.' },
  { id: 'obj', label: 'OBJ', hint: 'Malla 3D genérica (Blender, Meshmixer…).' },
  { id: 'svg', label: 'SVG (corte láser)', hint: 'El contorno 2D en milímetros.' },
];

export interface OpcionesArchivo {
  formatos: Set<Fmt>;
  /** Lo que haya escrito el usuario; vacío, se usa `porDefecto`. */
  nombre: string;
  porDefecto: string;
  /** Separar las piezas en la cama, o dejarlas donde están. */
  separar: boolean;
  colores: { bg: string; trace: string; text: string };
  /** Color pintado a mano de cada zona (o nada, con «todo de un color»). */
  zona?: (pieceId: string, zone: string) => string | undefined;
  /**
   * Termoformado: el 3MF sale como proyecto de Bambu con placas (mallas, tuerca
   * y clip, cada molde). Sin esto, 3MF estándar con todo en una placa.
   */
  porPlacas?: boolean;
  /** Para los tests: de dónde leer los perfiles de Bambu (por defecto, su repositorio). */
  leerPerfil?: Leer;
  /** Termoformado: bajar todo, solo las planchas (con tuerca y pinza) o solo los moldes. */
  soloPiezas?: 'todas' | 'planchas' | 'moldes';
}

/**
 * A qué placa va cada pieza del termoformado: las planchas juntas, la tuerca y
 * la pinza juntas, y cada molde en la suya (son grandes y de otro material).
 * Las piezas de otros productos no tienen placa.
 */
export function placaDe(id: string): string | null {
  if (id === 'sheet' || id === 'sheet-back') return 'planchas';
  if (id === 'cap' || id.startsWith('clip')) return 'tuerca-y-pinza';
  if (id.startsWith('mold-')) return id.replace('mold-down', 'molde-abajo').replace('mold-up', 'molde-arriba');
  return null;
}

/** Las piezas agrupadas por placa, en orden. Vacío si el producto no las tiene. */
export function placasDe(piezas: Piece[]): Map<string, Piece[]> {
  const grupos = new Map<string, Piece[]>();
  for (const pc of piezas) {
    const g = placaDe(pc.id);
    if (g) grupos.set(g, [...(grupos.get(g) ?? []), pc]);
  }
  return grupos;
}

/** Arma el archivo. `null` si no hay nada que guardar. */
export async function armarArchivo(
  piezas: Piece[],
  silueta: Silhouette | null,
  o: OpcionesArchivo,
): Promise<{ blob: Blob; outName: string } | null> {
  if (o.soloPiezas === 'planchas') piezas = piezas.filter((pc) => !pc.id.startsWith('mold-'));
  else if (o.soloPiezas === 'moldes') piezas = piezas.filter((pc) => pc.id.startsWith('mold-'));
  if (!piezas.length || !o.formatos.size) return null;
  const name = (o.nombre.trim() || o.porDefecto).replace(/[^\w-]+/g, '_').slice(0, 40) || 'moldelab';
  const forExport = o.separar ? spreadPieces(piezas) : dropToBed(piezas);

  const files: Record<string, Uint8Array> = {};
  const add = async (fn: string, blob: Blob) => {
    files[fn] = new Uint8Array(await blob.arrayBuffer());
  };

  if (o.formatos.has('3mf')) {
    // Con placas (termoformado): un 3MF de PROYECTO de Bambu, con las mallas en
    // una placa, la tuerca y el clip en otra y cada molde en la suya. Si no, el
    // 3MF estándar con los colores pintados.
    const placas = o.porPlacas ? placasDe(piezas) : new Map<string, Piece[]>();
    let hecho = false;
    if (placas.size > 1) {
      // Los ajustes del proyecto (A1) se bajan de los perfiles oficiales de Bambu.
      // Sin ellos Bambu ignora las placas: si no se pueden bajar, 3MF estándar.
      try {
        const colores = planBambu(placas, { ...o.colores, zone: o.zona }).filamentos;
        const json = await ajustesProyecto(o.leerPerfil ?? leerDeBambu, colores);
        await add(`${name}.3mf`, toBambu3mf(placas, { ...o.colores, zone: o.zona }, () => json));
        hecho = true;
      } catch (e) {
        console.warn('Sin ajustes de Bambu; sale el 3MF estándar.', e);
      }
    }
    if (!hecho) await add(`${name}.3mf`, to3mf(forExport, { ...o.colores, zone: o.zona }));
  }
  if (o.formatos.has('obj')) await add(`${name}.obj`, toObj(forExport.map((p) => ({ name: p.label, mesh: p.mesh }))));
  if (o.formatos.has('svg') && silueta) await add(`${name}.svg`, toSvg(silueta.loops));
  if (o.formatos.has('stl')) {
    if (forExport.length === 1)
      await add(`${name}.stl`, toStl(forExport[0].mesh, `MoldeLab ${forExport[0].label}`));
    else for (const pc of forExport) await add(`${name}-${pc.id}.stl`, toStl(pc.mesh, pc.label));
  }

  const names = Object.keys(files);
  if (!names.length) return null;
  const single = names.length === 1;
  return {
    blob: single ? new Blob([files[names[0]].buffer as ArrayBuffer]) : zipFiles(files),
    outName: single ? names[0] : `${name}.zip`,
  };
}

/** Medidas reales de lo que se imprime (caja envolvente en mm): ancho × largo × alto. */
export function medidas(piezas: Piece[]): { w: number; l: number; h: number } | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of piezas) {
    const q = p.mesh.positions;
    for (let i = 0; i < q.length; i += 3) {
      if (q[i] < minX) minX = q[i];
      if (q[i] > maxX) maxX = q[i];
      if (q[i + 1] < minY) minY = q[i + 1];
      if (q[i + 1] > maxY) maxY = q[i + 1];
      if (q[i + 2] < minZ) minZ = q[i + 2];
      if (q[i + 2] > maxZ) maxZ = q[i + 2];
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { w: maxX - minX, l: maxY - minY, h: maxZ - minZ };
}
