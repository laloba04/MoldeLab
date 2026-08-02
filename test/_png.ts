/** Descodificador PNG mínimo (sin entrelazar), solo para reproducir en Node. */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function readPng(file: string): { data: Uint8ClampedArray; width: number; height: number } {
  const buf = readFileSync(file);
  let pos = 8;
  let w = 0, h = 0, depth = 0, color = 0;
  const idat: Buffer[] = [];
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      depth = body[8];
      color = body[9];
      if (body[12] !== 0) throw new Error('PNG entrelazado no soportado');
      if (depth !== 8) throw new Error('profundidad ' + depth + ' no soportada');
    } else if (type === 'PLTE') palette = Buffer.from(body);
    else if (type === 'tRNS') trns = Buffer.from(body);
    else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
    pos += 12 + len;
  }

  const ch = color === 0 ? 1 : color === 2 ? 3 : color === 3 ? 1 : color === 4 ? 2 : 4;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);

  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? out[y * stride + i - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = i >= ch && y > 0 ? out[(y - 1) * stride + i - ch] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + i] = v & 0xff;
    }
  }

  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * ch;
    let r = 0, g = 0, b = 0, a = 255;
    if (color === 0) r = g = b = out[s];
    else if (color === 2) [r, g, b] = [out[s], out[s + 1], out[s + 2]];
    else if (color === 3) {
      const idx = out[s];
      r = palette![idx * 3]; g = palette![idx * 3 + 1]; b = palette![idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    } else if (color === 4) { r = g = b = out[s]; a = out[s + 1]; }
    else { r = out[s]; g = out[s + 1]; b = out[s + 2]; a = out[s + 3]; }
    data.set([r, g, b, a], i * 4);
  }
  return { data, width: w, height: h };
}
