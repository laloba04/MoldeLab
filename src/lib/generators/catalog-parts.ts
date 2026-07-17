/**
 * Generadores del catálogo.
 *
 * Ninguno inventa geometría nueva: todos se apoyan en `extrudeRegion` sobre
 * regiones ya saneadas por Clipper, que es lo único que garantiza que la malla
 * cierre. Cada función devuelve una lista de sólidos cerrados; la unión de los
 * que se solapan la resuelve el laminador.
 */

import type { Loop, Mesh, Params, Piece, Pt } from '../../types';
import { emptyMesh, extrudeRegion, merge } from '../mesh';
import { offsetRegions, sanitize, type Region } from '../clipper';
import { boxOf, circle, roundedRect, shiftLoops, spikes } from '../shapes';

const outerOf = (loops: Loop[]) => loops.filter((l) => !l.hole).map((l) => l.pts);
const holesOf = (loops: Loop[]) => loops.filter((l) => l.hole).map((l) => l.pts);

/** Regiones limpias de la silueta, opcionalmente engordada o adelgazada. */
export function regionsOf(loops: Loop[], delta = 0): Region[] {
  return offsetRegions(outerOf(loops), holesOf(loops), delta);
}

function solid(regions: Region[], zLo: number, zHi: number): Mesh {
  const m = emptyMesh();
  for (const r of regions) extrudeRegion(m, r, zLo, zHi);
  return m;
}

function piece(
  id: string,
  label: string,
  role: Piece['role'],
  mesh: Mesh,
  extra?: Pick<Piece, 'plate' | 'overlay'>,
): Piece[] {
  return mesh.positions.length ? [{ id, label, role, mesh, ...extra }] : [];
}

// -----------------------------------------------------------------------------
// Relieve: el bloque que comparten sello, embosser, llavero y placas
// -----------------------------------------------------------------------------

const STEPS = 3;

/** Relieve escalonado. Cada escalón es un sólido cerrado por su cuenta. */
export function reliefSolids(detail: Loop[], p: Params, z0: number, height: number): Mesh[] {
  const dOuter = outerOf(detail);
  const dHoles = holesOf(detail);
  if (!dOuter.length || height <= 0) return [];

  // "Engrosar trazo": un offset positivo engorda las líneas del dibujo antes de
  // extruir; uno negativo las afina. Es la perilla que en un generador SVG se
  // llama "engrossar linhas" — aquí en milímetros, y de paso vale para adelgazar.
  // El ángulo de salida (taper) se resta encima, escalón a escalón.
  const base = p.strokeWidth || 0;
  const steps = p.reliefTaper > 0.01 ? STEPS : 1;
  const dz = height / steps;
  const out: Mesh[] = [];

  for (let s = 0; s < steps; s++) {
    const delta = base - p.reliefTaper * s;
    // Con delta 0 exacto, saltarse Clipper preserva los puntos originales.
    const regions =
      Math.abs(delta) < 1e-6 ? sanitize(dOuter, dHoles) : offsetRegions(dOuter, dHoles, delta);
    const zLo = z0 + dz * s - (s === 0 ? 0.01 : 0);
    const zHi = z0 + dz * (s + 1);
    for (const r of regions) out.push(solid([r], zLo, zHi));
  }
  return out;
}

/** Grabado en hueco: la placa se parte en las capas de arriba y abajo, y la
 *  intermedia lleva el dibujo restado. Sin booleanas 3D. */
export function engraved(base: Region[], detail: Loop[], p: Params, zLo: number, zHi: number): Mesh[] {
  const zCut = zHi - p.engraveDepth;
  if (zCut <= zLo) return [solid(base, zLo, zHi)];

  const out: Mesh[] = [solid(base, zLo, zCut)];

  // Capa superior: la silueta de la placa menos el dibujo. El dibujo entra como
  // agujero, así que el nivel de arriba queda calado justo donde va el grabado.
  const dOuter = outerOf(detail);
  const dHoles = holesOf(detail);

  for (const r of base) {
    const carved = sanitize(
      [r.outer, ...dHoles],
      [...r.holes, ...dOuter.map((o) => [...o].reverse() as Pt[])],
    );
    for (const c of carved) out.push(solid([c], zCut, zHi));
  }
  return out;
}

// -----------------------------------------------------------------------------
// Repostería
// -----------------------------------------------------------------------------

/** Plantilla: una placa con la silueta calada. Se espolvorea por encima. */
export function buildStencil(loops: Loop[], detail: Loop[], p: Params): Piece[] {
  const box = boxOf(loops);
  const frame = roundedRect(
    box.cx,
    box.cy,
    box.w + p.border * 2,
    box.h + p.border * 2,
    p.cornerRadius,
  );

  // El dibujo va como agujero del marco: lo que se recorta es el trazo.
  const src = detail.length ? detail : loops;
  const cut = sanitize(
    [frame, ...holesOf(src)],
    [...outerOf(src).map((o) => [...o].reverse() as Pt[])],
  );

  return piece('stencil', 'Plantilla', 'body', solid(cut, 0, p.thickness), {
    plate: { regions: cut, zLo: 0, zHi: p.thickness },
  });
}

/** Topper de tarta: la silueta extruida más las púas que la clavan en la tarta. */
export function buildTopper(loops: Loop[], detail: Loop[], p: Params): Piece[] {
  const box = boxOf(loops);
  const body = regionsOf(loops);

  const extras: Mesh[] = [];
  for (const s of spikes(box, p.spikeCount, p.spikeWidth, p.spikeLength)) {
    extras.push(solid(sanitize([s], []), 0, p.thickness));
  }
  extras.push(...reliefSolids(detail, p, p.thickness - 0.01, p.reliefHeight));
  const overlay = merge(...extras);

  return piece('topper', 'Topper de tarta', 'body', merge(solid(body, 0, p.thickness), overlay), {
    plate: { regions: body, zLo: 0, zHi: p.thickness },
    overlay,
  });
}

/** Multicortador: la misma pieza repetida en rejilla sobre una sola cama. */
export function repeatGrid(pieces: Piece[], loops: Loop[], p: Params): Piece[] {
  const box = boxOf(loops);
  const stepX = box.w + p.spacing;
  const stepY = box.h + p.spacing;
  const cols = Math.max(1, p.gridCols);
  const rows = Math.ceil(p.copies / cols);

  return pieces.map((pc) => {
    const positions: number[] = [];
    for (let i = 0; i < p.copies; i++) {
      const col = i % cols;
      const row = (i / cols) | 0;
      const dx = (col - (cols - 1) / 2) * stepX;
      const dy = ((rows - 1) / 2 - row) * stepY;
      const src = pc.mesh.positions;
      for (let v = 0; v < src.length; v += 3) {
        positions.push(src[v] + dx, src[v + 1] + dy, src[v + 2]);
      }
    }
    // La placa reconstruible no sobrevive a la rejilla: quedaría sin desplazar.
    return { id: pc.id, label: pc.label, role: pc.role, mesh: { positions } };
  });
}

/** Placa de entrenamiento: el dibujo grabado en hueco para practicar glasa. */
export function buildPracticePlate(loops: Loop[], detail: Loop[], p: Params): Piece[] {
  const box = boxOf(loops);
  const plate = sanitize(
    [roundedRect(box.cx, box.cy, box.w + p.border * 2, box.h + p.border * 2, p.cornerRadius)],
    [],
  );

  // La capa de abajo es maciza: ahí puede grabarse la marca de agua.
  const zCut = p.thickness - p.engraveDepth;
  const layers = engraved(plate, detail, p, 0, p.thickness);
  const overlay = merge(...layers.slice(1));

  return piece('practice', 'Placa de entrenamiento', 'body', merge(layers[0], overlay), {
    plate: { regions: plate, zLo: 0, zHi: zCut > 0 ? zCut : p.thickness },
    overlay,
  });
}

/** Molde de impronta: la silueta hundida en un bloque. Se rellena y se desmolda. */
export function buildImprintMold(loops: Loop[], p: Params): Piece[] {
  const box = boxOf(loops);
  const block = sanitize(
    [roundedRect(box.cx, box.cy, box.w + p.border * 2, box.h + p.border * 2, p.cornerRadius)],
    [],
  );
  const zCut = Math.max(0.4, p.thickness - p.engraveDepth);
  const carvedParts: Mesh[] = [];

  for (const r of block) {
    const carved = sanitize(
      [r.outer, ...holesOf(loops)],
      [...outerOf(loops).map((o) => [...o].reverse() as Pt[])],
    );
    for (const c of carved) carvedParts.push(solid([c], zCut, p.thickness));
  }

  // La capa de abajo es maciza: ahí puede grabarse la marca de agua.
  const overlay = merge(...carvedParts);
  return piece('mold', 'Molde de impronta', 'body', merge(solid(block, 0, zCut), overlay), {
    plate: { regions: block, zLo: 0, zHi: zCut },
    overlay,
  });
}

// -----------------------------------------------------------------------------
// Llaveros y etiquetas
// -----------------------------------------------------------------------------

/** La anilla se pega al borde superior y solapa hacia dentro para soldarse. */
function ringAt(loops: Loop[], p: Params): { outer: Pt[]; hole: Pt[] } {
  const box = boxOf(loops);
  const cy = box.maxY + p.ringOuter * 0.55; // solapa con el cuerpo
  return {
    outer: circle(box.cx, cy, p.ringOuter, 40),
    hole: [...circle(box.cx, cy, p.ringInner, 32)].reverse() as Pt[],
  };
}

export function buildKeychain(
  loops: Loop[],
  detail: Loop[],
  p: Params,
  variant: 'silhouette' | 'relief' | 'cutout',
): Piece[] {
  const ring = ringAt(loops, p);
  const extras: Mesh[] = [solid(sanitize([ring.outer], [ring.hole]), 0, p.thickness)];

  let base: Region[];
  if (variant === 'cutout') {
    // El dibujo se cala en una etiqueta: se ve a través.
    const box = boxOf(loops);
    const tag = roundedRect(
      box.cx,
      box.cy,
      box.w + p.border * 2,
      box.h + p.border * 2,
      p.cornerRadius,
    );
    const src = detail.length ? detail : loops;
    base = sanitize(
      [tag, ...holesOf(src)],
      [...outerOf(src).map((o) => [...o].reverse() as Pt[])],
    );
  } else {
    base = regionsOf(loops);
    if (variant === 'relief') {
      extras.push(...reliefSolids(detail, p, p.thickness - 0.01, p.reliefHeight));
    }
  }

  const overlay = merge(...extras);
  return piece('keychain', 'Llavero', 'body', merge(solid(base, 0, p.thickness), overlay), {
    plate: { regions: base, zLo: 0, zHi: p.thickness },
    overlay,
  });
}

export function buildTag(loops: Loop[], detail: Loop[], p: Params, round: boolean): Piece[] {
  const box = boxOf(loops);
  const shape = round
    ? circle(box.cx, box.cy, Math.max(box.w, box.h) / 2 + p.border, 72)
    : roundedRect(box.cx, box.cy, box.w + p.border * 2, box.h + p.border * 2, p.cornerRadius);

  const base = sanitize([shape], []);

  // Agujero para la anilla, arriba del todo.
  const hy = box.cy + (round ? Math.max(box.w, box.h) / 2 + p.border : box.h / 2 + p.border) - p.ringOuter;
  const ringSolid = sanitize(
    [circle(box.cx, hy + p.ringOuter * 0.4, p.ringOuter, 40)],
    [[...circle(box.cx, hy + p.ringOuter * 0.4, p.ringInner, 32)].reverse() as Pt[]],
  );

  const overlay = merge(
    ...reliefSolids(detail, p, p.thickness - 0.01, p.reliefHeight),
    solid(ringSolid, 0, p.thickness),
  );

  return piece('tag', round ? 'Etiqueta redonda' : 'Etiqueta', 'body', merge(solid(base, 0, p.thickness), overlay), {
    plate: { regions: base, zLo: 0, zHi: p.thickness },
    overlay,
  });
}

// -----------------------------------------------------------------------------
// Letreros
// -----------------------------------------------------------------------------

/** Letrero de pie: la silueta en vertical, sobre una peana inclinada. */
export function buildStandingSign(loops: Loop[], p: Params): Piece[] {
  const box = boxOf(loops);
  const face = regionsOf(loops);

  // La cara del letrero se imprime tumbada y se encaja en la peana.
  const sign = solid(face, 0, p.thickness);

  const baseW = box.w + p.border * 2;
  const slotW = p.thickness + 0.4; // holgura de encaje
  const lean = Math.tan((p.standAngle * Math.PI) / 180) * 6;

  const plate = sanitize([roundedRect(box.cx, box.cy, baseW, p.standDepth, p.cornerRadius)], []);
  const parts: Mesh[] = [solid(plate, 0, 4)];

  // Ranura: un prisma restado a mano partiendo la peana en dos bloques.
  const slotFront = sanitize(
    [roundedRect(box.cx, box.cy - p.standDepth / 4 - slotW / 2 - lean, baseW, p.standDepth / 2 - slotW / 2, 0)],
    [],
  );
  const slotBack = sanitize(
    [roundedRect(box.cx, box.cy + p.standDepth / 4 + slotW / 2 - lean, baseW, p.standDepth / 2 - slotW / 2, 0)],
    [],
  );
  parts.push(solid(slotFront, 4, 10), solid(slotBack, 4, 10));

  return [
    ...piece('sign', 'Letrero', 'body', sign, {
      plate: { regions: face, zLo: 0, zHi: p.thickness },
    }),
    ...piece('stand', 'Peana', 'blade', merge(...parts)),
  ];
}

export function buildWallSign(loops: Loop[], detail: Loop[], p: Params): Piece[] {
  const box = boxOf(loops);
  const plate = roundedRect(
    box.cx,
    box.cy,
    box.w + p.border * 2,
    box.h + p.border * 2,
    p.cornerRadius,
  );

  const inset = p.border / 2 + p.mountHoleDia / 2;
  const r = p.mountHoleDia / 2;
  const holes: Pt[][] = [
    [...circle(box.minX - p.border + inset, box.maxY + p.border - inset, r, 24)].reverse() as Pt[],
    [...circle(box.maxX + p.border - inset, box.maxY + p.border - inset, r, 24)].reverse() as Pt[],
    [...circle(box.minX - p.border + inset, box.minY - p.border + inset, r, 24)].reverse() as Pt[],
    [...circle(box.maxX + p.border - inset, box.minY - p.border + inset, r, 24)].reverse() as Pt[],
  ];

  const base = sanitize([plate], holes);
  const overlay = merge(...reliefSolids(detail, p, p.thickness - 0.01, p.reliefHeight));

  return piece('wall-sign', 'Letrero de pared', 'body', merge(solid(base, 0, p.thickness), overlay), {
    plate: { regions: base, zLo: 0, zHi: p.thickness },
    overlay,
  });
}

// -----------------------------------------------------------------------------
// Personalizados
// -----------------------------------------------------------------------------

export function buildExtrude(loops: Loop[], p: Params): Piece[] {
  const base = regionsOf(loops);
  return piece('extrude', 'Extrusión', 'body', solid(base, 0, p.thickness), {
    plate: { regions: base, zLo: 0, zHi: p.thickness },
  });
}

export function buildReliefPlate(loops: Loop[], detail: Loop[], p: Params, round = false): Piece[] {
  const box = boxOf(loops);
  const shape = round
    ? circle(box.cx, box.cy, Math.max(box.w, box.h) / 2 + p.border, 72)
    : roundedRect(box.cx, box.cy, box.w + p.border * 2, box.h + p.border * 2, p.cornerRadius);

  const base = sanitize([shape], []);
  const overlay = merge(...reliefSolids(detail, p, p.thickness - 0.01, p.reliefHeight));

  return piece('plate', round ? 'Posavasos' : 'Placa', 'body', merge(solid(base, 0, p.thickness), overlay), {
    plate: { regions: base, zLo: 0, zHi: p.thickness },
    overlay,
  });
}

export function buildInlayPlate(loops: Loop[], detail: Loop[], p: Params): Piece[] {
  const box = boxOf(loops);
  const base = sanitize(
    [roundedRect(box.cx, box.cy, box.w + p.border * 2, box.h + p.border * 2, p.cornerRadius)],
    [],
  );

  // La capa de abajo es maciza: ahí puede grabarse la marca de agua.
  const zCut = p.thickness - p.engraveDepth;
  const layers = engraved(base, detail, p, 0, p.thickness);
  const overlay = merge(...layers.slice(1));

  return piece('inlay', 'Placa grabada', 'body', merge(layers[0], overlay), {
    plate: { regions: base, zLo: 0, zHi: zCut > 0 ? zCut : p.thickness },
    overlay,
  });
}

/** Solo el contorno: un aro que sigue la silueta, sin relleno. */
export function buildOutline(loops: Loop[], p: Params): Piece[] {
  const parts: Mesh[] = [];
  const half = p.wallThickness / 2;

  for (const l of loops) {
    const outer = offsetRegions([l.pts], [], half);
    const inner = offsetRegions([l.pts], [], -half);
    const holes = inner.flatMap((r) => [[...r.outer].reverse() as Pt[]]);

    for (const o of outer) {
      const ring = sanitize([o.outer], holes);
      parts.push(solid(ring, 0, p.thickness));
    }
  }
  return piece('outline', 'Contorno', 'blade', merge(...parts));
}

export function buildBookmark(loops: Loop[], detail: Loop[], p: Params): Piece[] {
  const box = boxOf(loops);
  const w = box.w + p.border * 2;
  const h = Math.max(box.h + p.border * 2, w * 3); // proporción de marcapáginas

  const plate = roundedRect(box.cx, box.cy, w, h, p.cornerRadius);
  const hole = [...circle(box.cx, box.cy + h / 2 - p.border - p.ringInner, p.ringInner, 28)].reverse() as Pt[];

  const base = sanitize([plate], [hole]);
  const overlay = merge(...reliefSolids(detail, p, p.thickness - 0.01, p.reliefHeight));

  return piece('bookmark', 'Marcapáginas', 'body', merge(solid(base, 0, p.thickness), overlay), {
    plate: { regions: base, zLo: 0, zHi: p.thickness },
    overlay,
  });
}

export { shiftLoops };
