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
import { intersect, offsetRegions, sanitize, type Region } from '../clipper';
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
        plate: { regions, zLo, zHi },
        overlay: parts.length > 1 ? merge(...parts.slice(1)) : undefined,
      });
    }
  }
  return pieces;
}

// -----------------------------------------------------------------------------
// Articulado: segmentos rígidos unidos por bisagras vivas
// -----------------------------------------------------------------------------

/**
 * La silueta se corta en bandas verticales y se une con puentes finos de
 * ~0,6 mm de alto: la bisagra viva de toda la vida. Dos o tres capas de
 * impresión doblan miles de veces antes de romper; un pasador articulado de
 * verdad necesitaría holguras 3D que aquí no tocan.
 */
export function buildArticulated(s: Silhouette, p: Params): Piece[] {
  const base = regionsOf(s.loops);
  if (!base.length) return [];

  const box = boxOf(s.loops);
  const n = Math.max(2, p.segments);
  const segW = (box.w - p.hingeGap * (n - 1)) / n;
  if (segW <= 2) return [];

  const parts: Mesh[] = [];
  const hingeZ = 0.6; // 3 capas a 0,2: el punto dulce de una bisagra viva

  for (let i = 0; i < n; i++) {
    const x0 = box.minX + i * (segW + p.hingeGap);
    const band = roundedRect(x0 + segW / 2, box.cy, segW, box.h + 4, 0);
    parts.push(solid(intersect(base, [band]), 0, p.thickness));
  }

  // Puentes: cruzan el hueco y muerden 2 mm en cada segmento para soldarse.
  for (let i = 0; i < n - 1; i++) {
    const xGap = box.minX + (i + 1) * segW + i * p.hingeGap + p.hingeGap / 2;
    const bridge = roundedRect(xGap, box.cy, p.hingeGap + 4, Math.min(8, box.h * 0.5), 0);
    parts.push(solid(intersect(base, [bridge]), 0, hingeZ));
  }

  // Anilla en el primer segmento.
  const cy = box.maxY + p.ringOuter * 0.55;
  const cx = box.minX + segW / 2;
  parts.push(
    solid(
      sanitize([circle(cx, cy, p.ringOuter, 40)], [rev(circle(cx, cy, p.ringInner, 32))]),
      0,
      p.thickness,
    ),
  );

  const mesh = merge(...parts);
  // Sin marca de agua: grabarla rellenaría los huecos de las bisagras y un
  // relieve soldaría los segmentos entre sí.
  return mesh.positions.length
    ? [{ id: 'articulated', label: 'Llavero articulado', role: 'body', mesh, noMark: true }]
    : [];
}

// -----------------------------------------------------------------------------
// Guía de alambre: el contorno como muro para doblar alambre encima
// -----------------------------------------------------------------------------

export function buildWireJig(s: Silhouette, p: Params): Piece[] {
  const box = boxOf(s.loops);
  const plate = sanitize(
    [roundedRect(box.cx, box.cy, box.w + p.border * 2, box.h + p.border * 2, p.cornerRadius)],
    [],
  );

  // El muro sigue la línea del contorno. El alambre se dobla apoyado en él.
  const walls: Mesh[] = [];
  const half = p.wallThickness / 2;
  for (const l of s.loops) {
    const outer = offsetRegions([l.pts], [], half);
    const holes = offsetRegions([l.pts], [], -half).map((r) => rev(r.outer));
    for (const o of outer) {
      walls.push(solid(sanitize([o.outer], holes), p.thickness - 0.01, p.thickness + p.reliefHeight + 2));
    }
  }

  const overlay = merge(...walls);
  const mesh = merge(solid(plate, 0, p.thickness), overlay);
  return [{
    id: 'wire-jig',
    label: 'Guía de alambre',
    role: 'body',
    mesh,
    plate: { regions: plate, zLo: 0, zHi: p.thickness },
    overlay,
  }];
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

  const overlay = merge(...reliefSolids(s.detail, p, thick - 0.01, p.reliefHeight));
  const mesh = merge(solid(body, 0, thick), overlay);
  return mesh.positions.length
    ? [{
        id: 'opener',
        label: 'Abridor con sello',
        role: 'body',
        mesh,
        plate: { regions: body, zLo: 0, zHi: thick },
        overlay,
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
  const innerR = offsetRegions(islands, [], -p.wallThickness);
  const wallHoles = innerR.map((r) => rev(r.outer));

  const walls: Mesh[] = [];
  for (const o of outerR) {
    walls.push(solid(sanitize([o.outer], wallHoles), floorT - 0.01, p.boxHeight));
  }

  // Tapa: placa con la misma silueta + labio interior que encaja en el cuerpo.
  const lipOuter = offsetRegions(islands, [], -(p.wallThickness + 0.25));
  const lipInner = offsetRegions(islands, [], -(p.wallThickness + 0.25 + 1.2));
  const lipHoles = lipInner.map((r) => rev(r.outer));

  const lidExtras: Mesh[] = [];
  for (const o of lipOuter) {
    lidExtras.push(solid(sanitize([o.outer], lipHoles), floorT - 0.01, floorT + p.lidLip));
  }
  // El relieve decora la tapa, que es la cara que se ve.
  lidExtras.push(...reliefSolids(s.detail, p, -0.01, -p.reliefHeight));

  const pieces: Piece[] = [];
  const bodyOverlay = merge(...walls);
  const lidOverlay = merge(...lidExtras);
  const bodyMesh = merge(solid(outerR, 0, floorT), bodyOverlay);
  const lidMesh = merge(solid(outerR, 0, floorT), lidOverlay);
  const floor = { regions: outerR, zLo: 0, zHi: floorT };

  if (bodyMesh.positions.length) {
    pieces.push({ id: 'box-body', label: 'Caja', role: 'body', mesh: bodyMesh, plate: floor, overlay: bodyOverlay });
  }
  if (lidMesh.positions.length) {
    pieces.push({ id: 'box-lid', label: 'Tapa', role: 'icing', mesh: lidMesh, plate: floor, overlay: lidOverlay });
  }
  return pieces;
}

// -----------------------------------------------------------------------------
// Puzzle: la placa cortada en piezas con lengüetas
// -----------------------------------------------------------------------------

/**
 * La rejilla se genera con lengüetas semicirculares en cada arista interior.
 * La clave de que las piezas encajen es que la arista es UNA sola geometría
 * canónica: la celda de un lado la recorre tal cual (lengüeta que sale) y la
 * del otro lado la recorre invertida (muesca que entra). No hay dos versiones
 * de la misma arista que puedan discrepar.
 */
export function buildPuzzle(s: Silhouette, p: Params): Piece[] {
  const box = boxOf(s.loops);
  const bw = box.w + p.border * 2;
  const bh = box.h + p.border * 2;
  const plate = sanitize([roundedRect(box.cx, box.cy, bw, bh, p.cornerRadius)], []);

  const rows = Math.max(2, p.puzzleRows);
  const cols = Math.max(2, p.puzzleCols);
  const cw = bw / cols;
  const ch = bh / rows;
  const x0 = box.cx - bw / 2;
  const y0 = box.cy - bh / 2;
  const rad = Math.min(cw, ch) * 0.16;

  /** Arista canónica de A a B con lengüeta hacia `side` (+1 / −1 / 0 = recta). */
  const edge = (ax: number, ay: number, bx: number, by: number, side: number): Pt[] => {
    if (!side) return [[ax, ay]];
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const tx = (bx - ax) / len;
    const ty = (by - ay) / len;
    const nx = -ty * side;
    const ny = tx * side;

    const pts: Pt[] = [[ax, ay], [mx - tx * rad, my - ty * rad]];
    // Semicírculo del cuello a la punta y de vuelta.
    for (let i = 1; i < 10; i++) {
      const a = Math.PI - (i / 10) * Math.PI;
      pts.push([
        mx + Math.cos(a) * rad * tx * -1 + nx * Math.sin(a) * rad * 1.7,
        my + Math.cos(a) * rad * ty * -1 + ny * Math.sin(a) * rad * 1.7,
      ]);
    }
    pts.push([mx + tx * rad, my + ty * rad]);
    return pts;
  };

  // Dirección de cada lengüeta, decidida una vez por arista.
  const hSide = (r: number, c: number) => ((r + c) % 2 ? 1 : -1); // aristas horizontales
  const vSide = (r: number, c: number) => ((r + c) % 2 ? -1 : 1); // aristas verticales

  const pieces: Mesh[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const L = x0 + c * cw;
      const R = L + cw;
      const B = y0 + r * ch;
      const T = B + ch;

      const poly: Pt[] = [
        // abajo (izq→dcha): arista horizontal r (0 = borde exterior, recta)
        ...edge(L, B, R, B, r === 0 ? 0 : hSide(r, c)),
        // derecha (abajo→arriba)
        ...edge(R, B, R, T, c === cols - 1 ? 0 : vSide(r, c + 1)),
        // arriba (dcha→izq): la misma arista canónica que usará la celda de
        // encima como "abajo", recorrida al revés.
        ...rev(edge(L, T, R, T, r === rows - 1 ? 0 : hSide(r + 1, c))),
        // izquierda (arriba→abajo)
        ...rev(edge(L, B, L, T, c === 0 ? 0 : vSide(r, c))),
      ];

      // Recorte + rebaje de 0,12 mm por lado: el juego que hace que encaje.
      const cell = intersect(plate, [poly]);
      const eased = offsetRegions(
        cell.map((x) => x.outer),
        cell.flatMap((x) => x.holes),
        -0.12,
      );
      if (eased.length) pieces.push(solid(eased, 0, p.thickness));

      // El dibujo en relieve, recortado a esta pieza.
      const detailRegions = regionsOf(s.detail);
      const detailCut = intersect(detailRegions, [poly]);
      const detailEased = offsetRegions(
        detailCut.map((x) => x.outer),
        detailCut.flatMap((x) => x.holes),
        -0.12,
      );
      if (detailEased.length) {
        pieces.push(solid(detailEased, p.thickness - 0.01, p.thickness + p.reliefHeight));
      }
    }
  }

  const mesh = merge(...pieces);
  // Sin marca de agua: grabarla borraría los cortes entre piezas y un relieve
  // las soldaría entre sí.
  return mesh.positions.length
    ? [{ id: 'puzzle', label: 'Rompecabezas', role: 'body', mesh, noMark: true }]
    : [];
}

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
  }];
}
