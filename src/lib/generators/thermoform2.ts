/**
 * Termoformado 2: dos mallas con BORDE ALTO que se juntan por el borde.
 *
 * Cómo funciona (y por qué así):
 *
 *   malla    — una plancha calada, plana, con un borde alto (≈ 4 mm) todo
 *              alrededor que mira hacia DENTRO del adorno. Al juntar las dos
 *              mitades, los dos bordes hacen una banda maciza: es lo que da
 *              forma y fuerza al adorno, y donde van la rosca, los clips o los
 *              imanes. El dibujo va A RAS dentro de la malla, como trozos de
 *              otro color: se ve igual por las dos caras.
 *   rosca    — cada mitad lleva media rosca arriba, tumbada en el plano donde
 *              se juntan; la tuerca, enroscada, las sujeta y cuelga el adorno.
 *   clip     — una grapa que abraza la banda por fuera y engancha las dos
 *              mallas por unas ventanitas que llevan junto al borde.
 *   molde ↓  — un bloque con la cavidad (el hueco de la cúpula). La malla
 *              caliente se apoya encima, con el borde hacia arriba.
 *   molde ↑  — se le da la vuelta y aprieta: una cúpula sobre una meseta que
 *              pisa el margen plano, y alrededor una RANURA donde entra el borde
 *              alto, para que no se aplaste ni se tuerza.
 *
 * La cúpula abomba la plancha hacia el lado CONTRARIO al borde: así el borde
 * queda dentro y la cúpula fuera.
 *
 * Nada de booleanas 3D, como en el resto: regiones 2D extruidas y cúpulas que
 * mueven vértices (ver `dome.ts`).
 */

import type { ElementoTermo, Loop, Mesh, Params, Piece, Pt } from '../../types';
import { emptyMesh, merge } from '../mesh';
import { intersectRegions, offsetRegions, sanitize, strokeOpen, subtract, union, type Region } from '../clipper';
import { boxOf, circle, egg, roundedRect, star } from '../shapes';
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
  return o(o(o(o(rs, 0.02), -0.02), -0.02), 0.02);
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

/** Media vuelta alrededor del eje Y que pasa por (cx, ·, h/2): x → 2cx − x, z → h − z. Es un giro: no espeja. */
function girarY(m: Mesh, cx: number, h: number): Mesh {
  const q = m.positions;
  const out = new Array<number>(q.length);
  for (let i = 0; i < q.length; i += 3) {
    out[i] = 2 * cx - q[i];
    out[i + 1] = q[i + 1];
    out[i + 2] = h - q[i + 2];
  }
  return { positions: out };
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
 * El clip, de perfil: una grapa que abraza la banda por fuera y mete dos
 * ganchos por las ventanitas. Se dibuja en el plano (u = a lo ancho de la
 * banda, v = hacia fuera desde el borde) y se imprime tumbado, extruido a lo
 * ancho del clip. Ver la cabecera.
 */
function perfilClip(H: number, t: number, rimW: number, holgura: number): Region[] {
  const a = 1.0; // grosor de las barras del clip
  const e = holgura;
  const vVentana = -(rimW + 1.2);
  const rect = (u0: number, u1: number, v0: number, v1: number): Pt[] => [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
  const piezas: Pt[][] = [
    rect(-(H + e + a), H + e + a, e, e + a), // el lomo, por fuera del borde
    rect(H + e, H + e + a, vVentana - 0.5, e + a), // las dos patas, por fuera de las mallas
    rect(-(H + e + a), -(H + e), vVentana - 0.5, e + a),
    rect(H - t - 0.8, H + e + a, vVentana - 0.5, vVentana + 0.5), // los ganchos, por las ventanitas
    rect(-(H + e + a), -(H - t - 0.8), vVentana - 0.5, vVentana + 0.5),
  ];
  let r: Region[] = [];
  for (const p of piezas) r = r.length ? union(r, sanitize([p], [])) : sanitize([p], []);
  return r;
}

const ANCHO_CLIP = 5;

export function buildThermoform2(loops: Loop[], detail: Loop[], p: Params, textLoops?: Loop[]): Piece[] {
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
  const base = sanitize([formaDelAdorno(p.moldShape, centro.cx, centro.cy, p.targetWidthMm, p.cornerRadius, fuente)], []);
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
  const rCuello = Math.min(rPedido, H - FONDO_ROSCA - 0.05);
  const roscaRecortada = rCuello < rPedido - 1e-6;
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
    sitiosClip.push({ pt: corteEn(outer, cx, cy, 0, -1), n: [0, -1], lado: 'abajo' });
    if (p.formSideClips || union_ === 'clips') {
      sitiosClip.push({ pt: corteEn(outer, cx, cy, -1, 0), n: [-1, 0], lado: 'izq' });
      sitiosClip.push({ pt: corteEn(outer, cx, cy, 1, 0), n: [1, 0], lado: 'der' });
    }
  }
  const holgClip = Math.max(0, p.clipClearance ?? 0.15);
  const ventanas = sitiosClip.length
    ? sanitize(
        sitiosClip.map(({ pt, n }) => {
          const c: Pt = [pt[0] - n[0] * (rimW + 1.2), pt[1] - n[1] * (rimW + 1.2)];
          const largo = ANCHO_CLIP + 2 * holgClip + 0.3;
          return n[0] ? roundedRect(c[0], c[1], 1.6, largo, 0) : roundedRect(c[0], c[1], largo, 1.6, 0);
        }),
        [],
      )
    : [];

  // Imanes: en orejitas por fuera del borde, con el bolsillo abierto por arriba
  // (por donde se juntan las mitades): se imprime sin puentes y el imán se pega.
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
    const trozos: { reg: Region[]; alto: number; color?: string; enrejado: boolean }[] = [];
    if (!detras) {
      const manchas = dibujo.filter((l) => !l.line);
      const lineas = dibujo.filter((l) => l.line);
      const rLineas = lineas.length ? regionsOf(lineas) : [];
      const rManchas = manchas.length ? regionsOf(manchas) : [];
      const h = Math.max(0, p.formDesignHeight ?? 0);
      if (rManchas.length) trozos.push({ reg: intersectRegions(rLineas.length ? subtract(rManchas, rLineas) : rManchas, dentroS), alto: h, enrejado: false });
      if (rLineas.length) trozos.push({ reg: intersectRegions(rLineas, dentroS), alto: h, enrejado: false });
    }
    for (const el of elementos.filter((e) => (e.cara === 'detras') === detras)) {
      const reg = regionDe(el, cupulaS);
      if (reg.length) trozos.push({ reg, alto: Math.max(0, el.alto), color: auto(el.color), enrejado: el.enrejado });
    }
    const nombreReg = !detras && nombre.length ? intersectRegions(regionsOf(nombre), dentroS) : [];

    // El calado: por dentro del borde, sin tocar las ventanitas ni lo macizo.
    const macizos = [...trozos.filter((x) => !x.enrejado).flatMap((x) => x.reg), ...nombreReg];
    let zonaCalado = offsetRegions(dentroS.map((r) => r.outer), [], -0.8);
    if (macizos.length) zonaCalado = subtract(zonaCalado, offsetRegions(macizos.map((r) => r.outer), [], Math.max(0.6, p.holeWall)));
    if (ventanas.length) zonaCalado = subtract(zonaCalado, offsetRegions(m(ventanas).map((r) => r.outer), [], 1));
    // El calado mete una celda si su centro cae dentro, así que una esquina puede
    // pisar un texto: se recortan para dejar siempre pared alrededor de lo macizo.
    let agujeros = p.formLatticeBySlicer ? [] : calado(p.holePattern, zonaCalado, Math.max(1, p.holeSpacing), Math.max(0.3, p.holeWall));
    const pared = Math.max(0.6, p.holeWall);
    const protegido = [
      ...(macizos.length ? offsetRegions(macizos.map((r) => r.outer), [], pared) : []),
      ...(ventanas.length ? offsetRegions(m(ventanas).map((r) => r.outer), [], 1) : []),
    ];
    if (agujeros.length && protegido.length) agujeros = limpiar(subtract(agujeros, protegido));
    agujeros = agujeros.length ? limpiar(intersectRegions(agujeros, offsetRegions(dentroS.map((r) => r.outer), [], -pared))) : agujeros;
    let plancha = dentroS;
    if (ventanas.length) plancha = subtract(plancha, m(ventanas));
    const llena = plancha;
    if (agujeros.length) plancha = subtract(plancha, agujeros);

    // Cada trozo a ras: el macizo ocupa su sitio entero; el enrejado, solo la malla.
    const regTrozos = trozos.map((x) => limpiar(intersectRegions(x.reg, x.enrejado ? plancha : llena)));
    const ocupado = [...regTrozos.flat(), ...nombreReg];
    const cuerpoReg = limpiar(ocupado.length ? subtract(plancha, ocupado) : plancha);

    // El borde: la mitad de dentro, si se pide, del color de la malla.
    const anillo = subtract(sanitize([outerS], []), offsetRegions([outerS], [], -rimW));
    const medio = offsetRegions([outerS], [], -rimW / 2);
    const bordeFuera = p.formRimInnerPlate ? subtract(anillo, medio) : anillo;
    const bordeDentro = p.formRimInnerPlate ? intersectRegions(anillo, medio) : [];

    // Lo que va con el borde (su color y su alto): relleno de la muesca, orejita de colgar.
    let bordeReg = bordeFuera;
    if (relleno.length) bordeReg = union(bordeReg, subtract(m(relleno), sanitize([outerS], [])));
    if (orejaColgar.length) bordeReg = union(bordeReg, subtract(m(orejaColgar), sanitize([outerS], [])));
    if (orejasIman.length) bordeReg = subtract(bordeReg, m(orejasIman));
    const sitiosS = sitiosIman.map(([x, y]) => (detras ? ([2 * cx - x, y] as Pt) : ([x, y] as Pt)));
    const orejas = sitiosS.length
      ? merge(
          solid(sanitize(sitiosS.map(([x, y]) => circle(x, y, rOreja, 40)), []), 0, H - hondoIman),
          solid(
            sitiosS.map(([x, y]) => ({ outer: circle(x, y, rOreja, 40), holes: [[...circle(x, y, rIman, 40)].reverse()] })),
            H - hondoIman - 0.01,
            H,
          ),
        )
      : emptyMesh();
    // Media rosca: girada media vuelta para quedar por debajo del plano donde se juntan.
    const cuello = conRosca
      ? girarY(medioCuelloRoscado(cx, yNace, rCuello, largoCuello, detras ? 0 : 0.5, caja.maxY - yNace, paso), cx, H)
      : emptyMesh();

    const cuerpo = merge(solid(cuerpoReg, 0, t), bordeDentro.length ? solid(bordeDentro, t - 0.01, H) : emptyMesh(), bordeDentro.length ? solid(bordeDentro, 0, t) : emptyMesh());
    const partes: { m: Mesh; color?: string }[] = [
      { m: merge(solid(bordeReg, 0, H), orejas, cuello), color: auto(p.formColorRim) },
      ...trozos.map((x, i) => ({ m: solid(regTrozos[i], 0, t + x.alto), color: x.color })),
    ].filter((x) => x.m.positions.length);
    const textMesh = nombreReg.length ? solid(nombreReg, 0, t + Math.max(0, p.formDesignHeight ?? 0)) : undefined;

    const domo: Dome = { ...domeOf(cupulaS, D, 140, tipoPared), signo: -1 };
    return { outerS, dentroS, cupulaS, cuerpo, partes, textMesh, domo, llena };
  };

  const delante = cara(false);
  const detras = p.formBack ? cara(true) : null;

  // --- Montado (visor) -----------------------------------------------------------
  const aparte = caja.w + 30;
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
      textMesh: c.textMesh,
      dome: c.domo,
      noMark: true,
      montaje,
    });
  };
  const notas = [
    conImanes && sitiosIman.length ? `${sitiosIman.length} imanes de ${p.formMagnetDia}×${p.formMagnetH} mm` : '',
    roscaRecortada ? `rosca de ${((rCuello + FONDO_ROSCA) * 2).toFixed(1)} mm: no cabe más con este borde` : '',
  ].filter(Boolean);
  pieza('sheet', `Malla delantera${notas.length ? ` (${notas.join('; ')})` : ''}`, delante, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  if (detras) pieza('sheet-back', 'Malla trasera', detras, [-1, 0, 0, 2 * cx, 0, 1, 0, 0, 0, 0, -1, 2 * H]);

  // --- Tuerca y clips --------------------------------------------------------------
  const colorCierre = auto(p.formColorNut);
  if (detras && conRosca) {
    const altoTuerca = Math.max(3, p.neckLength);
    const huecoTuerca = Math.max(2, altoTuerca - 0.5);
    piezas.push({
      id: 'cap',
      label: 'Tuerca (cierra arriba y cuelga)',
      role: 'body',
      mesh: tuerca(rCuello, altoTuerca, p.capClearance, p.ringOuter, p.ringInner, paso),
      tint: colorCierre,
      noMark: true,
      montaje: [1, 0, 0, cx, 0, 0, 1, yNace + largoCuello - huecoTuerca, 0, -1, 0, H],
    });
  }
  if (detras && sitiosClip.length) {
    const perfil = perfilClip(H, t, rimW, holgClip);
    const clip = solid(perfil, 0, ANCHO_CLIP);
    for (const { pt, lado } of sitiosClip) {
      const w2 = ANCHO_CLIP / 2;
      const montaje =
        lado === 'abajo'
          ? [0, 0, 1, pt[0] - w2, 0, -1, 0, pt[1], 1, 0, 0, H]
          : lado === 'der'
            ? [0, 1, 0, pt[0], 0, 0, 1, pt[1] - w2, 1, 0, 0, H]
            : [0, -1, 0, pt[0], 0, 0, -1, pt[1] + w2, 1, 0, 0, H];
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

  /** El molde de abajo: bloque con la cavidad. La malla se apoya encima con el borde hacia arriba. */
  const hembra = (c: ReturnType<typeof cara>): Mesh => {
    const bloque = sanitize([mayor(offsetRegions([c.outerS], [], pared)) ?? c.outerS], []);
    const boca = mayor(offsetRegions([c.cupulaS], [], t + holgPlancha)) ?? c.cupulaS;
    const alto = suelo + D + holgPlancha;
    return abombar(solid(bloque, 0, alto), domeOf(boca, D + holgPlancha, 140, tipoPared), 3, { desde: alto, signo: -1 });
  };

  /** El molde de arriba, de pie: base, meseta con la cúpula y la ranura del borde alrededor. */
  const macho = (c: ReturnType<typeof cara>, detras_: boolean): Mesh => {
    const huella = sanitize([mayor(offsetRegions([c.outerS], [], holgBorde + 3)) ?? c.outerS], []);
    const meseta = offsetRegions([c.outerS], [], -(rimW + holgBorde));
    const fueraRanura = offsetRegions([c.outerS], [], holgBorde);
    let pared_ = subtract(huella, fueraRanura);
    // Muescas: por donde asoman la rosca, la orejita, el relleno y las orejitas de los imanes.
    const m = (rs: Region[]) => (detras_ ? espejoRegs(rs, cx) : rs);
    const asoma: Region[] = [
      ...(conRosca ? sanitize([roundedRect(cx, (yNace + yNace + largoCuello + 4) / 2, (rCuello + FONDO_ROSCA + 0.8) * 2, largoCuello + 4, 0)], []) : []),
      ...relleno,
      ...orejaColgar,
      ...orejasIman,
    ];
    if (asoma.length) pared_ = subtract(pared_, offsetRegions(m(asoma).map((r) => r.outer), [], 0.6));
    const zMeseta = baseMacho + (H - t) + holgBorde;
    return merge(
      solid(huella, 0, baseMacho),
      abombar(solid(meseta, baseMacho - 0.01, zMeseta), domeOf(c.cupulaS, D, 140, tipoPared), 3, { desde: zMeseta, signo: 1 }),
      pared_.length ? solid(pared_, baseMacho - 0.01, zMeseta) : emptyMesh(),
    );
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
    piezas.push({ id: `mold-down${idExtra}`, label: `Molde de abajo (cavidad)${sufijo}${aviso}`, role: 'body', mesh: hembra(c), tint: colorMolde, noMark: true, montaje: montajeMolde(col, 1) });
    // De pie se imprime en espejo: al darle la vuelta para apretar, casa con la malla.
    piezas.push({ id: `mold-up${idExtra}`, label: `Molde de arriba (ranura del borde; se le da la vuelta)${sufijo}${aviso}`, role: 'body', mesh: espejoMalla(macho(c, detras_), cx), tint: colorMolde, noMark: true, montaje: montajeMolde(col, 2) });
  };
  pareja(delante, false, dos ? ' · delantera' : '', '', 0);
  if (dos && detras) pareja(detras, true, ' · trasera', '-back', 1);
  return piezas;
}
