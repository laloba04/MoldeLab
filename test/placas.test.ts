/**
 * El 3MF por placas del termoformado: la carpeta «placas» trae un archivo por
 * placa (planchas, tuerca y pinza, cada molde) y cada uno es un 3MF válido.
 */

import { unzipSync } from 'fflate';
import { buildProduct } from '../src/lib/catalog';
import { armarArchivo, placaDe, placasDe } from '../src/lib/exportar';
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
check('sin placas sale un solo 3MF', !!sin && sin.outName === 'prueba.3mf');
check('con placas sale un ZIP', !!con && con.outName === 'prueba.zip');
if (con) {
  const z = unzipSync(new Uint8Array(await con.blob.arrayBuffer()));
  const nombres = Object.keys(z);
  check('el ZIP trae el 3MF con todo', nombres.includes('prueba.3mf'));
  const placas = nombres.filter((n) => n.startsWith('placas/'));
  check('y un 3MF por placa', placas.length === grupos.size, placas.join(', '));
  for (const n of placas) {
    const inner = unzipSync(z[n]);
    const modelo = Object.keys(inner).find((k) => k.endsWith('.model'));
    const xml = modelo ? new TextDecoder().decode(inner[modelo]) : '';
    check(`${n} es un 3MF con objetos`, /<object /.test(xml));
  }
}
if (failures) {
  console.log(`\n${failures} fallo(s).`);
  process.exitCode = 1;
} else console.log('\nTodo correcto.');
