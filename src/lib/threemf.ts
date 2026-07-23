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
 * Color: se usa el "Face Coloring" del 3MF estándar (extensión de color oficial
 * del 3MF Consortium), que es lo que Bambu Studio reconoce y ofrece emparejar
 * con sus filamentos al importar (ventana "Standard 3MF Color Parsing"):
 *   - Un `<m:colorgroup>` con dos colores: 0 = fondo, 1 = trazo.
 *   - Cada triángulo apunta a su color con `pid`/`p1`; el objeto lleva el fondo
 *     por defecto (`pindex="0"`) y los triángulos del relieve el trazo (`p1=1`).
 * OJO: hay que usar la extensión de COLOR (`m:colorgroup`), no `basematerials`,
 * que Bambu trata como ranura de filamento sin color. Ver #18.
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

  // Paleta del archivo: 0 = fondo, 1 = trazo, y detrás los colores propios de
  // las piezas que los traen (las capas de color), sin repetir ninguno. Así un
  // letrero de 3 capas sale del laminador ya con sus 3 filamentos separados.
  //
  // El trazo solo entra si alguna pieza trae relieve aparte. Si no lo trae —el
  // caso de «todo de un color»— declararlo igual haría que el laminador pidiera
  // un segundo filamento para pintar cero triángulos.
  const hasTrace = pieces.some((pc) => pc.overlay?.positions.length);
  const palette: string[] = colors
    ? hasTrace
      ? [hex(colors.bg), hex(colors.trace)]
      : [hex(colors.bg)]
    : [];
  const idxOf = (c?: string): number => {
    if (!colors || !c) return 0;
    const h = hex(c);
    const found = palette.indexOf(h);
    if (found >= 0) return found;
    palette.push(h);
    return palette.length - 1;
  };

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
    // Color estándar del 3MF (extensión de color): la placa apunta al color 0
    // (fondo) y el relieve al color 1 (trazo). Bambu lo lee como colores reales.
    const baseIdx = idxOf(pc.tint);
    const tr = tris
      .map(([a, b, c, relieve]) =>
        colors
          ? `<triangle v1="${a}" v2="${b}" v3="${c}" pid="1" p1="${relieve ? 1 : baseIdx}"/>`
          : `<triangle v1="${a}" v2="${b}" v3="${c}"/>`,
      )
      .join('');

    // El objeto declara su color por defecto (el suyo, o el fondo); el relieve
    // lo cambia al color del trazo.
    const objAttr = colors ? ` pid="1" pindex="${baseIdx}"` : '';
    objects.push(
      `<object id="${id}" type="model" name="${xmlName(pc.label)}"${objAttr}><mesh>` +
        `<vertices>${vx}</vertices><triangles>${tr}</triangles></mesh></object>`,
    );
    items.push(`<item objectid="${id}"/>`);
  });

  // Grupo de COLOR (no de material): es lo que el "Standard 3MF Import Color"
  // de Bambu lee como colores de verdad. displaycolor en formato #RRGGBBFF.
  const colorGroup = colors
    ? `<m:colorgroup id="1">` +
      palette.map((h) => `<m:color color="${h}FF"/>`).join('') +
      `</m:colorgroup>`
    : '';

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="es-ES" ` +
    `xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" ` +
    `xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">` +
    `<metadata name="Application">MoldeLab</metadata>` +
    `<resources>${colorGroup}${objects.join('')}</resources>` +
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

  // 3MF estándar con color por cara (Face Coloring). Sin los .config propios de
  // Bambu a propósito: así lo trata como 3MF estándar y abre su ventana de
  // "Standard 3MF Color Parsing", que reconoce los colores del archivo.
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
