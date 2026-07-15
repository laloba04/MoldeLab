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

console.log(`\n${totalTris.toLocaleString('es-ES')} triángulos en total`);
console.log(failures ? `\n${failures} fallo(s).` : '\nTodo correcto.');
process.exitCode = failures ? 1 : 0;
