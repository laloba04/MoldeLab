/**
 * Los colores de la imagen: cada trozo del dibujo sale con el color que tiene en
 * la imagen, en cualquier producto que use el dibujo, y lo que no viene de la
 * imagen (la placa, un icono con su color) no se toca.
 */

import { vectorize } from '../src/lib/pipeline';
import { buildProduct, byId, PRODUCTS } from '../src/lib/catalog';
import { coloresDeZonas, esColorida } from '../src/lib/coloresImagen';
import { DEFAULTS, type Params, type ProductId } from '../src/types';

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? '  — ' + extra : ''}`);
}

const ROSA = '#f07896', AZUL = '#78b4f0', NEGRO = '#000000';
/** Un círculo rosa pequeño arriba a la izquierda y uno azul grande a la derecha, con contorno negro. */
function imagen(conColor = true): ImageData {
  const W = 400, H = 300;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const put = (x: number, y: number, c: number[]) => {
    const k = (y * W + x) * 4;
    [data[k], data[k + 1], data[k + 2]] = c;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d1 = Math.hypot(x - 110, y - 110), d2 = Math.hypot(x - 280, y - 150);
      if (d1 < 55) put(x, y, d1 > 48 || !conColor ? [0, 0, 0] : [240, 120, 150]);
      if (d2 < 80) put(x, y, d2 > 72 || !conColor ? [0, 0, 0] : [120, 180, 240]);
    }
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

console.log('MoldeLab — Colores de la imagen\n');

check('una imagen con color se reconoce', esColorida(imagen(true)));
check('un dibujo en negro no cuenta como imagen con color', !esColorida(imagen(false)));

const img = imagen();
const P = (id: ProductId, extra: Partial<Params> = {}): Params =>
  ({ ...DEFAULTS, product: id, ...(byId(id).inicial ?? {}), colorAsInk: true, ...extra }) as Params;
const hacer = (id: ProductId, extra: Partial<Params> = {}) => {
  const p = P(id, extra);
  const sil = vectorize(img, p, null);
  const piezas = buildProduct(sil, p);
  return { piezas, z: coloresDeZonas(piezas, sil, img) };
};

/** Colores de los trozos del dibujo de una pieza, por lado (x<0 rosa, x>0 azul). */
function porLado(id: ProductId, extra: Partial<Params> = {}) {
  const { piezas, z } = hacer(id, extra);
  const izq = new Set<string>(), der = new Set<string>();
  for (const pz of piezas)
    (pz.overlayParts ?? []).forEach((pm, i) => {
      const c = z[`${pz.id}#p${i}`];
      if (!c) return;
      const xs = pm.positions.filter((_, k) => k % 3 === 0);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      (cx < 0 ? izq : der).add(c);
    });
  return { izq, der, piezas, z };
}

{
  // El sello es una sola superficie que se entinta: no tiene contorno aparte.
  const { izq, der } = porLado('stamp');
  check('stamp: rosa a un lado y azul al otro', izq.has(ROSA) && !izq.has(AZUL) && der.has(AZUL) && !der.has(ROSA), `${[...izq]} / ${[...der]}`);
}
for (const id of ['thermoform2', 'relief-plate', 'keychain-relief', 'coaster'] as ProductId[]) {
  const { izq, der } = porLado(id);
  check(`${id}: el círculo pequeño sale rosa con su contorno negro`, izq.has(ROSA) && izq.has(NEGRO) && !izq.has(AZUL), [...izq].join(' '));
  check(`${id}: el grande sale azul con su contorno negro`, der.has(AZUL) && der.has(NEGRO) && !der.has(ROSA), [...der].join(' '));
}

{
  // Lo que no viene de la imagen no se pinta: la placa del termoformado (con su
  // color) ni un icono con el color elegido en la web.
  const { piezas, z } = hacer('thermoform2', {
    formElements: [{ id: 'a', tipo: 'icono', icono: 'heart', texto: '', negrita: false, cara: 'delante', color: '#00ff00', enrejado: false, x: -60, y: -60, rot: 0, tam: 15, alto: 0 }],
  } as Partial<Params>);
  const hoja = piezas.find((x) => x.id === 'sheet')!;
  const conTinte = (hoja.overlayParts ?? []).map((_, i) => i).filter((i) => hoja.partTints?.[i]);
  check('los trozos con su color propio (borde, icono) no se tocan', conTinte.length > 0 && conTinte.every((i) => !z[`sheet#p${i}`]), `${conTinte.length} trozos con color propio`);
  check('el icono verde sigue verde', hoja.partTints?.includes('#00ff00') ?? false);
}

{
  // Cada trozo suelto, aparte: dos manchas que no se tocan son dos zonas.
  const { piezas } = hacer('relief-plate');
  const n = piezas.reduce((t, x) => t + (x.overlayParts?.length ?? 0), 0);
  check('las manchas sueltas salen como trozos aparte', n >= 4, `${n} trozos`);
}

{
  // Imagen difícil: cuerpo marrón con contorno negro, tripa BLANCA encerrada,
  // corazón rojo OSCURO sin contorno, y un verde y un amarillo PEGADOS sin línea
  // entre medias (dentro de un marco negro). Tienen que salir los seis.
  const W = 500, H = 420;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  const put = (x: number, y: number, c: number[]) => {
    const k = (y * W + x) * 4;
    [data[k], data[k + 1], data[k + 2]] = c;
  };
  const elipse = (x0: number, y0: number, x1: number, y1: number, relleno: number[], borde: number) => {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        if (d <= 1) put(x, y, borde && d > 1 - borde / Math.min(rx, ry) ? [0, 0, 0] : relleno);
      }
  };
  elipse(40, 40, 300, 380, [200, 150, 100], 9);
  elipse(100, 170, 240, 330, [255, 255, 255], 7);
  elipse(140, 90, 200, 150, [150, 20, 30], 0);
  for (let y = 60; y <= 360; y++)
    for (let x = 320; x <= 470; x++)
      put(x, y, x < 330 || x > 460 || y < 70 || y > 350 ? [0, 0, 0] : y < 210 ? [90, 190, 90] : [250, 220, 60]);
  const dificil = { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
  const seis = ['#c89664', '#ffffff', '#96141e', '#5abe5a', '#fadc3c', '#000000'];
  for (const id of ['thermoform2', 'coaster', 'relief-plate'] as ProductId[]) {
    const p = P(id);
    const sil = vectorize(dificil, p, null);
    const piezas = buildProduct(sil, p);
    const z = coloresDeZonas(piezas, sil, dificil);
    const salen = new Set(Object.values(z));
    const faltan = seis.filter((c) => !salen.has(c));
    check(`${id}: salen los seis colores (blanco encerrado, rojo oscuro, verde y amarillo pegados)`, faltan.length === 0, faltan.length ? `faltan ${faltan.join(' ')}` : '');
    // Y cada uno en su sitio: el rojo arriba en el cuerpo, el blanco debajo.
    const sitio = (c: string) => {
      for (const pz of piezas)
        for (let i = 0; i < (pz.overlayParts?.length ?? 0); i++)
          if (z[`${pz.id}#p${i}`] === c) {
            const ys = pz.overlayParts![i].positions.filter((_, k) => k % 3 === 1);
            return (Math.min(...ys) + Math.max(...ys)) / 2;
          }
      return NaN;
    };
    check(`${id}: el corazón rojo va encima de la tripa blanca, y el verde encima del amarillo`, sitio('#96141e') > sitio('#ffffff') && sitio('#5abe5a') > sitio('#fadc3c'));
  }
}

{
  // Ningún producto se rompe ni se inventa colores raros.
  let rotos = 0;
  const raros = new Set<string>();
  for (const e of PRODUCTS) {
    try {
      const { z } = hacer(e.id);
      for (const c of Object.values(z)) if (![ROSA, AZUL, NEGRO].includes(c)) raros.add(`${e.id}:${c}`);
    } catch {
      rotos++;
    }
  }
  check('todos los productos funcionan con los colores de la imagen', rotos === 0, `${rotos} rotos`);
  check('y solo salen los colores que hay en la imagen', raros.size === 0, [...raros].slice(0, 6).join(' '));
}

if (failures) {
  console.log(`\n${failures} fallo(s).`);
  process.exitCode = 1;
}
console.log('\nTodo correcto.');
