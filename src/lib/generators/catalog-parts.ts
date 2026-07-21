/**
 * Generadores del catálogo.
 *
 * Ninguno inventa geometría nueva: todos se apoyan en `extrudeRegion` sobre
 * regiones ya saneadas por Clipper, que es lo único que garantiza que la malla
 * cierre. Cada función devuelve una lista de sólidos cerrados; la unión de los
 * que se solapan la resuelve el laminador.
 */

import type { Loop, Mesh, MoldShape, Params, Piece, Pt } from '../../types';
import { emptyMesh, extrudeRegion, merge } from '../mesh';
import { intersect, offsetRegions, sanitize, subtract, union, type Region } from '../clipper';
import { pointInPolygon } from '../polygon';
import { boxOf, circle, heart, roundedRect, shiftLoops, spikes } from '../shapes';

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

/**
 * Relieve escalonado. Cada escalón es un sólido cerrado por su cuenta.
 * Si se pasa `clip` (el contorno de la placa), el relieve se recorta a él, para
 * que el dibujo no sobresalga cuando la forma del molde es más pequeña que la
 * imagen (p. ej. un corazón que no cubre todo el dibujo).
 */
export function reliefSolids(
  detail: Loop[],
  p: Params,
  z0: number,
  height: number,
  clip?: Pt[][],
): Mesh[] {
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
    let regions =
      Math.abs(delta) < 1e-6 ? sanitize(dOuter, dHoles) : offsetRegions(dOuter, dHoles, delta);
    if (clip) regions = intersect(regions, clip);
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
export function buildStencil(loops: Loop[], detail: Loop[], p: Params, label = 'Plantilla'): Piece[] {
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

  return piece('stencil', label, 'body', solid(cut, 0, p.thickness), {
    plate: { regions: cut, zLo: 0, zHi: p.thickness },
  });
}

/**
 * Letrero calado. Dos maneras de entenderlo, y las dos valen:
 *
 *  - «figura»: se recorta la figura entera y queda una placa con su hueco. Es
 *    la plantilla de toda la vida; nada se cae porque no queda nada suelto.
 *  - «líneas»: se recorta solo un contorno fino, así que la figura se dibuja
 *    con la luz y la placa sigue entera. El problema clásico es que ese corte
 *    cerrado deja la parte de DENTRO suelta (como el centro de una «o»), así
 *    que se dejan sin cortar unos cuantos PUENTES repartidos por el contorno.
 */
export function buildCutoutSign(loops: Loop[], detail: Loop[], p: Params): Piece[] {
  const box = boxOf(loops);
  const frame = roundedRect(
    box.cx,
    box.cy,
    box.w + p.border * 2,
    box.h + p.border * 2,
    p.cornerRadius,
  );
  const src = detail.length ? detail : loops;

  if (p.cutoutMode === 'figure') {
    const cut = sanitize(
      [frame, ...holesOf(src)],
      [...outerOf(src).map((o) => [...o].reverse() as Pt[])],
    );
    return piece('sign-cutout', 'Letrero calado', 'body', solid(cut, 0, p.thickness), {
      plate: { regions: cut, zLo: 0, zHi: p.thickness },
    });
  }

  // --- Modo «solo las líneas» ---
  const half = Math.max(0.3, p.cutLineWidth / 2);

  // Dibujable solo si al meterse media línea hacia dentro queda algo: una forma
  // más estrecha que el propio corte no se puede contornear, saldría como un
  // borrón. Es la misma regla que usaría una cuchilla de verdad, y de paso deja
  // fuera las motitas sin tocar los dibujos buenos de las alas.
  const drawn: { l: Loop; inner: Region[] }[] = [];
  for (const l of src) {
    const inner = offsetRegions([l.pts], [], -half);
    if (inner.length) drawn.push({ l, inner });
  }

  const n = Math.max(0, Math.round(p.cutBridges));
  const side = half * 2 + 1; // algo más ancho que la banda, para que cosa

  let bands: Region[] = [];
  let bridges: Region[] = [];

  for (const [k, { l, inner }] of drawn.entries()) {
    // La banda a quitar: lo de fuera del contorno menos lo de dentro. Es una
    // resta de verdad; el material de alrededor ni se toca.
    bands = union(bands, subtract(offsetRegions([l.pts], [], half), inner));

    // Puentes: cuadraditos sobre el contorno que NO se cortan, y que dejan
    // cosida la parte de dentro con el resto de la placa. Se reparten por el
    // contorno, y cada figura empieza en un sitio distinto para que no se
    // amontonen todos en la misma zona.
    if (n > 0 && l.pts.length >= n) {
      const skip = l.pts.length / n;
      const start = (skip * k) / Math.max(1, drawn.length);
      for (let b = 0; b < n; b++) {
        const [bx, by] = l.pts[Math.floor(start + b * skip) % l.pts.length];
        bridges = union(bridges, sanitize([roundedRect(bx, by, side, side, 0)], []));
      }
    }
  }

  const cut = union(subtract(sanitize([frame], []), bands), bridges);
  return piece('sign-cutout', 'Letrero calado', 'body', solid(cut, 0, p.thickness), {
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

/**
 * La anilla del llavero es una PESTAÑA con forma de píldora (como la de
 * MakerLab «Image to Keychain»): un rectángulo de puntas redondeadas que sale
 * del borde superior del dibujo, centrado, con el agujero cerca de la punta.
 *
 * La clave para que no flote: la pestaña se solapa hacia DENTRO del material
 * (baja por debajo del punto más alto del dibujo en el eje central), así que la
 * unión con el dibujo es un bloque macizo, no un cuello fino. Funciona igual
 * aunque el centro tenga un hueco (una mariposa entre las antenas): la pestaña
 * baja hasta encontrar material y se suelda a él.
 */
/**
 * Centro del agujero de la anilla (el punto que el usuario arrastra con el
 * ratón en el visor). Depende de la caja del dibujo y de la posición elegida.
 */
export function ringHandle(loops: Loop[], p: Params): Pt {
  const box = boxOf(loops);
  const rx = box.cx + (p.ringPos ?? 0) * (box.w / 2);
  // La posición por defecto NO depende del tamaño de la anilla, para que al
  // agrandarla o achicarla crezca en su sitio sin saltar.
  const holeDefault = box.maxY + Math.max(4, box.h * 0.06);
  const holeCy = holeDefault + (p.ringPosY ?? 0) * (box.h / 2);
  return [rx, holeCy];
}

function ringAt(loops: Loop[], p: Params): { tab: Pt[]; hole: Pt[] } {
  const [rx, holeCy] = ringHandle(loops, p);

  // Argolla de tamaño FIJO: una píldora con el agujero arriba y un rabito debajo
  // que la mantiene pegada al dibujo. No se estira; va tal cual donde se
  // arrastre (arriba/abajo, izquierda/derecha), como en MakerLab.
  const w = p.ringOuter * 2; // ancho (lo controla «Anilla»)
  const neck = p.ringNeck ?? p.ringOuter * 2; // largo del rabito (lo controla «Largo»)
  const tabTop = holeCy + p.ringOuter;
  const tabBottom = holeCy - neck;
  const cy = (tabTop + tabBottom) / 2;
  const tab = roundedRect(rx, cy, w, Math.max(w, tabTop - tabBottom), w / 2);

  return {
    tab,
    hole: [...circle(rx, holeCy, p.ringInner, 32)].reverse() as Pt[],
  };
}

export function buildKeychain(
  loops: Loop[],
  detail: Loop[],
  p: Params,
  variant: 'silhouette' | 'relief' | 'cutout' | 'plate',
): Piece[] {
  const ring = ringAt(loops, p);
  const extras: Mesh[] = [
    solid(sanitize([ring.tab], [ring.hole]), 0, p.thickness), // la pestaña con su agujero
  ];

  let base: Region[];
  if (variant === 'plate') {
    // Une las letras por su PROPIO contorno: se engorda la silueta (offset) hasta
    // que las letras vecinas se tocan y forman una sola pieza con forma de la
    // palabra, no una placa rectangular. Las letras van en relieve encima.
    base = regionsOf(loops, Math.max(0.6, p.border));
    extras.push(...reliefSolids(detail, p, p.thickness - 0.01, p.reliefHeight));
  } else if (variant === 'cutout') {
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

/** Lo que la pestaña del letrero se hunde en la peana. La ranura mide igual. */
const SLOT_DEPTH = 6;

/**
 * Letrero de pie: la silueta en vertical, sobre una peana inclinada.
 * `unite` engorda la silueta para que las partes sueltas (las letras de una
 * palabra) se toquen y salgan en una sola pieza; 0 la deja tal cual.
 */
export function buildStandingSign(
  loops: Loop[],
  p: Params,
  unite = 0,
  detail: Loop[] = [],
): Piece[] {
  const box = boxOf(loops);
  const face = regionsOf(loops, unite);

  // La cara del letrero se imprime tumbada y se encaja en la peana. Cuando se
  // han unido las letras (unite > 0), el dibujo se levanta en relieve encima
  // para que se siga leyendo: si no, la palabra queda hecha un churro.
  const relief = unite > 0 ? reliefSolids(detail.length ? detail : loops, p, p.thickness - 0.01, p.reliefHeight) : [];

  // Pestaña plana bajo la silueta: es lo que entra en la ranura. Sin ella, una
  // figura de base irregular (las colas de una mariposa, la panza de un gato)
  // se apoya en dos puntos y se cae. Arranca DENTRO del material —se busca el
  // punto más bajo con relleno en el eje central— para quedar soldada.
  const solidAt = (x: number, y: number) =>
    loops.some((l) => !l.hole && pointInPolygon([x, y], l.pts)) &&
    !loops.some((l) => l.hole && pointInPolygon([x, y], l.pts));

  const step = Math.max(0.4, box.h / 240);
  let lowest = box.minY;
  for (let y = box.minY; y <= box.maxY; y += step) {
    if (solidAt(box.cx, y)) {
      lowest = y;
      break;
    }
  }

  const tabTop = lowest + 2; // solape para soldarse a la figura
  const tabBottom = box.minY - SLOT_DEPTH;
  const tabW = Math.max(12, box.w * 0.45);
  const tang = solid(
    sanitize([roundedRect(box.cx, (tabTop + tabBottom) / 2, tabW, tabTop - tabBottom, 0)], []),
    0,
    p.thickness,
  );

  const sign = merge(solid(face, 0, p.thickness), tang, ...relief);

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
  parts.push(solid(slotFront, 4, 4 + SLOT_DEPTH), solid(slotBack, 4, 4 + SLOT_DEPTH));

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

export function buildExtrude(
  loops: Loop[],
  p: Params,
  unite = 0,
  detail: Loop[] = [],
): Piece[] {
  const base = regionsOf(loops, unite);
  // Igual que en el letrero de pie: si se han unido las letras, el dibujo se
  // levanta encima para que se lea.
  const overlay =
    unite > 0
      ? merge(...reliefSolids(detail.length ? detail : loops, p, p.thickness - 0.01, p.reliefHeight))
      : emptyMesh();

  return piece('extrude', 'Extrusión', 'body', merge(solid(base, 0, p.thickness), overlay), {
    plate: { regions: base, zLo: 0, zHi: p.thickness },
    overlay: overlay.positions.length ? overlay : undefined,
  });
}

/**
 * Contorno de la placa según la «forma del molde» elegida. 'image' sigue la
 * silueta del dibujo (para que no salga siempre en placa); el resto son formas
 * estándar ajustadas a la caja de la imagen más el marco.
 */
export function moldBase(loops: Loop[], p: Params, shape: MoldShape): Region[] {
  const box = boxOf(loops);
  const w = box.w + p.border * 2;
  const h = box.h + p.border * 2;
  switch (shape) {
    case 'image':
      // La placa es la propia silueta, engordada por el marco.
      return regionsOf(loops, p.border);
    case 'circle':
      // El círculo debe contener la diagonal del dibujo, no solo el lado mayor.
      return sanitize([circle(box.cx, box.cy, Math.hypot(w, h) / 2, 72)], []);
    case 'heart': {
      // Corazón centrado por su caja en el medio de la imagen (heart() ya
      // centra por su caja). Nada de recolocar por el centro de masa: en un
      // corazón cae arriba, entre los lóbulos, y descentraría el dibujo. Mide
      // algo más que el dibujo para que este quepa en su cuerpo y lo llene.
      return sanitize([heart(box.cx, box.cy, w * 1.7, h * 1.7)], []);
    }
    case 'square':
      return sanitize([roundedRect(box.cx, box.cy, w, h, 0)], []);
    case 'rounded':
    default:
      return sanitize([roundedRect(box.cx, box.cy, w, h, p.cornerRadius)], []);
  }
}

/**
 * Encoge y centra el dibujo para que quepa ENTERO dentro de la placa: ni
 * sobresale flotando, ni se corta. Busca (binario) la mayor escala con la que
 * todo el contorno del dibujo cae dentro de la forma del molde. Si ya cabía a
 * tamaño natural, no lo toca.
 */
export function fitDetailToBase(detail: Loop[], base: Region[]): Loop[] {
  const outerPts = detail.filter((l) => !l.hole).flatMap((l) => l.pts);
  if (!outerPts.length || !base.length) return detail;

  const dbox = boxOf(detail);
  // Se centra en el MEDIO real de la placa (centro de su caja), no en su centro
  // de masa: en un corazón el centro de masa cae arriba y descentra el dibujo.
  const bbox = boxOf(base.map((r) => ({ pts: r.outer, hole: false })));
  const bc: Pt = [bbox.cx, bbox.cy];

  const inside = (x: number, y: number): boolean => {
    for (const r of base) {
      if (pointInPolygon([x, y], r.outer)) {
        for (const h of r.holes) if (pointInPolygon([x, y], h)) return false;
        return true;
      }
    }
    return false;
  };

  let lo = 0;
  let hi = 1.5;
  for (let it = 0; it < 20; it++) {
    const s = (lo + hi) / 2;
    const fits = outerPts.every(([x, y]) =>
      inside(bc[0] + (x - dbox.cx) * s, bc[1] + (y - dbox.cy) * s),
    );
    if (fits) lo = s;
    else hi = s;
  }

  if (lo >= 1) return detail; // ya cabía entero a su tamaño
  const s = lo * 0.95; // un pelín de margen para no rozar el borde
  return detail.map((l) => ({
    hole: l.hole,
    pts: l.pts.map(([x, y]) => [bc[0] + (x - dbox.cx) * s, bc[1] + (y - dbox.cy) * s] as Pt),
  }));
}

export function buildReliefPlate(loops: Loop[], detail: Loop[], p: Params, round = false): Piece[] {
  // El posavasos nace redondo mientras el usuario no elija forma; el resto de
  // placas siguen la silueta de la imagen por defecto.
  const shape: MoldShape = round && p.moldShape === 'image' ? 'circle' : p.moldShape;
  const base = moldBase(loops, p, shape);
  // En 'silueta' la placa YA es la forma del dibujo: el dibujo va a tamaño
  // natural, sin tocarlo. En las formas estándar (corazón, círculo…) se encoge
  // para caber entero, centrado; el recorte queda solo como red de seguridad.
  const fitted = shape === 'image' ? detail : fitDetailToBase(detail, base);
  const clip = shape === 'image' ? undefined : base.map((r) => r.outer);
  const overlay = merge(...reliefSolids(fitted, p, p.thickness - 0.01, p.reliefHeight, clip));

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
