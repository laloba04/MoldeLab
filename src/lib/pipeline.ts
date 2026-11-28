/**
 * Orquestador. Imagen dentro, piezas fuera.
 *
 *   imagen -> máscara -> limpieza -> relleno -> contornos -> mm ->
 *   simplificado -> suavizado -> anidamiento -> centrado -> producto
 *
 * Se separa en dos pasos porque cambiar la altura de un cortador no debería
 * obligar a re-vectorizar la imagen: `vectorize` es lo caro, `buildProduct` es
 * lo que se re-ejecuta con cada movimiento de un slider.
 */

import type { Loop, Params, Piece, Pt, Silhouette } from '../types';
import { binarize, cleanupMask, cortarEntreColores, fillEnclosed, gruposDeColor, pad, type Mask } from './image';
import { traceContours } from './contours';
import { area, dedupe, orient, pointInPolygon, resample, simplify, smooth } from './polygon';
import { boxOf, shiftLoops } from './shapes';
import { buildProduct, byId } from './catalog';

const BORDER = 2;

/**
 * Contornos de una máscara -> lazos en mm, orientados y clasificados.
 * `resampleMm` es el paso al que se reparten los puntos del contorno: fino
 * (≈0.5) conserva los detalles pequeños; grueso (≈1.2) da menos triángulos.
 */
function loopsFromMask(
  mask: Mask,
  p: Params,
  mmPerPx: number,
  minAreaMm2: number,
  resampleMm = 1.2,
): Loop[] {
  const raw = traceContours(pad(mask, BORDER));
  const loops: Loop[] = [];

  for (const c of raw) {
    // A milímetros. Se invierte Y para pasar de coordenadas de imagen a las del
    // mundo 3D, donde Y sube.
    let pts: Pt[] = c.map(([x, y]) => [(x - BORDER) * mmPerPx, -(y - BORDER) * mmPerPx]);

    pts = dedupe(pts);
    if (pts.length < 3 || area(pts) < minAreaMm2) continue;

    pts = simplify(pts, p.simplify);
    pts = smooth(pts, p.smooth);
    pts = dedupe(pts);
    pts = resample(pts, resampleMm);
    if (pts.length < 3) continue;

    loops.push({ pts, hole: false });
  }

  // Anidamiento: un lazo dentro de un número impar de otros es un agujero. Se
  // mira en varios puntos del lazo y gana la mayoría: con uno solo, si caía
  // justo donde dos contornos casi se tocan (una raya fina entre dos colores),
  // una mancha salía como agujero y desaparecía.
  for (const l of loops) {
    const n = Math.min(7, l.pts.length);
    let impares = 0;
    for (let k = 0; k < n; k++) {
      const pt = l.pts[Math.floor((k * l.pts.length) / n)];
      let depth = 0;
      for (const other of loops) {
        if (other !== l && pointInPolygon(pt, other.pts)) depth++;
      }
      if (depth % 2 === 1) impares++;
    }
    l.hole = impares * 2 > n;
    l.pts = orient(l.pts, !l.hole); // islas CCW, agujeros CW
  }

  return loops;
}

/**
 * `textImg` es el nombre solo, sobre el mismo lienzo y del mismo tamaño que
 * `img`. Se traza con la misma escala y se centra con la misma caja, así que sus
 * contornos caen exactamente encima de los del dibujo compuesto.
 */
export function vectorize(img: ImageData, p: Params, textImg?: ImageData | null): Silhouette {
  const mmPerPx = p.targetWidthMm / img.width;

  // La silueta y el relieve pueden salir de umbrales distintos. En una foto eso
  // marca la diferencia entre un contorno limpio y un contorno con detalle.
  // La silueta puede salir de la transparencia; el relieve, nunca. En un PNG
  // recortado toda la figura es opaca, así que por transparencia el relieve
  // saldría macizo: la pieza entera de una pieza, sin un detalle dentro. Por eso
  // el detalle mira siempre la luz.
  const solidBin = binarize(img, p.threshold, p.invert);
  const detailBin = binarize(
    img,
    p.useDetailThreshold ? p.detailThreshold : p.threshold,
    p.invert,
    'luz',
    p.colorAsInk,
  );

  const solidMask = fillEnclosed(p.cleanup > 0 ? cleanupMask(solidBin, p.cleanup) : solidBin);
  let detailMask = p.cleanup > 0 ? cleanupMask(detailBin, p.cleanup) : detailBin;

  // Con los colores claros como dibujo, cada color sale como trozo propio:
  //  - lo blanco ENCERRADO por el dibujo (la tripa blanca de un osito) también
  //    es dibujo: es un color más, no el fondo;
  //  - entre dos colores que se tocan sin línea negra en medio se deja una raya
  //    finísima, para que no salgan pegados en un solo trozo de un solo color.
  // También entre la línea y los colores: si no, un marco negro alrededor de
  // dos colores los seguiría uniendo por los extremos.
  const ancho = Math.max(2, Math.round(0.3 / mmPerPx));
  let lineaOscura: (g: number) => boolean = () => false;
  let gruposColor: ReturnType<typeof gruposDeColor> | undefined;
  let porColor: Mask[] | undefined;
  if (p.colorAsInk) {
    detailMask = fillEnclosed(detailMask);
    gruposColor = gruposDeColor(img, detailMask);
    const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const umbral = p.useDetailThreshold ? p.detailThreshold : p.threshold;
    // La línea: los grupos oscuros y sin color (negro, gris oscuro).
    lineaOscura = (g) => {
      const c = gruposColor!.colores[g];
      return lum(c) < umbral && Math.max(...c) - Math.min(...c) < 40;
    };
    // El dibujo partido por colores, sin rayas en medio: cada color, su máscara
    // (se tocan unos con otros). Para quien quiera el dibujo tal cual la imagen.
    const lleno = detailMask;
    const g = gruposColor;
    porColor = g.colores
      .map((_, k) => ({ data: lleno.data.map((v, i) => (v && g.grupo[i] === k ? 1 : 0)), w: lleno.w, h: lleno.h }))
      .map((mk) => (p.cleanup > 0 ? cleanupMask(mk, p.cleanup) : mk));
    detailMask = cortarEntreColores(detailMask, gruposColor.grupo, ancho);
  }

  const all = loopsFromMask(solidMask, p, mmPerPx, 0);

  // Descarta islas de ruido, y con ellas los agujeros que vivían dentro.
  const islands = all.filter((l) => !l.hole);
  const biggest = islands.reduce((m, l) => Math.max(m, area(l.pts)), 0);
  const minArea = (biggest * p.minIslandPct) / 100;

  const kept = islands.filter((l) => area(l.pts) >= minArea);
  const kholes = all.filter(
    (l) => l.hole && kept.some((i) => pointInPolygon(l.pts[0], i.pts)),
  );

  let loops = [...kept, ...kholes];
  // El detalle lleva las líneas finas (venas, filigranas): se remuestrea a un
  // paso fino (0.5 mm) para que no se redondeen ni se emborronen.
  let detail = loopsFromMask(detailMask, p, mmPerPx, minArea * 0.02, 0.5);

  // Con «los colores claros también son dibujo», el dibujo viene en dos cosas
  // distintas que no se pueden mezclar: las MANCHAS de color y la LÍNEA que las
  // rodea. Metidas en el mismo saco sale un pegote —el vestido entero levantado
  // y las rayas negras perdidas dentro—, que es justo lo que pasaba antes.
  //
  // La línea se saca aparte mirando solo la luz, que es lo que hacía siempre. Va
  // marcada, y el relieve la levanta un escalón por encima de la mancha: se ve
  // el dibujo como en la imagen y cada cosa se puede pintar de su color.
  //
  // Se AÑADE a `detail`, no lo sustituye. La línea cae dentro de la mancha, así
  // que la unión de las dos sigue siendo el dibujo entero: quien use `detail` a
  // pelo —la plantilla, el calado— no nota ninguna diferencia.
  if (p.colorAsInk) {
    const lineBin = binarize(img, p.useDetailThreshold ? p.detailThreshold : p.threshold, p.invert, 'luz');
    let lineMask = p.cleanup > 0 ? cleanupMask(lineBin, p.cleanup) : lineBin;
    // Un color oscuro (rojo fuerte, marrón) es oscuro como la línea pero no es
    // línea: se separa del negro para que salga de su color.
    if (gruposColor) {
      const g = gruposColor;
      const oscuroConColor = new Uint8Array(lineMask.data.length);
      for (let i = 0; i < oscuroConColor.length; i++) oscuroConColor[i] = lineMask.data[i] && g.grupo[i] >= 0 && !lineaOscura(g.grupo[i]) ? 1 : 0;
      lineMask = { ...lineMask, data: lineMask.data.map((v, i) => (oscuroConColor[i] ? 0 : v)) };
    }
    for (const l of loopsFromMask(lineMask, p, mmPerPx, minArea * 0.02, 0.5)) {
      detail.push({ ...l, line: true });
    }
  }

  // Bandas por umbral para los productos en capas: la capa 0 es la silueta
  // entera y cada banda siguiente es lo que queda por debajo de un umbral más
  // exigente — la zona más oscura de la imagen, cada vez más pequeña.
  let bands: Loop[][] | undefined;
  if (byId(p.product).needsBands) {
    bands = [loops];
    const nExtra = Math.max(1, p.layers - 1);
    for (let i = 1; i <= nExtra; i++) {
      const t = Math.max(10, Math.round(p.threshold * (1 - i / (nExtra + 1))));
      const bin = binarize(img, t, p.invert, 'luz');
      const m = p.cleanup > 0 ? cleanupMask(bin, p.cleanup) : bin;
      bands.push(loopsFromMask(m, p, mmPerPx, minArea * 0.05, 0.6));
    }
  }

  // Todo centrado en el origen: los productos con marco, peana o púas necesitan
  // un bounding box con el que contar, y el visor lo agradece.
  let textLoops: Loop[] | undefined;
  // Con «invertir claro/oscuro» el dibujo se da la vuelta y lo que era tinta pasa
  // a ser fondo. El nombre lo dibujamos nosotros siempre en negro, asi que
  // levantarlo ahi lo dejaria flotando sobre un agujero: mejor no levantarlo.
  if (!p.invert && textImg && textImg.width === img.width && textImg.height === img.height) {
    const tb = binarize(textImg, 128, false);
    textLoops = loopsFromMask(p.cleanup > 0 ? cleanupMask(tb, p.cleanup) : tb, p, mmPerPx, 0, 0.5);
  }

  const hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const capas = porColor
    ?.map((mk, k) => ({ ls: loopsFromMask(mk, p, mmPerPx, minArea * 0.005, 0.5), c: hex(gruposColor!.colores[k]) }))
    .filter((x) => x.ls.some((l) => !l.hole));
  let colorLoops = capas?.map((x) => x.ls);
  const colorLoopsColors = capas?.map((x) => x.c);

  const box = boxOf(loops.length ? loops : detail);
  colorLoops = colorLoops?.map((ls) => shiftLoops(ls, -box.cx, -box.cy));
  loops = shiftLoops(loops, -box.cx, -box.cy);
  detail = shiftLoops(detail, -box.cx, -box.cy);
  bands = bands?.map((b) => shiftLoops(b, -box.cx, -box.cy));
  textLoops = textLoops?.length ? shiftLoops(textLoops, -box.cx, -box.cy) : undefined;

  return { loops, detail, bands, textLoops, colorLoops, colorLoopsColors, widthMm: box.w, heightMm: box.h, muestreo: { mmPerPx, cx: box.cx, cy: box.cy } };
}

export function buildPieces(s: Silhouette, p: Params): Piece[] {
  if (!s.loops.length) return [];
  return buildProduct(s, p);
}
