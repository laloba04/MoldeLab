/**
 * El 3MF por placas del termoformado: la carpeta «placas» trae un archivo por
 * placa (planchas, tuerca y pinza, cada molde) y cada uno es un 3MF válido.
 */

import { unzipSync } from 'fflate';
const strToU8Vacio = new TextEncoder().encode('{}');
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

// Perfiles de mentira (los de verdad se bajan de Bambu al descargar): una
// cadena con herencia e inclusión, como la de Bambu, para probar el aplanado.
const falsos: Record<string, Record<string, unknown>> = {
  'machine/fdm_machine_common': { name: 'fdm_machine_common', printable_height: '250', nozzle_diameter: ['0.4'] },
  'machine/Bambu Lab A1 0.4 nozzle': { name: 'Bambu Lab A1 0.4 nozzle', inherits: 'fdm_machine_common', include: ['Bambu Lab A1 0.4 nozzle template machine_start_gcode'], printable_area: ['0x0', '256x0', '256x256', '0x256'], printable_height: '256', setting_id: 'GM030' },
  'machine/Bambu Lab A1 0.4 nozzle template machine_start_gcode': { name: 'x', machine_start_gcode: 'G28 ; prueba' },
  'process/0.20mm Standard @BBL A1': { name: '0.20mm Standard @BBL A1', layer_height: '0.2', compatible_printers: ['Bambu Lab A1 0.4 nozzle'] },
  'filament/Bambu PLA Basic @BBL A1': { name: 'Bambu PLA Basic @BBL A1', filament_type: ['PLA'], nozzle_temperature: ['220'], filament_id: 'GFA00', filament_dev_ams_drying_temperature: ['45', '45', '45', '45', '55', '55', '45', '45'], filament_extruder_variant: ['Direct Drive Standard'] },
};
const leerFalso = async (t: string, n: string) => {
  const p = falsos[`${t}/${n}`];
  if (!p) throw new Error(`falta ${t}/${n}`);
  return p;
};
const con = await armarArchivo(piezas, null, { ...base, porPlacas: true, leerPerfil: leerFalso });
const sinPerfiles = await armarArchivo(piezas, null, { ...base, porPlacas: true, leerPerfil: async () => { throw new Error('sin red'); } });
if (sinPerfiles) {
  const zz = unzipSync(new Uint8Array(await sinPerfiles.blob.arrayBuffer()));
  check('sin poder bajar los perfiles, sale el 3MF estándar (que sí abre)', !Object.keys(zz).some((k) => k.startsWith('Metadata/')));
}
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
  check('dice la versión del taller (2.9.1.70), no una antigua', /BambuStudio-02\.09\.01\.70/.test(modelo));
  const ajustes = JSON.parse(new TextDecoder().decode(z['Metadata/project_settings.config'] ?? strToU8Vacio));
  check('lleva los ajustes del proyecto con la A1', ajustes.printer_settings_id === 'Bambu Lab A1 0.4 nozzle' && ajustes.print_settings_id === '0.20mm Standard @BBL A1');
  check('con el G-code de inicio y la cama del perfil (aplanando herencia e inclusiones)', ajustes.machine_start_gcode === 'G28 ; prueba' && ajustes.printable_height === '256' && ajustes.nozzle_diameter?.[0] === '0.4');
  const nFil = (cfg.match(/key="extruder" value="(\d+)"/g) ?? []).map((x) => Number(/(\d+)"$/.exec(x)![1])).reduce((a, b) => Math.max(a, b), 0);
  check('un filamento por color, con su color', ajustes.filament_colour.length === nFil && ajustes.filament_settings_id.length === nFil && ajustes.filament_type.length === nFil, `${nFil} filamentos`);
  // Lo que comprueba Bambu al abrir (PresetBundle::load_config_file_config).
  const nCol = ajustes.filament_colour.length;
  check('Bambu: filament_self_index uno por filamento (si no, «Invalid configuration file»)', Array.isArray(ajustes.filament_self_index) && ajustes.filament_self_index.length === nCol && ajustes.filament_self_index.length === ajustes.filament_extruder_variant.length && ajustes.filament_self_index.every((x: string, i: number) => x === String(i + 1)));
  check('Bambu: las listas de varios valores van enteras por filamento', ajustes.filament_dev_ams_drying_temperature.length === 8 * nCol, `${ajustes.filament_dev_ams_drying_temperature.length} valores`);
  check('Bambu: mapa de filamentos, ids y purgas del tamaño justo', ajustes.filament_map.length === nCol && ajustes.filament_ids.every((x: string) => x === 'GFA00') && ajustes.flush_volumes_matrix.length === nCol * nCol);
  check('Bambu: todo son textos o listas de textos', Object.values(ajustes).every((v) => typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))));
  check('sin datos internos del perfil (herencia, ids, compatibles)', !('inherits' in ajustes) && !('setting_id' in ajustes) && !('compatible_printers' in ajustes));
}

// Las partes: cerradas y bien colocadas en su placa.
const plan = planBambu(grupos, { ...colores, zone: undefined });
{
  // Cada trozo de color (borde, enrejado, nombre) encima de su pieza, no desplazado.
  const caja = (verts: string[]) => {
    const xs = verts.map((v) => +v.split(' ')[0]);
    const ys = verts.map((v) => +v.split(' ')[1]);
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  };
  let fuera = 0;
  let conTrozos = 0;
  for (const pl of plan.placas)
    for (const o of pl.objetos) {
      if (o.partes.length < 2) continue;
      conTrozos++;
      const [a0, a1, b0, b1] = caja(o.partes[0].verts);
      for (const pt of o.partes.slice(1)) {
        const [x0, x1, y0, y1] = caja(pt.verts);
        if (x0 < a0 - 0.5 || x1 > a1 + 0.5 || y0 < b0 - 0.5 || y1 > b1 + 0.5) fuera++;
      }
    }
  check('los trozos de color van encima de su pieza (no desplazados en la placa)', conTrozos > 0 && fuera === 0, `${fuera} fuera de ${conTrozos} piezas con trozos`);
}
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
