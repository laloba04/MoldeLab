/**
 * STL binario: 80 bytes de cabecera, uint32 con el número de triángulos y
 * 50 bytes por triángulo (normal + 3 vértices + 2 bytes de atributo).
 * Little-endian, float32.
 */

import { zipSync } from 'fflate';
import type { Mesh } from '../types';

export function stlBytes(mesh: Mesh, header = 'MoldeLab'): Uint8Array {
  const count = mesh.positions.length / 9;
  const buf = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  bytes.set(new TextEncoder().encode(header.slice(0, 79)), 0);
  view.setUint32(80, count, true);

  let o = 84;
  const p = mesh.positions;

  for (let i = 0; i < count; i++) {
    const b = i * 9;
    const ax = p[b], ay = p[b + 1], az = p[b + 2];
    const bx = p[b + 3], by = p[b + 4], bz = p[b + 5];
    const cx = p[b + 6], cy = p[b + 7], cz = p[b + 8];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;

    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;

    view.setFloat32(o, nx / len, true);
    view.setFloat32(o + 4, ny / len, true);
    view.setFloat32(o + 8, nz / len, true);
    view.setFloat32(o + 12, ax, true);
    view.setFloat32(o + 16, ay, true);
    view.setFloat32(o + 20, az, true);
    view.setFloat32(o + 24, bx, true);
    view.setFloat32(o + 28, by, true);
    view.setFloat32(o + 32, bz, true);
    view.setFloat32(o + 36, cx, true);
    view.setFloat32(o + 40, cy, true);
    view.setFloat32(o + 44, cz, true);
    view.setUint16(o + 48, 0, true);
    o += 50;
  }
  return bytes;
}

export function toStl(mesh: Mesh, header = 'MoldeLab'): Blob {
  return new Blob([stlBytes(mesh, header).buffer as ArrayBuffer], { type: 'model/stl' });
}

/** Varias piezas -> un solo .zip. Una descarga, un clic, cero bloqueos. */
export function toZip(files: { name: string; mesh: Mesh }[]): Blob {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    // Los STL ya van comprimidos fatal; nivel 0 = empaquetar sin perder tiempo.
    entries[f.name] = stlBytes(f.mesh, f.name);
  }
  return new Blob([zipSync(entries, { level: 0 }).buffer as ArrayBuffer], { type: 'application/zip' });
}
