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

import { binarize, fillEnclosed, type Mask } from './image';

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
/**
 * Fila más baja con tinta cerca del eje central de la imagen. Sirve para saber
 * dónde termina de verdad el dibujo (no su caja), y así soldar el texto justo
 * ahí. Devuelve la Y en píxeles de la imagen (o su alto si no hay tinta).
 */
function inkBottomCenter(img: ImageData, colFrac = 0.4): number {
  const { width, height, data } = img;
  const x0 = Math.floor(width * (0.5 - colFrac / 2));
  const x1 = Math.ceil(width * (0.5 + colFrac / 2));
  for (let y = height - 1; y >= 0; y--) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (data[i + 3] > 40 && lum < 150) return y;
    }
  }
  return height;
}

/** Encoge una máscara `r` píxeles. Dos pasadas de mínimo, una por eje: sale lo
 *  mismo que un círculo y cuesta lo que una línea. */
function encoger(m: Mask, r: number): Mask {
  const { w, h } = m;
  const a = new Uint8Array(w * h);
  const b = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 1;
      for (let d = -r; d <= r && on; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= w || !m.data[y * w + xx]) on = 0;
      }
      a[y * w + x] = on;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 1;
      for (let d = -r; d <= r && on; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h || !a[yy * w + x]) on = 0;
      }
      b[y * w + x] = on;
    }
  }
  return { data: b, w, h };
}

/**
 * Abre un hueco alrededor del nombre, SOLO por dentro de la figura.
 *
 * Sin hueco, un nombre puesto sobre un dibujo de líneas no se lee: las dos cosas
 * se levantan a la misma altura, así que no queda encima, queda mezclado.
 *
 * Y el hueco no puede abrirse a lo bruto. La primera versión borraba un anillo
 * sin mirar dónde: cuando ese anillo cruzaba el CONTORNO EXTERIOR del dibujo, la
 * silueta dejaba de cerrar, el relleno se escapaba y el llavero salía sin placa,
 * en puras líneas sueltas. Aquí se calcula antes qué es «dentro» —la silueta
 * rellena, encogida un margen— y no se borra ni un píxel fuera de ahí. El
 * contorno queda intacto por construcción, así que la pieza no se puede romper.
 */
function limpiarAlrededor(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  texto: string,
  cx: number,
  cy: number,
  px: number,
): void {
  // Lo justo para que se note el escalón y no un milímetro más: el hueco solo
  // tiene que separar las letras de las líneas, no despejar media figura. Con
  // uno ancho el nombre se lee, sí, pero se lleva por delante los adornos de
  // alrededor y la pieza pierde la gracia.
  const halo = Math.max(6, px * 0.1);
  const margen = Math.ceil(Math.max(5, px * 0.14));

  const lienzo = ctx.getImageData(0, 0, w, h);
  const dentro = encoger(fillEnclosed(binarize(lienzo, 128, false)), margen);

  // Dónde borrar: las letras engordadas el ancho del halo.
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const o = off.getContext('2d', { willReadFrequently: true })!;
  o.fillStyle = '#fff';
  o.fillRect(0, 0, w, h);
  o.font = ctx.font;
  o.textAlign = 'center';
  o.textBaseline = 'middle';
  o.lineJoin = 'round';
  o.lineCap = 'round';
  o.strokeStyle = '#000';
  o.fillStyle = '#000';
  o.lineWidth = halo * 2;
  o.strokeText(texto, cx, cy);
  o.fillText(texto, cx, cy);
  const anillo = binarize(o.getImageData(0, 0, w, h), 128, false);

  const d = lienzo.data;
  for (let i = 0; i < dentro.data.length; i++) {
    if (!anillo.data[i] || !dentro.data[i]) continue;
    const j = i * 4;
    d[j] = 255;
    d[j + 1] = 255;
    d[j + 2] = 255;
    d[j + 3] = 255;
  }
  ctx.putImageData(lienzo, 0, 0);
}

/**
 * Dónde acaba el nombre en el lienzo compuesto, en píxeles.
 *
 * Lo comparten el dibujado y el tirador de la vista 3D: si cada uno hiciera su
 * cuenta, el tirador acabaría en un sitio y el nombre en otro — que es justo lo
 * que pasaba cuando el tirador se calculaba «a ojo» desde la caja de la pieza.
 */
export function textLayout(img: ImageData, text: string, scale: number, tx = 0, ty = 0) {
  const t = text.trim();
  const imgW = W * 0.9;
  const k = imgW / img.width;
  const imgH = img.height * k;
  const imgTop = 20;

  // Dónde acaba de verdad el dibujo: la tinta más baja, no el borde de la imagen.
  const inkY0 = imgTop + inkBottomCenter(img) * k;

  const probe = makeCanvas(8, 8).ctx;

  // Primer tanteo con el tamaño que se ha pedido, solo para saber DÓNDE cae.
  const px0 = fit(probe, t, W * (scale / 100), 200);
  const cae = (alto: number) => imgH + 20 + alto / 2 + ty * alto * 1.5;
  const encima = cae(px0 * 1.6) - (px0 * 1.6) / 2 <= inkY0 + 2;

  // Encima de la figura el nombre lleva tope de ancho.
  //
  // «Tamaño del texto» es el porcentaje del ancho de trabajo, y eso vale cuando
  // el nombre va debajo, en su propia fila. Encima no: un 70% tapa la figura
  // entera y la pieza deja de ser un elefante con un nombre para ser un cartel
  // con orejas. Aquí se le limita a media anchura del dibujo, que es lo que mide
  // una chapa de nombre de verdad; el deslizador sigue mandando por debajo de
  // ese tope.
  const px = encima ? Math.min(px0, fit(probe, t, imgW * 0.5, px0)) : px0;
  probe.font = FONT.replace('%s', String(px));
  const textH = px * 1.6;
  const textW = probe.measureText(t).width;

  // Posición: parte de «centrado, debajo de la imagen» y se desplaza con el
  // control, sin tope. Puede acabar encima del dibujo, que es lo que se quiere
  // para poner el nombre sobre la figura.
  const textCy = cae(textH);
  const textCx = W / 2 + tx * (W * 0.5);

  // El lienzo crece por donde haga falta: a lo alto y también a lo ANCHO.
  //
  // Antes solo crecía a lo alto y el texto se recortaba contra los bordes
  // laterales. El efecto era que a partir de cierto punto movías el deslizador
  // y no pasaba nada —el texto se quedaba clavado en el borde— sin que nada lo
  // explicara. Ahora el lienzo se estira y el deslizador siempre responde.
  const margen = textW / 2 + 30;
  const left = Math.min(0, textCx - margen);
  const right = Math.max(W, textCx + margen);
  const bottom = Math.max(imgH + textH + 60, textCy + textH / 2 + 30);
  const top = Math.min(0, textCy - textH / 2 - 30);
  const cw = Math.ceil(right - left);
  const ch = Math.ceil(bottom - top);
  const shift = -top; // todo se dibuja desplazado si el texto sube por encima
  const shiftX = -left; // y lo mismo si se va por la izquierda

  return { t, px, textH, textW, textCx, textCy, shift, shiftX, cw, ch, imgW, imgH, imgTop, k, inkY0 };
}

export function imageWithText(
  img: ImageData,
  text: string,
  scale: number,
  tx = 0,
  ty = 0,
): ImageData {
  const L = textLayout(img, text, scale, tx, ty);
  const { t, px, textH, textW, textCx, textCy, shift, shiftX, cw, ch, imgW, imgH, imgTop, inkY0 } = L;
  if (!t) return img;

  const { c, ctx } = makeCanvas(cw, ch);

  // ImageData no se puede dibujar escalado: pasa por un canvas intermedio.
  const tmp = document.createElement('canvas');
  tmp.width = img.width;
  tmp.height = img.height;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  ctx.drawImage(tmp, shiftX + (W - imgW) / 2, imgTop + shift, imgW, imgH);

  // Puente: une la tinta más baja del dibujo con el texto para que salgan
  // soldados en UNA pieza (si no, el texto flota o se pierde como isla suelta).
  //
  // Va desde el dibujo hasta el BORDE DE ARRIBA del texto, no hasta su centro.
  // Antes llegaba al centro y por tanto cruzaba las letras: con el texto pegado
  // al dibujo, esa barra se veía como un pegote atravesándolo todo. Y si el
  // texto ya toca el dibujo no se dibuja ninguna barra, que no hace falta.
  ctx.font = FONT.replace('%s', String(px));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const inkY = inkY0 + shift;
  const textTop = textCy + shift - textH / 2;
  const debajo = textTop > inkY + 2;

  // El puente solo hace falta cuando el nombre cuelga por DEBAJO del dibujo: ahí
  // es una isla suelta y hay que soldarla. Si cae encima, ya se apoya en la
  // placa y no hay nada que unir.
  //
  // Y llega hasta el borde de ARRIBA de las letras, no hasta su centro. Antes
  // iba al centro y cruzaba la palabra entera de lado a lado: ese era el pegote
  // que se veía atravesando la pieza.
  if (debajo) {
    ctx.strokeStyle = '#000';
    ctx.lineWidth = Math.max(22, px * 0.28);
    ctx.beginPath();
    ctx.moveTo(shiftX + W / 2, inkY);
    ctx.lineTo(shiftX + textCx, textTop + textH * 0.22);
    ctx.stroke();
  }

  if (debajo) {
    // Colgando por debajo, el nombre va en tinta y se levanta en relieve sobre
    // la placa lisa: se lee solo.
    ctx.fillStyle = '#000';
    ctx.fillText(t, shiftX + textCx, textCy + shift);
  } else {
    // Encima de la figura se le abre un hueco alrededor: un anillo de dibujo
    // borrado para que el nombre no se mezcle con las líneas.
    //
    // Solo se borra POR DENTRO de la figura, y con margen respecto a su
    // contorno. Eso es lo importante: la primera versión borraba a lo bruto, el
    // anillo cruzaba el contorno exterior, la silueta dejaba de cerrar y el
    // llavero se quedaba sin placa, en puras líneas sueltas. Aquí se calcula
    // antes qué es «dentro» y no se toca ni un píxel fuera de ahí.
    limpiarAlrededor(ctx, c.width, c.height, t, shiftX + textCx, textCy + shift, px);
    ctx.fillStyle = '#000';
    ctx.fillText(t, shiftX + textCx, textCy + shift);
  }


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
