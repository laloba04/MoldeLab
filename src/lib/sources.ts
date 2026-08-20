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

import { fontCss, type FontStyle } from './font';

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
 * La tipografía del texto de la pieza: las mismas cuatro empaquetadas que usa la
 * marca del taller (`font.ts`).
 *
 * Empaquetadas y no del sistema por lo de siempre: esto acaba siendo geometría
 * dentro del STL, así que con la fuente del sistema la misma pieza saldría
 * distinta en cada ordenador según lo que tuviera instalado.
 */
let FUENTE: FontStyle = 'redonda';
const font = (px: number) => fontCss(FUENTE, px);

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number, startPx: number): number {
  let px = startPx;
  do {
    ctx.font = font(px);
    if (ctx.measureText(text).width <= maxW) return px;
    px -= 8;
  } while (px > 20);
  return px;
}

/** Escribe centrado en (cx, cy), girado `rad` radianes sobre ese mismo punto. */
function escribirGirado(
  ctx: CanvasRenderingContext2D,
  t: string,
  cx: number,
  cy: number,
  rad: number,
): void {
  if (!rad) {
    ctx.fillText(t, cx, cy);
    return;
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);
  ctx.fillText(t, 0, 0);
  ctx.restore();
}

/** Qué tipografía usan las funciones de este módulo. */
export function useFont(style: FontStyle): void {
  FUENTE = style;
}

/** Texto recto. `scale` = % del ancho que puede ocupar. */
export function textImage(text: string, scale: number): ImageData {
  const t = text.trim() || 'Texto';
  const probe = makeCanvas(8, 8).ctx;
  const px = fit(probe, t, W * (scale / 100), 320);

  probe.font = font(px);
  const m = probe.measureText(t);
  const h = Math.ceil((m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * 1.5) + 40;

  const { c, ctx } = makeCanvas(W, Math.max(h, 120));
  ctx.font = font(px);
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
  probe.font = font(px);

  const arcLen = probe.measureText(t).width * 1.08;
  const theta = (Math.max(10, curve) * Math.PI) / 180;
  const radius = arcLen / theta;

  const sag = radius * (1 - Math.cos(theta / 2)); // cuánto "cae" el arco
  const h = Math.ceil(sag + px * 2.4);
  const { c, ctx } = makeCanvas(W, Math.max(h, 160));

  ctx.font = font(px);
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

/**
 * Dónde acaba el nombre en el lienzo compuesto, en píxeles.
 *
 * Lo comparten el dibujado y el tirador de la vista 3D: si cada uno hiciera su
 * cuenta, el tirador acabaría en un sitio y el nombre en otro — que es justo lo
 * que pasaba cuando el tirador se calculaba «a ojo» desde la caja de la pieza.
 */
export function textLayout(img: ImageData, text: string, scale: number, tx = 0, ty = 0, rot = 0) {
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

  // Cuánto se mueve el nombre a lo alto con el deslizador.
  //
  // Hacia ARRIBA se mide contra el dibujo: al -100% llega justo a su coronilla.
  // Antes se medía en alturas de letra, y en un dibujo alto —una cinta, un
  // muñeco de cuerpo entero— el deslizador se quedaba corto: lo ponías al tope y
  // el nombre seguía abajo, sin llegar ni a la mitad de la figura.
  //
  // Hacia ABAJO se mide en alturas de letra, que es lo que se quiere ahí: alejar
  // el nombre un poco del dibujo, no mandarlo a tomar viento.
  const cae = (alto: number) => imgH + 20 + alto / 2 + ty * (ty < 0 ? imgH : alto * 1.5);
  const encima = cae(px0 * 1.6) - (px0 * 1.6) / 2 <= inkY0 + 2;

  // Encima de la figura el nombre lleva tope de ancho.
  //
  // «Tamaño del texto» es el porcentaje del ancho de trabajo, y eso vale cuando
  // el nombre va debajo, en su propia fila. Encima no: al 100% se sale de la
  // figura por los dos lados. Se le limita a tres cuartos del ancho del dibujo,
  // que deja el nombre bien grande sin desbordarlo; el deslizador sigue mandando
  // por debajo de ese tope.
  const px = encima ? Math.min(px0, fit(probe, t, imgW * 0.75, px0)) : px0;
  probe.font = font(px);
  const textH = px * 1.6;
  const textW = probe.measureText(t).width;

  // Posición: parte de «centrado, debajo de la imagen» y se desplaza con el
  // control, sin tope. Puede acabar encima del dibujo, que es lo que se quiere
  // para poner el nombre sobre la figura.
  const textCy = cae(textH);
  const textCx = W / 2 + tx * (W * 0.5);

  // Media caja del texto, contando el giro: un texto girado ocupa más a lo alto
  // y a lo ancho que el mismo texto en recto, y si no se cuenta, se sale.
  const rad = (rot * Math.PI) / 180;
  const ca = Math.abs(Math.cos(rad));
  const sa = Math.abs(Math.sin(rad));
  const halfW = (textW / 2) * ca + (textH / 2) * sa;
  const halfH = (textW / 2) * sa + (textH / 2) * ca;

  // El lienzo crece por donde haga falta: a lo alto y también a lo ANCHO.
  //
  // Antes solo crecía a lo alto y el texto se recortaba contra los bordes
  // laterales. El efecto era que a partir de cierto punto movías el deslizador
  // y no pasaba nada —el texto se quedaba clavado en el borde— sin que nada lo
  // explicara. Ahora el lienzo se estira y el deslizador siempre responde.
  const margen = halfW + 30;
  const left = Math.min(0, textCx - margen);
  const right = Math.max(W, textCx + margen);
  const bottom = Math.max(imgH + textH + 60, textCy + halfH + 30);
  const top = Math.min(0, textCy - halfH - 30);
  const cw = Math.ceil(right - left);
  const ch = Math.ceil(bottom - top);
  const shift = -top; // todo se dibuja desplazado si el texto sube por encima
  const shiftX = -left; // y lo mismo si se va por la izquierda

  return { t, px, textH, textW, textCx, textCy, shift, shiftX, cw, ch, imgW, imgH, imgTop, k, inkY0, rad, halfH };
}

export function imageWithText(
  img: ImageData,
  text: string,
  scale: number,
  tx = 0,
  ty = 0,
  rot = 0,
): ImageData {
  const L = textLayout(img, text, scale, tx, ty, rot);
  const { t, px, textH, textCx, textCy, shift, shiftX, cw, ch, imgW, imgH, imgTop, inkY0, rad, halfH } = L;
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
  ctx.font = font(px);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const inkY = inkY0 + shift;
  const textTop = textCy + shift - halfH;
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

  // El nombre, en tinta y con su giro. Caiga encima o debajo se dibuja igual:
  // lo que lo hace legible sobre la figura es que luego se levanta un escalón
  // por encima del dibujo (ver `textOnlyImage` y buildKeychain), no un trato
  // especial aquí.
  //
  // Y tiene que girar EXACTAMENTE igual que en `textOnlyImage`, que es la capa
  // que se levanta. Si uno gira y el otro no, el nombre sale por duplicado: uno
  // tumbado y otro recto, cada uno de su color.
  ctx.fillStyle = '#000';
  escribirGirado(ctx, t, shiftX + textCx, textCy + shift, rad);

  return ctx.getImageData(0, 0, c.width, c.height);
}

/**
 * El nombre solo, sobre un lienzo del mismo tamaño y en el mismo sitio que en la
 * imagen compuesta.
 *
 * Sirve para que el generador sepa cuál de los trazos es el nombre y pueda
 * levantarlo más alto que el dibujo. Comparte con `imageWithText` la función que
 * calcula la posición, así que los contornos caen exactamente encima; si cada
 * uno hiciera su cuenta, el nombre saldría levantado en un sitio y dibujado en
 * otro.
 */
export function textOnlyImage(
  img: ImageData,
  text: string,
  scale: number,
  tx = 0,
  ty = 0,
  rot = 0,
): ImageData | null {
  const L = textLayout(img, text, scale, tx, ty, rot);
  if (!L.t) return null;

  const { c, ctx } = makeCanvas(L.cw, L.ch);
  ctx.font = font(L.px);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  escribirGirado(ctx, L.t, L.shiftX + L.textCx, L.textCy + L.shift, L.rad);
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
