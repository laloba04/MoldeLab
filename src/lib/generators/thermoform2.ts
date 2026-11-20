/**
 * Termoformado 2: dos mallas con BORDE ALTO, como el de las fotos.
 *
 * Cómo funciona:
 *
 *   malla    — una plancha calada, plana, con un borde alto (≈ 4 mm) todo
 *              alrededor. El dibujo va A RAS dentro de la malla, en trozos de
 *              otro color. Las dos mitades se juntan por la cara PLANA; el borde
 *              y la cúpula quedan por fuera.
 *   rosca    — cada mitad lleva media rosca arriba; la tuerca (hexagonal) las
 *              sujeta y cuelga el adorno.
 *   clip     — una pieza en «C» que abraza los dos bordes por fuera y mete un
 *              gancho por la VENTANITA de cada malla: un agujero en la parte de
 *              dentro del borde (como en las fotos), con la pared de fuera
 *              entera. Abajo, y si se pide, a los lados.
 *   molde ↓  — la CAVIDAD, con una ranura alrededor (con holgura) donde entra el
 *              borde alto y muescas para la rosca: la malla caliente se pone
 *              boca abajo, con el borde metido en la ranura.
 *   molde ↑  — la cúpula sobre su base: se le da la vuelta y aprieta la malla
 *              dentro de la cavidad.
 *
 * Nada de booleanas 3D, como en el resto: regiones 2D extruidas y cúpulas que
 * mueven vértices (ver `dome.ts`).
 */

import type { ElementoTermo, Loop, Mesh, Params, Piece, Pt } from '../../types';
import { emptyMesh, merge } from '../mesh';
import { intersectRegions, offsetRegions, sanitize, strokeOpen, subtract, union, type Region } from '../clipper';
import { boxOf, circle, egg, heart, roundedRect, star } from '../shapes';
import { pointInPolygon } from '../polygon';
import { fitDetailToBase, regionsOf } from './catalog-parts';
import { abombar, domeOf, type Dome } from '../dome';
import { FONDO_ROSCA, medioCuelloRoscado } from './rosca';
import { textPaths } from '../font';
import { esFigura, figura, PROPORCION } from '../figuras';
import {
  areaDe,
  bordeArriba,
  calado,
  casiSimetrica,
  corazonRedondo,
  enderezar,
  formaDelAdorno,
  medir,
  sitiosEnBorde,
  solid,
  tuerca,
} from './thermoform';

const auto = (c?: string) => (c && c !== 'auto' ? c : undefined);

const mayor = (rs: Region[]): Pt[] | null =>
  rs.reduce<Pt[] | null>((a, r) => (!a || Math.abs(areaDe(r.outer)) > Math.abs(areaDe(a)) ? r.outer : a), null);

/**
 * Quita las rajas y tiras de grosor cero que salen al restar regiones que se
 * tocan justo en un borde (un texto rozando un agujero de la malla): cerrar y
 * abrir 0,02 mm. No cambia ninguna medida que se note.
 */
function limpiar(rs: Region[]): Region[] {
  if (!rs.length) return rs;
  const o = (x: Region[], d: number) => offsetRegions(x.map((r) => r.outer), x.flatMap((r) => r.holes), d);
  // Cerrar y abrir 0,02 mm: (+d, −d, −d, +d) es lo mismo que (+d, −2d, +d), con
  // un desplazamiento menos (es de lo que más tarda con un dibujo de muchos trozos).
  return o(o(o(rs, 0.02), -0.04), 0.02);
}

/** Regiones a contornos (para las funciones que piden `Loop`). */
const comoLazos = (rs: Region[]): Loop[] =>
  rs.flatMap((r) => [{ pts: r.outer, hole: false }, ...r.holes.map((h) => ({ pts: h, hole: true }))]);

/** Espejo izquierda-derecha alrededor de x = cx, para regiones. */
function espejoRegs(rs: Region[], cx: number): Region[] {
  const e = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [2 * cx - x, y] as Pt).reverse();
  return rs.map((r) => ({ outer: e(r.outer), holes: r.holes.map(e) }));
}

/** Espejo izquierda-derecha de una malla (cambia el orden para seguir mirando fuera). */
function espejoMalla(m: Mesh, cx: number): Mesh {
  const q = m.positions;
  const out = new Array<number>(q.length);
  for (let i = 0; i < q.length; i += 9) {
    for (const [d, o] of [[0, 0], [3, 6], [6, 3]]) {
      out[i + d] = 2 * cx - q[i + o];
      out[i + d + 1] = q[i + o + 1];
      out[i + d + 2] = q[i + o + 2];
    }
  }
  return { positions: out };
}

/** Corazón clásico (la curva de siempre), de ancho `ancho` y su alto natural. */
export function corazonClasico(cx: number, cy: number, ancho: number): Pt[] {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < 720; i++) {
    const t = (i / 720) * Math.PI * 2;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const a = Math.max(10, ancho);
  const crudo = heart(cx, cy, a, (a * (y1 - y0)) / 32, 180);
  // Punta y muesca algo redondeadas (r ≈ 3 % del ancho): una punta afilada no se
  // termoforma ni se imprime bien, y el bloque del molde hacía un pico raro.
  const r = Math.max(1, a * 0.03);
  const o = (x: Region[], d: number) => offsetRegions(x.map((q) => q.outer), x.flatMap((q) => q.holes), d, 'round');
  const suave = mayor(o(o(o(sanitize([crudo], []), r), -2 * r), r));
  return suave ?? crudo;
}

/** Gira unos puntos `grados` alrededor de (cx, cy). */
function girar(pts: Pt[], cx: number, cy: number, grados: number): Pt[] {
  if (!grados) return pts;
  const a = (grados * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c] as Pt);
}

/** La forma de un icono, de lado `lado`, centrada en (x, y). */
function formaIcono(nombre: string, x: number, y: number, lado: number): Pt[] {
  if (esFigura(nombre)) return figura(nombre, x, y, lado, lado * PROPORCION[nombre]);
  if (nombre === 'heart') return corazonRedondo(x, y, lado);
  if (nombre === 'star') return star(x, y, lado, lado * 0.95);
  if (nombre === 'egg') return egg(x, y, lado * 0.78, lado);
  return circle(x, y, lado / 2, 64);
}

/** Dónde corta el contorno una recta desde el centro en la dirección (dx, dy): el corte más lejano. */
function corteEn(outer: Pt[], cx: number, cy: number, dx: number, dy: number): Pt {
  let mejor = 0;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const [x1, y1] = outer[j];
    const [x2, y2] = outer[i];
    const ex = x2 - x1;
    const ey = y2 - y1;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((x1 - cx) * ey - (y1 - cy) * ex) / den;
    const u = ((x1 - cx) * dy - (y1 - cy) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t > mejor) mejor = t;
  }
  return [cx + dx * mejor, cy + dy * mejor];
}

/**
 * Dónde va un clip: el sitio del contorno más cercano al corte en la dirección
 * pedida (abajo, a un lado) en el que el borde es RECTO a lo largo de `largo` mm,
 * con su normal hacia fuera. En una punta (corazón, rombo, escudo) o en un
 * entrante (estrella) el clip, que es recto, no puede abrazar el borde: se
 * corre a un tramo recto cercano y se gira con él.
 */
export function sitioRecto(outer: Pt[], cx: number, cy: number, dir: Pt, largo: number): { pt: Pt; n: Pt } {
  const ideal = corteEn(outer, cx, cy, dir[0], dir[1]);
  // Contorno remuestreado cada 0,25 mm.
  const paso = 0.25;
  const pts: Pt[] = [];
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(l / paso));
    for (let j = 0; j < k; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  const N = pts.length;
  const medio = Math.max(2, Math.round(largo / 2 / paso));
  if (N < 4 * medio) return { pt: ideal, n: dir };
  let mejor: { pt: Pt; n: Pt; nota: number } | null = null;
  for (let i = 0; i < N; i++) {
    const a = pts[(i - medio + N) % N];
    const b = pts[(i + medio) % N];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const l = Math.hypot(tx, ty);
    if (l < largo * 0.9) continue;
    // ¿Recto? Ningún punto del tramo se separa más de 0,3 mm de la cuerda.
    let desv = 0;
    for (let j = -medio; j <= medio && desv <= 0.3; j++) {
      const q = pts[(i + j + N) % N];
      desv = Math.max(desv, Math.abs(((q[0] - a[0]) * ty - (q[1] - a[1]) * tx) / l));
    }
    if (desv > 0.3) continue;
    let n: Pt = [ty / l, -tx / l];
    const c = pts[i];
    if (pointInPolygon([c[0] + n[0] * 0.5, c[1] + n[1] * 0.5], outer)) n = [-n[0], -n[1]];
    const cos = n[0] * dir[0] + n[1] * dir[1];
    if (cos < 0.34) continue; // como mucho ~70° girado
    // Lejos de una punta: ningún otro tramo del contorno a menos de 6 mm (la
    // muesca entra unos 3 mm y el lado de enfrente no puede caer dentro).
    const lejos = medio + Math.round(4 / paso);
    let cerca = false;
    for (let j = lejos; j < N - lejos && !cerca; j += 2) {
      const q = pts[(i + j) % N];
      cerca = Math.hypot(q[0] - c[0], q[1] - c[1]) < 6;
    }
    if (cerca) continue;
    const nota = Math.hypot(c[0] - ideal[0], c[1] - ideal[1]) + 8 * (1 - cos) + Math.abs(c[0] - cx) * 1e-3;
    if (!mejor || nota < mejor.nota) mejor = { pt: c, n, nota };
  }
  return mejor ? { pt: mejor.pt, n: mejor.n } : { pt: ideal, n: dir };
}

/** Rectángulo girado: centro, normal (a lo `ancho`) y tangente (a lo `largo`). */
function rectGirado(c: Pt, n: Pt, ancho: number, largo: number): Pt[] {
  const t: Pt = [-n[1], n[0]];
  const a = ancho / 2;
  const b = largo / 2;
  const q = (s: number, u: number): Pt => [c[0] + n[0] * s + t[0] * u, c[1] + n[1] * s + t[1] * u];
  return [q(-a, -b), q(a, -b), q(a, b), q(-a, b)];
}

/** Lo ancho del clip (a lo largo del borde). */
const ANCHO_CLIP = 5.4;

/**
 * Los ajustes de laminado de cada pieza, como los guarda el kit original en su
 * proyecto de Bambu: van dentro del archivo, objeto a objeto, y Bambu los usa
 * sin tocar nada.
 * - Mallas, si la malla la hace el laminador: sin capas arriba ni abajo y el
 *   relleno en giroide es la propia malla.
 * - Moldes: capas de 0,28 mm y 10 % de relleno (lo que dicen sus etiquetas).
 * - Tuerca y clip: macizos por fuera y con borde de adherencia (son pequeños).
 */
/** Grosor del dibujo de la imagen encima de la plancha (el del kit). */
export const GROSOR_DIBUJO = 0.8;

export function ajustesLaminado(id: string, p: Params): Record<string, string> | undefined {
  if (id === 'sheet' || id === 'sheet-back') {
    if (!p.formLatticeBySlicer) return undefined;
    const d = `${Math.round(p.formSlicerDensity)}%`;
    return {
      top_shell_layers: '0', bottom_shell_layers: '0', wall_loops: '3',
      sparse_infill_pattern: 'gyroid', sparse_infill_density: d, skeleton_infill_density: d, skin_infill_density: d,
      infill_wall_overlap: '45%', sparse_infill_anchor: '1000', sparse_infill_anchor_max: '1000', wall_generator: 'arachne',
    };
  }
  if (id.startsWith('mold-'))
    return {
      layer_height: '0.28', top_shell_layers: '5', bottom_shell_layers: '3', wall_loops: '3',
      sparse_infill_density: '10%', skeleton_infill_density: '10%', skin_infill_density: '10%', wall_generator: 'arachne',
    };
  if (id === 'cap' || id.startsWith('clip'))
    return { top_shell_layers: '4', bottom_shell_layers: '3', brim_type: 'outer_only', brim_object_gap: '0.2', wall_generator: 'arachne' };
  return undefined;
}

export function buildThermoform2(loops: Loop[], detail: Loop[], p: Params, textLoops?: Loop[]): Piece[] {
  return construir(loops, detail, p, textLoops).map((pc) => {
    const a = ajustesLaminado(pc.id, p);
    return a ? { ...pc, ajustesLaminado: a } : pc;
  });
}

function construir(loops: Loop[], detail: Loop[], p: Params, textLoops?: Loop[]): Piece[] {
  if (!(loops.length ? loops : detail).length) return [];

  // --- La forma (igual que el termoformado de siempre) ------------------------
  if (p.moldShape === 'image') {
    const g = enderezar(loops.length ? loops : detail);
    if (g) {
      loops = g(loops);
      detail = g(detail);
    }
  }
  const fuente = loops.length ? loops : detail;
  const centro = boxOf(fuente);
  // El corazón del Termoformado 2 es el CLÁSICO (muesca honda y lados curvos): el
  // redondo del termoformado de siempre (cuadrado + dos círculos) se veía aplastado.
  const base = sanitize(
    [p.moldShape === 'heart' ? corazonClasico(centro.cx, centro.cy, p.targetWidthMm) : formaDelAdorno(p.moldShape, centro.cx, centro.cy, p.targetWidthMm, p.cornerRadius, fuente)],
    [],
  );
  if (!base.length) return [];
  const principal = mayor(base)!;
  const outer = medir(p.formEvenOut === false ? principal : casiSimetrica(principal), p);
  const caja = boxOf([{ pts: outer, hole: false }]);
  const cx = caja.cx;
  const cy = caja.cy;

  // --- Medidas ----------------------------------------------------------------
  const t = Math.max(0.3, p.sheetThickness);
  const rimW = Math.max(1, p.formRimWidth);
  const H = t + Math.max(1, p.formRimHeight); // alto total del borde: el plano donde se juntan
  const D = Math.max(1, p.formHeight); // hondo de cada mitad
  const margenPlano = 2.5; // plano entre el borde y la cúpula: aquí pisa el molde y van las ventanitas
  const tipoPared = p.formProfile ?? 'suave';
  const union_ = p.formJoin ?? 'rosca';
  const conRosca = union_ === 'rosca';
  const conImanes = union_ === 'imanes';

  // La rosca no puede bajar del plano de la cama: su radio por fuera cabe en el borde.
  const rPedido = Math.max(2, (p.formScrewDia ?? 9) / 2 - FONDO_ROSCA);
  const rCuello = rPedido;
  const paso = Math.max(0.5, p.threadPitch ?? 2);

  // El cuello nace de lo alto de la forma; en una muesca (corazón) se rellena.
  const yCuello = bordeArriba(outer, cx) ?? caja.maxY;
  const relleno = sanitize(
    [roundedRect(cx, (yCuello - 1 + caja.maxY) / 2, (rCuello + FONDO_ROSCA + 0.6) * 2, Math.max(1, caja.maxY - yCuello + 1), 0)],
    [],
  );
  const yNace = caja.maxY - Math.min(1.6, rimW);
  const largoCuello = caja.maxY - yNace + Math.max(3, p.neckLength);

  // La orejita para colgar (con clips o imanes no hay rosca de la que colgar).
  const rTab = 4.5;
  const yTab = caja.maxY + rTab;
  const orejaColgar = !conRosca
    ? sanitize(
        [
          circle(cx, yTab, rTab, 48),
          // Llega hasta media orejita, por debajo del agujero: si acabara en el centro del
          // agujero dejaría una raja de grosor cero.
          roundedRect(cx, (yCuello - 1 + yTab - 2.6) / 2, rTab * 2, yTab - 2.6 - yCuello + 1, 0),
        ],
        [[...circle(cx, yTab, 2, 32)].reverse()],
      )
    : [];

  // --- Zonas de la malla -------------------------------------------------------
  const dentro = offsetRegions([outer], [], -rimW); // la plancha, por dentro del borde
  const zonaCupula = mayor(offsetRegions([outer], [], -(rimW + margenPlano))) ?? outer;

  // Clips: abajo siempre que haya clip; a los lados si se pide (con «Clips», siempre).
  const sitiosClip: { pt: Pt; n: Pt; lado: 'abajo' | 'izq' | 'der' }[] = [];
  if (!conImanes) {
    const largoSitio = ANCHO_CLIP + 0.6 + 2; // la muesca y 1 mm de borde recto a cada lado
    sitiosClip.push({ ...sitioRecto(outer, cx, cy, [0, -1], largoSitio), lado: 'abajo' });
    if (p.formSideClips || union_ === 'clips') {
      sitiosClip.push({ ...sitioRecto(outer, cx, cy, [-1, 0], largoSitio), lado: 'izq' });
      sitiosClip.push({ ...sitioRecto(outer, cx, cy, [1, 0], largoSitio), lado: 'der' });
    }
  }
  const holgClip = Math.max(0, p.clipClearance ?? 0.15);
  // El cierre de abajo: en un tramo del borde (la muesca) el borde se rebaja a
  // una cabeza baja. Con las dos mitades juntas por la cara plana, las dos
  // cabezas forman un carril más grueso que las planchas; el clip es una funda
  // con una raja: cada cabeza cabe sola por la raja (se mete de una en una) y,
  // juntas, ya no salen. Nada de ganchos finos que se doblen.
  const rajaClip = 2 * t + 0.4; // por la raja pasan las dos planchas juntas
  const cabeza = Math.min(H, rajaClip - 0.2); // alto de cada cabeza desde la juntura: cabe sola por la raja
  const largoMuesca = ANCHO_CLIP + 0.6;
  const muescas = sitiosClip.length
    ? sanitize(
        sitiosClip.map(({ pt, n }) => {
          const fondo = 2 * rimW + 2;
          return rectGirado(pt, n, fondo, largoMuesca);
        }),
        [],
      )
    : [];

  // Y, por dentro de la cabeza (dejando un puente de 0,3 mm), un agujero en la
  // plancha de lo largo de la muesca, como el kit: por ahí pasa la parte de
  // dentro del clip al meterlo.
  const agujerosClip = sitiosClip.length
    ? sanitize(
        sitiosClip.map(({ pt, n }) => {
          const v0 = rimW + 0.3;
          const fondo = 1.85;
          const c: Pt = [pt[0] - n[0] * (v0 + fondo / 2), pt[1] - n[1] * (v0 + fondo / 2)];
          const largo = largoMuesca + 0.2;
          return rectGirado(c, n, fondo, largo);
        }),
        [],
      )
    : [];

  /**
   * El clip, de perfil (u = de la juntura hacia fuera, v = hacia fuera del
   * borde): una funda que abraza las dos cabezas, con una raja hacia dentro por
   * la que pasan las planchas. Se imprime tumbado.
   */
  const perfilClip = (): Region[] => {
    const e = holgClip;
    const W = 0.95;
    const u1 = cabeza + e; // medio hueco, a lo grueso
    const vIn = -(rimW + W); // fondo del hueco hacia dentro
    const r2 = rajaClip / 2;
    const rect = (u0: number, u1_: number, v0: number, v1: number): Pt[] => [[u0, v0], [u1_, v0], [u1_, v1], [u0, v1]];
    const piezasClip: Pt[][] = [
      rect(-(u1 + W), u1 + W, e, e + W), // por fuera del borde
      rect(u1, u1 + W, vIn - W, e + W), // los dos lados
      rect(-(u1 + W), -u1, vIn - W, e + W),
      rect(r2, u1 + W, vIn - W, vIn), // por dentro, con la raja en medio
      rect(-(u1 + W), -r2, vIn - W, vIn),
    ];
    let r: Region[] = [];
    for (const q of piezasClip) r = r.length ? union(r, sanitize([q], [])) : sanitize([q], []);
    return r;
  };

  // Imanes: en orejitas por fuera del borde, con el bolsillo abierto por la cara
  // plana (por donde se juntan las mitades): cada imán queda frente al suyo.
  const rIman = Math.max(1, (p.formMagnetDia ?? 6) / 2 + (p.formMagnetClear ?? 0.15));
  const rOreja = rIman + 1.2;
  const hondoIman = Math.min(H - 0.6, (p.formMagnetH ?? 2) + (p.formMagnetClear ?? 0.15));
  const sitiosIman = conImanes
    ? sitiosEnBorde(outer, Math.round(p.formMagnets ?? 4), rOreja - 1.6, [cx, caja.maxY], 2 * (rTab + rOreja + 3))
    : [];
  const orejasIman = sitiosIman.length ? sanitize(sitiosIman.map(([x, y]) => circle(x, y, rOreja, 40)), []) : [];

  // --- El dibujo: imagen, nombre y elementos -----------------------------------
  const elementos: ElementoTermo[] = Array.isArray(p.formElements) ? p.formElements : [];
  const dondeDibujo = offsetRegions([zonaCupula], [], -Math.max(0, p.border));
  const juntos = fitDetailToBase(
    [...detail, ...(textLoops ?? [])],
    dondeDibujo.length ? dondeDibujo : sanitize([zonaCupula], []),
    true,
  );
  const dibujo = juntos.slice(0, detail.length);
  const nombre0 = juntos.slice(detail.length);
  const nombre = nombre0.length && (p.formTextOutline ?? 0) > 0 ? comoLazos(regionsOf(nombre0, p.formTextOutline)) : nombre0;

  /** La región de un elemento, en la cúpula `zona` de su cara. */
  const regionDe = (el: ElementoTermo, zona: Pt[]): Region[] => {
    const b = boxOf([{ pts: zona, hole: false }]);
    const ix = b.cx + (el.x / 100) * (b.w / 2);
    const iy = b.cy + (el.y / 100) * (b.h / 2);
    const ancho = (b.w * Math.max(5, el.tam)) / 100;
    let r: Region[] = [];
    if (el.tipo === 'icono') {
      r = sanitize([girar(formaIcono(el.icono, ix, iy, ancho), ix, iy, el.rot)], []);
    } else {
      const tp = textPaths(el.texto || '');
      if (!tp.paths.length || tp.width <= 0) return [];
      const k = ancho / tp.width;
      const paths = tp.paths.map((pts) =>
        // Un giro imperceptible: con la base de todas las letras en la misma recta
        // exacta, el mallador de las tapas (earcut) se lía y deja huecos.
        girar(pts.map(([x, y]) => [ix + (x - tp.width / 2) * k, iy + (y - 0.5) * k] as Pt), ix, iy, el.rot + 0.013),
      );
      r = strokeOpen(paths, k * (el.negrita ? 0.26 : 0.17));
    }
    const limite = offsetRegions([outer], [], -(rimW + 0.6));
    return intersectRegions(r, limite);
  };

  // --- Una cara -----------------------------------------------------------------
  //
  // La trasera es la delantera en espejo (para casar al juntarlas), con su propio
  // dibujo, que va SIN espejar: la trasera se junta dándole media vuelta, y un
  // giro no cambia cómo se lee.
  const cara = (detras: boolean) => {
    const m = (rs: Region[]) => (detras ? espejoRegs(rs, cx) : rs);
    const mp = (pts: Pt[]) => (detras ? espejoRegs([{ outer: pts, holes: [] }], cx)[0].outer : pts);
    const outerS = mp(outer);
    const dentroS = m(dentro);
    const cupulaS = mp(zonaCupula);

    // Trozos de dibujo de esta cara, cada uno con su color y su alto.
    const trozos: { reg: Region[]; alto: number; color?: string; enrejado: boolean; img?: boolean }[] = [];
    if (!detras) {
      const manchas = dibujo.filter((l) => !l.line);
      const lineas = dibujo.filter((l) => l.line);
      const rLineas = lineas.length ? regionsOf(lineas) : [];
      const rManchas = manchas.length ? regionsOf(manchas) : [];
      const h = Math.max(0, p.formDesignHeight ?? 0);
      if (rManchas.length) trozos.push({ reg: intersectRegions(rLineas.length ? subtract(rManchas, rLineas) : rManchas, dentroS), alto: h, enrejado: false, img: true });
      if (rLineas.length) trozos.push({ reg: intersectRegions(rLineas, dentroS), alto: h, enrejado: false, img: true });
    }
    for (const el of elementos.filter((e) => (e.cara === 'detras') === detras)) {
      const reg = regionDe(el, cupulaS);
      if (reg.length) trozos.push({ reg, alto: Math.max(0, el.alto), color: auto(el.color), enrejado: el.enrejado });
    }
    const nombreReg = !detras && nombre.length ? intersectRegions(regionsOf(nombre), dentroS) : [];

    // El calado: por dentro del borde, sin tocar las ventanitas ni lo macizo.
    const macizos = [...trozos.filter((x) => !x.enrejado).flatMap((x) => x.reg), ...nombreReg];
    // Con la malla del laminador no hay calado: nada de esto hace falta (y con un
    // dibujo de muchos trozos era lo más lento de todo).
    const conCalado = !p.formLatticeBySlicer;
    let zonaCalado = conCalado ? offsetRegions(dentroS.map((r) => r.outer), [], -0.8) : [];
    // Con sus huecos: un dibujo de líneas (un osito de contorno) deja malla por
    // dentro; con solo el contorno de fuera, el interior entero salía macizo.
    const engordar = (rs: Region[], d: number) => offsetRegions(rs.map((r) => r.outer), rs.flatMap((r) => r.holes), d);
    if (conCalado && macizos.length) zonaCalado = subtract(zonaCalado, engordar(macizos, Math.max(0.6, p.holeWall)));
    if (conCalado && muescas.length) zonaCalado = subtract(zonaCalado, offsetRegions(m(muescas).map((r) => r.outer), [], 1));
    // El calado mete una celda si su centro cae dentro, así que una esquina puede
    // pisar un texto: se recortan para dejar siempre pared alrededor de lo macizo.
    let agujeros = !conCalado ? [] : calado(p.holePattern, zonaCalado, Math.max(1, p.holeSpacing), Math.max(0.3, p.holeWall));
    const pared = Math.max(0.6, p.holeWall);
    const protegido = !agujeros.length ? [] : [
      ...(macizos.length ? engordar(macizos, pared) : []),
      ...(muescas.length ? offsetRegions(m(muescas).map((r) => r.outer), [], 1) : []),
    ];
    if (agujeros.length && protegido.length) agujeros = limpiar(subtract(agujeros, protegido));
    agujeros = agujeros.length ? limpiar(intersectRegions(agujeros, offsetRegions(dentroS.map((r) => r.outer), [], -pared))) : agujeros;
    let plancha = agujerosClip.length ? limpiar(subtract(dentroS, m(agujerosClip))) : dentroS;
    const llena = plancha;
    if (agujeros.length) plancha = subtract(plancha, agujeros);

    // Cada trozo a ras: el macizo ocupa su sitio entero; el enrejado, solo la malla.
    // El dibujo de la imagen ya sale limpio del vectorizador y solo se recorta
    // por el borde: no hace falta repasarlo (era de lo que más tardaba).
    const regTrozos = trozos.map((x) => {
      const r = intersectRegions(x.reg, x.enrejado ? plancha : llena);
      return x.img ? r : limpiar(r);
    });
    // El dibujo de la imagen va ENCIMA de la plancha entera, como en el kit: a ras
    // (recortado en la plancha) solo se tocaba con la malla por los lados y al
    // despegarlo de la cama medio dibujo se soltaba.
    const ocupado = [...regTrozos.filter((_, i) => !trozos[i].img).flat(), ...nombreReg];
    // El hueco que deja el dibujo encaja justo con él (se ha recortado con esta
    // misma plancha), así que solo hace falta repasarlo si hay calado.
    const cuerpoReg = ocupado.length ? (agujeros.length ? limpiar(subtract(plancha, ocupado)) : subtract(plancha, ocupado)) : plancha;

    // El borde: la mitad de dentro, si se pide, del color de la malla.
    const anillo = subtract(sanitize([outerS], []), offsetRegions([outerS], [], -rimW));
    const medio = offsetRegions([outerS], [], -rimW / 2);
    const bordeFuera = limpiar(p.formRimInnerPlate ? subtract(anillo, medio) : anillo);
    const bordeDentro = limpiar(p.formRimInnerPlate ? intersectRegions(anillo, medio) : []);
    // El borde, rebajado en la muesca del clip a la cabeza baja.
    const mu = muescas.length ? m(muescas) : [];
    const conVentana = (rs: Region[]): Mesh => {
      if (!rs.length) return emptyMesh();
      if (!mu.length) return solid(rs, 0, H);
      const sin = limpiar(subtract(rs, mu));
      const cab = limpiar(intersectRegions(rs, mu));
      return merge(sin.length ? solid(sin, 0, H) : emptyMesh(), cab.length ? solid(cab, 0, cabeza) : emptyMesh());
    };

    // Lo que va con el borde (su color y su alto): relleno de la muesca, orejita de colgar.
    let bordeReg = bordeFuera;
    if (relleno.length) bordeReg = union(bordeReg, subtract(m(relleno), sanitize([outerS], [])));
    if (orejaColgar.length) bordeReg = union(bordeReg, subtract(m(orejaColgar), sanitize([outerS], [])));
    if (orejasIman.length) bordeReg = subtract(bordeReg, m(orejasIman));
    bordeReg = limpiar(subtract(bordeReg, bordeFuera));
    const sitiosS = sitiosIman.map(([x, y]) => (detras ? ([2 * cx - x, y] as Pt) : ([x, y] as Pt)));
    const orejas = sitiosS.length
      ? merge(
          solid(
            sitiosS.map(([x, y]) => ({ outer: circle(x, y, rOreja, 40), holes: [[...circle(x, y, rIman, 40)].reverse()] })),
            0,
            hondoIman,
          ),
          solid(sanitize(sitiosS.map(([x, y]) => circle(x, y, rOreja, 40)), []), hondoIman - 0.01, H),
        )
      : emptyMesh();
    // Media rosca, tumbada sobre la cara plana. La trasera va desfasada media
    // vuelta: al darle la vuelta para juntarlas, la rosca sigue de una a otra.
    const cuello = conRosca ? medioCuelloRoscado(cx, yNace, rCuello, largoCuello, detras ? 0.5 : 0, caja.maxY - yNace, paso) : emptyMesh();

    const cuerpo = merge(solid(cuerpoReg, 0, t), conVentana(bordeDentro));
    const partes: { m: Mesh; color?: string; img?: boolean }[] = [
      { m: merge(conVentana(bordeFuera), bordeReg.length ? solid(bordeReg, 0, H) : emptyMesh(), orejas, cuello), color: auto(p.formColorRim) },
      ...trozos.map((x, i) => ({
        m: x.img ? solid(regTrozos[i], t, t + GROSOR_DIBUJO + x.alto) : solid(regTrozos[i], 0, t + x.alto),
        color: x.color,
        img: x.img,
      })),
    ].filter((x) => x.m.positions.length);
    const textMesh = nombreReg.length ? solid(nombreReg, 0, t + Math.max(0, p.formDesignHeight ?? 0)) : undefined;

    const domo: Dome = domeOf(cupulaS, D, 140, tipoPared);
    return { outerS, dentroS, cupulaS, cuerpo, partes, textMesh, domo, llena };
  };

  const delante = cara(false);
  const detras = p.formBack ? cara(true) : null;

  // --- Montado (visor) -----------------------------------------------------------
  const aparte = caja.w + 30;
  const sube = D + H + 1;
  const montajeMolde = (col: number, fila: number) => [1, 0, 0, aparte * col, 0, 1, 0, -(caja.h + 25) * fila, 0, 0, 1, 0];
  const piezas: Piece[] = [];
  const pieza = (id: string, label: string, c: ReturnType<typeof cara>, montaje: number[]) => {
    const mesh = merge(c.cuerpo, ...c.partes.map((x) => x.m), c.textMesh ?? emptyMesh());
    const overlay = c.partes.length ? merge(...c.partes.map((x) => x.m)) : undefined;
    piezas.push({
      id,
      label,
      role: 'icing',
      mesh,
      tint: auto(p.formColorPlate),
      overlay,
      overlayParts: c.partes.map((x) => x.m),
      partTints: c.partes.map((x) => x.color),
      deImagen: c.partes.map((x) => !!x.img),
      textMesh: c.textMesh,
      dome: c.domo,
      noMark: true,
      montaje,
    });
  };
  const notas = [
    conImanes && sitiosIman.length ? `${sitiosIman.length} imanes de ${p.formMagnetDia}×${p.formMagnetH} mm` : '',
  ].filter(Boolean);
  pieza('sheet', `Malla delantera${notas.length ? ` (${notas.join('; ')})` : ''}`, delante, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, sube]);
  if (detras) pieza('sheet-back', 'Malla trasera', detras, [-1, 0, 0, 2 * cx, 0, 1, 0, 0, 0, 0, -1, sube]);

  // --- Tuerca y clips --------------------------------------------------------------
  const colorCierre = auto(p.formColorNut);
  if (detras && conRosca) {
    const altoTuerca = Math.max(3, p.neckLength);
    const huecoTuerca = Math.max(2, altoTuerca - 0.5);
    piezas.push({
      id: 'cap',
      label: 'Tuerca (cierra arriba y cuelga)',
      role: 'body',
      mesh: tuerca(rCuello, altoTuerca, p.capClearance, p.ringOuter, p.ringInner, paso, true),
      tint: colorCierre,
      noMark: true,
      montaje: [1, 0, 0, cx, 0, 0, 1, yNace + largoCuello - huecoTuerca, 0, -1, 0, sube],
    });
  }
  if (detras && sitiosClip.length) {
    const clip = solid(perfilClip(), 0, ANCHO_CLIP);
    const w2 = ANCHO_CLIP / 2;
    for (const { pt, n, lado } of sitiosClip) {
      // Perfil (u, v) y lo ancho (z) → mundo: u a lo alto desde la juntura, v hacia fuera (n),
      // z a lo largo del borde (t, la normal girada 90°).
      const t: Pt = [-n[1], n[0]];
      const montaje = [0, n[0], t[0], pt[0] - t[0] * w2, 0, n[1], t[1], pt[1] - t[1] * w2, 1, 0, 0, sube];
      piezas.push({
        id: lado === 'abajo' ? 'clip' : `clip-${lado}`,
        label: lado === 'abajo' ? 'Clip de abajo' : `Clip del lado (${lado === 'izq' ? 'izquierda' : 'derecha'})`,
        role: 'body',
        mesh: clip,
        tint: colorCierre,
        noMark: true,
        montaje,
      });
    }
  }

  // --- Moldes ------------------------------------------------------------------------
  if (!p.formMold) return piezas;
  const pared = Math.max(2, p.formWall ?? 6);
  const suelo = Math.max(0.6, p.formFloor ?? 1.1);
  const baseMacho = Math.max(1, p.formMaleBase ?? 3);
  const holgPlancha = Math.max(0, p.formClearance ?? 0.1);
  const holgBorde = Math.max(0, p.formStepClearance ?? 0.2);
  const colorMolde = auto(p.formColorMold);
  const aviso = ' — PETG, capas de 0,28 mm y 10 % de relleno';

  /**
   * El molde de abajo: la cavidad, con la RANURA alrededor donde entra el borde
   * alto (con su holgura) y muescas por donde bajan la rosca, la orejita y los
   * imanes. La malla entra boca abajo, así que se hace en las medidas de la malla
   * y se espeja al final.
   */
  const hembra = (c: ReturnType<typeof cara>, detras_: boolean): Mesh => {
    const m = (rs: Region[]) => (detras_ ? espejoRegs(rs, cx) : rs);
    const bloque = sanitize([mayor(offsetRegions([c.outerS], [], pared)) ?? c.outerS], []);
    const boca = mayor(offsetRegions([c.cupulaS], [], t + holgPlancha)) ?? c.cupulaS;
    const ranura = subtract(offsetRegions([c.outerS], [], holgBorde), offsetRegions([c.outerS], [], -(rimW + holgBorde)));
    const asoma: Region[] = [
      ...(conRosca ? sanitize([roundedRect(cx, yNace + (largoCuello + 1) / 2, (rCuello + FONDO_ROSCA + 0.6) * 2, largoCuello + 1, 0)], []) : []),
      ...relleno,
      ...orejaColgar,
      ...orejasIman,
    ];
    const muescasM = asoma.length ? limpiar(subtract(intersectRegions(offsetRegions(m(asoma).map((r) => r.outer), [], 0.5), bloque), ranura)) : [];
    const hondoRanura = H - t + holgBorde;
    const hondoMuesca = Math.max(H, rCuello + FONDO_ROSCA) - t + 0.4;
    const alto = suelo + Math.max(D + holgPlancha, hondoRanura, muescasM.length ? hondoMuesca : 0);
    const meseta = limpiar(subtract(bloque, muescasM.length ? union(ranura, muescasM) : ranura));
    return espejoMalla(
      merge(
        abombar(solid(meseta, 0, alto), domeOf(boca, D + holgPlancha, 140, tipoPared), 3, { desde: alto, signo: -1 }),
        solid(limpiar(intersectRegions(ranura, bloque)), 0, alto - hondoRanura),
        muescasM.length ? solid(muescasM, 0, alto - hondoMuesca) : emptyMesh(),
      ),
      cx,
    );
  };

  /** El molde de arriba, de pie: la cúpula sobre su base. Se le da la vuelta y aprieta. */
  const macho = (c: ReturnType<typeof cara>): Mesh => {
    const base_ = sanitize([mayor(offsetRegions([c.outerS], [], -0.3)) ?? c.outerS], []);
    return abombar(solid(base_, 0, baseMacho), domeOf(c.cupulaS, D, 140, tipoPared), 3, { desde: baseMacho, signo: 1 });
  };

  const asimetrica = (() => {
    const a = sanitize([outer], []);
    const b = espejoRegs(a, cx);
    const dif = union(subtract(a, b), subtract(b, a));
    const area = Math.abs(areaDe(outer)) || 1;
    return dif.reduce((s, r) => s + Math.abs(areaDe(r.outer)), 0) / area > 0.02;
  })();
  const dos = !!detras && asimetrica && p.formSplitMolds !== false;
  const pareja = (c: ReturnType<typeof cara>, detras_: boolean, sufijo: string, idExtra: string, col: number) => {
    piezas.push({ id: `mold-down${idExtra}`, label: `Molde de abajo (cavidad con ranura para el borde)${sufijo}${aviso}`, role: 'body', mesh: hembra(c, detras_), tint: colorMolde, noMark: true, montaje: montajeMolde(col, 1) });
    piezas.push({ id: `mold-up${idExtra}`, label: `Molde de arriba (cúpula; se le da la vuelta)${sufijo}${aviso}`, role: 'body', mesh: macho(c), tint: colorMolde, noMark: true, montaje: montajeMolde(col, 2) });
  };
  pareja(delante, false, dos ? ' · delantera' : '', '', 0);
  if (dos && detras) pareja(detras, true, ' · trasera', '-back', 1);
  return piezas;
}
