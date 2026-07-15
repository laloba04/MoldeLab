/**
 * Auditoría del exportador 3MF.
 *
 * Se genera un 3MF real (cortador + sello), se descomprime y se comprueba:
 *  1. Estructura OPC: las tres entradas obligatorias del paquete.
 *  2. Que los índices de triángulo apunten a vértices que existen.
 *  3. Que la soldadura no pierda triángulos (solo puede quitar degenerados).
 *  4. Que las unidades sean milímetros y haya un objeto por pieza.
 */

import { unzipSync, strFromU8 } from 'fflate';
import { to3mf } from '../src/lib/threemf';
import { traceContours } from '../src/lib/contours';
import { dedupe, orient, pointInPolygon, resample, simplify, smooth } from '../src/lib/polygon';
import { cleanupMask, fillEnclosed, pad, type Mask } from '../src/lib/image';
import { boxOf, shiftLoops } from '../src/lib/shapes';
import { buildProduct } from '../src/lib/catalog';
import { DEFAULTS, type Loop, type Pt, type Silhouette } from '../src/types';

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? '  — ' + extra : ''}`);
}

// --- misma silueta de siempre: estrella con agujero ---------------------------

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

async function main() {
  console.log('MoldeLab — auditoría del 3MF\n');

  const mask = starMask();
  const cleaned = cleanupMask(mask, 1);
  const mm = 70 / mask.w;
  let loops = loopsFrom(fillEnclosed(cleaned), mm);
  let detail = loopsFrom(cleaned, mm);
  const box = boxOf(loops);
  loops = shiftLoops(loops, -box.cx, -box.cy);
  detail = shiftLoops(detail, -box.cx, -box.cy);
  const sil: Silhouette = { loops, detail, widthMm: box.w, heightMm: box.h };

  const pieces = buildProduct(sil, { ...DEFAULTS, product: 'cutter-stamp' });
  check('el producto genera 2 piezas', pieces.length === 2);

  const blob = to3mf(pieces);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const entries = unzipSync(bytes);

  // 1. Estructura OPC
  check('[Content_Types].xml presente', '[Content_Types].xml' in entries);
  check('_rels/.rels presente', '_rels/.rels' in entries);
  check('3D/3dmodel.model presente', '3D/3dmodel.model' in entries);

  const model = strFromU8(entries['3D/3dmodel.model']);

  // 4. Unidades y objetos
  check('unidades en milímetros', model.includes('unit="millimeter"'));
  const objects = model.match(/<object /g)?.length ?? 0;
  check('un objeto por pieza', objects === pieces.length, `${objects} objetos`);
  check('los objetos llevan nombre', model.includes('name="Cortador"') && model.includes('name="Sello"'));

  // 2. y 3. Por cada objeto: índices válidos y conteo de triángulos
  const objRe = /<object id="(\d+)"[^>]*>.*?<vertices>(.*?)<\/vertices><triangles>(.*?)<\/triangles>/gs;
  let m: RegExpExecArray | null;
  let oi = 0;

  while ((m = objRe.exec(model))) {
    const nVerts = m[2].match(/<vertex /g)?.length ?? 0;
    const triIdx = [...m[3].matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)];
    const nTris = triIdx.length;
    const soupTris = pieces[oi].mesh.positions.length / 9;

    let maxIdx = -1;
    let degenerate = 0;
    for (const t of triIdx) {
      const a = +t[1], b = +t[2], c = +t[3];
      maxIdx = Math.max(maxIdx, a, b, c);
      if (a === b || b === c || a === c) degenerate++;
    }

    check(
      `${pieces[oi].label}: todos los índices existen`,
      maxIdx < nVerts,
      `máx ${maxIdx} de ${nVerts} vértices`,
    );
    check(`${pieces[oi].label}: sin triángulos degenerados en el XML`, degenerate === 0);
    check(
      `${pieces[oi].label}: la soldadura conserva los triángulos`,
      nTris <= soupTris && nTris > soupTris * 0.98,
      `${nTris} de ${soupTris} (${((nTris / soupTris) * 100).toFixed(1)}%)`,
    );
    // La gracia de indexar: muchos menos vértices que 3 por triángulo.
    check(
      `${pieces[oi].label}: los vértices se comparten de verdad`,
      nVerts < nTris * 1.2,
      `${nVerts} vértices para ${nTris} tris (soup sería ${nTris * 3})`,
    );
    oi++;
  }

  check('se han auditado todos los objetos', oi === pieces.length);
  console.log(`\ntamaño del 3MF: ${(blob.size / 1024).toFixed(0)} KB`);
  console.log(failures ? `\n${failures} fallo(s).` : '\nTodo correcto.');
  process.exitCode = failures ? 1 : 0;
}

main();
