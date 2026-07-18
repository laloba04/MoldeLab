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

/** Suelda los vértices de un tramo de `positions` [from, to). */
function weld(positions: number[], from = 0, to = positions.length): Indexed {
  const index = new Map<string, number>();
  const verts: string[] = [];
  const tris: [number, number, number][] = [];
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

  for (let i = from; i < to; i += 9) {
    const a = idOf(i);
    const b = idOf(i + 3);
    const c = idOf(i + 6);
    // Un triángulo que la cuantización ha dejado con dos vértices iguales ya no
    // aporta superficie: fuera.
    if (a !== b && b !== c && a !== c) tris.push([a, b, c]);
  }
  return { verts, tris };
}

/** Un color '#rrggbb' al formato displaycolor del 3MF ('#RRGGBBFF'). */
function displayColor(hex: string): string {
  const h = hex.replace('#', '').toUpperCase();
  return `#${(h.length === 6 ? h : 'CCCCCC') + 'FF'}`;
}

/** Un objeto <mesh> del 3MF a partir de un tramo de posiciones. */
function meshObject(id: number, name: string, positions: number[], from: number, to: number, matAttr: string): string {
  const { verts, tris } = weld(positions, from, to);
  const vx = verts
    .map((v) => {
      const [x, y, z] = v.split(' ');
      return `<vertex x="${x}" y="${y}" z="${z}"/>`;
    })
    .join('');
  const tr = tris.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('');
  return (
    `<object id="${id}" type="model" name="${xmlName(name)}"${matAttr}><mesh>` +
    `<vertices>${vx}</vertices><triangles>${tr}</triangles></mesh></object>`
  );
}

const xmlName = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/**
 * Todas las piezas en UN archivo .3mf, como objetos independientes.
 * El sentido de giro es el mismo que en el STL: CCW visto desde fuera.
 */
export function to3mf(pieces: Piece[], colors?: { bg: string; trace: string }): Blob {
  const objects: string[] = [];
  const items: string[] = [];

  // El id 1 lo ocupa el grupo de materiales (fondo y trazo); los objetos van
  // después. Sin colores es un 3MF liso, como antes.
  const matId = 1;
  let nextId = colors ? 2 : 1;

  for (const pc of pieces) {
    const hasOverlay = colors && pc.overlay && pc.overlay.positions.length > 0;
    const overlayStart = pc.mesh.positions.length - (pc.overlay?.positions.length ?? 0);

    if (hasOverlay) {
      // Dos partes con material propio: la placa (fondo) y el relieve (trazo).
      // Un objeto contenedor las une con <components>: así el laminador ve una
      // pieza con dos partes y le asigna a cada una su filamento/color.
      const baseId = nextId++;
      const reliefId = nextId++;
      const groupId = nextId++;
      objects.push(
        meshObject(baseId, `${pc.label} · fondo`, pc.mesh.positions, 0, overlayStart, ` pid="${matId}" pindex="0"`),
      );
      objects.push(
        meshObject(reliefId, `${pc.label} · trazo`, pc.mesh.positions, overlayStart, pc.mesh.positions.length, ` pid="${matId}" pindex="1"`),
      );
      objects.push(
        `<object id="${groupId}" type="model" name="${xmlName(pc.label)}"><components>` +
          `<component objectid="${baseId}"/><component objectid="${reliefId}"/>` +
          `</components></object>`,
      );
      items.push(`<item objectid="${groupId}"/>`);
    } else {
      // Sin relieve (o sin colores): un solo objeto. Con colores, todo al fondo.
      const id = nextId++;
      const matAttr = colors ? ` pid="${matId}" pindex="0"` : '';
      objects.push(meshObject(id, pc.label, pc.mesh.positions, 0, pc.mesh.positions.length, matAttr));
      items.push(`<item objectid="${id}"/>`);
    }
  }

  const materials = colors
    ? `<basematerials id="${matId}">` +
      `<base name="Fondo" displaycolor="${displayColor(colors.bg)}"/>` +
      `<base name="Trazo" displaycolor="${displayColor(colors.trace)}"/>` +
      `</basematerials>`
    : '';

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="es-ES" ` +
    `xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Application">MoldeLab</metadata>` +
    `<resources>${materials}${objects.join('')}</resources>` +
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
