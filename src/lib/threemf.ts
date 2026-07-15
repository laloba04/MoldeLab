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
 * Las mallas internas son sopa de triángulos (9 floats por triángulo); el 3MF
 * exige vértices indexados, así que aquí se sueldan: los vértices se cuantizan
 * a 1 µm y se deduplican por clave. De paso el archivo encoge ~6x, porque cada
 * vértice compartido se escribe una vez en vez de seis.
 */

import { zipSync, strToU8 } from 'fflate';
import type { Mesh, Piece } from '../types';

interface Indexed {
  verts: string[]; // "x y z" ya formateados
  tris: [number, number, number][];
}

/** 1 µm de cuantización: por debajo de cualquier impresora y del float32 del STL. */
const q = (v: number) => Math.round(v * 1000) / 1000;

function weld(mesh: Mesh): Indexed {
  const index = new Map<string, number>();
  const verts: string[] = [];
  const tris: [number, number, number][] = [];
  const p = mesh.positions;

  const idOf = (i: number): number => {
    const x = q(p[i]);
    const y = q(p[i + 1]);
    const z = q(p[i + 2]);
    const key = `${x} ${y} ${z}`;
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
    if (a !== b && b !== c && a !== c) tris.push([a, b, c]);
  }
  return { verts, tris };
}

const xmlName = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * Todas las piezas en UN archivo .3mf, como objetos independientes.
 * El sentido de giro es el mismo que en el STL: CCW visto desde fuera.
 */
export function to3mf(pieces: Piece[]): Blob {
  const objects: string[] = [];
  const items: string[] = [];

  pieces.forEach((pc, i) => {
    const { verts, tris } = weld(pc.mesh);
    const id = i + 1;

    const vx = verts
      .map((v) => {
        const [x, y, z] = v.split(' ');
        return `<vertex x="${x}" y="${y}" z="${z}"/>`;
      })
      .join('');
    const tr = tris.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('');

    objects.push(
      `<object id="${id}" type="model" name="${xmlName(pc.label)}"><mesh>` +
        `<vertices>${vx}</vertices><triangles>${tr}</triangles>` +
        `</mesh></object>`,
    );
    items.push(`<item objectid="${id}"/>`);
  });

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="es-ES" ` +
    `xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Application">MoldeLab</metadata>` +
    `<resources>${objects.join('')}</resources>` +
    `<build>${items.join('')}</build>` +
    `</model>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel-1" ` +
    `Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    `</Relationships>`;

  // El XML comprime de maravilla; aquí sí merece la pena el nivel 6.
  const zip = zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
    },
    { level: 6 },
  );

  return new Blob([zip.buffer as ArrayBuffer], {
    type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
  });
}
