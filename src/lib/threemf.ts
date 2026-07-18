/**
 * Exportador 3MF.
 *
 * Un 3MF es un ZIP OPC con un XML dentro: el estándar abierto del 3MF
 * Consortium. Frente al STL trae dos cosas que aquí importan de verdad:
 *
 *  - **Unidades.** El STL no dice si mide milímetros o pulgadas; el 3MF sí
 *    (`unit="millimeter"`). Se acabó el cortador de 7 cm importado como 7 m.
 *  - **Varios objetos en un archivo.** Cortador + sello, caja + tapa: entran
 *    como objetos separados en el mismo archivo, y el laminador los recibe ya
 *    nombrados y colocados. No hace falta el ZIP de STLs sueltos.
 *
 * Color en Bambu/Orca: NO se hace con materiales del 3MF estándar (Bambu los
 * ignora). Se hace a su manera:
 *   1. Cada triángulo del relieve lleva `paint_color="8"` (pintado a la ranura
 *      de filamento 2); la placa va sin pintar y usa el filamento 1.
 *   2. `Metadata/project_settings.config` declara los dos filamentos y sus
 *      colores (fondo, trazo): de ahí saca Bambu los colores.
 *   3. `Metadata/model_settings.config` asigna el filamento base 1 a cada pieza.
 * (Formato según wiki de Bambu y análisis de sus 3MF. Ver #18.)
 *
 * Las mallas internas son sopa de triángulos (9 floats por triángulo); el 3MF
 * exige vértices indexados, así que aquí se sueldan: los vértices se cuantizan
 * a 1 µm y se deduplican por clave.
 */

import { zipSync, strToU8 } from 'fflate';
import type { Piece } from '../types';

interface Indexed {
  verts: string[]; // "x y z" ya formateados
  tris: [number, number, number, boolean][]; // a, b, c, esRelieve
}

/** 1 µm de cuantización: por debajo de cualquier impresora y del float32 del STL. */
const q = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Suelda los vértices de la malla y marca cada triángulo como relieve o no.
 * Los triángulos cuyo primer float está en `overlayStart` o más allá son el
 * relieve (el dibujo); como cada pieza se construye siempre como
 * `merge(base, overlay)`, el relieve es justo la cola de `positions`.
 */
function weld(positions: number[], overlayStart: number): Indexed {
  const index = new Map<string, number>();
  const verts: string[] = [];
  const tris: [number, number, number, boolean][] = [];
  const p = positions;

  const idOf = (i: number): number => {
    const key = `${q(p[i])} ${q(p[i + 1])} ${q(p[i + 2])}`;
    let id = index.get(key);
    if (id === undefined) {
      id = verts.length;
      index.set(key, id);
      verts.push(key);
    }
    return id;
  };

  for (let i = 0; i < p.length; i += 9) {
    const a = idOf(i);
    const b = idOf(i + 3);
    const c = idOf(i + 6);
    // Un triángulo que la cuantización ha dejado con dos vértices iguales ya no
    // aporta superficie: fuera.
    if (a !== b && b !== c && a !== c) tris.push([a, b, c, i >= overlayStart]);
  }
  return { verts, tris };
}

const xmlName = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** Normaliza un color a '#RRGGBB' en mayúsculas. */
const hex = (h: string) => `#${h.replace('#', '').toUpperCase().slice(0, 6).padEnd(6, '0')}`;

/**
 * Todas las piezas en UN archivo .3mf. `colors` activa el pintado de Bambu:
 * placa = filamento 1 (fondo), relieve = filamento 2 (trazo).
 */
export function to3mf(pieces: Piece[], colors?: { bg: string; trace: string }): Blob {
  const objects: string[] = [];
  const items: string[] = [];
  const settings: string[] = []; // model_settings.config, por pieza

  pieces.forEach((pc, idx) => {
    const id = idx + 1;
    const overlayStart =
      colors && pc.overlay ? pc.mesh.positions.length - pc.overlay.positions.length : Infinity;
    const { verts, tris } = weld(pc.mesh.positions, overlayStart);

    const vx = verts
      .map((v) => {
        const [x, y, z] = v.split(' ');
        return `<vertex x="${x}" y="${y}" z="${z}"/>`;
      })
      .join('');
    // Relieve pintado a la ranura 2 ("8"); la placa sin pintar usa la 1.
    const tr = tris
      .map(([a, b, c, relieve]) =>
        relieve && colors
          ? `<triangle v1="${a}" v2="${b}" v3="${c}" paint_color="8"/>`
          : `<triangle v1="${a}" v2="${b}" v3="${c}"/>`,
      )
      .join('');

    objects.push(
      `<object id="${id}" type="model" name="${xmlName(pc.label)}"><mesh>` +
        `<vertices>${vx}</vertices><triangles>${tr}</triangles></mesh></object>`,
    );
    items.push(`<item objectid="${id}"/>`);
    settings.push(
      `<object id="${id}"><metadata key="name" value="${xmlName(pc.label)}"/>` +
        `<metadata key="extruder" value="1"/></object>`,
    );
  });

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="es-ES" ` +
    `xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" ` +
    `xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">` +
    `<metadata name="Application">MoldeLab</metadata>` +
    `<resources>${objects.join('')}</resources>` +
    `<build>${items.join('')}</build>` +
    `</model>`;

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
    `<Relationship Target="/3D/3dmodel.model" Id="rel-1" ` +
    `Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    `</Relationships>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
  };

  // Los archivos propios de Bambu: sin ellos el laminador solo lee geometría.
  if (colors) {
    files['Metadata/model_settings.config'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><config>${settings.join('')}</config>`,
    );
    // De aquí saca Bambu los colores (filament_colour es la fuente autoritativa).
    // Dos filamentos: 1 = fondo, 2 = trazo. PLA genérico ("GFL99").
    files['Metadata/project_settings.config'] = strToU8(
      JSON.stringify({
        filament_colour: [hex(colors.bg), hex(colors.trace)],
        filament_type: ['PLA', 'PLA'],
        filament_ids: ['GFL99', 'GFL99'],
        filament_settings_id: ['Generic PLA', 'Generic PLA'],
        filament_density: ['1.24', '1.24'],
        filament_diameter: ['1.75', '1.75'],
        nozzle_diameter: ['0.4'],
        version: '01.09.00.00',
      }),
    );
  }

  // El XML comprime de maravilla; aquí sí merece la pena el nivel 6.
  const zip = zipSync(files, { level: 6 });

  return new Blob([zip.buffer as ArrayBuffer], {
    type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
  });
}
