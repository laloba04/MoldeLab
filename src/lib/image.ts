/**
 * Imagen -> máscara binaria.
 *
 * La máscara es un Uint8Array de w*h con valores 0 / 1. Todo el pipeline
 * posterior trabaja sobre esta rejilla, así que aquí es donde se decide
 * qué es "material" y qué es fondo.
 */

export interface Mask {
  data: Uint8Array;
  w: number;
  h: number;
}

const MAX_SIDE = 700;

/** Dibuja el archivo en un canvas, reescalando si es enorme. */
export async function loadImageData(file: File | Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('El navegador no ha dado un contexto 2D.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return ctx.getImageData(0, 0, w, h);
}

/** ¿La imagen trae transparencia útil? Si sí, mandan los alfas. */
function hasAlpha(img: ImageData): boolean {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 250) return true;
  }
  return false;
}

/**
 * Binariza. Con alfa: opaco = material. Sin alfa: oscuro = material
 * (el caso típico de un dibujo negro sobre blanco).
 */
export function binarize(img: ImageData, threshold: number, invert: boolean): Mask {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(w * h);
  const alpha = hasAlpha(img);

  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    let on: boolean;
    if (alpha) {
      on = data[p + 3] > threshold;
    } else {
      const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      on = lum < threshold;
    }
    out[i] = (invert ? !on : on) ? 1 : 0;
  }
  return { data: out, w, h };
}

function dilate(m: Mask): Mask {
  const { w, h, data } = m;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1 && !v; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (data[ny * w + nx]) {
            v = 1;
            break;
          }
        }
      }
      out[y * w + x] = v;
    }
  }
  return { data: out, w, h };
}

function erode(m: Mask): Mask {
  const { w, h, data } = m;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1;
      for (let dy = -1; dy <= 1 && v; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          // El borde de la imagen cuenta como fondo: nada toca el marco.
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !data[ny * w + nx]) {
            v = 0;
            break;
          }
        }
      }
      out[y * w + x] = v;
    }
  }
  return { data: out, w, h };
}

/** Cierre morfológico: tapa agujeritos y une trazos punteados. */
export function cleanupMask(m: Mask, passes: number): Mask {
  let cur = m;
  for (let i = 0; i < passes; i++) cur = dilate(cur);
  for (let i = 0; i < passes; i++) cur = erode(cur);
  return cur;
}

/**
 * Rellena todo lo que no sea el fondo conectado al borde.
 * Convierte un dibujo de líneas en una silueta maciza.
 */
export function fillEnclosed(m: Mask): Mask {
  const { w, h, data } = m;
  const bg = new Uint8Array(w * h);
  const stack: number[] = [];

  const push = (x: number, y: number) => {
    const i = y * w + x;
    if (!bg[i] && !data[i]) {
      bg[i] = 1;
      stack.push(i);
    }
  };

  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }

  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }

  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = bg[i] ? 0 : 1;
  return { data: out, w, h };
}

/** Copia con un marco de fondo, para que ningún contorno toque el borde. */
export function pad(m: Mask, border = 2): Mask {
  const w = m.w + border * 2;
  const h = m.h + border * 2;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < m.h; y++) {
    out.set(m.data.subarray(y * m.w, (y + 1) * m.w), (y + border) * w + border);
  }
  return { data: out, w, h };
}
