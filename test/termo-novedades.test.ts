/**
 * Ajustes nuevos del termoformado (Novedades): figuras, tamaño por alto o fijo,
 * molde, borde, rosca, pinza y exportar solo planchas o solo moldes.
 */

import { buildProduct } from '../src/lib/catalog';
import { armarArchivo } from '../src/lib/exportar';
import { FIGURAS } from '../src/lib/figuras';
import { DEFAULTS, type Loop, type Mesh, type Params, type Piece, type Pt } from '../src/types';

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? '  — ' + extra : ''}`);
}

function aristasAbiertas(m: Mesh): number {
  const k = (x: number) => Math.round(x * 1e4) / 1e4;
  const vk = (i: number) => `${k(m.positions[i])},${k(m.positions[i + 1])},${k(m.positions[i + 2])}`;
  const edges = new Map<string, number>();
  for (let i = 0; i < m.positions.length; i += 9) {
    const v = [vk(i), vk(i + 3), vk(i + 6)];
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      const rev = `${b}|${a}`;
      if (edges.get(rev)) edges.set(rev, edges.get(rev)! - 1);
      else edges.set(`${a}|${b}`, (edges.get(`${a}|${b}`) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of edges.values()) open += Math.abs(n);
  return open;
}

function caja(m: Mesh) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z1 = -Infinity;
  const q = m.positions;
  for (let i = 0; i < q.length; i += 3) {
    x0 = Math.min(x0, q[i]); x1 = Math.max(x1, q[i]);
    y0 = Math.min(y0, q[i + 1]); y1 = Math.max(y1, q[i + 1]);
    z1 = Math.max(z1, q[i + 2]);
  }
  return { w: x1 - x0, h: y1 - y0, z: z1 };
}

const circ = (n: number, r: number): Pt[] =>
  Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)] as Pt);
const loops: Loop[] = [{ pts: circ(64, 20), hole: false }];
const detalle: Loop[] = [{ pts: [[-12, -4], [12, -4], [12, 4], [-12, 4]] as Pt[], hole: false }];
const sil = { loops, detail: detalle, widthMm: 40, heightMm: 40 };
const hacer = (extra: Partial<Params> = {}): Piece[] =>
  buildProduct(sil, { ...DEFAULTS, product: 'thermoform', moldShape: 'circle', ...extra });
const pieza = (ps: Piece[], id: string) => ps.find((x) => x.id === id);

console.log('MoldeLab — ajustes nuevos del termoformado\n');

for (const f of FIGURAS) {
  const ps = hacer({ moldShape: f });
  const abiertas = ps.reduce((t, x) => t + aristasAbiertas(x.mesh), 0);
  check(`figura ${f}: planchas, tuerca, pinza y moldes, todo cerrado`, ps.length >= 5 && abiertas === 0, `${ps.length} piezas, ${abiertas} aristas abiertas`);
}

// Una placa normal con figura también sale.
const placa = buildProduct(sil, { ...DEFAULTS, product: 'relief-plate', moldShape: 'cloud' });
check('una placa con forma de nube sale', placa.length > 0 && placa[0].mesh.positions.length > 0);

const base = caja(pieza(hacer(), 'sheet')!.mesh);
const porAlto = caja(pieza(hacer({ formSizeBy: 'alto', moldShape: 'cloud', targetWidthMm: 50 }), 'sheet')!.mesh);
check('con «el alto», la plancha mide de alto lo pedido (más el cuello)', porAlto.h >= 50 && porAlto.h < 50 + 15, `${porAlto.h.toFixed(1)} mm`);
const fija = caja(pieza(hacer({ formSizeBy: 'fijo', targetWidthMm: 80, formFixedH: 50 }), 'sheet')!.mesh);
check('con «fijos», 80 de ancho y 50 de alto (más el cuello)', Math.abs(fija.w - 80) < 1 && fija.h >= 50 && fija.h < 65, `${fija.w.toFixed(1)} × ${fija.h.toFixed(1)}`);
check('con «el ancho» no cambia lo de antes', Math.abs(base.w - DEFAULTS.targetWidthMm) < 1, `${base.w.toFixed(1)}`);

const cuenco = caja(pieza(hacer(), 'mold-down')!.mesh);
const cuencoGordo = caja(pieza(hacer({ formWall: 8, formFloor: 6 }), 'mold-down')!.mesh);
check('más pared ensancha el molde de abajo', cuencoGordo.w > cuenco.w + 7, `${cuenco.w.toFixed(1)} → ${cuencoGordo.w.toFixed(1)}`);
check('más suelo lo sube', cuencoGordo.z > cuenco.z + 2.5, `${cuenco.z.toFixed(1)} → ${cuencoGordo.z.toFixed(1)}`);
const macho = caja(pieza(hacer(), 'mold-up')!.mesh);
const machoGordo = caja(pieza(hacer({ formMaleBase: 5 }), 'mold-up')!.mesh);
check('más base sube el molde de arriba', machoGordo.z > macho.z + 2, `${macho.z.toFixed(1)} → ${machoGordo.z.toFixed(1)}`);

const bordeBase = caja(pieza(hacer(), 'sheet')!.overlayParts![0]);
const bordeAlto = caja(pieza(hacer({ formRimHeight: 2 }), 'sheet')!.overlayParts![0]);
check('un borde más alto se nota en la plancha', bordeAlto.z > bordeBase.z + 1.3, `${bordeBase.z.toFixed(2)} → ${bordeAlto.z.toFixed(2)}`);
for (const [n, ov] of [['paso de rosca 3', { threadPitch: 3 }], ['pinza holgada', { clipClearance: 0.6 }], ['borde ancho', { formRimWidth: 5 }], ['sin igualar', { formEvenOut: false }]] as const) {
  const ps = hacer(ov as Partial<Params>);
  const abiertas = ps.reduce((t, x) => t + aristasAbiertas(x.mesh), 0);
  check(`${n}: todo cerrado`, abiertas === 0, `${abiertas}`);
}

// Una forma asimétrica (una media luna hecha de dibujo) da dos parejas; sin «aparte», una.
const luna: Loop[] = [{ pts: [...circ(48, 20).filter(([x]) => x > -5), [-5, 15], [-5, -15]] as Pt[], hole: false }];
const asim = (extra: Partial<Params>) => buildProduct({ loops: luna, detail: luna, widthMm: 25, heightMm: 40 }, { ...DEFAULTS, product: 'thermoform', moldShape: 'image', formEvenOut: false, ...extra });
const moldes = (ps: Piece[]) => ps.filter((x) => x.id.startsWith('mold-')).length;
check('forma asimétrica: dos parejas de moldes', moldes(asim({})) === 4, `${moldes(asim({}))}`);
check('sin «moldes aparte»: una pareja', moldes(asim({ formSplitMolds: false })) === 2, `${moldes(asim({ formSplitMolds: false }))}`);

// Imanes y pinzas laterales.
for (const forma of ['circle', 'heart', 'cloud'] as const) {
  const im = hacer({ formJoin: 'imanes', moldShape: forma });
  const abiertas = im.reduce((t, x) => t + aristasAbiertas(x.mesh), 0);
  const del = pieza(im, 'sheet')!;
  check(`imanes (${forma}): sin pinza de abajo, 4 imanes y todo cerrado`, !pieza(im, 'clip') && /4 imanes/.test(del.label) && abiertas === 0, `${del.label}, ${abiertas} aristas abiertas`);
  const cI = caja(del.mesh), c0 = caja(pieza(hacer({ moldShape: forma }), 'sheet')!.mesh);
  check(`imanes (${forma}): las orejitas asoman por el borde`, cI.w + cI.h > c0.w + c0.h + 3, `${(c0.w + c0.h).toFixed(1)} → ${(cI.w + cI.h).toFixed(1)}`);
}
const placaSin = pieza(hacer({ moldShape: 'heart' }), 'sheet')!.plate!.regions;
const placaCon = pieza(hacer({ moldShape: 'heart', formJoin: 'imanes' }), 'sheet')!.plate!.regions;
check('las orejitas de los imanes van unidas a la plancha (no sueltas)', placaCon.length === placaSin.length, `${placaSin.length} → ${placaCon.length} trozos`);
const lados = hacer({ formSideClips: true });
check('pinzas laterales: abajo + dos lados', ['clip', 'clip-izq', 'clip-der'].every((id) => !!pieza(lados, id)));

const ps = hacer();
const op = { formatos: new Set(['stl' as const]), nombre: 'p', porDefecto: 'x', separar: true, colores: { bg: '#fff', trace: '#000', text: '#f00' } };
const soloMoldes = await armarArchivo(ps, null, { ...op, soloPiezas: 'moldes' });
const soloPlanchas = await armarArchivo(ps, null, { ...op, soloPiezas: 'planchas' });
const { unzipSync } = await import('fflate');
const nombres = async (r: Awaited<ReturnType<typeof armarArchivo>>) =>
  r ? (r.outName.endsWith('.zip') ? Object.keys(unzipSync(new Uint8Array(await r.blob.arrayBuffer()))) : [r.outName]) : [];
const nm = await nombres(soloMoldes);
const np = await nombres(soloPlanchas);
check('«solo moldes» trae solo moldes', nm.length >= 2 && nm.every((n) => n.includes('mold-')), nm.join(', '));
check('«solo planchas» no trae moldes', np.length >= 3 && np.every((n) => !n.includes('mold-')), np.join(', '));

if (failures) {
  console.log(`\n${failures} fallo(s).`);
  process.exitCode = 1;
} else console.log('\nTodo correcto.');
