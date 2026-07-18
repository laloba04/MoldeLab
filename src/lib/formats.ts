/**
 * Exportadores extra: OBJ (malla 3D genérica) y SVG (vector 2D para corte
 * láser). El STL y el 3MF viven en sus propios archivos; estos dos completan
 * los formatos que ofrece la web de referencia.
 */

import { zipSync } from 'fflate';
import type { Loop, Mesh, Pt } from '../types';
import { boxOf } from './shapes';

/** Empaqueta varios archivos (ya en bytes) en un solo .zip. */
export function zipFiles(entries: Record<string, Uint8Array>): Blob {
  return new Blob([zipSync(entries, { level: 0 }).buffer as ArrayBuffer], { type: 'application/zip' });
}

/** Suelda vértices de una malla (cuantización a 1 µm) para un OBJ compacto. */
function weld(positions: number[]): { verts: [number, number, number][]; faces: [number, number, number][] } {
  const q = (v: number) => Math.round(v * 1000) / 1000;
  const index = new Map<string, number>();
  const verts: [number, number, number][] = [];
  const faces: [number, number, number][] = [];

  const idOf = (i: number): number => {
    const x = q(positions[i]), y = q(positions[i + 1]), z = q(positions[i + 2]);
    const key = `${x},${y},${z}`;
    let id = index.get(key);
    if (id === undefined) {
      id = verts.length;
      index.set(key, id);
      verts.push([x, y, z]);
    }
    return id;
  };

  for (let i = 0; i < positions.length; i += 9) {
    const a = idOf(i), b = idOf(i + 3), c = idOf(i + 6);
    if (a !== b && b !== c && a !== c) faces.push([a, b, c]);
  }
  return { verts, faces };
}

/** Varias piezas -> un solo .obj, cada una como grupo `o`. */
export function toObj(pieces: { name: string; mesh: Mesh }[]): Blob {
  let out = '# MoldeLab\n';
  let base = 0; // los índices del OBJ son globales y 1-based

  for (const { name, mesh } of pieces) {
    const { verts, faces } = weld(mesh.positions);
    out += `o ${name.replace(/\s+/g, '_')}\n`;
    for (const [x, y, z] of verts) out += `v ${x} ${y} ${z}\n`;
    for (const [a, b, c] of faces) out += `f ${a + 1 + base} ${b + 1 + base} ${c + 1 + base}\n`;
    base += verts.length;
  }
  return new Blob([out], { type: 'text/plain' });
}

/**
 * Contornos 2D -> SVG en milímetros, para corte láser. Cada contorno es una
 * línea de corte (stroke fino, sin relleno). El eje Y del SVG apunta hacia
 * abajo, así que se invierte respecto a los milímetros del molde.
 */
export function toSvg(loops: Loop[]): Blob {
  const box = boxOf(loops);
  const w = Math.max(box.w, 0.1);
  const h = Math.max(box.h, 0.1);

  const path = (pts: Pt[]) =>
    'M ' + pts.map(([x, y]) => `${x.toFixed(3)} ${(-y).toFixed(3)}`).join(' L ') + ' Z';
  const d = loops.map((l) => path(l.pts)).join(' ');

  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(2)}mm" height="${h.toFixed(2)}mm" ` +
    `viewBox="${box.minX.toFixed(3)} ${(-box.maxY).toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)}">\n` +
    `<path d="${d}" fill="none" stroke="#000000" stroke-width="0.1" fill-rule="evenodd"/>\n` +
    `</svg>\n`;

  return new Blob([svg], { type: 'image/svg+xml' });
}
