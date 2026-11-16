/**
 * Los ajustes de proyecto de Bambu Studio para la A1 (boquilla 0,4, perfil
 * 0,20 mm Standard y PLA Basic), sacados de los perfiles OFICIALES de Bambu.
 *
 * Sin estos ajustes, Bambu Studio 2.x abre el 3MF de proyecto «solo con la
 * geometría»: no hace caso de las placas. Y no se pueden inventar: lo que
 * faltara lo rellenaría con valores por defecto (un G-code de inicio vacío en
 * una A1 es peligroso). Por eso se usan los perfiles de fábrica, tal cual.
 *
 * Los perfiles son de Bambu (licencia AGPL) y NO se copian en este proyecto: se
 * bajan del repositorio público de Bambu Studio, de la misma versión que tiene
 * el taller, en el momento de descargar. Si no se pueden bajar, quien llama
 * saca el 3MF estándar.
 *
 * Cada perfil hereda de otro (`inherits`) y puede incluir trozos (`include`,
 * los G-code). Aquí se aplana la cadena igual que lo hace Bambu.
 */

export const VERSION_BAMBU = '02.09.01.70';
const RAIZ = `https://raw.githubusercontent.com/bambulab/BambuStudio/v${VERSION_BAMBU}/resources/profiles/BBL`;

export const IMPRESORA = 'Bambu Lab A1 0.4 nozzle';
export const PERFIL = '0.20mm Standard @BBL A1';
export const FILAMENTO = 'Bambu PLA Basic @BBL A1';

type Perfil = Record<string, unknown>;
export type Leer = (tipo: 'machine' | 'process' | 'filament', nombre: string) => Promise<Perfil>;

/** Lo que es del perfil en sí, no un ajuste: no va al proyecto. */
const META = new Set(['type', 'name', 'from', 'inherits', 'instantiation', 'setting_id', 'include', 'description', 'renamed_from', 'version', 'filament_id', 'base_id']);
const esMeta = (k: string) => META.has(k) || k.includes('compatible_');

/** Aplana un perfil con toda su cadena de herencia e inclusiones. */
export async function aplanar(leer: Leer, tipo: 'machine' | 'process' | 'filament', nombre: string, profundidad = 0): Promise<Perfil> {
  if (profundidad > 12) throw new Error(`Cadena de perfiles demasiado larga: ${nombre}`);
  const p = await leer(tipo, nombre);
  let out: Perfil = {};
  if (typeof p.inherits === 'string' && p.inherits) out = await aplanar(leer, tipo, p.inherits, profundidad + 1);
  const inc = Array.isArray(p.include) ? (p.include as string[]) : [];
  for (const i of inc) {
    const trozo = await leer(tipo, i);
    for (const [k, v] of Object.entries(trozo)) if (k !== 'name' && k !== 'instantiation') out[k] = v;
  }
  return { ...out, ...p };
}

/** El `Metadata/project_settings.config`: impresora + perfil + `n` filamentos con sus colores. */
export async function ajustesProyecto(leer: Leer, colores: string[]): Promise<string> {
  const n = Math.max(1, colores.length);
  const [maquina, proceso, filamento] = await Promise.all([
    aplanar(leer, 'machine', IMPRESORA),
    aplanar(leer, 'process', PERFIL),
    aplanar(leer, 'filament', FILAMENTO),
  ]);
  if (!maquina.machine_start_gcode || !maquina.printable_area) throw new Error('El perfil de la impresora ha llegado incompleto.');
  const cfg: Perfil = {};
  for (const [k, v] of Object.entries(maquina)) if (!esMeta(k)) cfg[k] = v;
  for (const [k, v] of Object.entries(proceso)) if (!esMeta(k)) cfg[k] = v;
  // Los del filamento van filamento tras filamento: la lista ENTERA de fábrica
  // repetida n veces (hay ajustes con varios valores por filamento, como las
  // 8 temperaturas de secado; Bambu los lee en bloques).
  const porFilamento = (v: unknown[]) => Array.from({ length: n }, () => v).flat();
  const cadaUno = (v: string) => Array.from({ length: n }, () => v);
  for (const [k, v] of Object.entries(filamento)) {
    if (esMeta(k)) continue;
    cfg[k] = Array.isArray(v) ? porFilamento(v as unknown[]) : v;
  }
  const colores_ = colores.length ? colores : ['#FFFFFF'];
  cfg.filament_colour = colores_;
  cfg.filament_multi_colour = colores_;
  cfg.filament_settings_id = cadaUno(FILAMENTO);
  // Lo que guarda Bambu 2.9 en cada proyecto: sin `filament_self_index` no
  // cuadran los filamentos con las variantes de extrusor y lo da por inválido.
  cfg.filament_self_index = colores_.map((_, i) => String(i + 1));
  cfg.filament_map = cadaUno('1');
  cfg.filament_map_mode = 'Auto For Flush';
  cfg.filament_ids = cadaUno(typeof filamento.filament_id === 'string' ? filamento.filament_id : '');
  cfg.filament_nozzle_map = cadaUno('0');
  cfg.filament_volume_map = cadaUno('0');
  cfg.filament_colour_type = cadaUno('1');
  cfg.default_filament_colour = cadaUno('');
  cfg.filament_diameter_map = cadaUno('0.4');
  cfg.filament_is_mixed = cadaUno('0');
  cfg.nozzle_volume_type = ['Standard'];
  cfg.extruder_nozzle_volume_type = ['Standard'];
  cfg.curr_bed_type = 'Textured PEI Plate';
  // Purgas al cambiar de color (Bambu las recalcula con el botón de purga).
  cfg.flush_volumes_matrix = colores_.flatMap((_, i) => colores_.map((__, j) => (i === j ? '0' : '280')));
  cfg.flush_volumes_vector = Array.from({ length: 2 * n }, () => '140');
  cfg.flush_multiplier = ['1'];
  cfg.printer_settings_id = IMPRESORA;
  cfg.print_settings_id = PERFIL;
  cfg.from = 'project';
  cfg.name = 'project_settings';
  cfg.version = VERSION_BAMBU;
  return JSON.stringify(cfg, null, 4);
}

/** Lector de verdad: del repositorio de Bambu, guardado en memoria. */
const cache = new Map<string, Promise<Perfil>>();
export const leerDeBambu: Leer = (tipo, nombre) => {
  const url = `${RAIZ}/${tipo}/${encodeURIComponent(nombre)}.json`;
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`No se ha podido bajar el perfil ${nombre} (${r.status})`);
      return r.json() as Promise<Perfil>;
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
};
