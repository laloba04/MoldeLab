/**
 * Termoformado: una plancha fina que se calienta y se abomba entre dos moldes.
 *
 * La gracia es que una pieza curva no hay que imprimirla curva. Se imprime
 * PLANA —rápido, sin soportes y con el dibujo nítido—, se calienta con agua
 * hirviendo o una pistola de aire, y se prensa entre dos moldes impresos. Sale
 * una cúpula limpia que tumbada en la cama tardaría horas y saldría escalonada.
 *
 * Tres piezas, y cada una tiene su motivo:
 *
 *   plancha  — lo que acaba siendo el adorno. Fina (0,6 mm), con el dibujo en
 *              relieve y, si se quiere, calada en panal. El calado no es solo
 *              estético: una plancha maciza se arruga al abombarla, y los
 *              agujeros le dan por dónde estirarse.
 *   molde ↑  — el macho, la cúpula. La plancha se apoya encima.
 *   molde ↓  — la hembra, el cuenco. Baja y aprieta.
 *
 * Nada de booleanas 3D, como en todo el proyecto. La cúpula sale de `loft`
 * entre anillos cada vez más pequeños —escalar un contorno no cambia su número
 * de puntos, así que las bandas emparejan siempre— y el cuenco de apilar losas
 * anulares, cada una un prisma cerrado por su cuenta.
 */

import type { HolePattern, Loop, Mesh, MoldShape, Params, Piece, Pt } from '../../types';
import { emptyMesh, cap, extrudeRegion, loft, merge } from '../mesh';
import { offsetRegions, sanitize, subtract, union, type Region } from '../clipper';
import { boxOf, circle, egg, heart, polygon, roundedRect, star } from '../shapes';
import { orient, pointInPolygon } from '../polygon';
import { fitDetailToBase, regionsOf, reliefSolids } from './catalog-parts';
import { abombar, domeOf } from '../dome';
import { FONDO_ROSCA, medioCuelloRoscado, tuercaRoscada } from './rosca';

/** Lo que el reborde de la plancha sobresale por encima de ella. */
const REBORDE_ALTO = 0.6;

/**
 * El punto más alto del contorno en la vertical `x`: dónde corta el contorno esa
 * vertical, y de los cortes, el de arriba. En un círculo es lo alto del círculo;
 * en un corazón, el fondo de la muesca entre los dos lóbulos.
 */
function bordeArriba(outer: Pt[], x: number): number | null {
  let mejor: number | null = null;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const [x1, y1] = outer[j];
    const [x2, y2] = outer[i];
    if ((x1 - x) * (x2 - x) > 0 || x1 === x2) continue;
    const y = y1 + ((x - x1) / (x2 - x1)) * (y2 - y1);
    if (mejor === null || y > mejor) mejor = y;
  }
  return mejor;
}

const rev = (pts: Pt[]) => [...pts].reverse() as Pt[];

function solid(regions: Region[], zLo: number, zHi: number): Mesh {
  const m = emptyMesh();
  for (const r of regions) extrudeRegion(m, r, zLo, zHi);
  return m;
}

/** Un contorno encogido hacia su centro. Conserva el número de puntos. */
function encoger(pts: Pt[], cx: number, cy: number, f: number): Pt[] {
  return pts.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f] as Pt);
}

/** Una celda del calado, centrada en el origen y de `lado` de ancho. */
function celda(patron: HolePattern, cx: number, cy: number, lado: number): Pt[] {
  switch (patron) {
    case 'circle':
      return circle(cx, cy, lado / 2, 20);
    case 'square':
      return roundedRect(cx, cy, lado, lado, lado * 0.18, 4);
    case 'diamond':
      return polygon(cx, cy, lado * 1.3, lado * 1.3, 4, false);
    case 'triangle':
      return polygon(cx, cy, lado * 1.25, lado * 1.1, 3);
    case 'hexagon':
    default: {
      // Hexágono de PUNTA arriba, con `lado` de cara a cara. Es el que encaja
      // con filas corridas medio paso: así todas las paredes del panal miden lo
      // mismo. Con el hexágono tumbado (punta a los lados) quedaban huecos
      // grandes entre celdas y el panal parecía una lámina con puntos.
      const r = lado / Math.sqrt(3);
      const pts: Pt[] = [];
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 2 + (k * Math.PI) / 3;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      return pts;
    }
  }
}

/**
 * La rejilla de agujeros que cala la plancha.
 *
 * Las filas impares van medio paso corridas, que es lo que convierte una
 * cuadrícula en un panal y lo que hace que el calado aguante el estirón por
 * igual en todas las direcciones.
 */
function calado(patron: HolePattern, zona: Region[], paso: number, pared: number): Region[] {
  if (patron === 'none' || !zona.length) return [];

  const b = boxOf(zona.map((r) => ({ pts: r.outer, hole: false })));
  const lado = Math.max(0.3, paso - pared);
  // Filas a √3/2 del paso: en un panal de verdad cada fila encaja en los huecos
  // de la anterior, y la pared entre dos celdas mide igual en todas direcciones.
  const pasoY = patron === 'hexagon' ? (paso * Math.sqrt(3)) / 2 : paso;
  const agujeros: Pt[][] = [];

  for (let j = 0, y = b.minY; y <= b.maxY; j++, y += pasoY) {
    const corrido = j % 2 ? paso / 2 : 0;
    for (let x = b.minX; x <= b.maxX; x += paso) {
      const c = celda(patron, x + corrido, y, lado);
      // Solo celdas ENTERAS. Recortarlas contra el borde dejaba medias celdas
      // —feas, y por donde se rompe el borde al prensar— y, peor, muchas con un
      // lado en la misma línea recta: el triangulador, al enlazar unos agujeros
      // con otros, se comía puntos de esa línea y la plancha salía con grietas.
      if (c.every((pt) => dentroDe(zona, pt))) agujeros.push(c);
    }
  }
  return agujeros.map((a) => ({ outer: orient(a, true), holes: [] }));
}

/**
 * ¿Cae el punto dentro de la zona? Dentro de algún contorno exterior y fuera de
 * sus huecos —la zona llega con el dibujo restado como hueco, y por ahí no se
 * puede calar—.
 */
function dentroDe(zona: Region[], pt: Pt): boolean {
  for (const r of zona) {
    if (!pointInPolygon(pt, r.outer)) continue;
    if (r.holes.some((h) => pointInPolygon(pt, h))) return false;
    return true;
  }
  return false;
}

// -----------------------------------------------------------------------------
// El cuello y el tapón: lo que une las dos medias planchas
// -----------------------------------------------------------------------------

/**
 * Gira +90° alrededor del eje X: (x, y, z) → (x, −z, y), y luego traslada.
 *
 * Es un giro de verdad (determinante +1), no un cambio de ejes: las caras siguen
 * mirando hacia fuera sin tener que dar la vuelta a ningún triángulo. Sirve para
 * poner de pie el ojal de la tuerca, que se monta tumbado porque lo único que se
 * sabe hacer es extruir en Z.
 */
function girarX(m: Mesh, dx: number, dy: number, dz: number): Mesh {
  const p = m.positions;
  const out = new Array<number>(p.length);
  for (let i = 0; i < p.length; i += 3) {
    out[i] = p[i] + dx;
    out[i + 1] = -p[i + 2] + dy;
    out[i + 2] = p[i + 1] + dz;
  }
  return { positions: out };
}

/**
 * La tuerca que cierra el adorno por arriba: se enrosca en el cuello y sujeta
 * las dos mitades. Lleva encima el ojal por donde pasa el cordón.
 */
function tuerca(r: number, alto: number, holgura: number, ojo: number, ojoHueco: number): Mesh {
  const techo = 1.5;
  // Un pelo menos que lo que asoma el cuello, para que llegue a apretar.
  const hueco = Math.max(2, alto - 0.5);
  const cuerpo = tuercaRoscada(r, hueco, holgura, 1.6, techo);

  // El ojal: un aro de pie encima del techo, con el agujero horizontal. Se
  // monta tumbado y se pone de pie con el giro.
  const aro = emptyMesh();
  extrudeRegion(aro, { outer: circle(0, 0, ojo, 32), holes: [rev(circle(0, 0, ojoHueco, 24))] }, -1, 1);
  const zAro = hueco + techo + ojo - Math.min(ojo * 0.35, 1.2);
  return merge(cuerpo, girarX(aro, 0, 0, zAro));
}

/**
 * La pinza de abajo: una U pequeña que muerde los dos bordes planos juntos.
 *
 * El cuello y su tapón sujetan las dos medias planchas por ARRIBA; por abajo no
 * hay nada, y al colgar el adorno se abren como una almeja. La pinza entra por
 * el borde de abajo y las cierra.
 *
 * La ranura mide lo que las dos planchas juntas más un pelo, y no más honda que
 * el borde plano: si llegara a la cúpula, la aplastaría.
 */
function pinza(grosor: number, reborde: number): Mesh {
  const ranura = grosor * 2 + 0.2;
  const hondo = Math.max(1, reborde - 0.4);
  const pared = 1.6;
  const ancho = ranura + pared * 2;
  const fondo = hondo + pared;
  const largo = 7;

  const bloque = roundedRect(0, 0, ancho, fondo, 0.6, 3);
  // La ranura sale por el lado de arriba del bloque: se pasa un poco del borde
  // para que el corte la abra limpia, sin dejar una piel de material.
  const hueco = roundedRect(0, fondo / 2 - hondo / 2 + 0.5, ranura, hondo + 1, 0, 1);
  return solid(subtract(sanitize([bloque], []), sanitize([hueco], [])), 0, largo);
}

// -----------------------------------------------------------------------------
// Las piezas
// -----------------------------------------------------------------------------

/**
 * La silueta del adorno: la forma elegida con SU proporción y el tamaño pedido.
 *
 * Antes se sacaba de la caja del dibujo, como en la placa con relieve, y con un
 * nombre —ancho y bajito— el corazón salía aplastado, de 100 × 46 mm. Un adorno
 * es la forma primero: el corazón es un corazón, mide lo que diga «Tamaño», y el
 * dibujo o el nombre se encajan dentro.
 */
function formaDelAdorno(
  forma: MoldShape,
  cx: number,
  cy: number,
  ancho: number,
  radio: number,
  silueta: Loop[],
): Pt[] {
  const a = Math.max(10, ancho);
  switch (forma) {
    case 'heart':
      return corazonRedondo(cx, cy, a);
    case 'hexagon':
      return polygon(cx, cy, a, a * 0.88, 6, false);
    case 'triangle':
      return polygon(cx, cy, a, a * 0.87, 3);
    case 'diamond':
      return polygon(cx, cy, a * 0.78, a, 4, false);
    case 'star':
      return star(cx, cy, a, a * 0.95);
    case 'egg':
      return egg(cx, cy, a * 0.78, a);
    case 'square':
      return roundedRect(cx, cy, a, a, Math.min(radio, a / 4));
    case 'rounded':
      return roundedRect(cx, cy, a, a * 0.72, Math.min(radio, a / 4));
    case 'image': {
      // La forma del PROPIO dibujo: una flor sale con sus pétalos, un gato con
      // sus orejas.
      //
      // Antes se envolvía con una goma elástica (la envolvente convexa) y una
      // flor salía hexagonal: la plancha no se parecía al dibujo. Ahora solo se
      // arregla lo que de verdad no se puede prensar: las rendijas estrechas se
      // rellenan (cerrar: engordar y volver a adelgazar) y los picos se
      // redondean (abrir: adelgazar y volver a engordar), que es por donde una
      // plancha caliente se rasga.
      const fuera = silueta.filter((l) => !l.hole).map((l) => l.pts);
      if (!fuera.length) return circle(cx, cy, a / 2, 96);
      const b = boxOf(silueta.filter((l) => !l.hole));
      const k = a / Math.max(b.w, b.h, 1e-6);
      const escalada = fuera.map((pts) => pts.map(([x, y]) => [cx + (x - b.cx) * k, cy + (y - b.cy) * k] as Pt));
      const rendija = a * 0.06;
      const pico = a * 0.04;
      const soloFuera = (rs: { outer: Pt[] }[]) => rs.map((reg) => reg.outer);
      const cerrada = offsetRegions(soloFuera(offsetRegions(escalada, [], rendija, 'round')), [], -rendija, 'round');
      const redondeada = offsetRegions(soloFuera(offsetRegions(soloFuera(cerrada), [], -pico, 'round')), [], pico, 'round');
      const mayor = redondeada.reduce<Pt[] | null>(
        (m, reg) => (!m || Math.abs(areaDe(reg.outer)) > Math.abs(areaDe(m)) ? reg.outer : m),
        null,
      );
      return mayor ?? envolver(escalada.flat());
    }
    case 'circle':
    default:
      return circle(cx, cy, a / 2, 96);
  }
}

/**
 * La envolvente convexa de unos puntos: la goma elástica que los rodea.
 * Cadena monótona de Andrew, en sentido antihorario.
 */
function envolver(puntos: Pt[]): Pt[] {
  const pts = [...puntos].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts;
  const cruz = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const abajo: Pt[] = [];
  for (const p of pts) {
    while (abajo.length >= 2 && cruz(abajo[abajo.length - 2], abajo[abajo.length - 1], p) <= 0) abajo.pop();
    abajo.push(p);
  }
  const arriba: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (arriba.length >= 2 && cruz(arriba[arriba.length - 2], arriba[arriba.length - 1], p) <= 0) arriba.pop();
    arriba.push(p);
  }
  return [...abajo.slice(0, -1), ...arriba.slice(0, -1)];
}

/**
 * Corazón redondeado, el del emoji ♥: un cuadrado girado con dos círculos sobre
 * sus lados de arriba.
 *
 * El corazón de las placas es el de la curva clásica, con una muesca en V muy
 * honda entre los lóbulos. Para un adorno no sirve: el cuello nace del fondo de
 * esa muesca y se quedaba hundido entre los lóbulos, sin sitio para la tuerca.
 * Este tiene la muesca poco honda —como el de Formify— y el cuello asoma.
 */
function corazonRedondo(cx: number, cy: number, ancho: number): Pt[] {
  // Con lado `l`, el corazón mide 1,707·l de ancho (l/√2 + l).
  const l = ancho / (1 / Math.SQRT2 + 1);
  const d = l / Math.SQRT2;
  const cuadrado: Pt[] = [
    [0, -d],
    [d, 0],
    [0, d],
    [-d, 0],
  ];
  const lobulo = (sx: number) => circle((sx * d) / 2, d / 2, l / 2, 72);
  const juntos = union(sanitize([cuadrado], []), sanitize([lobulo(-1), lobulo(1)], []));
  const borde = juntos.reduce<Pt[] | null>(
    (a, r) => (!a || Math.abs(areaDe(r.outer)) > Math.abs(areaDe(a)) ? r.outer : a),
    null,
  );
  if (!borde) return circle(cx, cy, ancho / 2, 96);
  // Centrado por su caja, que es lo que espera quien lo coloca.
  const b = boxOf([{ pts: borde, hole: false }]);
  return borde.map(([x, y]) => [cx + x - b.cx, cy + y - b.cy] as Pt);
}

/**
 * Las dos medias planchas, el tapón que las une y los dos moldes.
 *
 * El dibujo va en relieve sobre la plancha, no calado: calado se pierde al
 * abombar, porque el borde de cada letra es justo por donde se rasga. Si se
 * quiere ver a contraluz, para eso está el calado de fondo.
 *
 * `textLoops` es el nombre, si se ha escrito uno. Se levanta por encima del
 * dibujo y va aparte, igual que en el llavero de imagen y texto: a la misma
 * altura se fundiría con las líneas y no se leería.
 */
export function buildThermoform(
  loops: Loop[],
  detail: Loop[],
  p: Params,
  textLoops?: Loop[],
): Piece[] {
  if (!(loops.length ? loops : detail).length) return [];
  // Con «Silueta», la forma se ENDEREZA antes de nada (ver `enderezar`): un
  // dibujo un poco torcido sale derecho y simétrico, con una sola pareja de
  // moldes, y el adorno cuelga recto. El dibujo gira con la forma; el nombre
  // no, que se queda recto para leerse.
  if (p.moldShape === 'image') {
    const g = enderezar(loops.length ? loops : detail);
    if (g) {
      loops = g(loops);
      detail = g(detail);
    }
  }
  const fuente = loops.length ? loops : detail;
  const centro = boxOf(fuente);
  const base = sanitize(
    [formaDelAdorno(p.moldShape, centro.cx, centro.cy, p.targetWidthMm, p.cornerRadius, fuente)],
    [],
  );
  if (!base.length) return [];

  // Un molde tiene que ser UNA pieza: si la forma elegida saliera en trozos, la
  // cúpula no tendría sobre qué apoyarse. Se queda con la mayor.
  const principal = base.reduce((a, r) =>
    Math.abs(areaDe(r.outer)) > Math.abs(areaDe(a.outer)) ? r : a,
  );
  const outer = casiSimetrica(principal.outer);
  const caja = boxOf([{ pts: outer, hole: false }]);
  const cx = caja.cx;
  const cy = caja.cy;

  const alto = Math.max(1, p.formHeight);
  const grosor = Math.max(0.2, p.sheetThickness);

  // --- El cuello ---------------------------------------------------------------
  //
  // Nace de lo ALTO de la forma —en un corazón, a la altura de las puntas de
  // los lóbulos— y sale hacia fuera. Todo él queda por fuera: es donde se
  // enrosca la tuerca, y si se metía en la forma quedaba tumbado encima de la
  // plancha abombada, en una zanja.
  //
  // Lo que hay entre el fondo de la muesca y el cuello se rellena de plancha
  // plana (`relleno`, más abajo): es el cuello quien se apoya en ella, no al
  // revés.
  const rCuello = Math.max(2, p.neckRadius);
  const yCuello = bordeArriba(outer, cx) ?? caja.maxY; // el fondo de la muesca
  const yNace = caja.maxY - 1.6; // se mete un poco en el relleno, para soldar
  const largoCuello = caja.maxY - yNace + Math.max(3, p.neckLength);

  // La muesca, rellena: de un poco por debajo de su fondo hasta lo alto de la
  // forma, del ancho del cuello. Así el cuello sale de material firme.
  const relleno = roundedRect(
    cx,
    (yCuello - 1 + caja.maxY) / 2,
    (rCuello + 0.5) * 2,
    Math.max(1, caja.maxY - yCuello + 1),
    0,
  );

  // El borde PLANO de la plancha: no se abomba, se apoya en el escalón del
  // cuenco y es lo que la deja quieta al prensar. La cúpula va por dentro de él.
  //
  // Y donde está el relleno de la muesca tampoco. Solo ahí, con un margen: un
  // corte más largo dejaba una zanja plana por la cúpula.
  const reborde = Math.max(2.5, p.holeWall * 3);
  const sitioCuello = offsetRegions([relleno], [], 1.5);
  const cupulaOuter =
    subtract(offsetRegions([outer], [], -reborde), sitioCuello).reduce<Pt[] | null>(
      (a, r) => (!a || Math.abs(areaDe(r.outer)) > Math.abs(areaDe(a)) ? r.outer : a),
      null,
    ) ?? encoger(outer, cx, cy, 0.85);
  const domo = domeOf(cupulaOuter, alto);

  // --- El espejo -----------------------------------------------------------
  //
  // Las piezas que se ponen BOCA ABAJO quedan en espejo, y con un dibujo que no
  // es igual por los dos lados eso decide si encajan o no:
  //
  // - La plancha de delante entra en el cuenco con el dibujo hacia abajo, o sea
  //   dada la vuelta: el hueco del cuenco tiene que ser el ESPEJO de la forma.
  // - La de atrás se junta con la de delante dándole la vuelta sobre el eje del
  //   cuello: se imprime en espejo para que, vuelta, case con la de delante.
  //
  // Antes todo salía sin espejar y solo encajaba con formas simétricas (un
  // corazón, una flor). Con un dibujo asimétrico las dos mitades no
  // coincidían, y la plancha no entraba en su molde.
  const espejoPts = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [2 * cx - x, y] as Pt).reverse();
  const espejoRegs = (rs: Region[]): Region[] =>
    rs.map((r) => ({ outer: espejoPts(r.outer), holes: r.holes.map(espejoPts) }));
  const espejoMalla = (m: Mesh): Mesh => {
    const q = m.positions;
    const out = new Array<number>(q.length);
    for (let i = 0; i < q.length; i += 9) {
      // Espejar le da la vuelta a cada cara: se cambia el orden de dos vértices
      // para que siga mirando hacia fuera.
      for (const [d, o] of [[0, 0], [3, 6], [6, 3]]) {
        out[i + d] = 2 * cx - q[i + o];
        out[i + d + 1] = q[i + o + 1];
        out[i + d + 2] = q[i + o + 2];
      }
    }
    return { positions: out };
  };
  const cupulaTrasera = espejoPts(cupulaOuter);
  const domoTrasera = domeOf(cupulaTrasera, alto);
  // ¿Es la forma igual a su espejo? Entonces los mismos moldes sirven para las
  // dos planchas; si no, la trasera lleva los suyos.
  const asimetrica = (() => {
    const a = sanitize([outer], []);
    const b = sanitize([espejoPts(outer)], []);
    const dif = union(subtract(a, b), subtract(b, a));
    const area = Math.abs(areaDe(outer)) || 1;
    return dif.reduce((t, r) => t + Math.abs(areaDe(r.outer)), 0) / area > 0.02;
  })();

  // --- Montado (para el visor) -----------------------------------------------
  //
  // Dónde va cada pieza con el adorno cerrado: la delantera tal cual, la
  // trasera vuelta sobre el eje del cuello debajo de ella, la tuerca en la punta
  // del cuello, la pinza mordiendo el borde de abajo y los moldes a un lado. Todo
  // levantado lo que mide la cúpula, para que el adorno no atraviese la cama.
  // Son matrices 3×4 por filas (ver `Piece.montaje`).
  const sube = alto + grosor + 1;
  const montajeDelantera = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, sube];
  const montajeTrasera = [-1, 0, 0, 2 * cx, 0, 1, 0, 0, 0, 0, -1, sube];
  const aparte = caja.w + 25;
  const montajeMolde = (col: number, fila: number) => [1, 0, 0, aparte * col, 0, 1, 0, -(caja.h + 20) * fila, 0, 0, 1, 0];

  // --- La plancha ------------------------------------------------------------
  //
  // El dibujo se encoge para caber dentro, igual que en la placa con relieve: si
  // sobresale del contorno queda flotando y al abombar se va por el borde.
  //
  // El dibujo y el nombre se encajan JUNTOS, con la misma escala y el mismo
  // centro. Por separado, cada uno se centraba por su cuenta y el nombre perdía
  // el sitio que se le había dado con los deslizadores.
  //
  // Y se encajan en la CÚPULA, no en la plancha entera, con el margen de
  // «Marco» alrededor: en el borde plano no lucen, y al prensar es la zona que
  // se aplasta contra el escalón.
  // La plancha es la forma MÁS el relleno de la muesca. Es plano —no se
  // abomba— y forma parte del reborde.
  const plano = union(sanitize([outer], []), sanitize([relleno], []));
  const dondeVa = offsetRegions([cupulaOuter], [], -Math.max(0, p.border));
  const juntos = fitDetailToBase(
    [...detail, ...(textLoops ?? [])],
    dondeVa.length ? dondeVa : sanitize([cupulaOuter], []),
    true,
  );
  const dibujo = juntos.slice(0, detail.length);
  const nombre = juntos.slice(detail.length);
  // El NOMBRE no aparta el calado: las letras van encima del panal, que sigue
  // por debajo. Es como se ve en un adorno de verdad, y lo que pidió el taller.
  // Lo que sí puede apartarlo es el dibujo, si se quita «calar también el
  // dibujo»; el nombre, nunca.
  const todo = dibujo;
  // El margen que se deja macizo alrededor de cada línea: lo justo para que el
  // calado no se coma el canto del trazo. Con el «marco» de la placa (4 mm) se
  // comía la plancha entera en cuanto el dibujo era de líneas, y el panal, que
  // es la gracia del adorno, desaparecía.
  const margenDibujo = Math.max(0.8, p.holeWall * 1.2);
  const zonaDibujo = todo.length ? regionsOf(todo, margenDibujo) : [];

  // El calado respeta el reborde macizo: por ahí es por donde se agarra la
  // plancha al prensarla, y un borde calado se rompe de la primera.
  const util = offsetRegions([outer], [], -reborde);
  const sinDibujo =
    p.holesOnDesign || !zonaDibujo.length ? util : subtract(util, zonaDibujo);
  const agujeros = calado(p.holePattern, sinDibujo, Math.max(1, p.holeSpacing), Math.max(0.3, p.holeWall));
  const planchaReg = agujeros.length ? subtract(plano, agujeros) : plano;

  // El medio cuello nace del borde de arriba, centrado. Va FUERA de la cúpula:
  // lo de dentro se abomba, y un cuello torcido no se puede tapar.
  // Cada plancha lleva MEDIO cuello roscado. La trasera, al darle la vuelta
  // para juntarla, gira media vuelta sobre el eje del cuello: su espiral va
  // desfasada media vuelta y la rosca sigue de una mitad a la otra.
  //
  // Rosca SOLO en lo que asoma, que es donde se enrosca la tuerca. El tramo que
  // cruza la muesca va liso: roscado entero salía un tornillo larguísimo.
  const liso = caja.maxY - yNace; // lo que va metido en el relleno
  const cuello = medioCuelloRoscado(cx, yNace, rCuello, largoCuello, 0, liso);
  const cuelloTrasera = medioCuelloRoscado(cx, yNace, rCuello, largoCuello, 0.5, liso);

  const relieve = reliefSolids(dibujo, p, grosor - 0.01, p.reliefHeight, [outer]);
  const relieveNombre = nombre.length
    ? merge(...reliefSolids(nombre, p, grosor - 0.01, p.reliefHeight * 2.2, [outer]))
    : undefined;

  // Si se pide la pieza YA abombada (sin molde), se deforma aquí: lo mismo que
  // se ve en pantalla es lo que sale en el archivo.
  const prensar = (m: Mesh): Mesh => (p.formMold ? m : abombar(m, domo));

  // El reborde: el borde plano de la plancha, un poco más alto que ella. Perfila
  // la forma —sin él, el borde de un panal se ve deshilachado— y la hace más
  // fuerte justo donde se agarra al prensar. Es una zona aparte, así que se
  // puede pintar de otro color, como en la de Formify.
  const anillo = subtract(plano, offsetRegions([outer], [], -reborde));
  const rebordeMalla = anillo.length ? solid(anillo, grosor - 0.01, grosor + REBORDE_ALTO) : emptyMesh();

  const cuerpo = prensar(merge(solid(planchaReg, 0, grosor), cuello));
  const partes = [rebordeMalla, ...relieve].filter((m) => m.positions.length).map(prensar);
  const capaNombre = relieveNombre ? prensar(relieveNombre) : undefined;
  const overlay = merge(...partes);
  const delantera = merge(cuerpo, overlay, capaNombre ?? emptyMesh());

  // La TRASERA: la misma plancha sin dibujo, EN ESPEJO (ver arriba). Se juntan
  // por la cara plana: las dos mitades del cuello forman un cuello entero, el
  // tapón entra por él y las deja sujetas. Así el adorno sale cerrado y hueco,
  // que es lo que deja que la luz pase por el calado.
  //
  // Se espeja la plancha, no el cuello: el cuello ya es simétrico, y espejar
  // una rosca la cambiaría de a derechas a a izquierdas.
  const prensarTrasera = (m: Mesh): Mesh => (p.formMold ? m : abombar(m, domoTrasera));
  const rebordeTrasera = anillo.length
    ? prensarTrasera(solid(espejoRegs(anillo), grosor - 0.01, grosor + REBORDE_ALTO))
    : emptyMesh();
  const trasera = merge(
    prensarTrasera(merge(solid(espejoRegs(planchaReg), 0, grosor), cuelloTrasera)),
    rebordeTrasera,
  );

  // Con molde, las planchas se imprimen planas pero el visor sabe abombarlas
  // para enseñar cómo quedan. Sin molde ya vienen abombadas de fábrica.
  const domoVisor = p.formMold ? domo : undefined;
  const placa = p.formMold ? { regions: planchaReg, zLo: 0, zHi: grosor } : undefined;

  const piezas: Piece[] = [];
  if (delantera.positions.length) {
    piezas.push({
      id: 'sheet',
      label: 'Plancha delantera',
      role: 'icing',
      mesh: delantera,
      plate: placa,
      overlay: overlay.positions.length ? overlay : undefined,
      overlayParts: partes.length ? partes : undefined,
      textMesh: capaNombre?.positions.length ? capaNombre : undefined,
      dome: domoVisor,
      // La marca del taller va en la trasera: aquí estorbaría al dibujo.
      noMark: true,
      montaje: montajeDelantera,
    });
  }
  if (p.formBack && trasera.positions.length) {
    piezas.push({
      id: 'sheet-back',
      label: 'Plancha trasera',
      role: 'icing',
      mesh: trasera,
      overlay: rebordeTrasera.positions.length ? rebordeTrasera : undefined,
      overlayParts: rebordeTrasera.positions.length ? [rebordeTrasera] : undefined,
      dome: p.formMold ? domoTrasera : undefined,
      // La marca del taller va aquí, en RELIEVE por la cara de fuera, como el
      // nombre en la delantera: por encima del panal. Para buscarle sitio se le
      // da la zona de la cúpula MACIZA; con la plancha calada no encontraba un
      // hueco donde cupiera entera y no salía en ninguna parte.
      //
      // Sin molde la plancha ya viene abombada, y una marca plana encima no
      // seguiría la curva: en ese caso no se pone.
      plate: p.formMold ? { regions: sanitize([cupulaTrasera], []), zLo: 0, zHi: grosor } : undefined,
      soloRelieve: true,
      noMark: !p.formMold,
      montaje: montajeTrasera,
    });
  }

  // El tapón: solo tiene sentido si hay dos mitades que unir.
  if (p.formBack) {
    const altoTuerca = Math.max(3, p.neckLength);
    const t = tuerca(rCuello, altoTuerca, p.capClearance, p.ringOuter, p.ringInner);
    // Montada: de pie sobre la punta del cuello, con el eje a lo largo de Y.
    const huecoTuerca = Math.max(2, altoTuerca - 0.5);
    const yPunta = yNace + largoCuello;
    piezas.push({
      id: 'cap',
      label: 'Tuerca (cierra por arriba)',
      role: 'body',
      mesh: t,
      noMark: true,
      montaje: [1, 0, 0, cx, 0, 0, 1, yPunta - huecoTuerca, 0, -1, 0, sube],
    });
    // La pinza, mordiendo los dos bordes juntos por abajo (ver `pinza`).
    const hondo = Math.max(1, reborde - 0.4);
    const fondo = hondo + 1.6;
    piezas.push({
      id: 'clip',
      label: 'Pinza (cierra por abajo)',
      role: 'body',
      mesh: pinza(grosor, reborde),
      noMark: true,
      montaje: [0, 0, 1, cx - 3.5, 0, 1, 0, caja.minY - (fondo / 2 - hondo), -1, 0, 0, sube],
    });
  }

  // --- Los dos moldes --------------------------------------------------------
  //
  // Solo si se van a prensar planchas planas. Pedida la pieza ya abombada, los
  // moldes sobran.
  if (!p.formMold) return piezas;

  // Cómo se usa, que es lo que manda en las medidas: la plancha caliente se
  // pone en el CUENCO, con su borde plano apoyado en el escalón; la CÚPULA se le
  // da la vuelta y se aprieta desde arriba, y empuja la plancha dentro del hueco.
  //
  // La cúpula va JUSTA; el hueco del cuenco se abre lo que mide la plancha más
  // la holgura. Al revés la plancha no entraría, y sin holgura quedaría
  // aprisionada y se rasgaría.
  //
  // Y el hueco deja sitio TAMBIÉN al relieve: la plancha entra con la cara del
  // dibujo hacia el cuenco, y si el hueco solo midiera la plancha, el nombre
  // —que va levantado— se aplastaría contra la pared al prensar.
  const hueco =
    grosor + Math.max(REBORDE_ALTO, p.reliefHeight * 2.2) + Math.max(0, p.formClearance);
  const pared = 4;
  const suelo = 3;

  const mayor = (rs: Region[], f: Pt[]): Pt[] =>
    rs.reduce<Pt[] | null>(
      (a, r) => (!a || Math.abs(areaDe(r.outer)) > Math.abs(areaDe(a)) ? r.outer : a),
      null,
    ) ?? f;

  // --- La cúpula (el macho) --------------------------------------------------
  //
  // Sobre una pestaña que llega hasta el borde de la plancha pero NO lo pasa:
  // así, al apretar, aplasta el borde plano contra el escalón y lo sujeta, y no
  // choca con el cuello, que sale justo por fuera de ese borde.
  //
  // Lisa: es un bloque plano al que se le deforma solo la cara de arriba, con
  // la misma cúpula que abomba la plancha. Apilando losas salía a escalones.
  const pestanaOuter = mayor(offsetRegions([outer], [], -0.4), outer);
  const pestana = 2.5;
  const macho = abombar(solid(sanitize([pestanaOuter], []), 0, pestana), domo, 3, {
    desde: pestana,
  });

  // --- El cuenco (la hembra) -------------------------------------------------
  const bloque = sanitize([mayor(offsetRegions([outer], [], pared), outer)], []);
  // A lo ANCHO, la boca solo se abre lo que mide la plancha más la holgura: el
  // sitio para el relieve va en hondo, no en ancho. Junto al borde la plancha
  // casi no se curva, así que el relieve no necesita sitio de lado; y si la boca
  // se abriera también eso, se comería el escalón y el borde plano de la
  // plancha no tendría dónde apoyarse.
  const boca = mayor(
    offsetRegions([cupulaOuter], [], grosor + Math.max(0, p.formClearance)),
    cupulaOuter,
  );

  // El escalón es el contorno entero de la plancha, con un pelo de holgura para
  // que entre sin forzar. Y la ranura del cuello, que atraviesa la pared: sin
  // ella, el cuello tropieza con el borde del cuenco y la plancha no asienta.
  const rCrestas = rCuello + FONDO_ROSCA + 0.3;
  // Desde el fondo de la muesca hasta fuera de la pared, que es por donde sale.
  const ranuraLargo = pared * 2 + 4;
  const ranura = roundedRect(cx, yNace + ranuraLargo / 2, rCrestas * 2, ranuraLargo, 0);
  // La plancha se apoya entera en el escalón, relleno de la muesca incluido.
  const escalon = union(
    offsetRegions([outer], [], 0.25),
    union(offsetRegions([relleno], [], 0.25), sanitize([ranura], [])),
  );

  // El hueco es la cúpula agrandada lo que mide la plancha más la holgura, y
  // más honda por lo mismo: la cúpula de la boca tiene su propia distancia al
  // borde, así que se calcula aparte en vez de reutilizar la de la plancha.
  //
  // Liso también: un bloque macizo hasta el borde con la cara de arriba HUNDIDA
  // —la misma deformación, hacia abajo—, y encima el anillo del escalón.
  const domoBoca = domeOf(boca, alto + hueco);
  const borde = suelo + alto + hueco;
  const hembra = merge(
    abombar(solid(bloque, 0, borde), domoBoca, 3, { desde: borde, signo: -1 }),
    solid(subtract(bloque, escalon), borde - 0.01, borde + grosor),
  );

  // La plancha entra en el cuenco dada la vuelta, así que el cuenco es el
  // espejo de la forma; la cúpula también se da la vuelta para apretar, así que
  // va sin espejar y, vuelta, casa con el cuenco.
  //
  // La trasera se imprime ya en espejo: sus moldes son los mismos espejados. Si
  // la forma es simétrica, son idénticos y sobran.
  const pareja = (sufijo: string, cuenco: Mesh, cupula: Mesh, idExtra = '', col = 1) => {
    if (cuenco.positions.length) {
      piezas.push({ id: `mold-down${idExtra}`, label: `Molde de abajo (cuenco)${sufijo}`, role: 'body', mesh: cuenco, noMark: true, montaje: montajeMolde(col, 0) });
    }
    if (cupula.positions.length) {
      piezas.push({ id: `mold-up${idExtra}`, label: `Molde de arriba (cúpula, se le da la vuelta)${sufijo}`, role: 'body', mesh: cupula, noMark: true, montaje: montajeMolde(col, 1) });
    }
  };
  const dosParejas = asimetrica && p.formBack;
  pareja(dosParejas ? ' · delantera' : '', espejoMalla(hembra), macho);
  if (dosParejas) pareja(' · trasera', hembra, espejoMalla(macho), '-back', 2);
  return piezas;
}

/**
 * Si la forma es CASI simétrica, la deja simétrica del todo.
 *
 * Un dibujo hecho a mano —un osito, una flor— nunca es igual al milímetro por
 * los dos lados, y por esa nada salía como asimétrico: dos parejas de moldes
 * casi idénticas, que confunden y gastan plástico. Si lo que cambia entre un
 * lado y otro es poco, se junta la forma con su espejo: crece unas décimas por
 * donde le faltaba, no se nota, y sale una sola pareja de moldes con las dos
 * mitades casando exactas. Una luna, que sí es distinta por cada lado, se queda
 * como está.
 */
/** Cuánto se diferencia una forma de su espejo izquierda-derecha: el área que
 *  no coincide, en fracción del área de la forma (0 = simétrica). */
function asimetria(outer: Pt[]): number {
  const b = boxOf([{ pts: outer, hole: false }]);
  const espejo = outer.map(([x, y]) => [2 * b.cx - x, y] as Pt).reverse();
  const a = sanitize([outer], []);
  const e = sanitize([espejo], []);
  const dif = union(subtract(a, e), subtract(e, a));
  const area = Math.abs(areaDe(outer)) || 1;
  return dif.reduce((t, r) => t + Math.abs(areaDe(r.outer)), 0) / area;
}

/**
 * El giro que deja la forma más derecha: el que la hace más simétrica de
 * izquierda a derecha, buscando hasta 25° a cada lado. Devuelve con qué girar
 * los contornos, o nada si ya está derecha o girarla no la mejora.
 *
 * Un osito dibujado a mano suele estar un poco ladeado, y torcido no hay forma
 * de que sea simétrico: salía con dos parejas de moldes. Enderezado, la
 * diferencia que queda (una oreja algo mayor) se iguala con `casiSimetrica`.
 */
function enderezar(ls: Loop[]): ((ls: Loop[]) => Loop[]) | null {
  const fuera = ls.filter((l) => !l.hole);
  if (!fuera.length) return null;
  const mayor = fuera.reduce((a, l) => (Math.abs(areaDe(l.pts)) > Math.abs(areaDe(a.pts)) ? l : a)).pts;
  const b = boxOf(fuera);
  const girar = (pts: Pt[], g: number): Pt[] => {
    const c = Math.cos(g);
    const s = Math.sin(g);
    return pts.map(([x, y]) => [b.cx + (x - b.cx) * c - (y - b.cy) * s, b.cy + (x - b.cx) * s + (y - b.cy) * c] as Pt);
  };
  const base = asimetria(mayor);
  let mejor = { g: 0, a: base };
  for (let grados = -25; grados <= 25; grados += 1) {
    if (!grados) continue;
    const g = (grados * Math.PI) / 180;
    const a = asimetria(girar(mayor, g));
    if (a < mejor.a) mejor = { g, a };
  }
  // Solo si de verdad mejora: no se gira una forma por una décima.
  if (!mejor.g || mejor.a > base * 0.7) return null;
  return (xs) => xs.map((l) => ({ ...l, pts: girar(l.pts, mejor.g) }));
}

function casiSimetrica(outer: Pt[]): Pt[] {
  const distinto = asimetria(outer);
  // Hasta un 25 % de área distinta se iguala (ya enderezada, ver
  // `enderezar`): una oreja algo mayor, un brazo más bajo. Una luna difiere más
  // de un 100 %: esa sí lleva sus propios moldes para la trasera.
  if (distinto < 1e-3 || distinto > 0.25) return outer;
  const b = boxOf([{ pts: outer, hole: false }]);
  const espejo = outer.map(([x, y]) => [2 * b.cx - x, y] as Pt).reverse();
  const junta = union(sanitize([outer], []), sanitize([espejo], []));
  const mayor = junta.reduce<Pt[] | null>(
    (m, r) => (!m || Math.abs(areaDe(r.outer)) > Math.abs(areaDe(m)) ? r.outer : m),
    null,
  );
  return mayor ?? outer;
}

/** Área con signo, para quedarse con el contorno más grande. */
function areaDe(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  }
  return a / 2;
}
