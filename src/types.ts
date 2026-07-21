export type Pt = [number, number];

/** Un contorno cerrado en milímetros, sin repetir el primer punto al final. */
export interface Loop {
  pts: Pt[];
  hole: boolean;
}

export interface Silhouette {
  /** Silueta maciza: perímetro exterior + agujeros pasantes. */
  loops: Loop[];
  /** Trazos del dibujo sin rellenar. De aquí sale todo el relieve. */
  detail: Loop[];
  /** Bandas por umbral, de más clara a más oscura. Solo para productos en capas. */
  bands?: Loop[][];
  widthMm: number;
  heightMm: number;
}

export interface Mesh {
  positions: number[];
}

export interface Piece {
  id: string;
  label: string;
  /** Color en el visor: 'blade' = corta, 'icing' = marca, 'body' = estructura. */
  role: 'blade' | 'icing' | 'body';
  mesh: Mesh;
  /**
   * Placa base reconstruible: sus regiones 2D y el tramo de Z que ocupan.
   * Si está, la marca de agua puede grabarse en 2D recomponiendo la placa por
   * capas con el texto como agujero (patrón `engraved`), sin booleanas 3D.
   */
  plate?: { regions: { outer: Pt[]; holes: Pt[][] }[]; zLo: number; zHi: number };
  /** Sólidos montados sobre la placa (relieve, anillas). Se conservan tal cual
   *  cuando la placa se reconstruye. */
  overlay?: Mesh;
  /** La pieza no admite marca de agua de ningún tipo (p. ej. el puzzle o el
   *  articulado, donde cualquier marca soldaría las partes móviles). */
  noMark?: boolean;
  /** Color propio de la pieza, por encima del color de fondo elegido. Lo usan
   *  los productos por capas, donde cada capa va de un color distinto. */
  tint?: string;
}

// -----------------------------------------------------------------------------
// Catálogo
// -----------------------------------------------------------------------------

export type CategoryId = 'reposteria' | 'llaveros' | 'letreros' | 'personalizados';

export interface Category {
  id: CategoryId;
  label: string;
  icon: string;
}

export const CATEGORIES: Category[] = [
  { id: 'reposteria', label: 'Repostería', icon: '🍪' },
  { id: 'llaveros', label: 'Llaveros', icon: '🔑' },
  { id: 'letreros', label: 'Letreros', icon: '🪧' },
  { id: 'personalizados', label: 'Personalizados', icon: '🎨' },
];

export type ProductId =
  // Repostería
  | 'cutter'
  | 'cutter-stamp'
  | 'stamp'
  | 'embosser'
  | 'stencil'
  | 'cake-topper'
  | 'ejector-silhouette'
  | 'ejector-round'
  | 'ejector-square'
  | 'multi-cutter'
  | 'practice-plate'
  | 'imprint-mold'
  // Llaveros
  | 'keychain-silhouette'
  | 'keychain-relief'
  | 'keychain-cutout'
  | 'keychain-text'
  | 'keychain-image-text'
  | 'keychain-layers'
  | 'keychain-plate'
  | 'keychain-articulated'
  | 'tag-round'
  | 'tag-rect'
  // Letreros
  | 'sign-standing'
  | 'sign-wall'
  | 'sign-cutout'
  | 'sign-bigletter'
  | 'sign-curved'
  | 'sign-color-layers'
  // Personalizados
  | 'extrude'
  | 'relief-plate'
  | 'inlay-plate'
  | 'outline-only'
  | 'coaster'
  | 'bookmark'
  | 'wire-jig'
  | 'coloring-plate'
  | 'qr-plate'
  | 'opener-stamp'
  | 'figure-box'
  | 'puzzle';

/** Formas de contorno para las placas. 'image' sigue la silueta del dibujo. */
export type MoldShape = 'image' | 'rounded' | 'square' | 'circle' | 'heart';

/** Qué controles enseña cada producto. La UI se dibuja sola desde aquí. */
export type Field = keyof Params;

export interface Product {
  id: ProductId;
  category: CategoryId;
  label: string;
  hint: string;
  fields: Field[];
  /** La imagen se compone con texto antes de vectorizar. */
  needsText?: boolean;
  /** La imagen ES un código QR generado a partir de `qrContent`. */
  needsQr?: boolean;
  /** El pipeline calcula bandas por umbral además de la silueta. */
  needsBands?: boolean;
}

// -----------------------------------------------------------------------------
// Parámetros
// -----------------------------------------------------------------------------

export interface Params {
  product: ProductId;

  // Vectorizado
  threshold: number;
  detailThreshold: number;
  useDetailThreshold: boolean;
  invert: boolean;
  cleanup: number;
  simplify: number;
  smooth: number;
  minIslandPct: number;

  // Tamaño
  targetWidthMm: number;

  // Cortador
  cutterHeight: number;
  wallThickness: number;
  bladeThickness: number;
  bladeHeight: number;
  flangeWidth: number;
  flangeHeight: number;
  cutHoles: boolean;

  // Sello / relieve
  stampBase: number;
  stampRim: number; // reborde que sobresale del sello, para agarrarlo y sacarlo
  reliefHeight: number;
  reliefTaper: number;
  strokeWidth: number;
  handle: boolean;
  handleHeight: number;

  // Placa genérica
  thickness: number;
  border: number;
  cornerRadius: number;
  /** Contorno del molde en las placas: seguir la imagen o una forma estándar. */
  moldShape: MoldShape;

  // Grabado en hueco
  engraveDepth: number;

  // Eyector
  ejectorHeight: number;
  ejectorWall: number;
  ejectorClearance: number;
  plungerThickness: number;
  rodHeight: number;
  rodDiameter: number;

  // Multicortador
  copies: number;
  gridCols: number;
  spacing: number;

  // Anilla de llavero
  ringOuter: number;
  ringInner: number;
  ringPos: number; // posición horizontal de la anilla: -1 izq, 0 centro, 1 der
  ringPosY: number; // posición vertical de la anilla (arrastrada con el ratón)
  ringNeck: number; // largo del rabito de la anilla (mm)

  // Letreros
  standAngle: number;
  standDepth: number;
  mountHoleDia: number;

  // Topper de tarta
  spikeLength: number;
  spikeWidth: number;
  spikeCount: number;

  // Fuentes: texto y QR (se consumen ANTES del pipeline, en la composición)
  textContent: string;
  textScale: number;
  textX: number; // desplazamiento horizontal del texto (−1 izq … 1 der)
  textY: number; // desplazamiento vertical del texto (−1 arriba … 1 abajo)
  textCurve: number;
  qrContent: string;

  // Capas de color
  layers: number;
  layerHeight: number;

  // Articulado
  segments: number;
  hingeGap: number;

  // Puzzle
  puzzleRows: number;
  puzzleCols: number;

  // Caja
  boxHeight: number;
  lidLip: number;
}

export const DEFAULTS: Params = {
  product: 'cutter-stamp',

  threshold: 128,
  detailThreshold: 128,
  useDetailThreshold: false,
  invert: false,
  cleanup: 1,
  simplify: 0.15,
  smooth: 2,
  minIslandPct: 2,

  targetWidthMm: 70,

  cutterHeight: 15,
  wallThickness: 1.2,
  bladeThickness: 0.4,
  bladeHeight: 3,
  flangeWidth: 1.6,
  flangeHeight: 1.2,
  cutHoles: true,

  stampBase: 2,
  stampRim: 3,
  reliefHeight: 1.2,
  reliefTaper: 0.25,
  strokeWidth: 0,
  handle: false,
  handleHeight: 18,

  thickness: 3,
  border: 4,
  cornerRadius: 6,
  // Por defecto el molde sigue la silueta de la imagen subida: es lo que la
  // usuaria espera («que se adapte a la imagen»), no un rectángulo fijo.
  moldShape: 'image',

  engraveDepth: 0.8,

  ejectorHeight: 22,
  ejectorWall: 1.6,
  ejectorClearance: 0.35,
  plungerThickness: 2.4,
  rodHeight: 30,
  rodDiameter: 8,

  copies: 4,
  gridCols: 2,
  spacing: 4,

  ringOuter: 5,
  ringInner: 2.5,
  ringPos: 0,
  ringPosY: 0,
  ringNeck: 10,

  standAngle: 15,
  standDepth: 30,
  mountHoleDia: 4,

  spikeLength: 40,
  spikeWidth: 3,
  spikeCount: 2,

  textContent: '',
  textScale: 70,
  textX: 0,
  textY: 0,
  textCurve: 90,
  qrContent: '',

  layers: 3,
  layerHeight: 1.2,

  segments: 4,
  hingeGap: 1.5,

  puzzleRows: 3,
  puzzleCols: 4,

  boxHeight: 30,
  lidLip: 3,
};

/** Un metadato de control: deslizador (rango), interruptor o desplegable. */
export type FieldMeta =
  | { label: string; unit?: string; min: number; max: number; step: number }
  | { toggle: true; label: string }
  | { select: true; label: string; options: { value: string; label: string }[] };

/** Etiquetas y rangos de cada control. Un sitio, no cinco. */
export const FIELD_META: Record<Field, FieldMeta> = {
  product: { toggle: true, label: '' },

  threshold: { label: 'Umbral', min: 8, max: 248, step: 1 },
  detailThreshold: { label: 'Umbral del detalle', min: 8, max: 248, step: 1 },
  useDetailThreshold: { toggle: true, label: 'Umbral aparte para el detalle' },
  invert: { toggle: true, label: 'Invertir claro/oscuro' },
  cleanup: { label: 'Limpieza', unit: 'px', min: 0, max: 5, step: 1 },
  simplify: { label: 'Simplificar', unit: 'mm', min: 0, max: 1, step: 0.05 },
  smooth: { label: 'Suavizar', min: 0, max: 5, step: 1 },
  minIslandPct: { label: 'Ignorar islas menores de', unit: '%', min: 0, max: 25, step: 1 },

  targetWidthMm: { label: 'Tamaño', unit: 'mm', min: 15, max: 200, step: 1 },

  cutterHeight: { label: 'Altura', unit: 'mm', min: 6, max: 30, step: 0.5 },
  wallThickness: { label: 'Grosor de pared', unit: 'mm', min: 0.6, max: 3, step: 0.1 },
  bladeThickness: { label: 'Filo', unit: 'mm', min: 0.2, max: 1.2, step: 0.05 },
  bladeHeight: { label: 'Altura del filo', unit: 'mm', min: 0, max: 10, step: 0.5 },
  flangeWidth: { label: 'Pestaña', unit: 'mm', min: 0, max: 5, step: 0.2 },
  flangeHeight: { label: 'Altura de la pestaña', unit: 'mm', min: 0, max: 4, step: 0.2 },
  cutHoles: { toggle: true, label: 'Cortar también los huecos' },

  stampBase: { label: 'Base', unit: 'mm', min: 1, max: 6, step: 0.2 },
  stampRim: { label: 'Reborde para agarrar', unit: 'mm', min: 0, max: 10, step: 0.5 },
  reliefHeight: { label: 'Altura del relieve', unit: 'mm', min: 0.3, max: 4, step: 0.1 },
  reliefTaper: { label: 'Ángulo de salida', unit: 'mm', min: 0, max: 0.8, step: 0.05 },
  strokeWidth: { label: 'Engrosar trazo', unit: 'mm', min: -1, max: 2, step: 0.1 },
  handle: { toggle: true, label: 'Añadir tirador' },
  handleHeight: { label: 'Alto del tirador', unit: 'mm', min: 8, max: 40, step: 1 },

  thickness: { label: 'Grosor', unit: 'mm', min: 1, max: 12, step: 0.2 },
  border: { label: 'Marco', unit: 'mm', min: 0, max: 20, step: 0.5 },
  cornerRadius: { label: 'Radio de esquina', unit: 'mm', min: 0, max: 25, step: 0.5 },
  moldShape: {
    select: true,
    label: 'Forma del molde',
    options: [
      { value: 'image', label: 'Silueta (imagen)' },
      { value: 'rounded', label: 'Rectángulo redondeado' },
      { value: 'square', label: 'Cuadrado' },
      { value: 'circle', label: 'Círculo' },
      { value: 'heart', label: 'Corazón' },
    ],
  },

  engraveDepth: { label: 'Profundidad del grabado', unit: 'mm', min: 0.2, max: 4, step: 0.1 },

  ejectorHeight: { label: 'Altura del cuerpo', unit: 'mm', min: 10, max: 45, step: 1 },
  ejectorWall: { label: 'Pared', unit: 'mm', min: 0.8, max: 4, step: 0.1 },
  ejectorClearance: { label: 'Holgura del émbolo', unit: 'mm', min: 0.1, max: 0.8, step: 0.05 },
  plungerThickness: { label: 'Grosor del émbolo', unit: 'mm', min: 1.2, max: 6, step: 0.2 },
  rodHeight: { label: 'Vástago', unit: 'mm', min: 10, max: 60, step: 1 },
  rodDiameter: { label: 'Diámetro del vástago', unit: 'mm', min: 4, max: 16, step: 0.5 },

  copies: { label: 'Copias', min: 2, max: 12, step: 1 },
  gridCols: { label: 'Columnas', min: 1, max: 6, step: 1 },
  spacing: { label: 'Separación', unit: 'mm', min: 0, max: 20, step: 0.5 },

  ringOuter: { label: 'Anilla', unit: 'mm', min: 3, max: 10, step: 0.5 },
  ringInner: { label: 'Agujero de la anilla', unit: 'mm', min: 1.5, max: 6, step: 0.5 },
  ringPos: { label: 'Posición de la anilla', unit: '', min: -1, max: 1, step: 0.1 },
  ringPosY: { label: 'Altura de la anilla', unit: '', min: -1.5, max: 1.5, step: 0.05 },
  ringNeck: { label: 'Largo de la anilla', unit: 'mm', min: 3, max: 40, step: 1 },

  standAngle: { label: 'Inclinación', unit: '°', min: 0, max: 40, step: 1 },
  standDepth: { label: 'Fondo del pie', unit: 'mm', min: 10, max: 60, step: 1 },
  mountHoleDia: { label: 'Agujero de tornillo', unit: 'mm', min: 2, max: 8, step: 0.5 },

  spikeLength: { label: 'Largo de las púas', unit: 'mm', min: 15, max: 80, step: 1 },
  spikeWidth: { label: 'Ancho de las púas', unit: 'mm', min: 1.5, max: 8, step: 0.5 },
  spikeCount: { label: 'Número de púas', min: 1, max: 4, step: 1 },

  textContent: { toggle: true, label: '' },
  qrContent: { toggle: true, label: '' },
  textScale: { label: 'Tamaño del texto', unit: '%', min: 25, max: 100, step: 5 },
  textX: { label: 'Mover texto ↔', unit: '', min: -1, max: 1, step: 0.05 },
  textY: { label: 'Mover texto ↕', unit: '', min: -1, max: 1, step: 0.05 },
  textCurve: { label: 'Curvatura', unit: '°', min: 10, max: 180, step: 5 },

  layers: { label: 'Capas', min: 2, max: 4, step: 1 },
  layerHeight: { label: 'Alto de cada capa', unit: 'mm', min: 0.4, max: 3, step: 0.2 },

  segments: { label: 'Segmentos', min: 2, max: 8, step: 1 },
  hingeGap: { label: 'Separación', unit: 'mm', min: 0.8, max: 4, step: 0.1 },

  puzzleRows: { label: 'Filas', min: 2, max: 6, step: 1 },
  puzzleCols: { label: 'Columnas', min: 2, max: 6, step: 1 },

  boxHeight: { label: 'Alto de la caja', unit: 'mm', min: 10, max: 60, step: 1 },
  lidLip: { label: 'Labio de la tapa', unit: 'mm', min: 1.5, max: 6, step: 0.5 },
};

/** Controles de vectorizado: los ve todo producto, siempre. */
export const TRACE_FIELDS: Field[] = [
  'threshold',
  'useDetailThreshold',
  'detailThreshold',
  'invert',
  'cleanup',
  'simplify',
  'smooth',
  'minIslandPct',
];
