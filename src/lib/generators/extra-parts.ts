/**
 * Segunda hornada de generadores.
 *
 * Los que están aquí comparten una cosa: todos necesitan la intersección
 * booleana 2D (`intersect`) o las bandas por umbral, que no existían en la
 * primera tanda. Siguen la misma regla que el resto: cero booleanas 3D, cada
 * sólido cierra por su cuenta, y el laminador funde lo que se solape.
 */

import type { Mesh, Params, Piece, Pt, Silhouette } from '../../types';
import { emptyMesh, extrudeRegion, merge } from '../mesh';
import { intersect, offsetRegions, sanitize, subtract, type Region } from '../clipper';
import { boxOf, circle, roundedRect, stadium } from '../shapes';
import { regionsOf, reliefSolids } from './catalog-parts';

function solid(regions: Region[], zLo: number, zHi: number): Mesh {
  const m = emptyMesh();
  for (const r of regions) extrudeRegion(m, r, zLo, zHi);
  return m;
}

const rev = (pts: Pt[]) => [...pts].reverse() as Pt[];

// -----------------------------------------------------------------------------
// En capas: una pieza por banda de umbral, para imprimir a colores
// -----------------------------------------------------------------------------

/**
 * Paleta de las capas: cada una de un color distinto, del más claro (la base,
 * que es la más grande) al más oscuro (el detalle). Así en el visor se ve de un
 * vistazo qué va en cada capa, y el 3MF sale ya con sus colores separados.
 */
const LAYER_TINTS = ['#e4d5c1', '#c98f5a', '#8a5038', '#4e2b1f', '#2b1712'];

/**
 * Cada banda es más oscura (y por tanto más pequeña) que la anterior, y sube un
 * escalón. Se exporta una pieza por capa: el usuario cambia de filamento en el
 * cambio de capa del laminador, o imprime cada una de un color y las pega.
 */
export function buildLayered(s: Silhouette, p: Params, withRing: boolean): Piece[] {
  const bands = s.bands?.length ? s.bands : [s.loops, s.detail];
  const pieces: Piece[] = [];

  for (let i = 0; i < Math.min(bands.length, p.layers); i++) {
    const regions = regionsOf(bands[i]);
    if (!regions.length) continue;

    const zLo = i === 0 ? 0 : p.thickness + p.layerHeight * (i - 1) - 0.01;
    const zHi = p.thickness + p.layerHeight * i;
    const parts: Mesh[] = [solid(regions, zLo, zHi)];

    // La anilla vive en la capa base, que es la que aguanta el tirón.
    if (withRing && i === 0) {
      const box = boxOf(bands[0]);
      const cy = box.maxY + p.ringOuter * 0.55;
      parts.push(
        solid(
          sanitize([circle(box.cx, cy, p.ringOuter, 40)], [rev(circle(box.cx, cy, p.ringInner, 32))]),
          zLo,
          zHi,
        ),
      );
    }

    const mesh = merge(...parts);
    if (mesh.positions.length) {
      pieces.push({
        id: `layer-${i}`,
        label: `Capa ${i + 1}`,
        role: i % 2 ? 'icing' : 'body',
        mesh,
        tint: LAYER_TINTS[i % LAYER_TINTS.length],
        plate: { regions, zLo, zHi },
        overlay: parts.length > 1 ? merge(...parts.slice(1)) : undefined,
        overlayParts: parts.length > 1 ? parts.slice(1) : undefined,
      });
    }
  }
  return pieces;
}

// -----------------------------------------------------------------------------
// Placa para colorear: los trazos levantados, los huecos para pintar
// -----------------------------------------------------------------------------

export function buildColoringPlate(s: Silhouette, p: Params): Piece[] {
  const box = boxOf(s.loops);
  const plate = sanitize(
    [roundedRect(box.cx, box.cy, box.w + p.border * 2, box.h + p.border * 2, p.cornerRadius)],
    [],
  );

  // Solo el borde de cada trazo, no el trazo entero: queda un dibujo de líneas
  // en relieve y los huecos entre líneas se pintan con rotulador o glasa.
  const lines: Mesh[] = [];
  const src = s.detail.length ? s.detail : s.loops;
  for (const l of src) {
    const outer = offsetRegions([l.pts], [], 0.45);
    const holes = offsetRegions([l.pts], [], -0.45).map((r) => rev(r.outer));
    for (const o of outer) {
      lines.push(solid(sanitize([o.outer], holes), p.thickness - 0.01, p.thickness + p.reliefHeight));
    }
  }

  const overlay = merge(...lines);
  const mesh = merge(solid(plate, 0, p.thickness), overlay);
  return [{
    id: 'coloring',
    label: 'Placa para colorear',
    role: 'body',
    mesh,
    plate: { regions: plate, zLo: 0, zHi: p.thickness },
    overlay,
    overlayParts: lines,
  }];
}

// -----------------------------------------------------------------------------
// Abridor con sello: la silueta gorda con la boca de abrir chapas
// -----------------------------------------------------------------------------

export function buildOpener(s: Silhouette, p: Params): Piece[] {
  const box = boxOf(s.loops);

  // La boca estándar: 30×12 con el labio de apoyo. En PLA esto es un juguete;
  // el hint de la interfaz ya avisa de imprimirlo en PETG macizo.
  const mouth = stadium(box.cx, box.cy, 30, 12, 20);

  const thick = Math.max(p.thickness, 5);
  const body = sanitize(
    s.loops.filter((l) => !l.hole).map((l) => l.pts),
    [...s.loops.filter((l) => l.hole).map((l) => l.pts), rev(mouth)],
  );

  const extras = reliefSolids(s.detail, p, thick - 0.01, p.reliefHeight);
  const overlay = merge(...extras);
  const mesh = merge(solid(body, 0, thick), overlay);
  return mesh.positions.length
    ? [{
        id: 'opener',
        label: 'Abridor con sello',
        role: 'body',
        mesh,
        plate: { regions: body, zLo: 0, zHi: thick },
        overlay,
        overlayParts: extras,
      }]
    : [];
}

// -----------------------------------------------------------------------------
// Caja con tapa: la silueta hecha recipiente
// -----------------------------------------------------------------------------

export function buildBox(s: Silhouette, p: Params): Piece[] {
  // Una caja con agujeros pasantes no es una caja: solo cuentan las islas.
  const islands = s.loops.filter((l) => !l.hole).map((l) => l.pts);
  if (!islands.length) return [];

  const outerR = sanitize(islands, []);
  const floorT = Math.min(p.thickness, 3);

  // Cuerpo: suelo macizo + paredes (anillo entre la silueta y ella encogida).
  //
  // La resta es una booleana de verdad, y tiene que serlo. Antes se le pasaban a
  // CADA isla los huecos de TODAS, y se dejaba que decidiera el número de
  // vueltas: un hueco que cae fuera de su isla, en vez de no hacer nada, se
  // convertía en material macizo. Con este dibujo salían 13.739 mm² de pared
  // donde tocaban 686 — o sea, la caja llena.
  const innerR = offsetRegions(islands, [], -p.wallThickness);
  const walls: Mesh[] = [solid(subtract(outerR, innerR), floorT - 0.01, p.boxHeight)];

  // Tapa: placa con la misma silueta + labio interior que encaja en el cuerpo.
  const lipOuter = offsetRegions(islands, [], -(p.wallThickness + 0.25));
  const lipInner = offsetRegions(islands, [], -(p.wallThickness + 0.25 + 1.2));

  const lidExtras: Mesh[] = [];
  // El labio va por DEBAJO y el dibujo por encima, que es como se usa la tapa:
  // el labio se mete en la caja y el dibujo queda a la vista.
  //
  // Antes era al revés —labio arriba, dibujo hacia abajo— y eso no se podía
  // imprimir: apoyada, la tapa se sostendría solo sobre las líneas del dibujo y
  // toda la placa quedaría en el aire. Así apoya en el aro del labio y lo único
  // que vuela es la pestañita de un milímetro y pico del borde, que cualquier
  // impresora salva de un puente.
  lidExtras.push(solid(subtract(lipOuter, lipInner), -p.lidLip, 0.01));
  // El relieve decora la cara de arriba de la tapa, que es la que se ve. Y va
  // con altura POSITIVA: en negativo, `reliefSolids` no devuelve nada, y por eso
  // la tapa salía lisa, sin ningún detalle del dibujo.
  lidExtras.push(...reliefSolids(s.detail, p, floorT - 0.01, p.reliefHeight));

  const pieces: Piece[] = [];
  const bodyOverlay = merge(...walls);
  const lidOverlay = merge(...lidExtras);
  const bodyMesh = merge(solid(outerR, 0, floorT), bodyOverlay);
  const lidMesh = merge(solid(outerR, 0, floorT), lidOverlay);
  const floor = { regions: outerR, zLo: 0, zHi: floorT };

  if (bodyMesh.positions.length) {
    pieces.push({ id: 'box-body', label: 'Caja', role: 'body', mesh: bodyMesh, plate: floor, overlay: bodyOverlay, overlayParts: walls });
  }
  if (lidMesh.positions.length) {
    pieces.push({ id: 'box-lid', label: 'Tapa', role: 'icing', mesh: lidMesh, plate: floor, overlay: lidOverlay, overlayParts: lidExtras });
  }
  return pieces;
}

// -----------------------------------------------------------------------------
// Puzzle: la placa cortada en piezas con lengüetas
// -----------------------------------------------------------------------------


// -----------------------------------------------------------------------------
// Llavero matrícula: placa con marco y el texto/dibujo en relieve
// -----------------------------------------------------------------------------

export function buildPlateTag(s: Silhouette, p: Params): Piece[] {
  const box = boxOf(s.loops);

  // Proporción de matrícula: ancha y baja, con marco perimetral en relieve.
  const w = Math.max(box.w + p.border * 2, (box.h + p.border * 2) * 2.6);
  const h = w / 2.9;

  const plateOuter = roundedRect(box.cx, box.cy, w, h, Math.min(p.cornerRadius, h / 4));
  const base = sanitize([plateOuter], []);
  const extras: Mesh[] = [];

  // Marco: el borde de la placa, levantado.
  const frameInner = offsetRegions([plateOuter], [], -1.4);
  for (const o of base) {
    extras.push(
      solid(
        sanitize([o.outer], frameInner.map((r) => rev(r.outer))),
        p.thickness - 0.01,
        p.thickness + p.reliefHeight,
      ),
    );
  }

  extras.push(...reliefSolids(s.detail, p, p.thickness - 0.01, p.reliefHeight));

  // Agujero de anilla en la esquina superior izquierda.
  const hx = box.cx - w / 2 + p.ringOuter + 1;
  const hy = box.cy + h / 2 - p.ringOuter - 1;
  extras.push(
    solid(sanitize([circle(hx, hy, p.ringOuter, 36)], [rev(circle(hx, hy, p.ringInner, 28))]), 0, p.thickness),
  );

  const overlay = merge(...extras);
  const mesh = merge(solid(base, 0, p.thickness), overlay);
  return [{
    id: 'plate-tag',
    label: 'Llavero matrícula',
    role: 'body',
    mesh,
    plate: { regions: base, zLo: 0, zHi: p.thickness },
    overlay,
    overlayParts: extras,
  }];
}
