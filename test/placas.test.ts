/**
 * El 3MF por placas del termoformado: la carpeta «placas» trae un archivo por
 * placa (planchas, tuerca y pinza, cada molde) y cada uno es un 3MF válido.
 */

import { unzipSync } from 'fflate';
import { buildProduct } from '../src/lib/catalog';
import { armarArchivo, placaDe, placasDe } from '../src/lib/exportar';
import { planBambu } from '../src/lib/bambu';
import { DEFAULTS, type Loop, type Pt } from '../src/types';

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? '  — ' + extra : ''}`);
}

const circ = (n: number, r: number): Pt[] =>
  Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)] as Pt);
const loops: Loop[] = [{ pts: circ(64, 20), hole: false }];
const detalle: Loop[] = [{ pts: [[-12, -4], [12, -4], [12, 4], [-12, 4]] as Pt[], hole: false }];
const piezas = buildProduct(
  { loops, detail: detalle, widthMm: 40, heightMm: 40 },
  { ...DEFAULTS, product: 'thermoform', moldShape: 'circle' },
);

console.log('MoldeLab — 3MF por placas del termoformado\n');

const grupos = placasDe(piezas);
check('hay al menos tres placas (planchas, tuerca y pinza, moldes)', grupos.size >= 3, [...grupos.keys()].join(', '));
check('las planchas van juntas', (grupos.get('planchas')?.length ?? 0) >= 1);
check('la tuerca y la pinza van juntas', (grupos.get('tuerca-y-pinza')?.length ?? 0) >= 1);
check('cada molde va en su placa', [...grupos.keys()].filter((k) => k.startsWith('molde-')).length >= 2);
check('una pieza de otro producto no tiene placa', placaDe('base') === null);

const colores = { bg: '#ffffff', trace: '#000000', text: '#ff0000' };
const base = { formatos: new Set(['3mf' as const]), nombre: 'prueba', porDefecto: 'x', separar: true, colores };

const con = await armarArchivo(piezas, null, { ...base, porPlacas: true });
const sin = await armarArchivo(piezas, null, { ...base, porPlacas: false });
check('sin placas sale un solo 3MF estándar', !!sin && sin.outName === 'prueba.3mf');
check('con placas sale también UN solo .3mf (no un ZIP)', !!con && con.outName === 'prueba.3mf');
if (con && sin) {
  const z = unzipSync(new Uint8Array(await con.blob.arrayBuffer()));
  const zs = unzipSync(new Uint8Array(await sin.blob.arrayBuffer()));
  check('el estándar no lleva ajustes de Bambu (así Bambu lee sus colores)', !Object.keys(zs).some((k) => k.startsWith('Metadata/')));
  const cfg = new TextDecoder().decode(z['Metadata/model_settings.config'] ?? new Uint8Array());
  const modelo = new TextDecoder().decode(z['3D/3dmodel.model'] ?? new Uint8Array());
  const placasXml = cfg.match(/<plate>.*?<\/plate>/g) ?? [];
  check('el de proyecto trae sus placas (una por grupo)', placasXml.length === grupos.size, `${placasXml.length} placas`);
  const nombres = placasXml.map((x) => /plater_name" value="([^"]*)"/.exec(x)?.[1]);
  check('mallas, tuerca y clip, y cada molde', ['Mallas', 'Tuerca y clip', 'Molde de abajo', 'Molde de arriba'].every((n) => nombres.includes(n)), nombres.join(', '));
  const enPlacas = [...cfg.matchAll(/object_id" value="(\d+)"/g)].map((m) => m[1]);
  const items = [...modelo.matchAll(/<item objectid="(\d+)"/g)].map((m) => m[1]);
  check('cada pieza está en una placa, y solo en una', items.length === piezas.length && items.every((id) => enPlacas.filter((x) => x === id).length === 1), `${items.length} piezas`);
  const componentes = [...modelo.matchAll(/component objectid="(\d+)"/g)].map((m) => m[1]);
  const objetos = new Set([...modelo.matchAll(/<object id="(\d+)"/g)].map((m) => m[1]));
  check('cada parte existe como objeto', componentes.every((c) => objetos.has(c)));
  check('cada parte tiene su filamento', [...cfg.matchAll(/<part id/g)].length === componentes.length && /key="extruder" value="\d+"/.test(cfg));
  check('dice que es de Bambu Studio (si no, no lee las placas)', /BambuStudio/.test(modelo));
}

// Las partes: cerradas y bien colocadas en su placa.
const plan = planBambu(grupos, { ...colores, zone: undefined });
let abiertas = 0;
for (const pl of plan.placas)
  for (const o of pl.objetos)
    for (const pt of o.partes) {
      const aristas = new Map<string, number>();
      for (const [a, b, c] of pt.tris)
        for (const [x, y] of [[a, b], [b, c], [c, a]]) {
          const k = x < y ? `${x}|${y}` : `${y}|${x}`;
          aristas.set(k, (aristas.get(k) ?? 0) + (x < y ? 1 : -1));
        }
      for (const n of aristas.values()) if (n !== 0) abiertas++;
    }
check('todas las partes salen cerradas', abiertas === 0, `${abiertas}`);
const fuera = plan.placas.flatMap((pl, k) => pl.objetos.filter((o) => {
  const cx = (k % Math.ceil(Math.sqrt(plan.placas.length))) * 256 * 1.2 + 128;
  return Math.abs(o.x - cx) > 128;
}));
check('cada pieza cae dentro de su placa (cama de 256)', fuera.length === 0, fuera.map((o) => o.nombre).join(', '));
check('los filamentos salen en orden y sin repetir', new Set(plan.filamentos).size === plan.filamentos.length, plan.filamentos.join(' '));
if (failures) {
  console.log(`\n${failures} fallo(s).`);
  process.exitCode = 1;
} else console.log('\nTodo correcto.');
