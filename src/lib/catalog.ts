/**
 * El catálogo.
 *
 * Un producto es tres cosas: qué controles enseña, qué sólidos construye, y en
 * qué categoría vive. Nada más. La interfaz se dibuja sola a partir de `fields`
 * y el pipeline llama a `build`. Añadir un producto es añadir una entrada aquí.
 */

import type { Loop, Params, Piece, Product, ProductId, Silhouette } from '../types';
import { merge } from './mesh';
import { buildCutter } from './generators/cutter';
import { stampBaseRegions, stampSolids } from './generators/stamp';
import { buildEjector } from './generators/ejector';
import {
  buildArticulated,
  buildBox,
  buildColoringPlate,
  buildLayered,
  buildOpener,
  buildPlateTag,
  buildPuzzle,
  buildWireJig,
} from './generators/extra-parts';
import {
  buildBookmark,
  buildExtrude,
  buildImprintMold,
  buildInlayPlate,
  buildKeychain,
  buildOutline,
  buildPracticePlate,
  buildReliefPlate,
  buildStandingSign,
  buildStencil,
  buildTag,
  buildTopper,
  buildWallSign,
  repeatGrid,
} from './generators/catalog-parts';

type Build = (s: Silhouette, p: Params) => Piece[];

const SIZE = ['targetWidthMm'] as const;

const CUTTER_FIELDS = [
  ...SIZE,
  'cutterHeight',
  'wallThickness',
  'bladeThickness',
  'bladeHeight',
  'flangeWidth',
  'flangeHeight',
  'cutHoles',
] as const;

const STAMP_FIELDS = [...SIZE, 'stampBase', 'reliefHeight', 'reliefTaper', 'handle'] as const;

const PLATE_FIELDS = [...SIZE, 'thickness', 'border', 'cornerRadius'] as const;

const RELIEF_FIELDS = ['reliefHeight', 'reliefTaper'] as const;

const EJECTOR_FIELDS = [
  ...SIZE,
  'ejectorHeight',
  'ejectorWall',
  'ejectorClearance',
  'plungerThickness',
  'rodHeight',
  'rodDiameter',
  ...RELIEF_FIELDS,
] as const;

interface Entry extends Product {
  build: Build;
}

export const PRODUCTS: Entry[] = [
  // ─── Repostería ────────────────────────────────────────────────────────────
  {
    id: 'cutter',
    category: 'reposteria',
    label: 'Cortador',
    hint: 'Recorta la masa siguiendo el contorno.',
    fields: [...CUTTER_FIELDS],
    build: (s, p) => cutterPieces(s.loops, p),
  },
  {
    id: 'cutter-stamp',
    category: 'reposteria',
    label: 'Cortador con estampa',
    hint: 'Corta y marca el dibujo de una vez.',
    fields: [...CUTTER_FIELDS, 'stampBase', 'reliefHeight', 'reliefTaper'],
    build: (s, p) => [
      ...cutterPieces(s.loops, p),
      ...stampPieces(s.loops, s.detail, p),
    ],
  },
  {
    id: 'stamp',
    category: 'reposteria',
    label: 'Sello',
    hint: 'Marca el relieve sin cortar.',
    fields: [...STAMP_FIELDS],
    build: (s, p) => stampPieces(s.loops, s.detail, p),
  },
  {
    id: 'embosser',
    category: 'reposteria',
    label: 'Sello con mango',
    hint: 'Sello con agarre para presionar de pie.',
    fields: [...STAMP_FIELDS, 'handleHeight'],
    build: (s, p) => stampPieces(s.loops, s.detail, { ...p, handle: true }),
  },
  {
    id: 'stencil',
    category: 'reposteria',
    label: 'Plantilla',
    hint: 'Placa calada: se espolvorea cacao o azúcar por encima.',
    fields: [...PLATE_FIELDS],
    build: (s, p) => buildStencil(s.loops, s.detail, { ...p, thickness: Math.min(p.thickness, 2) }),
  },
  {
    id: 'cake-topper',
    category: 'reposteria',
    label: 'Topper de tarta',
    hint: 'La silueta con púas para clavarla en la tarta.',
    fields: [...SIZE, 'thickness', 'spikeLength', 'spikeWidth', 'spikeCount', ...RELIEF_FIELDS],
    build: (s, p) => buildTopper(s.loops, s.detail, p),
  },
  {
    id: 'ejector-silhouette',
    category: 'reposteria',
    label: 'Eyector · silueta',
    hint: 'El cuerpo sigue el contorno de tu imagen.',
    fields: [...EJECTOR_FIELDS],
    build: (s, p) => buildEjector(s.loops, s.detail, p, 'silhouette'),
  },
  {
    id: 'ejector-round',
    category: 'reposteria',
    label: 'Eyector · redondo',
    hint: 'Cuerpo circular. La imagen solo marca el relieve.',
    fields: [...EJECTOR_FIELDS],
    build: (s, p) => buildEjector(s.loops, s.detail, p, 'round'),
  },
  {
    id: 'ejector-square',
    category: 'reposteria',
    label: 'Eyector · cuadrado',
    hint: 'Cuerpo cuadrado con las esquinas al radio que quieras.',
    fields: [...EJECTOR_FIELDS, 'cornerRadius'],
    build: (s, p) => buildEjector(s.loops, s.detail, p, 'square'),
  },
  {
    id: 'multi-cutter',
    category: 'reposteria',
    label: 'Multicortador',
    hint: 'Varias copias del cortador en una sola cama.',
    fields: [...CUTTER_FIELDS, 'copies', 'gridCols', 'spacing'],
    build: (s, p) => repeatGrid(cutterPieces(s.loops, p), s.loops, p),
  },
  {
    id: 'practice-plate',
    category: 'reposteria',
    label: 'Placa de entrenamiento',
    hint: 'El dibujo hundido, para practicar la glasa encima.',
    fields: [...PLATE_FIELDS, 'engraveDepth'],
    build: (s, p) => buildPracticePlate(s.loops, s.detail, p),
  },
  {
    id: 'imprint-mold',
    category: 'reposteria',
    label: 'Molde de impronta',
    hint: 'La silueta hundida en un bloque. Se rellena y se desmolda.',
    fields: [...PLATE_FIELDS, 'engraveDepth'],
    build: (s, p) => buildImprintMold(s.loops, p),
  },

  // ─── Llaveros ──────────────────────────────────────────────────────────────
  {
    id: 'keychain-silhouette',
    category: 'llaveros',
    label: 'Llavero silueta',
    hint: 'La forma recortada, con su anilla.',
    fields: [...SIZE, 'thickness', 'ringOuter', 'ringInner'],
    build: (s, p) => buildKeychain(s.loops, s.detail, p, 'silhouette'),
  },
  {
    id: 'keychain-relief',
    category: 'llaveros',
    label: 'Llavero con relieve',
    hint: 'La silueta con el dibujo levantado encima.',
    fields: [...SIZE, 'thickness', 'ringOuter', 'ringInner', ...RELIEF_FIELDS],
    build: (s, p) => buildKeychain(s.loops, s.detail, p, 'relief'),
  },
  {
    id: 'keychain-cutout',
    category: 'llaveros',
    label: 'Llavero calado',
    hint: 'El dibujo atraviesa la etiqueta. Se ve la luz.',
    fields: [...SIZE, 'thickness', 'border', 'cornerRadius', 'ringOuter', 'ringInner'],
    build: (s, p) => buildKeychain(s.loops, s.detail, p, 'cutout'),
  },
  {
    id: 'keychain-text',
    category: 'llaveros',
    label: 'Llavero de texto',
    hint: 'Escribe un nombre y sale un llavero.',
    needsText: true,
    fields: ['textScale', 'thickness', ...SIZE, 'ringOuter', 'ringInner'],
    build: (s, p) => buildKeychain(s.loops, s.detail, p, 'silhouette'),
  },
  {
    id: 'keychain-image-text',
    category: 'llaveros',
    label: 'Llavero imagen + texto',
    hint: 'Tu imagen arriba, el nombre debajo, en una pieza.',
    needsText: true,
    fields: ['textScale', 'thickness', ...SIZE, 'ringOuter', 'ringInner', ...RELIEF_FIELDS],
    build: (s, p) => buildKeychain(s.loops, s.detail, p, 'relief'),
  },
  {
    id: 'keychain-layers',
    category: 'llaveros',
    label: 'Llavero en capas',
    hint: 'Una pieza por tono: cambia de filamento y sale a colores.',
    needsBands: true,
    fields: [...SIZE, 'thickness', 'layers', 'layerHeight', 'ringOuter', 'ringInner'],
    build: (s, p) => buildLayered(s, p, true),
  },
  {
    id: 'keychain-plate',
    category: 'llaveros',
    label: 'Llavero matrícula',
    hint: 'Placa con marco, como una matrícula en miniatura.',
    needsText: true,
    fields: ['textScale', ...SIZE, 'thickness', 'border', 'cornerRadius', ...RELIEF_FIELDS, 'ringOuter', 'ringInner'],
    build: (s, p) => buildPlateTag(s, p),
  },
  {
    id: 'keychain-articulated',
    category: 'llaveros',
    label: 'Llavero articulado',
    hint: 'Segmentos con bisagra viva: se dobla sin romperse.',
    fields: [...SIZE, 'thickness', 'segments', 'hingeGap', 'ringOuter', 'ringInner'],
    build: (s, p) => buildArticulated(s, p),
  },
  {
    id: 'tag-round',
    category: 'llaveros',
    label: 'Chapa redonda',
    hint: 'Disco con el dibujo en relieve.',
    fields: [...SIZE, 'thickness', 'border', 'ringOuter', 'ringInner', ...RELIEF_FIELDS],
    build: (s, p) => buildTag(s.loops, s.detail, p, true),
  },
  {
    id: 'tag-rect',
    category: 'llaveros',
    label: 'Chapa rectangular',
    hint: 'Etiqueta con esquinas redondeadas.',
    fields: [...SIZE, 'thickness', 'border', 'cornerRadius', 'ringOuter', 'ringInner', ...RELIEF_FIELDS],
    build: (s, p) => buildTag(s.loops, s.detail, p, false),
  },

  // ─── Letreros ──────────────────────────────────────────────────────────────
  {
    id: 'sign-standing',
    category: 'letreros',
    label: 'Letrero de pie',
    hint: 'La silueta y una peana con ranura. Dos piezas.',
    fields: [...SIZE, 'thickness', 'border', 'cornerRadius', 'standAngle', 'standDepth'],
    build: (s, p) => buildStandingSign(s.loops, p),
  },
  {
    id: 'sign-wall',
    category: 'letreros',
    label: 'Letrero de pared',
    hint: 'Placa con cuatro agujeros de tornillo.',
    fields: [...PLATE_FIELDS, 'mountHoleDia', ...RELIEF_FIELDS],
    build: (s, p) => buildWallSign(s.loops, s.detail, p),
  },
  {
    id: 'sign-cutout',
    category: 'letreros',
    label: 'Letrero calado',
    hint: 'El dibujo atraviesa la placa. Bonito a contraluz.',
    fields: [...PLATE_FIELDS],
    build: (s, p) => buildStencil(s.loops, s.detail, p),
  },

  {
    id: 'sign-bigletter',
    category: 'letreros',
    label: 'Letrero de letra grande',
    hint: 'Escribe la palabra: sale de pie, con su peana.',
    needsText: true,
    fields: ['textScale', ...SIZE, 'thickness', 'border', 'standAngle', 'standDepth'],
    build: (s, p) => buildStandingSign(s.loops, p),
  },
  {
    id: 'sign-curved',
    category: 'letreros',
    label: 'Letrero curvo',
    hint: 'El texto en arco, como una sonrisa.',
    needsText: true,
    fields: ['textScale', 'textCurve', ...SIZE, 'thickness'],
    build: (s, p) => buildExtrude(s.loops, p),
  },
  {
    id: 'sign-color-layers',
    category: 'letreros',
    label: 'Letrero en capas de color',
    hint: 'Cada tono de la imagen en su propia capa.',
    needsBands: true,
    fields: [...SIZE, 'thickness', 'layers', 'layerHeight'],
    build: (s, p) => buildLayered(s, p, false),
  },

  // ─── Personalizados ────────────────────────────────────────────────────────
  {
    id: 'extrude',
    category: 'personalizados',
    label: 'Extrusión',
    hint: 'La silueta, sin más. El punto de partida de todo.',
    fields: [...SIZE, 'thickness'],
    build: (s, p) => buildExtrude(s.loops, p),
  },
  {
    id: 'relief-plate',
    category: 'personalizados',
    label: 'Placa con relieve',
    hint: 'El dibujo levantado sobre una placa.',
    fields: [...PLATE_FIELDS, ...RELIEF_FIELDS],
    build: (s, p) => buildReliefPlate(s.loops, s.detail, p),
  },
  {
    id: 'inlay-plate',
    category: 'personalizados',
    label: 'Placa grabada',
    hint: 'El dibujo hundido. Se puede rellenar con otro color.',
    fields: [...PLATE_FIELDS, 'engraveDepth'],
    build: (s, p) => buildInlayPlate(s.loops, s.detail, p),
  },
  {
    id: 'outline-only',
    category: 'personalizados',
    label: 'Solo contorno',
    hint: 'Un aro que sigue la silueta, hueco por dentro.',
    fields: [...SIZE, 'thickness', 'wallThickness'],
    build: (s, p) => buildOutline(s.loops, p),
  },
  {
    id: 'coaster',
    category: 'personalizados',
    label: 'Posavasos',
    hint: 'Disco con el dibujo en relieve.',
    fields: [...SIZE, 'thickness', 'border', ...RELIEF_FIELDS],
    build: (s, p) => buildReliefPlate(s.loops, s.detail, p, true),
  },
  {
    id: 'bookmark',
    category: 'personalizados',
    label: 'Marcapáginas',
    hint: 'Tira alargada con agujero para la borla.',
    fields: [...SIZE, 'thickness', 'border', 'cornerRadius', 'ringInner', ...RELIEF_FIELDS],
    build: (s, p) => buildBookmark(s.loops, s.detail, p),
  },
  {
    id: 'wire-jig',
    category: 'personalizados',
    label: 'Molde guía para alambre',
    hint: 'El contorno como muro: dobla el alambre apoyado en él.',
    fields: [...SIZE, 'thickness', 'border', 'wallThickness', 'reliefHeight'],
    build: (s, p) => buildWireJig(s, p),
  },
  {
    id: 'coloring-plate',
    category: 'personalizados',
    label: 'Placa para colorear',
    hint: 'Las líneas en relieve, los huecos para pintar.',
    fields: [...PLATE_FIELDS, 'reliefHeight'],
    build: (s, p) => buildColoringPlate(s, p),
  },
  {
    id: 'qr-plate',
    category: 'personalizados',
    label: 'Placa QR',
    hint: 'Pega un enlace: sale un QR que se escanea de verdad.',
    needsQr: true,
    fields: [...SIZE, 'thickness', 'border', 'cornerRadius', ...RELIEF_FIELDS],
    build: (s, p) => buildReliefPlate(s.loops, s.detail, p),
  },
  {
    id: 'opener-stamp',
    category: 'personalizados',
    label: 'Abridor con sello',
    hint: 'Tu silueta con boca de abridor. Imprímelo macizo y en PETG.',
    fields: [...SIZE, 'thickness', ...RELIEF_FIELDS],
    build: (s, p) => buildOpener(s, p),
  },
  {
    id: 'figure-box',
    category: 'personalizados',
    label: 'Caja de figuritas',
    hint: 'La silueta hecha caja, con tapa que encaja.',
    fields: [...SIZE, 'wallThickness', 'boxHeight', 'lidLip', 'thickness', ...RELIEF_FIELDS],
    build: (s, p) => buildBox(s, p),
  },
  {
    id: 'puzzle',
    category: 'personalizados',
    label: 'Rompecabezas de imagen',
    hint: 'La placa cortada en piezas que encajan. Con tu dibujo encima.',
    fields: [...SIZE, 'thickness', 'border', 'puzzleRows', 'puzzleCols', 'reliefHeight'],
    build: (s, p) => buildPuzzle(s, p),
  },
];

// --- Envoltorios para las piezas heredadas ----------------------------------

function cutterPieces(loops: Loop[], p: Params): Piece[] {
  const mesh = buildCutter(loops, p);
  return mesh.positions.length
    ? [{ id: 'cutter', label: 'Cortador', role: 'blade', mesh }]
    : [];
}

function stampPieces(loops: Loop[], detail: Loop[], p: Params): Piece[] {
  const base = stampBaseRegions(loops);
  const solids = stampSolids(loops, detail, p);
  const mesh = merge(...solids);
  if (!mesh.positions.length) return [];

  // stampSolids devuelve primero la placa (un sólido por región); el resto
  // (relieve y tirador) es el overlay que sobrevive al grabado de la marca.
  return [{
    id: 'stamp',
    label: 'Sello',
    role: 'icing',
    mesh,
    plate: { regions: base, zLo: 0, zHi: p.stampBase },
    overlay: merge(...solids.slice(base.length)),
  }];
}

// --- API --------------------------------------------------------------------

export const byId = (id: ProductId): Entry =>
  PRODUCTS.find((p) => p.id === id) ?? PRODUCTS[0];

export function buildProduct(s: Silhouette, p: Params): Piece[] {
  const entry = byId(p.product);
  return entry.build(s, p).filter((pc) => pc.mesh.positions.length > 0);
}

export function searchProducts(q: string): Entry[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return PRODUCTS;
  return PRODUCTS.filter(
    (p) =>
      p.label.toLowerCase().includes(needle) ||
      p.hint.toLowerCase().includes(needle) ||
      p.id.includes(needle),
  );
}
