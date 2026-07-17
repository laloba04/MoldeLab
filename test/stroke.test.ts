/**
 * Auditoría del "engrosar trazo" (strokeWidth).
 *
 * Es la perilla que un generador SVG paramétrico llama "engrossar linhas":
 * engorda las líneas del dibujo antes de levantarlas en relieve. Aquí se
 * comprueba el comportamiento, no la implementación:
 *
 *   strokeWidth > 0  →  el relieve ocupa MÁS volumen (líneas más gordas).
 *   strokeWidth < 0  →  MENOS volumen (líneas más finas).
 *   strokeWidth = 0  →  igual que antes de existir la perilla.
 *
 * Y en los tres casos la placa sigue siendo un sólido válido.
 */

import { traceContours } from '../src/lib/contours';
import { dedupe, orient, pointInPolygon, resample, simplify, smooth } from '../src/lib/polygon';
import { cleanupMask, fillEnclosed, pad, type Mask } from '../src/lib/image';
import { boxOf, shiftLoops } from '../src/lib/shapes';
import { buildProduct } from '../src/lib/catalog';
import { DEFAULTS, type Loop, type Mesh, type Pt, type Silhouette } from '../src/types';

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
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}
function openEdges(m: Mesh): number {
  const k = (x: number) => Math.round(x * 1e4) / 1e4;
  const vk = (i: number) => `${k(m.positions[i])},${k(m.positions[i + 1])},${k(m.positions[i + 2])}`;
  const e = new Map<string, number>();
  for (let i = 0; i < m.positions.length; i += 9) {
    const v = [vk(i), vk(i + 3), vk(i + 6)];
    for (let j = 0; j < 3; j++) {
      const a = v[j], b = v[(j + 1) % 3];
      if (e.get(`${b}|${a}`)) e.set(`${b}|${a}`, e.get(`${b}|${a}`)! - 1);
      else e.set(`${a}|${b}`, (e.get(`${a}|${b}`) ?? 0) + 1);
    }
  }
  let o = 0;
  for (const n of e.values()) o += Math.abs(n);
  return o;
}
const vol = (pieces: { mesh: Mesh }[]) => pieces.reduce((s, p) => s + signedVolume(p.mesh), 0);

// --- silueta: estrella con agujero (con líneas internas que engordar) --------
function starMask(w = 220, h = 220): Mask {
  const data = new Uint8Array(w * h);
  const cx = w / 2, cy = h / 2, R = 92, r = 42;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      const t = (Math.cos(5 * Math.atan2(dy, dx)) + 1) / 2;
      data[y * w + x] = d < r + (R - r) * t && d > 16 ? 1 : 0;
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

const mask = starMask();
const cleaned = cleanupMask(mask, 1);
const mm = 70 / mask.w;
let loops = loopsFrom(fillEnclosed(cleaned), mm);
let detail = loopsFrom(cleaned, mm);
const box = boxOf(loops);
loops = shiftLoops(loops, -box.cx, -box.cy);
detail = shiftLoops(detail, -box.cx, -box.cy);
const sil: Silhouette = { loops, detail, widthMm: box.w, heightMm: box.h };

console.log('MoldeLab — auditoría de "engrosar trazo"\n');

const make = (strokeWidth: number) =>
  buildProduct(sil, { ...DEFAULTS, product: 'relief-plate', strokeWidth });

const thin = make(-0.4);
const zero = make(0);
const thick = make(0.8);

const vThin = vol(thin);
const vZero = vol(zero);
const vThick = vol(thick);

console.log(`volumen  fino ${vThin.toFixed(0)}  ·  normal ${vZero.toFixed(0)}  ·  grueso ${vThick.toFixed(0)} mm³\n`);

check('engrosar (+) añade volumen al relieve', vThick > vZero + 1,
  `${vThick.toFixed(0)} > ${vZero.toFixed(0)}`);
check('afinar (−) quita volumen al relieve', vThin < vZero - 1,
  `${vThin.toFixed(0)} < ${vZero.toFixed(0)}`);

for (const [name, pieces] of [['fino', thin], ['normal', zero], ['grueso', thick]] as const) {
  const bad = pieces.reduce((n, p) => n + openEdges(p.mesh), 0);
  const negative = pieces.some((p) => signedVolume(p.mesh) <= 0);
  check(`${name}: sólido válido (cerrado, normales fuera)`, bad === 0 && !negative,
    `${bad} aristas abiertas`);
}

console.log(failures ? `\n${failures} fallo(s).` : '\nTodo correcto.');
process.exitCode = failures ? 1 : 0;
