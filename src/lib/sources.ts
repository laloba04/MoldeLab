/**
 * Fuentes de imagen.
 *
 * El pipeline solo entiende ImageData. Todo lo que no sea un archivo subido
 * (texto, texto curvo, QR, imagen+texto) se rasteriza aquí a un canvas y entra
 * por la misma puerta. Los generadores nunca saben de dónde salió el dibujo.
 *
 * Solo funciona en navegador (usa canvas 2D). Los tests de Node no pasan por
 * aquí: alimentan los generadores con máscaras sintéticas.
 */

const W = 900; // ancho de trabajo; el alto se calcula

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Sin contexto 2D.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  return { c, ctx };
}

/**
 * Una fuente gorda y redonda aguanta la impresión; una fina se rompe en el
 * primer lavado. Nunito/Arial Rounded si están, y si no, sans-serif en negrita.
 */
const FONT = '900 %spx "Arial Rounded MT Bold", "Nunito", "Segoe UI", system-ui, sans-serif';

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number, startPx: number): number {
  let px = startPx;
  do {
    ctx.font = FONT.replace('%s', String(px));
    if (ctx.measureText(text).width <= maxW) return px;
    px -= 8;
  } while (px > 20);
  return px;
}

/** Texto recto. `scale` = % del ancho que puede ocupar. */
export function textImage(text: string, scale: number): ImageData {
  const t = text.trim() || 'Texto';
  const probe = makeCanvas(8, 8).ctx;
  const px = fit(probe, t, W * (scale / 100), 320);

  probe.font = FONT.replace('%s', String(px));
  const m = probe.measureText(t);
  const h = Math.ceil((m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * 1.5) + 40;

  const { c, ctx } = makeCanvas(W, Math.max(h, 120));
  ctx.font = FONT.replace('%s', String(px));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t, W / 2, c.height / 2);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/**
 * Texto en arco: cada letra rotada sobre una circunferencia. `curve` son los
 * grados totales que abarca el texto — 90° es una sonrisa, 180° una herradura.
 */
export function arcTextImage(text: string, scale: number, curve: number): ImageData {
  const t = text.trim() || 'Texto';
  const probe = makeCanvas(8, 8).ctx;
  const px = fit(probe, t, W * (scale / 100), 240);
  probe.font = FONT.replace('%s', String(px));

  const arcLen = probe.measureText(t).width * 1.08;
  const theta = (Math.max(10, curve) * Math.PI) / 180;
  const radius = arcLen / theta;

  const sag = radius * (1 - Math.cos(theta / 2)); // cuánto "cae" el arco
  const h = Math.ceil(sag + px * 2.4);
  const { c, ctx } = makeCanvas(W, Math.max(h, 160));

  ctx.font = FONT.replace('%s', String(px));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Centro del círculo por encima del lienzo: el texto sonríe hacia arriba.
  const cx = W / 2;
  const cy = px * 1.1 + radius;

  let dist = -arcLen / 2;
  for (const ch of t) {
    const w = probe.measureText(ch).width;
    const a = (dist + w / 2) / radius; // ángulo del centro de la letra
    ctx.save();
    ctx.translate(cx + Math.sin(a) * radius, cy - Math.cos(a) * radius);
    ctx.rotate(a);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    dist += w;
  }
  return ctx.getImageData(0, 0, c.width, c.height);
}

/** Imagen del usuario arriba, texto debajo. El clásico logo + nombre. */
export function imageWithText(img: ImageData, text: string, scale: number): ImageData {
  const t = text.trim();
  if (!t) return img;

  const probe = makeCanvas(8, 8).ctx;
  const px = fit(probe, t, W * (scale / 100), 200);
  probe.font = FONT.replace('%s', String(px));
  const textH = px * 1.6;

  const imgW = W * 0.9;
  const k = imgW / img.width;
  const imgH = img.height * k;

  const { c, ctx } = makeCanvas(W, Math.ceil(imgH + textH + 60));

  // ImageData no se puede dibujar escalado: pasa por un canvas intermedio.
  const tmp = document.createElement('canvas');
  tmp.width = img.width;
  tmp.height = img.height;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  ctx.drawImage(tmp, (W - imgW) / 2, 20, imgW, imgH);

  ctx.font = FONT.replace('%s', String(px));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // El texto solapa 6 px con la imagen: así texto e imagen salen soldados en
  // una sola pieza en vez de flotar separados.
  ctx.fillText(t, W / 2, imgH + 14 + textH / 2 - 6);

  return ctx.getImageData(0, 0, c.width, c.height);
}

/**
 * QR como ImageData. Cada módulo es un cuadrado de píxeles; marching squares
 * fusionará los adyacentes él solo. Nivel M: aguanta el relieve y el filamento.
 */
export async function qrImage(content: string): Promise<ImageData> {
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M'); // 0 = el tamaño lo decide el contenido
  qr.addData(content.trim() || 'https://example.com');
  qr.make();

  const n = qr.getModuleCount();
  const cell = 14;
  const quiet = 2 * cell; // zona de silencio: sin ella muchos lectores fallan
  const size = n * cell + quiet * 2;

  const { c, ctx } = makeCanvas(size, size);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.isDark(y, x)) {
        ctx.fillRect(quiet + x * cell, quiet + y * cell, cell, cell);
      }
    }
  }
  return ctx.getImageData(0, 0, c.width, c.height);
}
