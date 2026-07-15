/**
 * Test del pipeline geométrico sin navegador.
 *
 * Tres comprobaciones que separan un STL imprimible de uno roto:
 *  1. Manifold: cada arista aparece exactamente dos veces, en sentidos opuestos.
 *  2. Cerrado: la suma de normales por área da (0,0,0).
 *  3. Orientación: el volumen con signo es positivo (normales hacia fuera).
 */

import { traceContours } from '../src/lib/contours';
import { area, dedupe, orient, pointInPolygon, resample, simplify, smooth } from '../src/lib/polygon';
import { buildCutter } from '../src/lib/generators/cutter';
import { stampSolids } from '../src/lib/generators/stamp';
import { buildEjector } from '../src/lib/generators/ejector';
import { fillEnclosed, cleanupMask, pad, type Mask } from '../src/lib/image';
import { DEFAULTS, type Loop, type Mesh, type Pt } from '../src/types';
import { toStl } from '../src/lib/stl';
import { signedArea as signedAreaOf } from '../src/lib/polygon';

// --- utilidades de test ------------------------------------------------------

function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) process.exitCode = 1;
}

/** Volumen con signo: positivo si las normales miran hacia fuera. */
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
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return v;
}

/** Cada arista dirigida debe tener exactamente una gemela en sentido contrario. */
function manifoldReport(m: Mesh) {
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

/** Suma de normales ponderadas por área: ~0 en un sólido cerrado. */
function normalSum(m: Mesh) {
  let x = 0, y = 0, z = 0;
  const p = m.positions;
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    x += uy * vz - uz * vy;
    y += uz * vx - ux * vz;
    z += ux * vy - uy * vx;
  }
  return Math.hypot(x, y, z);
}

function auditMesh(label: string, m: Mesh, expectClosed = true) {
  const tris = m.positions.length / 9;
  const open = manifoldReport(m);
  const vol = signedVolume(m);
  const ns = normalSum(m);

  console.log(`\n[${label}] ${tris} triángulos`);
  check(`${label}: tiene geometría`, tris > 0, `${tris} tris`);
  if (expectClosed) {
    check(`${label}: manifold (sin aristas sueltas)`, open === 0, `${open} aristas abiertas`);
    check(`${label}: normales coherentes`, ns < 1e-3, `|Σn| = ${ns.toExponential(2)}`);
    check(`${label}: normales hacia fuera`, vol > 0, `V = ${vol.toFixed(2)} mm³`);
  }
  return { tris, vol };
}

// --- máscara sintética: una estrella con un agujero ---------------------------

function starMask(w = 220, h = 220): Mask {
  const data = new Uint8Array(w * h);
  const cx = w / 2;
  const cy = h / 2;
  const R = 92;
  const r = 42;

  const inStar = (x: number, y: number) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);
    // 5 puntas: el radio oscila entre r y R.
    const t = (Math.cos(5 * a) + 1) / 2;
    return d < r + (R - r) * t;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hole = Math.hypot(x - cx, y - cy) < 16; // agujero central
      data[y * w + x] = inStar(x, y) && !hole ? 1 : 0;
    }
  }
  return { data, w, h };
}

function loopsFrom(mask: Mask, mmPerPx: number): Loop[] {
  const raw = traceContours(pad(mask, 2));
  const loops: Loop[] = [];

  for (const c of raw) {
    let pts: Pt[] = c.map(([x, y]) => [(x - 2) * mmPerPx, -(y - 2) * mmPerPx]);
    pts = dedupe(pts);
    if (pts.length < 3) continue;
    pts = simplify(pts, DEFAULTS.simplify);
    pts = smooth(pts, DEFAULTS.smooth);
    pts = dedupe(pts);
    pts = resample(pts, 1.2);
    loops.push({ pts, hole: false });
  }

  for (const l of loops) {
    let depth = 0;
    for (const o of loops) {
      if (o !== l && pointInPolygon(l.pts[0], o.pts)) depth++;
    }
    l.hole = depth % 2 === 1;
    l.pts = orient(l.pts, !l.hole);
  }
  return loops;
}

// --- ejecución ---------------------------------------------------------------

function auditSolids(label: string, solids: Mesh[]) {
  console.log(`\n[${label}] ${solids.length} sólido(s)`);
  check(`${label}: tiene sólidos`, solids.length > 0);
  solids.forEach((m, i) => {
    const open = manifoldReport(m);
    const vol = signedVolume(m);
    const ns = normalSum(m);
    check(
      `${label} #${i + 1}: cerrado y hacia fuera`,
      open === 0 && vol > 0 && ns < 1e-3,
      `${(m.positions.length / 9) | 0} tris, ${open} aristas abiertas, V=${vol.toFixed(1)} mm³`,
    );
  });
}

console.log('MoldeLab — auditoría de geometría\n');

const mask = starMask();
const cleaned = cleanupMask(mask, 1);
const solid = fillEnclosed(cleaned);
const mmPerPx = 70 / mask.w;

const loops = loopsFrom(solid, mmPerPx);
const islands = loops.filter((l) => !l.hole);

console.log(`silueta maciza: ${islands.length} isla(s), ${loops.length - islands.length} agujero(s)`);
check('la silueta rellena es una sola isla', islands.length === 1);
check('la isla va en CCW', islands.every((l) => area(l.pts) > 0));

// El agujero solo existe antes de rellenar: ahí es donde vive el relieve.
const detail = loopsFrom(cleaned, mmPerPx);
const dHoles = detail.filter((l) => l.hole);
console.log(`trazo sin rellenar: ${detail.length - dHoles.length} isla(s), ${dHoles.length} agujero(s)`);
check('el trazo conserva el agujero central', dHoles.length === 1);
check('el agujero va en CW', dHoles.every((l) => area(l.pts) > 0 === false || signedAreaOf(l.pts) < 0));

const p = { ...DEFAULTS };

auditMesh('cortador', buildCutter(loops, p));
auditSolids('sello', stampSolids(loops, detail, p));

// El cuerpo del eyector es la única pieza hueca del catálogo: tiene que cerrar
// entera, no vale con que cierren sus partes.
const ej = buildEjector(loops, detail, p, 'silhouette');
const body = ej.find((x) => x.id === 'ejector-body');
check('eyector: hay cuerpo', !!body);
if (body) auditMesh('eyector: cuerpo', body.mesh);

// Un cortador sin filo ni pestaña es un tubo recto: su volumen tiene que ser
// perímetro x pared x altura, con un margen por las esquinas.
const plain = buildCutter(loops, {
  ...p,
  flangeWidth: 0,
  flangeHeight: 0,
  bladeHeight: 0,
  bladeThickness: p.wallThickness,
});
const vol = signedVolume(plain);
let per = 0;
for (const l of loops) {
  for (let i = 0; i < l.pts.length; i++) {
    const a = l.pts[i];
    const b = l.pts[(i + 1) % l.pts.length];
    per += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
}
const expected = per * p.wallThickness * p.cutterHeight;
const err = Math.abs(vol - expected) / expected;
console.log('');
check(
  'cortador recto: volumen = perímetro x pared x altura',
  err < 0.05,
  `real ${vol.toFixed(0)} vs esperado ${expected.toFixed(0)} mm³ (${(err * 100).toFixed(1)}%)`,
);

// Un STL binario pesa 84 bytes de cabecera + 50 por triángulo. Ni uno más.
const stl = toStl(plain);
const tris = plain.positions.length / 9;
check('STL binario: tamaño exacto', stl.size === 84 + tris * 50, `${stl.size} bytes / ${tris} tris`);

console.log(process.exitCode ? '\nHay fallos.' : '\nTodo correcto.');
