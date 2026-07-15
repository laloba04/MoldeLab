/**
 * Auditoría de la marca de agua grabada en la pieza.
 *
 * Este test define QUÉ tiene que pasar, no CÓMO. La entrada pública es
 * `applyWatermark(pieces, opts)` de src/lib/watermark.ts; da igual cómo esté
 * implementada por dentro mientras cumpla:
 *
 *   emboss  → la marca AÑADE material: la pieza marcada tiene más volumen y
 *             más triángulos que la pieza lisa.
 *   engrave → la marca QUITA material: la pieza marcada tiene MENOS volumen que
 *             la lisa (se ha hundido texto en la base), sin dejar de ser un
 *             sólido válido.
 *
 * En ambos casos la pieza tiene que seguir cerrada (manifold) y con las
 * normales hacia fuera, o no se imprime.
 *
 * Se prueba sobre `relief-plate`, que es una placa con base plana: el caso
 * canónico donde grabar tiene sentido. Un cortador (hueco) no se toca y este
 * test no lo cubre.
 */

import { traceContours } from '../src/lib/contours';
import { dedupe, orient, pointInPolygon, resample, simplify, smooth } from '../src/lib/polygon';
import { cleanupMask, fillEnclosed, pad, type Mask } from '../src/lib/image';
import { boxOf, shiftLoops } from '../src/lib/shapes';
import { buildProduct } from '../src/lib/catalog';
import { applyWatermark, canWatermark } from '../src/lib/watermark';
import { DEFAULTS, type Loop, type Mesh, type Pt, type Silhouette } from '../src/types';

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? '  — ' + extra : ''}`);
}

// --- auditoría de malla (mismas fórmulas que geometry.test.ts) ---------------

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

/** Aristas dirigidas sin gemela en sentido contrario: 0 = sólido cerrado. */
function openEdges(m: Mesh): number {
  const k = (x: number) => Math.round(x * 1e4) / 1e4;
  const vkey = (i: number) => `${k(m.positions[i])},${k(m.positions[i + 1])},${k(m.positions[i + 2])}`;
  const edges = new Map<string, number>();
  for (let i = 0; i < m.positions.length; i += 9) {
    const v = [vkey(i), vkey(i + 3), vkey(i + 6)];
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      const fwd = `${a}|${b}`;
      const rev = `${b}|${a}`;
      if (edges.get(rev)) edges.set(rev, edges.get(rev)! - 1);
      else edges.set(fwd, (edges.get(fwd) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of edges.values()) open += Math.abs(n);
  return open;
}

function nonFinite(m: Mesh): number {
  return m.positions.filter((v) => !Number.isFinite(v)).length;
}

const tris = (m: Mesh) => m.positions.length / 9;

// --- silueta de prueba: estrella de 5 puntas con agujero ---------------------

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
    if (pts.length >= 3) loops.push({ pts, hole: false });
  }
  for (const l of loops) {
    let d = 0;
    for (const o of loops) if (o !== l && pointInPolygon(l.pts[0], o.pts)) d++;
    l.hole = d % 2 === 1;
    l.pts = orient(l.pts, !l.hole);
  }
  return loops;
}

// --- montaje de la silueta ---------------------------------------------------

const mask = starMask();
const cleaned = cleanupMask(mask, 1);
const mm = 70 / mask.w;
let loops = loopsFrom(fillEnclosed(cleaned), mm);
let detail = loopsFrom(cleaned, mm);
const box = boxOf(loops);
loops = shiftLoops(loops, -box.cx, -box.cy);
detail = shiftLoops(detail, -box.cx, -box.cy);
const sil: Silhouette = { loops, detail, widthMm: box.w, heightMm: box.h };

const MARK = 'Barakaldesa Manitas 3D';

console.log('MoldeLab — auditoría de la marca de agua\n');

// La placa con relieve es el caso canónico: base plana sobre la que grabar.
const base = buildProduct(sil, { ...DEFAULTS, product: 'relief-plate' });
check('relief-plate genera al menos una pieza', base.length > 0);

const plate = base[0];
check('la placa admite marca', canWatermark(plate));

const baseVol = signedVolume(plate.mesh);
const baseTris = tris(plate.mesh);
console.log(`placa lisa: ${baseTris | 0} tris, ${baseVol.toFixed(1)} mm³\n`);

// --- EMBOSS: la marca añade material -----------------------------------------

const emb = applyWatermark(base, { text: MARK, mode: 'emboss', depth: 0.6, heightMm: 4 });
const embPiece = emb[0];
const embVol = signedVolume(embPiece.mesh);
const embTris = tris(embPiece.mesh);

console.log(`[emboss] ${embTris | 0} tris, ${embVol.toFixed(1)} mm³`);
check('emboss: sin coordenadas NaN', nonFinite(embPiece.mesh) === 0);
check('emboss: añade triángulos', embTris > baseTris, `${embTris | 0} > ${baseTris | 0}`);
check('emboss: añade volumen (la marca sobresale)', embVol > baseVol + 0.5,
  `${embVol.toFixed(1)} > ${baseVol.toFixed(1)}`);
check('emboss: sigue cerrada', openEdges(embPiece.mesh) === 0, `${openEdges(embPiece.mesh)} aristas abiertas`);
check('emboss: normales hacia fuera', embVol > 0);

// --- ENGRAVE: la marca quita material ----------------------------------------

const eng = applyWatermark(base, { text: MARK, mode: 'engrave', depth: 0.6, heightMm: 4 });
const engPiece = eng[0];
const engVol = signedVolume(engPiece.mesh);

console.log(`\n[engrave] ${tris(engPiece.mesh) | 0} tris, ${engVol.toFixed(1)} mm³`);
check('engrave: sin coordenadas NaN', nonFinite(engPiece.mesh) === 0);
check('engrave: quita volumen (el texto se hunde)', engVol < baseVol - 0.5,
  `${engVol.toFixed(1)} < ${baseVol.toFixed(1)}`);
check('engrave: sigue siendo un sólido válido', engVol > 0 && openEdges(engPiece.mesh) === 0,
  `V=${engVol.toFixed(1)}, ${openEdges(engPiece.mesh)} aristas abiertas`);

// --- la marca vacía no toca nada ---------------------------------------------

const none = applyWatermark(base, { text: '   ', mode: 'emboss', depth: 0.6, heightMm: 4 });
check('marca vacía: la pieza queda idéntica', tris(none[0].mesh) === baseTris);

console.log(failures ? `\n${failures} fallo(s).` : '\nTodo correcto.');
process.exitCode = failures ? 1 : 0;
