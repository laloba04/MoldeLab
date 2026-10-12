export type Pt = [number, number];

/** Un contorno cerrado en milímetros, sin repetir el primer punto al final. */
export interface Loop {
  pts: Pt[];
  hole: boolean;
  /**
   * Este contorno es LÍNEA del dibujo, no mancha de color.
   *
   * Solo aparece con «los colores claros también son dibujo». El relieve viene
   * entonces en dos niveles: las manchas abajo y la línea un escalón por encima,
   * cada cosa su zona y su color. Así un dibujo con vestido rosa y contorno
   * negro sale como en la imagen, en vez de como un pegote.
   *
   * Quien use `detail` entero no nota nada: la línea está DENTRO de la mancha,
   * así que la unión de las dos es exactamente el dibujo de siempre.
   */
  line?: boolean;
}

import { FONT_STYLES, type FontStyle } from './lib/font';
import type { Dome } from './lib/dome';

export interface Silhouette {
  /** Silueta maciza: perímetro exterior + agujeros pasantes. */
  loops: Loop[];
  /** Trazos del dibujo sin rellenar. De aquí sale todo el relieve. */
  detail: Loop[];
  /** Bandas por umbral, de más clara a más oscura. Solo para productos en capas. */
  bands?: Loop[][];
  /**
   * El nombre, aparte del resto del dibujo.
   *
   * Va en su propia lista porque se levanta MÁS ALTO. Puesto a la misma altura
   * que el dibujo no se distingue —no queda encima, queda fundido con él— y la
   * única forma de leerlo era abrir un hueco alrededor, o sea borrar adornos.
   * Con un escalón de altura se lee sin borrar nada.
   *
   * Está en las mismas coordenadas que `loops` y `detail`: se traza con la misma
   * escala y se centra con la misma caja.
   */
  textLoops?: Loop[];
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
  /**
   * Cuerpo que no es ni la placa grabable ni dibujo: se conserva tal cual al
   * grabar, y se pinta con el color de fondo. Es lo que hace falta cuando la
   * cara que se graba no es la que sostiene la pieza — el sello con reborde,
   * donde se graba el reborde pero la placa sigue ahí encima.
   */
  keep?: Mesh;
  /** Sólidos montados sobre la placa (relieve, anillas). Se conservan tal cual
   *  cuando la placa se reconstruye. */
  overlay?: Mesh;
  /**
   * Los trozos sueltos de `overlay`, en el MISMO orden en que se fundieron.
   *
   * `overlay` es siempre `merge(...overlayParts)`. Separados son las zonas que
   * se pueden pintar a mano: cada isla del dibujo, el marco, la anilla. El visor
   * dibuja una por una para saber cuál se toca con el ratón, y el 3MF le da a
   * cada una su color. Fundidas, la pieza es exactamente la misma.
   */
  overlayParts?: Mesh[];
  /**
   * El nombre, levantado por encima del dibujo y con su propio color.
   *
   * Va aparte del `overlay` por las dos cosas a la vez: se extruye más alto —a
   * la misma altura no se distingue del dibujo, queda fundido con él— y se pinta
   * distinto. Siempre es la ÚLTIMA cola de `mesh`, detrás del overlay, que es
   * como el visor y el 3MF reparten los colores.
   */
  textMesh?: Mesh;
  /** La pieza no admite marca de agua de ningún tipo (p. ej. el puzzle o el
   *  articulado, donde cualquier marca soldaría las partes móviles). */
  noMark?: boolean;
  /**
   * La marca va SIEMPRE en relieve, nunca grabada. Para piezas finas y caladas,
   * como la plancha del termoformado: grabar rehace la placa a partir de su
   * contorno, maciza, y se llevaría por delante el calado.
   */
  soloRelieve?: boolean;
  /** Color propio de la pieza, por encima del color de fondo elegido. Lo usan
   *  los productos por capas, donde cada capa va de un color distinto. */
  tint?: string;
  /**
   * La pieza se imprime plana pero se abomba después (termoformado). Con esto
   * el visor puede enseñarla ya abombada, que es como se va a ver; el archivo
   * sigue saliendo plano, que es como se imprime.
   */
  dome?: Dome;
  /**
   * La pieza se imprime BOCA ABAJO: la cara con el dibujo va contra la cama,
   * lisa, y lo demás (el pincho del jibbitz, la copa del AirTag, los huecos
   * del imán) crece hacia arriba. El número es lo que mide de alto.
   *
   * El archivo sale así, que es como se imprime; el visor puede darle la vuelta
   * para enseñarla por la cara, que es como se va a ver.
   */
  caraAbajo?: number;
  /**
   * Dónde va la pieza con todo MONTADO: un giro y un desplazamiento (matriz de
   * 3×4, por filas). Las piezas se imprimen cada una tumbada a su manera; con
   * esto el visor las puede enseñar puestas en su sitio, como quedan una vez
   * encajadas (el rodillo dentro del mango, los tapones en los lados).
   */
  montaje?: number[];
}

// -----------------------------------------------------------------------------
// Catálogo
// -----------------------------------------------------------------------------

export type CategoryId =
  | 'reposteria'
  | 'llaveros'
  | 'letreros'
  | 'personalizados'
  | 'accesorios'
  | 'decoracion';

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
  { id: 'accesorios', label: 'Accesorios', icon: '🧲' },
  { id: 'decoracion', label: 'Decoración', icon: '⭐' },
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
  | 'thermoform'
  | 'figure-box'
  | 'puzzle'
  // Accesorios (novedades)
  | 'magnet'
  | 'jibbitz'
  | 'pen-topper'
  | 'airtag'
  | 'griptok'
  | 'button'
  | 'letter-beads'
  | 'bolt-nut'
  // Decoración y repostería (novedades)
  | 'snowflake'
  | 'roller';

/** Cómo va el dibujo en las piezas que se imprimen boca abajo. */
export type ArtMode = 'inlay' | 'engrave';
/** Dónde va la anilla de colgar, si va. */
export type LoopSide = 'none' | 'top' | 'right' | 'bottom' | 'left';

/** Dibujo del calado de la plancha de termoformado. */
export type HolePattern = 'none' | 'hexagon' | 'circle' | 'square' | 'diamond' | 'triangle';

/** Formas de contorno para las placas. 'image' sigue la silueta del dibujo. */
export type MoldShape =
  | 'image'
  | 'rounded'
  | 'square'
  | 'circle'
  | 'heart'
  | 'hexagon'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'egg';

/** Qué controles enseña cada producto. La UI se dibuja sola desde aquí. */
export type Field = keyof Params;

export interface Product {
  id: ProductId;
  category: CategoryId;
  label: string;
  hint: string;
  fields: Field[];
  /** Distintivo en el menú: 'nuevo' (cian) o 'popular' (rosa). Se usa con
   *  cuentagotas — un menú lleno de etiquetas no destaca nada. */
  badge?: 'nuevo' | 'popular';
  /** La imagen se compone con texto antes de vectorizar. */
  needsText?: boolean;
  /**
   * El texto va ENCIMA de la imagen, no en su lugar: se puede subir un dibujo,
   * escribir un nombre, o las dos cosas. El nombre se levanta aparte del dibujo
   * (`Silhouette.textLoops`) para que se lea.
   */
  imageAndText?: boolean;
  /** El pipeline calcula bandas por umbral además de la silueta. */
  needsBands?: boolean;
  /**
   * Vive en la página de NOVEDADES (`#novedades`), no en la de siempre.
   *
   * Lo nuevo se prueba aparte: la página de siempre se queda tal cual, que es
   * la que se usa en el taller a diario, y lo que aún está por afinar no se le
   * cruza a nadie por medio. Cuando algo esté probado, se le quita la marca y
   * pasa a la de siempre.
   */
  novedad?: boolean;
  /**
   * Ajustes con los que arranca el producto al elegirlo. Un jibbitz mide 25 mm y
   * un rodillo 40 de diámetro: con el tamaño que traiga de otro producto (70 mm)
   * saldría un jibbitz del tamaño de una galleta.
   */
  inicial?: Partial<Params>;
  /**
   * Se genera sin imagen (el copo de nieve): la imagen y el nombre son opcionales
   * y van en el centro, pero sin ellos también sale la pieza.
   */
  sinImagen?: boolean;
  /**
   * Los ajustes repartidos en apartados plegables. Para los productos con
   * muchos mandos: una lista de veinte seguidos abruma, y lo importante (la
   * forma, el tamaño) queda enterrado entre medidas finas que casi nunca se
   * tocan. Si no hay apartados, se enseña `fields` tal cual.
   */
  groups?: FieldGroup[];
}

/** Un apartado de ajustes: título, una línea de ayuda y sus mandos. */
export interface FieldGroup {
  label: string;
  hint?: string;
  fields: Field[];
  /** Abierto al entrar. Los de medidas finas empiezan cerrados. */
  open?: boolean;
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
  /**
   * Contar como dibujo lo que tiene COLOR aunque sea claro.
   *
   * Por luz sola, los mofletes rosas de un dibujo infantil son más claros que el
   * umbral y se leen como fondo. Con esto puesto cuentan como tinta.
   *
   * Va apagado por defecto, y a propósito: un dibujo con manchas de color
   * grandes —un vestido, un lazo— se levanta ENTERO, y las líneas negras de
   * dentro se pierden dentro del pegote, porque el relieve es de una sola
   * altura. Apagado, solo se levanta la línea y se ve el dibujo.
   */
  colorAsInk: boolean;
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
  cutterGrow: number; // margen de masa alrededor del dibujo (mm)

  // Sello / relieve
  stampBase: number;
  stampRim: number; // reborde que sobresale del sello, para agarrarlo y sacarlo
  stampFit: number; // holgura del sello dentro del cortador, por cada lado
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

  // Termoformado
  /** Alto del abombado del molde, en milímetros. */
  formHeight: number;
  /** Grosor de la plancha que se calienta y se abomba. Fina a propósito. */
  sheetThickness: number;
  /** Dibujo del calado de la plancha. 'none' deja la plancha maciza. */
  holePattern: HolePattern;
  /** Distancia de centro a centro entre dos agujeros del calado. */
  holeSpacing: number;
  /** Pared de material que queda entre dos agujeros. */
  holeWall: number;
  /** Calar también por debajo del dibujo, en vez de dejarlo macizo. */
  holesOnDesign: boolean;
  /** Holgura entre las dos mitades del molde, además del grosor de la plancha. */
  formClearance: number;
  /** Sacar también la plancha trasera, para cerrar el adorno por detrás. */
  formBack: boolean;
  /**
   * Con molde: las planchas salen PLANAS y se prensan entre los moldes.
   * Sin molde: salen ya abombadas, para imprimirlas tal cual.
   */
  formMold: boolean;
  /** Radio del cuello por donde se unen las dos planchas. */
  neckRadius: number;
  /** Lo que asoma el cuello por encima de la forma: ahí se enrosca la tuerca. */
  neckLength: number;
  /** Holgura entre la rosca del cuello y la de la tuerca. Más, entra más suelta. */
  capClearance: number;

  /**
   * Largo del marcapáginas, en milímetros.
   *
   * Va aparte del tamaño de la imagen: el ancho lo manda el dibujo, pero el
   * largo es cosa del libro. Sin esto la tira salía proporcional al dibujo —tres
   * veces su ancho— y con una imagen grande daban 60 cm de marcapáginas.
   */
  bookmarkLength: number;

  // Letrero calado
  cutoutMode: 'figure' | 'lines';
  cutLineWidth: number; // grosor de la línea recortada (modo «solo líneas»)
  cutBridges: number; // puentes que sujetan la parte de dentro

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
  /** Tipografía del texto de la pieza. Las mismas cuatro que la marca. */
  textFont: FontStyle;
  /** Giro del texto sobre sí mismo, en grados. */
  textRot: number;
  textX: number; // desplazamiento horizontal del texto, en % (−100 izq … 100 der)
  textY: number; // desplazamiento vertical del texto, en % (−100 arriba … 100 abajo)
  textCurve: number;

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

  // --- Piezas boca abajo (novedades: imán, jibbitz, AirTag…) -----------------
  /** Dibujo incrustado a color (a ras) o grabado hundido (para una tinta). */
  artMode: ArtMode;
  /** Lo que se mete el dibujo en la cara. */
  artDepth: number;
  /** Anilla para colgar (AirTag). */
  loopSide: LoopSide;

  // Imán
  magnetCount: number;
  magnetDia: number;
  magnetDepth: number;

  // Jibbitz
  pegDia: number;
  pegLength: number;
  pegHead: number;

  // Remate de bolígrafo
  penDia: number;
  penHex: boolean;
  penThrough: boolean;

  // AirTag
  airtagWall: number;

  // GripTok
  gripRadius: number;
  gripHeight: number;

  // Botón
  buttonHoles: number;
  buttonHoleDia: number;

  // Cuentas de letras
  beadSize: number;
  beadCombined: boolean;
  cordDia: number;

  // Copo de nieve
  flakeArms: number;
  flakeBranches: number;
  flakeBranchWidth: number;
  flakeBranchLength: number;
  flakeAngle: number;

  // Rodillo
  rollerDia: number;
  rollerWidth: number;
  rollerRepeats: number;
  rollerRows: number;
  /** Cómo se colocan las filas: en cuadrícula, al tresbolillo o en diagonal. */
  rollerLayout: 'grid' | 'staggered' | 'diagonal';
  /** En diagonal, lo que se corre cada fila (en fracción de celda). */
  rollerShift: number;
  /** Giro del dibujo dentro de su celda, en grados. */
  rollerRot: number;
  /** Aros en los extremos: ninguno, lisos o a trozos. */
  rollerEdges: 'none' | 'straight' | 'dashed';
  /** Qué sacar: el rodillo, el mango o las dos cosas. */
  rollerPart: 'both' | 'roller' | 'handle';

  // Tornillo y tuerca
  boltPart: 'both' | 'bolt' | 'nut';
  boltDia: number;
  boltLength: number;
  boltPitch: number;
  boltClearance: number;
  nutShape: 'hexagon' | 'square' | 'round';
}

export const DEFAULTS: Params = {
  product: 'cutter-stamp',

  threshold: 128,
  detailThreshold: 128,
  useDetailThreshold: false,
  colorAsInk: false,
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
  cutterGrow: 0,

  stampBase: 2,
  stampRim: 3,
  stampFit: 0.4,
  reliefHeight: 1.2,
  reliefTaper: 0.25,
  strokeWidth: 0,
  handle: false,
  handleHeight: 18,

  thickness: 3,
  border: 4,
  cornerRadius: 6,
  bookmarkLength: 150,
  // Por defecto el molde sigue la silueta de la imagen subida: es lo que la
  // usuaria espera («que se adapte a la imagen»), no un rectángulo fijo.
  moldShape: 'image',

  formHeight: 12,
  sheetThickness: 0.6,
  holePattern: 'hexagon',
  holeSpacing: 4,
  holeWall: 0.8,
  // Como en un adorno de verdad: el panal sigue por debajo del dibujo.
  holesOnDesign: true,
  formClearance: 0.3,
  formBack: true,
  formMold: true,
  neckRadius: 3.5,
  neckLength: 5,
  // Holgura de una rosca impresa: con menos, la tuerca no entra; con más, baila.
  capClearance: 0.3,
  cutoutMode: 'lines',
  cutLineWidth: 2,
  cutBridges: 6,

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
  textFont: 'redonda',
  textRot: 0,
  textX: 0,
  textY: 0,
  textCurve: 90,

  layers: 3,
  layerHeight: 1.2,

  segments: 4,
  hingeGap: 1.5,

  puzzleRows: 3,
  puzzleCols: 4,

  boxHeight: 30,
  lidLip: 3,

  artMode: 'inlay',
  artDepth: 0.8,
  loopSide: 'top',

  magnetCount: 1,
  magnetDia: 8,
  magnetDepth: 2,

  // Lo que miden los de tienda: tallo de 6 para el agujero del zueco, que mide
  // unos 4 de grueso, y cabeza de 10 para que no se salga.
  pegDia: 6,
  pegLength: 4,
  pegHead: 10,

  penDia: 7,
  penHex: false,
  penThrough: false,

  airtagWall: 1.6,

  gripRadius: 19.9,
  gripHeight: 1.3,

  buttonHoles: 4,
  buttonHoleDia: 2,

  beadSize: 10,
  beadCombined: false,
  cordDia: 3,

  flakeArms: 6,
  flakeBranches: 3,
  flakeBranchWidth: 3,
  flakeBranchLength: 12,
  flakeAngle: 60,

  // Los mismos de partida que Formify.
  rollerDia: 60,
  rollerWidth: 80,
  rollerRepeats: 5,
  rollerRows: 2,
  rollerLayout: 'diagonal',
  rollerShift: 0.3,
  rollerRot: 0,
  rollerEdges: 'none',
  rollerPart: 'both',

  boltPart: 'both',
  boltDia: 10,
  boltLength: 20,
  boltPitch: 1.5,
  boltClearance: 0.25,
  nutShape: 'hexagon',
};

/** Un metadato de control: deslizador (rango), interruptor o desplegable. */
export type FieldMeta =
  | { label: string; unit?: string; min: number; max: number; step: number }
  | { toggle: true; label: string }
  | {
      select: true;
      label: string;
      /** `novedad`: la opción solo sale en la página de novedades. */
      options: { value: string; label: string; novedad?: boolean }[];
    };

/** Etiquetas y rangos de cada control. Un sitio, no cinco. */
export const FIELD_META: Record<Field, FieldMeta> = {
  product: { toggle: true, label: '' },

  threshold: { label: 'Umbral', min: 8, max: 248, step: 1 },
  detailThreshold: { label: 'Umbral del detalle', min: 8, max: 248, step: 1 },
  useDetailThreshold: { toggle: true, label: 'Umbral aparte para el detalle' },
  colorAsInk: { toggle: true, label: 'Los colores claros también son dibujo' },
  invert: { toggle: true, label: 'Invertir claro/oscuro' },
  cleanup: { label: 'Limpieza', unit: 'px', min: 0, max: 5, step: 1 },
  simplify: { label: 'Simplificar', unit: 'mm', min: 0, max: 1, step: 0.05 },
  smooth: { label: 'Suavizar', min: 0, max: 5, step: 1 },
  minIslandPct: { label: 'Ignorar islas menores de', unit: '%', min: 0, max: 25, step: 1 },

  targetWidthMm: { label: 'Tamaño', unit: 'mm', min: 15, max: 250, step: 1 },

  cutterHeight: { label: 'Altura', unit: 'mm', min: 6, max: 30, step: 0.5 },
  wallThickness: { label: 'Grosor de pared', unit: 'mm', min: 0.6, max: 3, step: 0.1 },
  bladeThickness: { label: 'Filo', unit: 'mm', min: 0.2, max: 1.2, step: 0.05 },
  bladeHeight: { label: 'Altura del filo', unit: 'mm', min: 0, max: 10, step: 0.5 },
  flangeWidth: { label: 'Pestaña', unit: 'mm', min: 0, max: 5, step: 0.2 },
  flangeHeight: { label: 'Altura de la pestaña', unit: 'mm', min: 0, max: 4, step: 0.2 },
  cutHoles: { toggle: true, label: 'Cortar también los huecos' },
  // De décima en décima: el margen de masa se ajusta al gusto (2,6 mm si hace
  // falta), no a saltos de medio milímetro.
  cutterGrow: { label: 'Agrandar el cortador', unit: 'mm', min: 0, max: 12, step: 0.1 },

  stampBase: { label: 'Base', unit: 'mm', min: 1, max: 6, step: 0.2 },
  stampRim: { label: 'Reborde para agarrar', unit: 'mm', min: 0, max: 10, step: 0.5 },
  stampFit: { label: 'Holgura del sello', unit: 'mm', min: 0, max: 1.5, step: 0.1 },
  reliefHeight: { label: 'Altura del relieve', unit: 'mm', min: 0.3, max: 4, step: 0.1 },
  reliefTaper: { label: 'Ángulo de salida', unit: 'mm', min: 0, max: 0.8, step: 0.05 },
  strokeWidth: { label: 'Engrosar trazo', unit: 'mm', min: -1, max: 2, step: 0.1 },
  handle: { toggle: true, label: 'Añadir tirador' },
  handleHeight: { label: 'Alto del tirador', unit: 'mm', min: 8, max: 40, step: 1 },

  thickness: { label: 'Grosor', unit: 'mm', min: 1, max: 12, step: 0.2 },
  border: { label: 'Marco', unit: 'mm', min: 0, max: 20, step: 0.5 },
  cornerRadius: { label: 'Radio de esquina', unit: 'mm', min: 0, max: 25, step: 0.5 },
  bookmarkLength: { label: 'Largo', unit: 'mm', min: 60, max: 260, step: 5 },
  moldShape: {
    select: true,
    label: 'Forma del molde',
    options: [
      { value: 'image', label: 'Silueta (imagen)' },
      { value: 'rounded', label: 'Rectángulo redondeado' },
      { value: 'square', label: 'Cuadrado' },
      { value: 'circle', label: 'Círculo' },
      { value: 'heart', label: 'Corazón' },
      { value: 'hexagon', label: 'Hexágono', novedad: true },
      { value: 'triangle', label: 'Triángulo', novedad: true },
      { value: 'diamond', label: 'Rombo', novedad: true },
      { value: 'star', label: 'Estrella', novedad: true },
      { value: 'egg', label: 'Huevo', novedad: true },
    ],
  },

  formHeight: { label: 'Alto del abombado', unit: 'mm', min: 3, max: 40, step: 1 },
  sheetThickness: { label: 'Grosor de la plancha', unit: 'mm', min: 0.4, max: 2, step: 0.1 },
  holeSpacing: { label: 'Separación del calado', unit: 'mm', min: 2, max: 12, step: 0.5 },
  holeWall: { label: 'Pared entre agujeros', unit: 'mm', min: 0.4, max: 3, step: 0.1 },
  holesOnDesign: { toggle: true, label: 'Calar también el dibujo' },
  formClearance: { label: 'Holgura del molde', unit: 'mm', min: 0, max: 1.5, step: 0.05 },
  formBack: { toggle: true, label: 'Plancha trasera y tuerca (cierra el adorno)' },
  formMold: { toggle: true, label: 'Con molde (planchas planas para prensar)' },
  neckRadius: { label: 'Grosor del cuello', unit: 'mm', min: 2, max: 8, step: 0.5 },
  neckLength: { label: 'Largo del cuello', unit: 'mm', min: 3, max: 15, step: 0.5 },
  capClearance: { label: 'Holgura de la rosca', unit: 'mm', min: 0.1, max: 0.6, step: 0.05 },
  holePattern: {
    select: true,
    label: 'Calado de la plancha',
    options: [
      { value: 'hexagon', label: 'Panal (hexágonos)' },
      { value: 'circle', label: 'Círculos' },
      { value: 'square', label: 'Cuadrados' },
      { value: 'diamond', label: 'Rombos' },
      { value: 'triangle', label: 'Triángulos' },
      { value: 'none', label: 'Sin calar (maciza)' },
    ],
  },

  cutoutMode: {
    select: true,
    label: 'Qué se recorta',
    options: [
      { value: 'lines', label: 'Solo las líneas (a contraluz)' },
      { value: 'figure', label: 'La figura entera' },
    ],
  },
  cutLineWidth: { label: 'Grosor de la línea', unit: 'mm', min: 0.8, max: 6, step: 0.2 },
  cutBridges: { label: 'Puentes de sujeción', min: 0, max: 12, step: 1 },

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
  textScale: { label: 'Tamaño del texto', unit: '%', min: 25, max: 100, step: 5 },
  // En porcentaje y no en milímetros: el desplazamiento es relativo al tamaño
  // de la pieza, así que al cambiar el tamaño el texto se queda donde estaba.
  textFont: {
    select: true,
    label: 'Tipografía',
    options: FONT_STYLES.map((f) => ({ value: f.id, label: f.label })),
  },
  textRot: { label: 'Girar texto', unit: '°', min: -180, max: 180, step: 5 },
  textX: { label: 'Mover texto ↔', unit: '%', min: -100, max: 100, step: 5 },
  textY: { label: 'Mover texto ↕', unit: '%', min: -100, max: 100, step: 5 },
  textCurve: { label: 'Curvatura', unit: '°', min: 10, max: 180, step: 5 },

  layers: { label: 'Capas', min: 2, max: 4, step: 1 },
  layerHeight: { label: 'Alto de cada capa', unit: 'mm', min: 0.4, max: 3, step: 0.2 },

  segments: { label: 'Segmentos', min: 2, max: 8, step: 1 },
  hingeGap: { label: 'Separación', unit: 'mm', min: 0.8, max: 4, step: 0.1 },

  puzzleRows: { label: 'Filas', min: 2, max: 6, step: 1 },
  puzzleCols: { label: 'Columnas', min: 2, max: 6, step: 1 },

  boxHeight: { label: 'Alto de la caja', unit: 'mm', min: 10, max: 60, step: 1 },
  lidLip: { label: 'Labio de la tapa', unit: 'mm', min: 1.5, max: 6, step: 0.5 },

  artMode: {
    select: true,
    label: 'El dibujo',
    options: [
      { value: 'inlay', label: 'Incrustado a color (a ras)' },
      { value: 'engrave', label: 'Grabado hundido (una tinta)' },
    ],
  },
  artDepth: { label: 'Profundidad del dibujo', unit: 'mm', min: 0.2, max: 2, step: 0.1 },
  loopSide: {
    select: true,
    label: 'Anilla para colgar',
    options: [
      { value: 'none', label: 'Sin anilla' },
      { value: 'top', label: 'Arriba' },
      { value: 'right', label: 'Derecha' },
      { value: 'bottom', label: 'Abajo' },
      { value: 'left', label: 'Izquierda' },
    ],
  },

  magnetCount: { label: 'Imanes', min: 1, max: 4, step: 1 },
  magnetDia: { label: 'Diámetro del imán', unit: 'mm', min: 3, max: 25, step: 0.5 },
  magnetDepth: { label: 'Grosor del imán', unit: 'mm', min: 1, max: 6, step: 0.5 },

  pegDia: { label: 'Grosor del tallo', unit: 'mm', min: 4, max: 9, step: 0.1 },
  pegLength: { label: 'Largo del tallo (grosor del zueco)', unit: 'mm', min: 2, max: 8, step: 0.5 },
  pegHead: { label: 'Cabeza del tallo', unit: 'mm', min: 7, max: 14, step: 0.5 },

  penDia: { label: 'Grosor del bolígrafo', unit: 'mm', min: 5, max: 14, step: 0.1 },
  penHex: { toggle: true, label: 'Bolígrafo hexagonal' },
  penThrough: { toggle: true, label: 'Agujero pasante' },

  airtagWall: { label: 'Pared del soporte', unit: 'mm', min: 1, max: 3, step: 0.1 },

  gripRadius: { label: 'Radio del agarre', unit: 'mm', min: 12, max: 25, step: 0.1 },
  gripHeight: { label: 'Alto del aro', unit: 'mm', min: 0.6, max: 4, step: 0.1 },

  buttonHoles: { label: 'Agujeros para coser', min: 2, max: 4, step: 2 },
  buttonHoleDia: { label: 'Tamaño de los agujeros', unit: 'mm', min: 1, max: 4, step: 0.1 },

  beadSize: { label: 'Tamaño de la cuenta', unit: 'mm', min: 6, max: 20, step: 0.5 },
  beadCombined: { toggle: true, label: 'Todo en una sola cuenta' },
  cordDia: { label: 'Grosor del cordón', unit: 'mm', min: 0.8, max: 6, step: 0.1 },

  flakeArms: { label: 'Brazos', min: 5, max: 8, step: 1 },
  flakeBranches: { label: 'Ramitas por brazo', min: 0, max: 6, step: 1 },
  flakeBranchWidth: { label: 'Grosor de las ramas', unit: 'mm', min: 1.5, max: 8, step: 0.5 },
  flakeBranchLength: { label: 'Largo de las ramitas', unit: 'mm', min: 3, max: 40, step: 0.5 },
  flakeAngle: { label: 'Ángulo de las ramitas', unit: '°', min: 20, max: 80, step: 5 },

  rollerDia: { label: 'Diámetro del rodillo', unit: 'mm', min: 20, max: 80, step: 1 },
  rollerWidth: { label: 'Ancho del rodillo', unit: 'mm', min: 20, max: 150, step: 1 },
  rollerRepeats: { label: 'Dibujos por vuelta', min: 1, max: 12, step: 1 },
  rollerRows: { label: 'Filas', min: 1, max: 6, step: 1 },
  rollerLayout: {
    select: true,
    label: 'Colocación',
    options: [
      { value: 'grid', label: 'En cuadrícula' },
      { value: 'staggered', label: 'Al tresbolillo' },
      { value: 'diagonal', label: 'En diagonal' },
    ],
  },
  rollerShift: { label: 'Desplazamiento diagonal', min: 0.05, max: 0.95, step: 0.05 },
  rollerRot: { label: 'Girar el dibujo', unit: '°', min: -180, max: 180, step: 5 },
  rollerEdges: {
    select: true,
    label: 'Bordes de los extremos',
    options: [
      { value: 'none', label: 'Sin bordes' },
      { value: 'straight', label: 'Lisos (marca una raya)' },
      { value: 'dashed', label: 'A trozos (marca un punteado)' },
    ],
  },
  rollerPart: {
    select: true,
    label: 'Qué sacar',
    options: [
      { value: 'both', label: 'Rodillo y mango' },
      { value: 'roller', label: 'Solo el rodillo' },
      { value: 'handle', label: 'Solo el mango' },
    ],
  },

  boltPart: {
    select: true,
    label: 'Qué sacar',
    options: [
      { value: 'both', label: 'Tornillo y tuerca' },
      { value: 'bolt', label: 'Solo el tornillo' },
      { value: 'nut', label: 'Solo la tuerca' },
    ],
  },
  boltDia: { label: 'Grosor del tornillo', unit: 'mm', min: 5, max: 24, step: 0.5 },
  boltLength: { label: 'Largo de la rosca', unit: 'mm', min: 5, max: 80, step: 1 },
  boltPitch: { label: 'Paso de la rosca', unit: 'mm', min: 0.8, max: 3, step: 0.05 },
  boltClearance: { label: 'Holgura de la rosca', unit: 'mm', min: 0.1, max: 0.6, step: 0.05 },
  nutShape: {
    select: true,
    label: 'Forma de la tuerca',
    options: [
      { value: 'hexagon', label: 'Hexagonal' },
      { value: 'square', label: 'Cuadrada' },
      { value: 'round', label: 'Redonda' },
    ],
  },
};

/** Controles de vectorizado: los ve todo producto, siempre. */
export const TRACE_FIELDS: Field[] = [
  'threshold',
  'useDetailThreshold',
  'detailThreshold',
  'colorAsInk',
  'invert',
  'cleanup',
  'simplify',
  'smooth',
  'minIslandPct',
];
