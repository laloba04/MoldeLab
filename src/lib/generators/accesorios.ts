/**
 * Accesorios de la página de novedades: imán, jibbitz, remate de bolígrafo,
 * soporte de AirTag, GripTok, botón, cuentas de letras y tornillo con tuerca.
 *
 * Casi todos son lo mismo por delante —una placa con el dibujo— y cambian en
 * lo que llevan por detrás: unos huecos para imanes, un tallo con cabeza, una
 * copa, un aro… Por eso se imprimen BOCA ABAJO, como en Formify: la cara del
 * dibujo contra la cama sale lisa y limpia, y lo de atrás crece hacia arriba
 * sin soportes. El dibujo va INCRUSTADO a ras en esa cara, de su color, en vez
 * de en relieve (un relieve contra la cama no se puede imprimir).
 *
 * Cómo se construye: todo se monta boca arriba, que es como se piensa —la cara
 * arriba en z = `cara`, lo de atrás por debajo—, y al final se le da la vuelta
 * entera con `bocaAbajo`. El visor le vuelve a dar la vuelta para enseñarla por
 * la cara (ver `Piece.caraAbajo`).
 */

import type { Loop, Mesh, MoldShape, Params, Piece, Pt, Silhouette } from '../../types';
import { cap, cylinder, emptyMesh, extrudeRegion, loft, merge } from '../mesh';
import { intersectRegions, offsetRegions, sanitize, subtract, union, type Region } from '../clipper';
import { pointInPolygon } from '../polygon';
import { boxOf, circle, roundedRect } from '../shapes';
import { fitDetailToBase, moldBase } from './catalog-parts';
import { tornilloRoscado, tuercaPasante } from './rosca';

const rev = (pts: Pt[]) => [...pts].reverse() as Pt[];
const outerOf = (loops: Loop[]) => loops.filter((l) => !l.hole).map((l) => l.pts);
const holesOf = (loops: Loop[]) => loops.filter((l) => l.hole).map((l) => l.pts);

function solid(regions: Region[], zLo: number, zHi: number): Mesh {
  const m = emptyMesh();
  for (const r of regions) if (zHi > zLo) extrudeRegion(m, r, zLo, zHi);
  return m;
}

const aLoops = (rs: Region[]): Loop[] =>
  rs.flatMap((r) => [{ pts: r.outer, hole: false }, ...r.holes.map((h) => ({ pts: h, hole: true }))]);

const cajaDe = (rs: Region[]) => boxOf(rs.map((r) => ({ pts: r.outer, hole: false })));

/** Agujero redondo (en sentido horario, como lo quiere un agujero). */
const agujero = (cx: number, cy: number, r: number, seg = 40) => rev(circle(cx, cy, r, seg));

/** ¿Cae el punto dentro de las regiones (y fuera de sus agujeros)? */
function dentro(rs: Region[], [x, y]: Pt): boolean {
  for (const r of rs) {
    if (!pointInPolygon([x, y], r.outer)) continue;
    if (r.holes.some((h) => pointInPolygon([x, y], h))) continue;
    return true;
  }
  return false;
}

// -----------------------------------------------------------------------------
// La cara: forma, dibujo y nombre
// -----------------------------------------------------------------------------

interface Colocado {
  /** Contorno de la pieza. */
  base: Region[];
  dibujo: Loop[];
  nombre: Loop[];
}

/**
 * La forma de la pieza y el dibujo colocado dentro. Con «Silueta» la pieza es
 * el propio dibujo engordado por el margen; con una forma (círculo, corazón…)
 * el dibujo se agranda o encoge hasta llenarla, y el nombre va con él.
 */
function colocar(s: Silhouette, p: Params, forma: MoldShape = p.moldShape): Colocado {
  const base = moldBase(s.loops, p, forma);
  const nombre = s.textLoops ?? [];
  if (forma === 'image' || !base.length) return { base, dibujo: s.detail, nombre };
  const donde = offsetRegions(base.map((r) => r.outer), [], -Math.max(0.6, p.border * 0.5));
  const juntos = fitDetailToBase([...s.detail, ...nombre], donde.length ? donde : base, true);
  return { base, dibujo: juntos.slice(0, s.detail.length), nombre: juntos.slice(s.detail.length) };
}

interface Cara {
  cuerpo: Mesh;
  /** Una malla por zona del dibujo, para pintarlas a mano. */
  zonas: Mesh[];
  letras?: Mesh;
}

/**
 * Placa de `z0` a `z0 + grosor` con el dibujo en la capa de arriba.
 *
 * Incrustado: la capa de arriba se parte en el fondo y el dibujo, cada cosa su
 * sólido y su color, a ras. Grabado: el dibujo es hueco, para imprimir de una
 * tinta y que se siga viendo.
 */
function cara(base: Region[], dibujo: Loop[], nombre: Loop[], p: Params, z0: number, grosor: number): Cara {
  const e = Math.min(p.artDepth, grosor * 0.6);
  const zTop = z0 + grosor;
  let dReg = dibujo.length
    ? offsetRegions(outerOf(dibujo), holesOf(dibujo), p.strokeWidth || 0)
    : [];
  dReg = dReg.length ? intersectRegions(dReg, base) : [];
  let tReg = nombre.length ? sanitize(outerOf(nombre), holesOf(nombre)) : [];
  tReg = tReg.length ? intersectRegions(tReg, base) : [];
  // El nombre manda sobre el dibujo: donde se pisan, se lee el nombre.
  if (tReg.length && dReg.length) dReg = subtract(dReg, tReg);
  const todo = union(dReg, tReg);

  const cuerpo = merge(
    solid(base, z0, zTop - e),
    solid(todo.length ? subtract(base, todo) : base, zTop - e, zTop),
  );
  if (p.artMode === 'engrave') return { cuerpo, zonas: [] };
  return {
    cuerpo,
    zonas: dReg.map((r) => solid([r], zTop - e, zTop)),
    letras: tReg.length ? solid(tReg, zTop - e, zTop) : undefined,
  };
}

/** Le da la vuelta a una malla montada boca arriba: la cara (en z = `cara`) pasa
 *  a z = 0, contra la cama. Es un giro de media vuelta, no un espejo: las caras
 *  siguen mirando hacia fuera. */
function bocaAbajo(m: Mesh, zCara: number): Mesh {
  const q = m.positions;
  const out = new Array<number>(q.length);
  for (let i = 0; i < q.length; i += 3) {
    out[i] = q[i];
    out[i + 1] = -q[i + 1];
    out[i + 2] = zCara - q[i + 2];
  }
  return { positions: out };
}

/** Lo más bajo de unas mallas (boca arriba): lo que sobresale por detrás. */
function zMin(ms: Mesh[]): number {
  let z = Infinity;
  for (const m of ms) for (let i = 2; i < m.positions.length; i += 3) z = Math.min(z, m.positions[i]);
  return Number.isFinite(z) ? z : 0;
}

/**
 * La pieza ya montada boca arriba, dada la vuelta y con sus colores: el cuerpo
 * del color de fondo, cada zona del dibujo con el suyo y el nombre al final.
 */
function pieza(id: string, label: string, zCara: number, cuerpo: Mesh[], c: Partial<Cara> = {}): Piece {
  const zonas = c.zonas ?? [];
  const alto = zCara - zMin([...cuerpo, ...zonas]);
  const f = (m: Mesh) => bocaAbajo(m, zCara);
  const body = merge(...cuerpo.map(f));
  const parts = zonas.map(f);
  const letras = c.letras ? f(c.letras) : undefined;
  const overlay = parts.length ? merge(...parts) : undefined;
  return {
    id,
    label,
    role: 'body',
    mesh: merge(body, overlay ?? emptyMesh(), letras ?? emptyMesh()),
    overlay,
    overlayParts: parts.length ? parts : undefined,
    textMesh: letras,
    // La cara que se grabaría es la del dibujo (la de la cama): no se marca.
    noMark: true,
    caraAbajo: alto,
  };
}

// -----------------------------------------------------------------------------
// Imán
// -----------------------------------------------------------------------------

/** Centros para `n` cosas repartidas alrededor de (cx, cy), separadas `sep`. */
function repartir(n: number, cx: number, cy: number, sep: number): Pt[] {
  if (n <= 1) return [[cx, cy]];
  if (n === 2) return [[cx - sep / 2, cy], [cx + sep / 2, cy]];
  if (n === 3) {
    const r = sep / Math.sqrt(3);
    return [0, 1, 2].map((k) => {
      const a = Math.PI / 2 + (k * 2 * Math.PI) / 3;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Pt;
    });
  }
  return [
    [cx - sep / 2, cy - sep / 2],
    [cx + sep / 2, cy - sep / 2],
    [cx + sep / 2, cy + sep / 2],
    [cx - sep / 2, cy + sep / 2],
  ];
}

/**
 * Imán de nevera: la placa con el dibujo y, por detrás, los huecos donde se
 * pegan los imanes. Los huecos quedan arriba al imprimir, abiertos: se puede
 * parar la impresión y meter los imanes, o pegarlos después.
 */
export function buildMagnet(s: Silhouette, p: Params): Piece[] {
  const { base, dibujo, nombre } = colocar(s, p);
  if (!base.length) return [];
  const hueco = p.magnetDepth + 0.2; // un pelo más: el imán entra a ras
  const grosor = Math.max(p.thickness, hueco + Math.min(p.artDepth, 1.2) + 0.8);
  const b = cajaDe(base);
  const radio = p.magnetDia / 2 + 0.1;
  const centros = repartir(p.magnetCount, b.cx, b.cy, Math.max(p.magnetDia + 3, Math.min(b.w, b.h) * 0.45));
  const huecos = centros.filter((c) => dentro(base, c)).map(([x, y]) => agujero(x, y, radio));
  const trasera = huecos.length ? sanitize(base.map((r) => r.outer), [...base.flatMap((r) => r.holes), ...huecos]) : base;
  const c = cara(base, dibujo, nombre, p, hueco, grosor - hueco);
  return [pieza('magnet', 'Imán', grosor, [solid(trasera, 0, hueco), c.cuerpo], c)];
}

// -----------------------------------------------------------------------------
// Jibbitz
// -----------------------------------------------------------------------------

/** Tronco de cono cerrado de eje Z, de radio `r0` en `z0` a `r1` en `z1`. */
function tronco(cx: number, cy: number, r0: number, z0: number, r1: number, z1: number, seg = 48): Mesh {
  const m = emptyMesh();
  const a = circle(cx, cy, r0, seg);
  const b = circle(cx, cy, r1, seg);
  loft(m, a, z0, b, z1, true);
  cap(m, a, [], z0, false);
  cap(m, b, [], z1, true);
  return m;
}

/**
 * Dije para zuecos: la placa con el dibujo y, por detrás, el tallo que entra
 * por el agujero del zueco y la cabeza que lo sujeta. La cabeza va en punta
 * hacia fuera, para que entre empujando; el escalón plano junto al tallo es el
 * que no la deja salir.
 */
export function buildJibbitz(s: Silhouette, p: Params): Piece[] {
  const { base, dibujo, nombre } = colocar(s, p);
  if (!base.length) return [];
  const { cx, cy } = cajaDe(base);
  const rTallo = p.pegDia / 2;
  const rCabeza = Math.max(rTallo + 0.8, p.pegHead / 2);
  const altoCabeza = 2.2;
  const c = cara(base, dibujo, nombre, p, 0, p.thickness);
  const tallo = emptyMesh();
  // El tallo se mete medio milímetro en la placa para soldarse a ella.
  cylinder(tallo, cx, cy, rTallo, -p.pegLength, 0.5, 40);
  const cabeza = tronco(cx, cy, rTallo + 0.6, -p.pegLength - altoCabeza, rCabeza, -p.pegLength);
  return [pieza('jibbitz', 'Jibbitz', p.thickness, [c.cuerpo, tallo, cabeza], c)];
}

// -----------------------------------------------------------------------------
// Remate de bolígrafo
// -----------------------------------------------------------------------------

/**
 * Extruye una región dibujada en el plano (x, z) a lo largo de Y, de `y0` a
 * `y1`. Se extruye en XY y se cambian los ejes; como cambiar dos ejes es un
 * espejo, se le da la vuelta a cada triángulo para que siga mirando afuera.
 */
function extruirEnY(r: Region[], y0: number, y1: number): Mesh {
  const m = solid(r, y0, y1);
  const q = m.positions;
  const out = new Array<number>(q.length);
  for (let i = 0; i < q.length; i += 9) {
    // (a, b, c) -> (a, c, b) en cada vértice, y el triángulo al revés.
    const v = [0, 2, 1].map((k) => [q[i + k * 3], q[i + k * 3 + 2], q[i + k * 3 + 1]]);
    for (let k = 0; k < 3; k++) {
      out[i + k * 3] = v[k][0];
      out[i + k * 3 + 1] = v[k][1];
      out[i + k * 3 + 2] = v[k][2];
    }
  }
  return { positions: out };
}

/** Hexágono con un pico arriba y otro abajo: impreso tumbado no cuelga nada. */
function hexPico(cx: number, cz: number, entreCaras: number): Pt[] {
  const r = entreCaras / 2 / Math.cos(Math.PI / 6);
  return [0, 1, 2, 3, 4, 5].map((k) => {
    const a = Math.PI / 2 + (k * Math.PI) / 3;
    return [cx + r * Math.cos(a), cz + r * Math.sin(a)] as Pt;
  });
}

/**
 * Remate para el bolígrafo: la figura con un canuto por debajo donde se mete
 * la punta de atrás del boli. El canuto va tumbado y a ras de la cara, así que
 * al imprimir boca abajo se apoya en la cama y no necesita soportes.
 */
export function buildPenTopper(s: Silhouette, p: Params): Piece[] {
  const { base, dibujo, nombre } = colocar(s, p);
  if (!base.length) return [];
  const b = cajaDe(base);
  const T = p.thickness;
  const rHueco = p.penDia / 2 + 0.25;
  const R = rHueco + 2;
  const zc = T - R; // tangente a la cara: al darle la vuelta, apoya en la cama
  // Lo más bajo de la figura por el centro: ahí nace el canuto.
  let yBajo = b.minY;
  for (let y = b.minY; y <= b.maxY; y += 0.25) {
    if (dentro(base, [b.cx, y])) {
      yBajo = y;
      break;
    }
  }
  const largo = Math.max(14, p.penDia * 2.4);
  const yArriba = yBajo + Math.min(6, b.h * 0.25);
  const y0 = yBajo - largo;
  const fuera = circle(b.cx, zc, R, 56);
  const hueco = p.penHex ? hexPico(b.cx, zc, p.penDia + 0.5) : circle(b.cx, zc, rHueco, 40);
  // Con agujero pasante, el canuto queda abierto también por arriba; sin él,
  // un tapón de 2 mm hace de tope.
  const tope = p.penThrough ? 0 : 2;
  const canuto = merge(
    extruirEnY(sanitize([fuera], [rev(hueco)]), y0, yArriba - tope),
    tope ? extruirEnY(sanitize([fuera], []), yArriba - tope, yArriba) : emptyMesh(),
  );
  const c = cara(base, dibujo, nombre, p, 0, T);
  return [pieza('pen-topper', 'Remate de bolígrafo', T, [c.cuerpo, canuto], c)];
}

// -----------------------------------------------------------------------------
// Soporte de AirTag
// -----------------------------------------------------------------------------

/** Anilla de colgar en un lado de la forma: pestaña redonda con su agujero. */
function anilla(base: Region[], lado: Params['loopSide'], p: Params): { tab: Region[]; hueco: Region[] } | null {
  if (lado === 'none') return null;
  const b = cajaDe(base);
  const rO = p.ringOuter;
  const sale = p.ringInner + 2;
  const [ux, uy] = lado === 'top' ? [0, 1] : lado === 'bottom' ? [0, -1] : lado === 'right' ? [1, 0] : [-1, 0];
  const borde = lado === 'top' ? b.maxY : lado === 'bottom' ? b.minY : lado === 'right' ? b.maxX : b.minX;
  const hx = ux ? borde + ux * sale : b.cx;
  const hy = uy ? borde + uy * sale : b.cy;
  // La pestaña nace 3 mm dentro de la forma, para soldarse.
  const ix = hx - ux * (sale + 3);
  const iy = hy - uy * (sale + 3);
  const largo = Math.hypot(hx - ix, hy - iy) + rO * 2;
  const tab = ux
    ? roundedRect((hx + ix) / 2 + (ux * rO) / 2, hy, largo, rO * 2, rO)
    : roundedRect(hx, (hy + iy) / 2 + (uy * rO) / 2, rO * 2, largo, rO);
  return { tab: sanitize([tab], []), hueco: sanitize([circle(hx, hy, p.ringInner, 32)], []) };
}

/** Lo que mide un AirTag, más una holgura. */
const AIRTAG_R = 31.9 / 2 + 0.3;
const AIRTAG_ALTO = 8.0 + 0.3;

/**
 * Soporte de AirTag: la placa con el dibujo y, por detrás, la copa donde entra
 * el AirTag a presión. El labio del borde va en rampa de 45°: se imprime sin
 * soportes, y el AirTag entra empujando y ya no se cae.
 */
export function buildAirtag(s: Silhouette, p: Params): Piece[] {
  const col = colocar(s, p);
  const b0 = col.base.length ? cajaDe(col.base) : { cx: 0, cy: 0 };
  const [cx, cy] = [b0.cx, b0.cy];
  const w = p.airtagWall;
  const Rf = AIRTAG_R + w;
  // La forma tiene que tapar la copa entera, aunque el dibujo sea pequeño.
  const disco = sanitize([circle(cx, cy, Rf + 0.6, 96)], []);
  const forma = col.base.length ? union(col.base, disco) : disco;
  const T = p.thickness;
  const c = cara(forma, col.dibujo, col.nombre, p, 0, T);
  // La anilla (si va) es placa lisa, sin dibujo, pegada a un lado.
  const ani = anilla(forma, p.loopSide, p);
  const extraAnilla = ani ? solid(subtract(subtract(ani.tab, forma), ani.hueco), 0, T) : emptyMesh();

  const pared = solid(sanitize([circle(cx, cy, Rf, 96)], [agujero(cx, cy, AIRTAG_R, 96)]), -AIRTAG_ALTO, 0.01);
  // El labio: un anillo cuyo hueco se estrecha 1 mm en 1 mm de alto.
  const labio = emptyMesh();
  const zA = -AIRTAG_ALTO;
  const zB = zA - 1;
  const fueraA = circle(cx, cy, Rf, 96);
  const dentroA = circle(cx, cy, AIRTAG_R, 96);
  const dentroB = circle(cx, cy, AIRTAG_R - 1, 96);
  loft(labio, fueraA, zB, fueraA, zA, true);
  loft(labio, dentroB, zB, dentroA, zA, false);
  cap(labio, fueraA, [rev(dentroA)], zA, true);
  cap(labio, fueraA, [rev(dentroB)], zB, false);

  return [pieza('airtag', 'Soporte de AirTag', T, [c.cuerpo, extraAnilla, pared, labio], c)];
}

// -----------------------------------------------------------------------------
// GripTok
// -----------------------------------------------------------------------------

/**
 * Tapa decorativa para el agarre del móvil (GripTok / PopSocket): la placa con
 * el dibujo y, por detrás, un aro que abraza la tapa del agarre que ya tienes.
 */
export function buildGriptok(s: Silhouette, p: Params): Piece[] {
  const col = colocar(s, p);
  const b0 = col.base.length ? cajaDe(col.base) : { cx: 0, cy: 0 };
  const rIn = p.gripRadius + 0.15;
  const rOut = rIn + 1.2;
  const base = union(col.base, sanitize([circle(b0.cx, b0.cy, rOut, 96)], []));
  const c = cara(base, col.dibujo, col.nombre, p, 0, p.thickness);
  const aro = solid(sanitize([circle(b0.cx, b0.cy, rOut, 96)], [agujero(b0.cx, b0.cy, rIn, 96)]), -p.gripHeight, 0.01);
  return [pieza('griptok', 'Tapa de GripTok', p.thickness, [c.cuerpo, aro], c)];
}

// -----------------------------------------------------------------------------
// Botón
// -----------------------------------------------------------------------------

/** Botón de coser con el dibujo: la forma con 2 o 4 agujeros en el centro. */
export function buildButton(s: Silhouette, p: Params): Piece[] {
  const col = colocar(s, p);
  if (!col.base.length) return [];
  const b = cajaDe(col.base);
  const r = p.buttonHoleDia / 2;
  const sep = Math.max(p.buttonHoleDia * 2.2, 3.5);
  const centros = repartir(p.buttonHoles >= 4 ? 4 : 2, b.cx, b.cy, sep);
  const base = sanitize(
    col.base.map((x) => x.outer),
    [...col.base.flatMap((x) => x.holes), ...centros.map(([x, y]) => agujero(x, y, r, 28))],
  );
  // El dibujo deja un aro de aire alrededor de cada agujero, para que la aguja
  // no rompa un trozo de dibujo suelto.
  const libre = sanitize(centros.map(([x, y]) => circle(x, y, r + 0.8, 28)), []);
  const quitar = (ls: Loop[]) => (ls.length ? aLoops(subtract(sanitize(outerOf(ls), holesOf(ls)), libre)) : ls);
  const c = cara(base, quitar(col.dibujo), quitar(col.nombre), p, 0, p.thickness);
  return [pieza('button', 'Botón', p.thickness, [c.cuerpo], c)];
}

// -----------------------------------------------------------------------------
// Cuentas de letras
// -----------------------------------------------------------------------------

/**
 * Parte el texto en letras: grupos de trozos que se solapan en horizontal. Así
 * la «i» con su punto, o la «ñ» con su virgulilla, son una sola letra.
 */
function letrasDe(detail: Loop[]): Loop[][] {
  const rs = sanitize(outerOf(detail), holesOf(detail));
  const cajas = rs.map((r) => ({ r, b: cajaDe([r]) })).sort((a, b) => a.b.minX - b.b.minX);
  const grupos: { rs: Region[]; maxX: number }[] = [];
  for (const { r, b } of cajas) {
    const g = grupos[grupos.length - 1];
    if (g && b.minX < g.maxX - b.w * 0.15) {
      g.rs.push(r);
      g.maxX = Math.max(g.maxX, b.maxX);
    } else grupos.push({ rs: [r], maxX: b.maxX });
  }
  return grupos.map((g) => aLoops(g.rs));
}

/**
 * Cuentas para pulseras con nombre: un cubo por letra (o una sola cuenta con
 * todo), con la letra incrustada en la cara y el agujero del cordón de lado a
 * lado. Se imprimen boca abajo, con el agujero tumbado.
 */
export function buildLetterBeads(s: Silhouette, p: Params): Piece[] {
  const fuente = s.textLoops?.length ? s.textLoops : s.detail;
  if (!fuente.length) return [];
  const S = p.beadSize;
  const grupos = p.beadCombined ? [fuente] : letrasDe(fuente);
  const rCordon = p.cordDia / 2 + 0.2;
  const e = Math.min(p.artDepth, S * 0.3);

  const cuerpos: Mesh[] = [];
  const zonas: Mesh[] = [];
  let x = 0;
  for (const g of grupos) {
    const gb = boxOf(g);
    // Ancho de la cuenta: un cubo, o una barra con todo el texto.
    const W = p.beadCombined ? Math.max(S, (gb.w / Math.max(gb.h, 1e-6)) * (S - 2.4) + 2.4) : S;
    const cx = x + W / 2;
    const marco = sanitize([roundedRect(cx, 0, W, S, 0)], []);
    const donde = offsetRegions([roundedRect(cx, 0, W - 2.4, S - 2.4, 0)], [], 0);
    const letra = fitDetailToBase(g, donde, true);
    // El cuerpo, extruido de lado a lado (eje X) con el agujero del cordón.
    const perfil = sanitize([roundedRect(0, (S - e) / 2, S, S - e, 0)], [agujero(0, S / 2, rCordon, 32)]);
    const m = solid(perfil, x, x + W);
    // (y, z, x) -> (x, y, z): un giro, no un espejo; las caras siguen fuera.
    const q = m.positions;
    const giro = new Array<number>(q.length);
    for (let i = 0; i < q.length; i += 3) {
      giro[i] = q[i + 2];
      giro[i + 1] = q[i];
      giro[i + 2] = q[i + 1];
    }
    const c = cara(marco, letra, [], p, S - e, e);
    cuerpos.push({ positions: giro }, c.cuerpo);
    zonas.push(...c.zonas);
    x += W + 3;
  }
  return [pieza('beads', p.beadCombined ? 'Cuenta' : 'Cuentas', S, cuerpos, { zonas })];
}

// -----------------------------------------------------------------------------
// Tornillo y tuerca
// -----------------------------------------------------------------------------

/** Radio del contorno de la tuerca en cada ángulo (hexágono, cuadrado, redondo). */
function contornoTuerca(forma: Params['nutShape'], entreCaras: number): (theta: number) => number {
  const r = entreCaras / 2;
  if (forma === 'round') return () => r * 1.08;
  const n = forma === 'square' ? 4 : 6;
  const lado = (2 * Math.PI) / n;
  return (theta) => {
    // Distancia del centro al lado del polígono regular, en esa dirección.
    const t = ((theta % lado) + lado) % lado - lado / 2;
    return r / Math.cos(t);
  };
}

/**
 * Tornillo con el dibujo en la cabeza, y su tuerca. La cabeza tiene la forma
 * elegida y el dibujo incrustado; se imprime boca abajo, así la rosca crece
 * hacia arriba, recta, que es como mejor sale una rosca.
 */
export function buildBoltNut(s: Silhouette, p: Params): Piece[] {
  const out: Piece[] = [];
  const fondo = p.boltPitch * 0.5;
  const rNucleo = p.boltDia / 2 - fondo;
  const entreCaras = Math.max(p.boltDia * 1.7, p.boltDia + 6);

  if (p.boltPart !== 'nut') {
    const col = colocar(s, p);
    // La cabeza tiene que cubrir de sobra la rosca.
    const minimo = sanitize([circle(0, 0, p.boltDia / 2 + 2.5, 64)], []);
    const base = col.base.length ? union(col.base, minimo) : minimo;
    const T = Math.max(p.thickness, 3);
    const c = cara(base, col.dibujo, col.nombre, p, 0, T);
    // La rosca sale por detrás de la cabeza, metida medio milímetro en ella.
    const b = cajaDe(base);
    // Se monta hacia arriba, de −0,5 (metida en la cabeza) a la punta, y aquí
    // se pone hacia abajo con media vuelta en X: un giro, no un espejo, así que
    // la rosca sigue siendo a derechas y casa con la tuerca.
    const rosca = tornilloRoscado(b.cx, b.cy, rNucleo, -0.5, p.boltLength + 0.5, p.boltPitch, fondo);
    const q = rosca.positions;
    const abajo = new Array<number>(q.length);
    for (let i = 0; i < q.length; i += 3) {
      abajo[i] = q[i];
      abajo[i + 1] = 2 * b.cy - q[i + 1];
      abajo[i + 2] = -q[i + 2];
    }
    out.push(pieza('bolt', 'Tornillo', T, [c.cuerpo, { positions: abajo }], c));
  }

  if (p.boltPart !== 'bolt') {
    const alto = Math.max(4, p.boltDia * 0.8);
    out.push({
      id: 'nut',
      label: 'Tuerca',
      role: 'body',
      mesh: tuercaPasante(rNucleo, alto, p.boltClearance, p.boltPitch, fondo, contornoTuerca(p.nutShape, entreCaras)),
      noMark: true,
    });
  }
  return out;
}

export { colocar, cara, pieza, bocaAbajo, solid, aLoops, cajaDe, dentro, anilla, agujero, rev };
