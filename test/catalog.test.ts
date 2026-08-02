/**
 * Auditoría del catálogo entero.
 *
 * Cada producto se construye con una silueta real (estrella con agujero) y se
 * comprueba que produzca geometría. Un producto que devuelve una malla vacía es
 * un producto roto, aunque la interfaz lo enseñe igual.
 *
 * El manifold no se puede exigir a la pieza completa: sello, llavero y topper
 * son uniones de sólidos que se solapan a propósito (placa + relieve + anilla),
 * y el laminador los funde. Lo que sí se exige es que el volumen salga positivo
 * y que las normales miren hacia fuera: eso sí lo rompe una orientación mal
 * puesta, y no se ve en pantalla hasta que la impresión sale del revés.
 */

import { traceContours } from '../src/lib/contours';
import { dedupe, orient, pointInPolygon, resample, simplify, smooth } from '../src/lib/polygon';
import { cleanupMask, fillEnclosed, pad, type Mask } from '../src/lib/image';
import { boxOf, shiftLoops } from '../src/lib/shapes';
import { PRODUCTS, buildProduct } from '../src/lib/catalog';
import { toStl } from '../src/lib/stl';
import { dropToBed, spreadPieces } from '../src/lib/layout';
import { stampBaseRegions, stampParts, stampRimRegions } from '../src/lib/generators/stamp';
import { expandLoops } from '../src/lib/generators/catalog-parts';
import { offsetRegions, subtract } from '../src/lib/clipper';
import { DEFAULTS, type Loop, type Mesh, type Pt, type Silhouette } from '../src/types';

const circleOf = (cx: number, cy: number, r: number): Pt[] =>
  Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Pt;
  });
const boxOfPts = (cx: number, cy: number, w: number, h: number): Pt[] => [
  [cx - w / 2, cy - h / 2],
  [cx + w / 2, cy - h / 2],
  [cx + w / 2, cy + h / 2],
  [cx - w / 2, cy + h / 2],
];

/**
 * Trozos sueltos de una malla a una altura dada. Rejilla fina y vecinos solo
 * pegados: si sale 1, la pieza es un sólido conectado de verdad y se imprime de
 * una vez, sin trozos que se caigan.
 */
function trozosA(m: Mesh, z: number): number {
  const S = 0.3;
  const on = new Set<string>();
  const pos = m.positions;
  for (let i = 0; i < pos.length; i += 9) {
    const v = [
      [pos[i], pos[i + 1], pos[i + 2]],
      [pos[i + 3], pos[i + 4], pos[i + 5]],
      [pos[i + 6], pos[i + 7], pos[i + 8]],
    ];
    const cr: Pt[] = [];
    for (let k = 0; k < 3; k++) {
      const a = v[k];
      const b = v[(k + 1) % 3];
      if ((a[2] - z) * (b[2] - z) < 0) {
        const t = (z - a[2]) / (b[2] - a[2]);
        cr.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    if (cr.length !== 2) continue;
    const n = Math.max(2, Math.ceil(Math.hypot(cr[1][0] - cr[0][0], cr[1][1] - cr[0][1]) / (S / 2)));
    for (let k = 0; k <= n; k++) {
      const x = cr[0][0] + ((cr[1][0] - cr[0][0]) * k) / n;
      const y = cr[0][1] + ((cr[1][1] - cr[0][1]) * k) / n;
      on.add(`${Math.round(x / S)},${Math.round(y / S)}`);
    }
  }
  const seen = new Set<string>();
  let islas = 0;
  for (const start of on) {
    if (seen.has(start)) continue;
    islas++;
    const st = [start];
    while (st.length) {
      const key = st.pop()!;
      if (seen.has(key) || !on.has(key)) continue;
      seen.add(key);
      const [x, y] = key.split(',').map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]])
        st.push(`${x + dx},${y + dy}`);
    }
  }
  return islas;
}

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? '  — ' + extra : ''}`);
}

function signedVolume(m: Mesh): number {
  let v = 0;
  const p = m.positions;
  for (let i = 0; i < p.length; i += 9) {
    const a = [p[i], p[i + 1], p[i + 2]];
    const b = [p[i + 3], p[i + 4], p[i + 5]];
    const c = [p[i + 6], p[i + 7], p[i + 8]];
    v +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

function degenerate(m: Mesh): number {
  let bad = 0;
  const p = m.positions;
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) < 1e-9) bad++;
  }
  return bad;
}

function nonFinite(m: Mesh): number {
  return m.positions.filter((v) => !Number.isFinite(v)).length;
}

// --- silueta de prueba: estrella de 5 puntas con un agujero central ----------

function starMask(w = 220, h = 220): Mask {
  const data = new Uint8Array(w * h);
  const cx = w / 2, cy = h / 2, R = 92, r = 42;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      const t = (Math.cos(5 * Math.atan2(dy, dx)) + 1) / 2;
      data[y * w + x] = d < r + (R - r) * t && d > 16 ? 1 : 0;
    }
  }
  return { data, w, h };
}

function loopsFrom(mask: Mask, mm: number): Loop[] {
  const loops: Loop[] = [];
  for (const c of traceContours(pad(mask, 2))) {
    let pts: Pt[] = c.map(([x, y]) => [(x - 2) * mm, -(y - 2) * mm]);
    pts = dedupe(pts);
    if (pts.length < 3) continue;
    pts = resample(dedupe(smooth(simplify(pts, DEFAULTS.simplify), DEFAULTS.smooth)), 1.2);
    if (pts.length < 3) continue;
    loops.push({ pts, hole: false });
  }
  for (const l of loops) {
    let d = 0;
    for (const o of loops) if (o !== l && pointInPolygon(l.pts[0], o.pts)) d++;
    l.hole = d % 2 === 1;
    l.pts = orient(l.pts, !l.hole);
  }
  return loops;
}

const mask = starMask();
const cleaned = cleanupMask(mask, 1);
const mm = 70 / mask.w;

let loops = loopsFrom(fillEnclosed(cleaned), mm);
let detail = loopsFrom(cleaned, mm);
const box = boxOf(loops);
loops = shiftLoops(loops, -box.cx, -box.cy);
detail = shiftLoops(detail, -box.cx, -box.cy);

const sil: Silhouette = { loops, detail, widthMm: box.w, heightMm: box.h };

console.log(`MoldeLab — auditoría del catálogo (${PRODUCTS.length} productos)\n`);
console.log(`silueta: ${loops.filter((l) => !l.hole).length} isla, ` +
  `${loops.filter((l) => l.hole).length} agujero, ${box.w.toFixed(0)}x${box.h.toFixed(0)} mm\n`);

let totalTris = 0;

for (const prod of PRODUCTS) {
  const p = { ...DEFAULTS, product: prod.id };
  let pieces;
  try {
    pieces = buildProduct(sil, p);
  } catch (e) {
    check(`${prod.label}`, false, `excepción: ${(e as Error).message}`);
    continue;
  }

  if (!pieces.length) {
    check(`${prod.label}`, false, 'no ha generado ninguna pieza');
    continue;
  }

  let ok = true;
  const notes: string[] = [];

  for (const pc of pieces) {
    const tris = pc.mesh.positions.length / 9;
    const vol = signedVolume(pc.mesh);
    const deg = degenerate(pc.mesh);
    const nan = nonFinite(pc.mesh);
    totalTris += tris;

    if (tris === 0) { ok = false; notes.push(`${pc.label}: vacía`); }
    if (nan > 0) { ok = false; notes.push(`${pc.label}: ${nan} coordenadas NaN`); }
    if (vol <= 0) { ok = false; notes.push(`${pc.label}: volumen ${vol.toFixed(1)} <= 0`); }
    if (deg > tris * 0.02) { ok = false; notes.push(`${pc.label}: ${deg} tris degenerados`); }

    // Y el STL tiene que pesar exactamente lo que debe pesar.
    const stl = toStl(pc.mesh);
    if (stl.size !== 84 + tris * 50) { ok = false; notes.push(`${pc.label}: STL mal dimensionado`); }
  }

  const summary = pieces
    .map((pc) => `${pc.label} ${((pc.mesh.positions.length / 9) | 0)}t`)
    .join(', ');

  check(`${prod.category.padEnd(15)} ${prod.label}`, ok, notes.length ? notes.join('; ') : summary);
}

// Cada producto tiene que declarar controles, o la interfaz sale en blanco.
const noFields = PRODUCTS.filter((p) => p.fields.length === 0);
console.log('');
check('todos los productos declaran controles', noFields.length === 0,
  noFields.map((p) => p.label).join(', '));

const ids = PRODUCTS.map((p) => p.id);
check('no hay ids repetidos', new Set(ids).size === ids.length);


// -----------------------------------------------------------------------------
// Colocación en la cama
// -----------------------------------------------------------------------------
//
// Un 3MF donde una pieza baja del cero (el reborde del sello, el émbolo del
// eyector) hace que el laminador hunda TODO el conjunto hasta que esa pieza
// toca la cama, y las demás se quedan flotando: «voladizo flotante», y la
// impresión sale mal. Aquí se exige que después de colocar, cada pieza se
// apoye en la cama y ninguna baje del cero.

const floorCeil = (m: Mesh) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 2; i < m.positions.length; i += 3) {
    if (m.positions[i] < lo) lo = m.positions[i];
    if (m.positions[i] > hi) hi = m.positions[i];
  }
  return { lo, hi };
};

console.log('');
let flotantes: string[] = [];
let hundidas: string[] = [];
let solapes: string[] = [];

for (const prod of PRODUCTS) {
  const p = { ...DEFAULTS, product: prod.id };
  let pieces;
  try {
    pieces = buildProduct(sil, p);
  } catch {
    continue;
  }
  if (!pieces.length) continue;

  for (const pc of spreadPieces(pieces)) {
    const { lo } = floorCeil(pc.mesh);
    if (Math.abs(lo) > 0.01) flotantes.push(`${prod.id}/${pc.label} a ${lo.toFixed(2)}`);
  }

  const junto = dropToBed(pieces);
  const min = Math.min(...junto.map((pc) => floorCeil(pc.mesh).lo));
  if (min < -0.01) hundidas.push(`${prod.id} a ${min.toFixed(2)}`);

  // Y separadas no se pueden pisar entre ellas.
  const spans = spreadPieces(pieces).map((pc) => {
    let a = Infinity;
    let b = -Infinity;
    for (let i = 0; i < pc.mesh.positions.length; i += 3) {
      if (pc.mesh.positions[i] < a) a = pc.mesh.positions[i];
      if (pc.mesh.positions[i] > b) b = pc.mesh.positions[i];
    }
    return [a, b];
  });
  for (let i = 1; i < spans.length; i++)
    if (spans[i][0] < spans[i - 1][1]) solapes.push(prod.id);
}

check('separadas, cada pieza se apoya en la cama', flotantes.length === 0, flotantes.slice(0, 4).join(', '));
check('juntas, nada baja del cero', hundidas.length === 0, hundidas.slice(0, 4).join(', '));
check('separadas, las piezas no se pisan', solapes.length === 0, [...new Set(solapes)].join(', '));

// -----------------------------------------------------------------------------
// El sello tiene que caber DENTRO del cortador
// -----------------------------------------------------------------------------
//
// La pared del cortador se levanta CENTRADA en la línea de corte, así que la
// cara interior queda a media pared hacia dentro. Si la placa del sello solo
// descuenta una holgura fija, mide más que el hueco y el sello no entra. Se
// comprueba con geometría, no de ojo: la placa no puede salirse del hueco.

console.log('');
{
  const outer = loops.filter((l) => !l.hole).map((l) => l.pts);
  const holes = loops.filter((l) => l.hole).map((l) => l.pts);
  const areaOf = (pts: Pt[]) => {
    let v = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      v += x1 * y2 - x2 * y1;
    }
    return Math.abs(v / 2);
  };
  const totalArea = (rs: { outer: Pt[]; holes: Pt[][] }[]) =>
    rs.reduce((acc, r) => acc + areaOf(r.outer) - r.holes.reduce((h, x) => h + areaOf(x), 0), 0);

  const malos: string[] = [];
  for (const wall of [0.6, 1.2, 3]) {
    for (const fit of [0, 0.4, 1.5]) {
      for (const grow of [0, 2, 6]) {
        const p = { ...DEFAULTS, wallThickness: wall, stampFit: fit, cutterGrow: grow };
        // El cortador se agranda; el sello no. El hueco se mide sobre la
        // silueta ya agrandada, que es la que de verdad corta.
        const cut = expandLoops(loops, grow);
        const hueco = offsetRegions(
          cut.filter((l) => !l.hole).map((l) => l.pts),
          cut.filter((l) => l.hole).map((l) => l.pts),
          -wall / 2,
        );
        const fuera = totalArea(subtract(stampBaseRegions(loops, p), hueco));
        if (fuera > 0.01)
          malos.push(`pared ${wall} / holgura ${fit} / margen ${grow}: ${fuera.toFixed(1)} mm² fuera`);
      }
    }
  }
  check('el sello cabe dentro del cortador', malos.length === 0, malos.join('; '));

  // El relieve tampoco puede sobresalir de la placa. El dibujo se traza sobre
  // el contorno original, pero la placa se encoge hacia dentro; sin recortar,
  // el reborde del dibujo cuelga en el aire y la impresora lo suelta.
  {
    const dentro = (pt: Pt, rs: { outer: Pt[]; holes: Pt[][] }[]) =>
      rs.some((r) => pointInPolygon(pt, r.outer) && !r.holes.some((h) => pointInPolygon(pt, h)));

    const colgando: string[] = [];
    for (const wall of [0.6, 1.2, 3]) {
      for (const fit of [0, 0.4, 1.5]) {
        const p = { ...DEFAULTS, wallThickness: wall, stampFit: fit, handle: false };
        // Un margen de tolerancia: la placa se comprueba engordada 0,02 mm para
        // no cazar los puntos que caen justo encima del borde.
        const placa = offsetRegions(
          stampBaseRegions(loops, p).map((r) => r.outer),
          stampBaseRegions(loops, p).flatMap((r) => r.holes),
          0.02,
        );
        const { overlay } = stampParts(loops, loops, p);
        let fuera = 0;
        for (const m of overlay) {
          for (let i = 0; i < m.positions.length; i += 3) {
            if (!dentro([m.positions[i], m.positions[i + 1]], placa)) fuera++;
          }
        }
        if (fuera) colgando.push(`pared ${wall} / holgura ${fit}: ${fuera} puntos fuera`);
      }
    }
    check(
      'el relieve no sobresale de la placa',
      colgando.length === 0,
      colgando.join('; ') || 'ningún punto del relieve cuelga',
    );
  }

  // Un dibujo con formas sueltas y muy juntas —la cabeza de un muñeco a 2 mm
  // del cuerpo— tiene dos trampas comprobadas a mano:
  //   1. el cortador debe salir de UNA pieza, cosido por una base baja;
  //   2. el reborde del sello NO puede fundir las formas en una plancha, porque
  //      esa plancha taparía el hueco donde van las paredes del cortador.
  {
    const cerca: Loop[] = [
      { pts: circleOf(0, 26, 12), hole: false },
      { pts: boxOfPts(0, -8, 40, 34), hole: false },
    ];
    const pp = { ...DEFAULTS, product: 'cutter-stamp' as const };
    const sil2: Silhouette = { loops: cerca, detail: cerca, widthMm: 40, heightMm: 76 };
    const piezas = buildProduct(sil2, pp);

    const cortadores = piezas.filter((x) => x.role === 'blade');
    check('formas sueltas: el cortador sale de una sola pieza', cortadores.length === 1,
      `${cortadores.length} cortador(es)`);

    const rim = stampRimRegions(cerca, pp);
    check('formas sueltas: el reborde del sello no las funde', rim.length === 2,
      `${rim.length} region(es); deberian ser 2`);

    // Y el sello también tiene que salir de una pieza: sus placas se cosen por
    // el reborde, que es lo único que queda por encima del filo del cortador.
    const sellos = piezas.filter((x) => x.role === 'icing');
    check('formas sueltas: el sello sale de una sola pieza', sellos.length === 1,
      `${sellos.length} sello(s)`);
    const unido = sellos[0] && trozosA(sellos[0].mesh, -0.8) === 1;
    check('formas sueltas: las placas del sello van cosidas', unido,
      sellos[0] ? `${trozosA(sellos[0].mesh, -0.8)} trozo(s) a la altura del reborde` : 'sin sello');

    // Y tiene que aguantar a CUALQUIER tamaño. Al achicar la pieza el hueco se
    // encoge, el reborde deja de caber, y si el puente colgara del reborde el
    // sello se partiría en dos justo al mover el mando de tamaño.
    const rotos: string[] = [];
    for (const mm of [20, 30, 45, 70]) {
      const chico = { ...pp, targetWidthMm: mm };
      const escala = mm / 76;
      const loops2: Loop[] = [
        { pts: circleOf(0, 26 * escala, 12 * escala), hole: false },
        { pts: boxOfPts(0, -8 * escala, 40 * escala, 34 * escala), hole: false },
      ];
      const ps = buildProduct(
        { loops: loops2, detail: loops2, widthMm: 40 * escala, heightMm: 76 * escala },
        chico,
      );
      for (const pc of ps) {
        const z = pc.role === 'blade' ? 0.3 : -0.8;
        const t = trozosA(pc.mesh, z);
        if (t !== 1) rotos.push(`${mm}mm ${pc.label}: ${t} trozos`);
      }
    }
    check('formas sueltas: aguanta a cualquier tamaño', rotos.length === 0, rotos.join('; '));
  }

  // Y agrandar tiene que agrandar de verdad, no quedarse en el comentario.
  const anchoDe = (mm: number) => {
    const e = expandLoops(loops, mm);
    let a = Infinity;
    let b = -Infinity;
    for (const l of e)
      for (const [x] of l.pts) {
        if (x < a) a = x;
        if (x > b) b = x;
      }
    return b - a;
  };
  const crece = anchoDe(2) - anchoDe(0);
  check('agrandar 2 mm ensancha el corte 4 mm (2 por lado)', Math.abs(crece - 4) < 0.3,
    `crece ${crece.toFixed(2)} mm`);
}

console.log(`\n${totalTris.toLocaleString('es-ES')} triángulos en total`);
console.log(failures ? `\n${failures} fallo(s).` : '\nTodo correcto.');
process.exitCode = failures ? 1 : 0;
