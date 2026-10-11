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
}

/** Arma el archivo. `null` si no hay nada que guardar. */
export async function armarArchivo(
  piezas: Piece[],
  silueta: Silhouette | null,
  o: OpcionesArchivo,
): Promise<{ blob: Blob; outName: string } | null> {
  if (!piezas.length || !o.formatos.size) return null;
  const name = (o.nombre.trim() || o.porDefecto).replace(/[^\w-]+/g, '_').slice(0, 40) || 'moldelab';
  const forExport = o.separar ? spreadPieces(piezas) : dropToBed(piezas);

  const files: Record<string, Uint8Array> = {};
  const add = async (fn: string, blob: Blob) => {
    files[fn] = new Uint8Array(await blob.arrayBuffer());
  };

  if (o.formatos.has('3mf')) await add(`${name}.3mf`, to3mf(forExport, { ...o.colores, zone: o.zona }));
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
