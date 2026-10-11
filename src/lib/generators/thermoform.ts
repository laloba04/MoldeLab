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
function formaDelAdorno(forma: MoldShape, cx: number, cy: number, ancho: number, radio: number): Pt[] {
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
    case 'circle':
    case 'image':
    default:
      // La silueta de la imagen no vale para abombar: un contorno con entrantes
      // y salientes se arruga al prensarlo. Se usa el círculo, que es el adorno
      // de toda la vida.
      return circle(cx, cy, a / 2, 96);
  }
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
  const fuente = loops.length ? loops : detail;
  if (!fuente.length) return [];
  const centro = boxOf(fuente);
  const base = sanitize([formaDelAdorno(p.moldShape, centro.cx, centro.cy, p.targetWidthMm, p.cornerRadius)], []);
  if (!base.length) return [];

  // Un molde tiene que ser UNA pieza: si la forma elegida saliera en trozos, la
  // cúpula no tendría sobre qué apoyarse. Se queda con la mayor.
  const principal = base.reduce((a, r) =>
    Math.abs(areaDe(r.outer)) > Math.abs(areaDe(a.outer)) ? r : a,
  );
  const outer = principal.outer;
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

  // La TRASERA: la misma plancha sin dibujo. Las dos se abomban en el mismo
  // molde y se juntan por la cara plana: las dos mitades del cuello forman un
  // cuello entero, el tapón entra por él y las deja sujetas. Así el adorno sale
  // cerrado y hueco, que es lo que deja que la luz pase por el calado.
  const rebordeTrasera = prensar(rebordeMalla);
  const trasera = merge(prensar(merge(solid(planchaReg, 0, grosor), cuelloTrasera)), rebordeTrasera);

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
    });
  }
  if (p.formBack && trasera.positions.length) {
    piezas.push({
      id: 'sheet-back',
      label: 'Plancha trasera',
      role: 'icing',
      mesh: trasera,
      plate: placa,
      overlay: rebordeTrasera.positions.length ? rebordeTrasera : undefined,
      overlayParts: rebordeTrasera.positions.length ? [rebordeTrasera] : undefined,
      dome: domoVisor,
    });
  }

  // El tapón: solo tiene sentido si hay dos mitades que unir.
  if (p.formBack) {
    const t = tuerca(rCuello, Math.max(3, p.neckLength), p.capClearance, p.ringOuter, p.ringInner);
    piezas.push({ id: 'cap', label: 'Tuerca (cierra por arriba)', role: 'body', mesh: t, noMark: true });
    piezas.push({
      id: 'clip',
      label: 'Pinza (cierra por abajo)',
      role: 'body',
      mesh: pinza(grosor, reborde),
      noMark: true,
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

  if (hembra.positions.length) {
    piezas.push({ id: 'mold-down', label: 'Molde de abajo (cuenco)', role: 'body', mesh: hembra, noMark: true });
  }
  if (macho.positions.length) {
    piezas.push({ id: 'mold-up', label: 'Molde de arriba (cúpula, se le da la vuelta)', role: 'body', mesh: macho, noMark: true });
  }
  return piezas;
}

/** Área con signo, para quedarse con el contorno más grande. */
function areaDe(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  }
  return a / 2;
}
