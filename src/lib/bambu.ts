/**
 * 3MF de PROYECTO de Bambu Studio, con varias placas.
 *
 * El 3MF estándar no tiene placas: todo cae en la misma. Las placas son cosa de
 * Bambu (y Orca, que viene de él): un archivo `Metadata/model_settings.config`
 * que dice qué objeto va en qué placa y qué filamento lleva cada parte.
 *
 * Por eso aquí el color no va pintado por triángulo (eso es del 3MF estándar,
 * y Bambu lo ignora en sus proyectos): cada trozo de color de una pieza —la
 * malla, el borde, cada dibujo, el nombre— es una PARTE del objeto con su
 * filamento (1, 2, 3…). Los colores reales los pone Bambu según los filamentos
 * cargados; el orden es el de la lista que se devuelve en `filamentos`.
 *
 * Las placas se colocan como las coloca Bambu: en rejilla, cada una a 1,2 veces
 * el ancho de la cama de la siguiente. Cama de 256 mm (X1, P1, A1).
 */

import { zipSync, strToU8 } from 'fflate';
import type { Piece } from '../types';
import { spreadPieces } from './layout';
import { VERSION_BAMBU } from './bambuPerfiles';

const CAMA = 256;
const PASO_PLACA = CAMA * 1.2;

/** El nombre de la placa como lo verá quien imprime. */
function nombrePlaca(g: string): string {
  const fijos: Record<string, string> = { planchas: 'Mallas', 'tuerca-y-pinza': 'Tuerca y clip' };
  if (fijos[g]) return fijos[g];
  const m = /^molde-(abajo|arriba)(-back)?$/.exec(g);
  if (m) return `Molde de ${m[1]}${m[2] ? ' (trasera)' : ''}`;
  return g;
}

const q = (v: number) => Math.round(v * 1000) / 1000;
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const hex = (h: string) => `#${h.replace('#', '').toUpperCase().slice(0, 6).padEnd(6, '0')}`;

export interface ColoresBambu {
  bg: string;
  trace: string;
  text?: string;
  zone?: (pieceId: string, zone: string) => string | undefined;
}

/** Una parte de un objeto: sus triángulos (sopa) y su color. */
interface Parte {
  nombre: string;
  pos: number[];
  color: string;
}

/** Los trozos de color de una pieza, en el orden en que van en su malla. */
export function partesDe(pc: Piece, c: ColoresBambu): Parte[] {
  const total = pc.mesh.positions.length;
  const textLen = pc.textMesh?.positions.length ?? 0;
  const overlays = pc.overlayParts ?? (pc.overlay ? [pc.overlay] : []);
  const overlayLen = overlays.reduce((s, m) => s + m.positions.length, 0);
  const zona = (z: string) => c.zone?.(pc.id, z);
  const partes: Parte[] = [];
  const cuerpo = pc.mesh.positions.slice(0, total - overlayLen - textLen);
  if (cuerpo.length) partes.push({ nombre: pc.label, pos: cuerpo, color: zona('base') ?? pc.tint ?? c.bg });
  overlays.forEach((m, i) => {
    if (m.positions.length) partes.push({ nombre: `${pc.label} · ${i === 0 ? 'borde' : `dibujo ${i}`}`, pos: m.positions, color: zona(`p${i}`) ?? pc.partTints?.[i] ?? c.trace });
  });
  if (textLen && pc.textMesh) partes.push({ nombre: `${pc.label} · nombre`, pos: pc.textMesh.positions, color: zona('name') ?? c.text ?? c.trace });
  return partes;
}

/** Suelda una sopa de triángulos a vértices indexados, ya movida (dx, dy, dz). */
function soldar(pos: number[], dx: number, dy: number, dz: number) {
  const index = new Map<string, number>();
  const verts: string[] = [];
  const tris: [number, number, number][] = [];
  const id = (i: number) => {
    const k = `${q(pos[i] + dx)} ${q(pos[i + 1] + dy)} ${q(pos[i + 2] + dz)}`;
    let n = index.get(k);
    if (n === undefined) {
      n = verts.length;
      index.set(k, n);
      verts.push(k);
    }
    return n;
  };
  for (let i = 0; i < pos.length; i += 9) {
    const a = id(i);
    const b = id(i + 3);
    const cc = id(i + 6);
    if (a !== b && b !== cc && a !== cc) tris.push([a, b, cc]);
  }
  return { verts, tris };
}

export interface PlanBambu {
  /** Colores de los filamentos, en orden (filamento 1, 2…). */
  filamentos: string[];
  placas: {
    nombre: string;
    objetos: {
      id: number;
      nombre: string;
      /** Dónde va en la escena de Bambu (centro de su caja, apoyado en la cama). */
      x: number;
      y: number;
      partes: { id: number; nombre: string; filamento: number; verts: string[]; tris: [number, number, number][] }[];
    }[];
  }[];
}

/** Reparte las piezas en placas y las partes en filamentos. */
export function planBambu(grupos: Map<string, Piece[]>, c: ColoresBambu): PlanBambu {
  const filamentos: string[] = [];
  const filamento = (color: string) => {
    const h = hex(color);
    let i = filamentos.indexOf(h);
    if (i < 0) i = filamentos.push(h) - 1;
    return i + 1;
  };
  const n = grupos.size;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  let siguienteId = 1;
  const placas: PlanBambu['placas'] = [];
  [...grupos.entries()].forEach(([nombre, piezas], k) => {
    const ox = (k % cols) * PASO_PLACA;
    const oy = -Math.floor(k / cols) * PASO_PLACA;
    // En fila, apoyadas, y la fila centrada en su placa.
    const colocadas = spreadPieces(piezas);
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const pc of colocadas) {
      const p = pc.mesh.positions;
      for (let i = 1; i < p.length; i += 3) {
        if (p[i] < y0) y0 = p[i];
        if (p[i] > y1) y1 = p[i];
      }
    }
    const cyFila = Number.isFinite(y0) ? (y0 + y1) / 2 : 0;
    const objetos: PlanBambu['placas'][number]['objetos'] = [];
    for (const pc of colocadas) {
      const partes = partesDe(pc, c);
      // Cada objeto con su origen en el centro de su caja y apoyado en z = 0:
      // así Bambu lo coloca por la transformación del `build`.
      let x0 = Infinity, x1 = -Infinity, yy0 = Infinity, yy1 = -Infinity, z0 = Infinity;
      for (const pt of partes)
        for (let i = 0; i < pt.pos.length; i += 3) {
          x0 = Math.min(x0, pt.pos[i]); x1 = Math.max(x1, pt.pos[i]);
          yy0 = Math.min(yy0, pt.pos[i + 1]); yy1 = Math.max(yy1, pt.pos[i + 1]);
          z0 = Math.min(z0, pt.pos[i + 2]);
        }
      const mx = (x0 + x1) / 2;
      const my = (yy0 + yy1) / 2;
      const objId = siguienteId++;
      objetos.push({
        id: objId,
        nombre: pc.label,
        x: ox + CAMA / 2 + mx,
        y: oy + CAMA / 2 + (my - cyFila),
        partes: partes.map((pt) => ({ id: siguienteId++, nombre: pt.nombre, filamento: filamento(pt.color), ...soldar(pt.pos, -mx, -my, -z0) })),
      });
    }
    placas.push({ nombre, objetos });
  });
  return { filamentos, placas };
}

/** El archivo: un solo .3mf de proyecto con sus placas. */
export function toBambu3mf(grupos: Map<string, Piece[]>, c: ColoresBambu, ajustes?: (filamentos: string[]) => string): Blob {
  const plan = planBambu(grupos, c);
  const recursos: string[] = [];
  const build: string[] = [];
  const config: string[] = [];
  const placasCfg: string[] = [];

  plan.placas.forEach((placa, k) => {
    const instancias: string[] = [];
    for (const o of placa.objetos) {
      for (const pt of o.partes) {
        recursos.push(
          `<object id="${pt.id}" type="model"><mesh><vertices>${pt.verts.map((v) => {
            const [x, y, z] = v.split(' ');
            return `<vertex x="${x}" y="${y}" z="${z}"/>`;
          }).join('')}</vertices><triangles>${pt.tris.map(([a, b, cc]) => `<triangle v1="${a}" v2="${b}" v3="${cc}"/>`).join('')}</triangles></mesh></object>`,
        );
      }
      recursos.push(
        `<object id="${o.id}" type="model"><components>${o.partes.map((pt) => `<component objectid="${pt.id}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`).join('')}</components></object>`,
      );
      build.push(`<item objectid="${o.id}" transform="1 0 0 0 1 0 0 0 1 ${q(o.x)} ${q(o.y)} 0" printable="1"/>`);
      config.push(
        `<object id="${o.id}"><metadata key="name" value="${xml(o.nombre)}"/><metadata key="extruder" value="${o.partes[0]?.filamento ?? 1}"/>` +
          o.partes
            .map(
              (pt) =>
                `<part id="${pt.id}" subtype="normal_part"><metadata key="name" value="${xml(pt.nombre)}"/>` +
                `<metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/><metadata key="extruder" value="${pt.filamento}"/></part>`,
            )
            .join('') +
          `</object>`,
      );
      instancias.push(
        `<model_instance><metadata key="object_id" value="${o.id}"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="${o.id}"/></model_instance>`,
      );
    }
    placasCfg.push(
      `<plate><metadata key="plater_id" value="${k + 1}"/><metadata key="plater_name" value="${xml(nombrePlaca(placa.nombre))}"/><metadata key="locked" value="false"/><metadata key="filament_map_mode" value="Auto For Flush"/>${instancias.join('')}</plate>`,
    );
  });

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="es-ES" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">` +
    `<metadata name="Application">BambuStudio-${VERSION_BAMBU}</metadata>` +
    `<metadata name="BambuStudio:3mfVersion">1</metadata>` +
    `<metadata name="Title">MoldeLab</metadata>` +
    `<resources>${recursos.join('')}</resources><build>${build.join('')}</build></model>`;
  const ajustesXml = `<?xml version="1.0" encoding="UTF-8"?><config>${config.join('')}${placasCfg.join('')}</config>`;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `<Default Extension="config" ContentType="text/xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    `</Relationships>`;
  const zip = zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
      'Metadata/model_settings.config': strToU8(ajustesXml),
      // Como los guarda Bambu: quién y con qué versión.
      'Metadata/slice_info.config': strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><config><header><header_item key="X-BBL-Client-Type" value="slicer"/><header_item key="X-BBL-Client-Version" value="${VERSION_BAMBU}"/></header></config>`,
      ),
      ...(ajustes ? { 'Metadata/project_settings.config': strToU8(ajustes(plan.filamentos)) } : {}),
    },
    { level: 6 },
  );
  return new Blob([zip.buffer as ArrayBuffer], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
}
