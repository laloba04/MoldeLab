/**
 * Auditoría del termoformado.
 *
 * Lo que se juega aquí no se ve en pantalla. Las dos mitades del molde salen de
 * caminos distintos —la cúpula de bandas lofteadas, el cuenco de losas anulares
 * apiladas— y tienen que encajar con la plancha en medio. Si el cuenco se queda
 * corto, al prensar se aplasta el adorno; si se pasa, la plancha no copia la
 * forma. Eso no lo enseña el visor: se mide.
 *
 * La primera versión del cuenco salió del revés —hueco ancho en el fondo y
 * cerrándose hacia arriba, o sea un bloque con un agujerito— y ningún test lo
 * pilló, porque la malla era perfectamente válida. Por eso aquí se mide la BOCA
 * del cuenco, no solo que exista.
 */

import { buildProduct } from '../src/lib/catalog';
import { DEFAULTS, type Loop, type Mesh, type Params, type Piece, type Pt } from '../src/types';

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? '  — ' + extra : ''}`);
}

function volumen(m: Mesh): number {
  let v = 0;
  const p = m.positions;
  for (let i = 0; i < p.length; i += 9) {
    const a = [p[i], p[i + 1], p[i + 2]];
    const b = [p[i + 3], p[i + 4], p[i + 5]];
    const c = [p[i + 6], p[i + 7], p[i + 8]];
    v +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

function aristasAbiertas(m: Mesh): number {
  const k = (x: number) => Math.round(x * 1e4) / 1e4;
  const vk = (i: number) => `${k(m.positions[i])},${k(m.positions[i + 1])},${k(m.positions[i + 2])}`;
  const edges = new Map<string, number>();
  for (let i = 0; i < m.positions.length; i += 9) {
    const v = [vk(i), vk(i + 3), vk(i + 6)];
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      const rev = `${b}|${a}`;
      if (edges.get(rev)) edges.set(rev, edges.get(rev)! - 1);
      else edges.set(`${a}|${b}`, (edges.get(`${a}|${b}`) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of edges.values()) open += Math.abs(n);
  return open;
}

function raros(m: Mesh): number {
  let n = 0;
  for (const v of m.positions) if (!Number.isFinite(v)) n++;
  return n;
}

function alto(m: Mesh): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 2; i < m.positions.length; i += 3) {
    const z = m.positions[i];
    if (z < min) min = z;
    if (z > max) max = z;
  }
  return { min, max };
}

/**
 * Alto de la malla SIN contar el cuello. El cuello sale por el borde de arriba
 * y es más gordo que la plancha a propósito; lo que tiene que ser fino es todo
 * lo demás, que es lo que se abomba.
 */
function altoSinCuello(m: Mesh): number {
  let yMax = -Infinity;
  for (let i = 1; i < m.positions.length; i += 3) yMax = Math.max(yMax, m.positions[i]);
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < m.positions.length; i += 3) {
    if (m.positions[i + 1] > yMax - DEFAULTS.neckLength - 2) continue;
    zMin = Math.min(zMin, m.positions[i + 2]);
    zMax = Math.max(zMax, m.positions[i + 2]);
  }
  return zMax - zMin;
}

/**
 * Lo ancha que es la malla a una altura dada: el segmento X que ocupan los
 * triángulos que cruzan ese plano. Sirve para medir la BOCA del cuenco: tiene
 * que ser ancha arriba y estrecha en el fondo.
 */
function huecoEnZ(m: Mesh, z: number, cy: number): number {
  // Se mira la fila y = cy y se busca el tramo SIN material más ancho en el centro.
  const xs: number[] = [];
  const p = m.positions;
  for (let i = 0; i < p.length; i += 9) {
    const tri = [0, 3, 6].map((o) => [p[i + o], p[i + o + 1], p[i + o + 2]]);
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      if ((a[2] - z) * (b[2] - z) > 0 || a[2] === b[2]) continue;
      const t = (z - a[2]) / (b[2] - a[2]);
      const x = a[0] + t * (b[0] - a[0]);
      const y = a[1] + t * (b[1] - a[1]);
      if (Math.abs(y - cy) < 0.6) xs.push(x);
    }
  }
  // Las paredes interiores: las x de corte más cercanas al centro por cada lado.
  const izq = xs.filter((x) => x < 0).reduce((a, x) => Math.max(a, x), -Infinity);
  const der = xs.filter((x) => x > 0).reduce((a, x) => Math.min(a, x), Infinity);
  return Number.isFinite(izq) && Number.isFinite(der) ? der - izq : 0;
}

/** Silueta de prueba: un cuadrado con un agujero, que es lo peor que puede venir. */
const cuadro: Pt[] = [
  [-20, -20],
  [20, -20],
  [20, 20],
  [-20, 20],
];
const agujero: Pt[] = [
  [-6, -6],
  [-6, 6],
  [6, 6],
  [6, -6],
];
const loops: Loop[] = [
  { pts: cuadro, hole: false },
  { pts: agujero, hole: true },
];
const detalle: Loop[] = [{ pts: [[-12, -4], [12, -4], [12, 4], [-12, 4]] as Pt[], hole: false }];
const sil = { loops, detail: detalle, widthMm: 40, heightMm: 40 };

const hacer = (extra: Partial<Params> = {}): Piece[] =>
  buildProduct(sil, { ...DEFAULTS, product: 'thermoform', ...extra });

console.log('MoldeLab — auditoría del termoformado\n');

const piezas = hacer();
check('salen las seis piezas', piezas.length === 6, piezas.map((p) => p.label).join(', '));

const plancha = piezas.find((p) => p.id === 'sheet')!;
const traseraPlana = piezas.find((p) => p.id === 'sheet-back')!;
const tapon = piezas.find((p) => p.id === 'cap')!;
const macho = piezas.find((p) => p.id === 'mold-up')!;
const hembra = piezas.find((p) => p.id === 'mold-down')!;

// --- Cada pieza, un sólido de verdad -----------------------------------------
for (const pz of piezas) {
  const v = volumen(pz.mesh);
  check(`${pz.label}: sin coordenadas raras`, raros(pz.mesh) === 0);
  check(`${pz.label}: volumen positivo`, v > 0, `${v.toFixed(1)} mm³`);
}

check('la cúpula cierra', aristasAbiertas(macho.mesh) === 0, `${aristasAbiertas(macho.mesh)} aristas abiertas`);
check('el cuenco cierra', aristasAbiertas(hembra.mesh) === 0, `${aristasAbiertas(hembra.mesh)} aristas abiertas`);

// --- El cuenco está abierto por ARRIBA ---------------------------------------
//
// Es justo lo que salió mal la primera vez. Se corta el cuenco a varias alturas
// y se mide el hueco: tiene que ensancharse hacia la boca, como un cuenco, y no
// cerrarse como una cúpula hueca.
{
  const a = alto(hembra.mesh);
  const cyH = 0;
  const fondo = huecoEnZ(hembra.mesh, a.min + 3 + 0.5, cyH);
  const medio = huecoEnZ(hembra.mesh, a.min + 3 + (a.max - a.min - 3) * 0.5, cyH);
  const boca = huecoEnZ(hembra.mesh, a.max - DEFAULTS.sheetThickness - 0.2, cyH);
  check('el hueco del cuenco se abre hacia arriba', fondo < medio && medio < boca,
    `fondo ${fondo.toFixed(1)} < medio ${medio.toFixed(1)} < boca ${boca.toFixed(1)} mm`);

  // La boca tiene que ser más ancha que la cúpula, por lo que mide la plancha.
  const cupulaAncho = (() => {
    let x0 = Infinity, x1 = -Infinity;
    const p = macho.mesh.positions;
    for (let i = 0; i < p.length; i += 3) if (p[i + 2] > 3) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); }
    return x1 - x0;
  })();
  check('la boca deja sitio a la plancha alrededor de la cúpula',
    boca > cupulaAncho + DEFAULTS.sheetThickness,
    `boca ${boca.toFixed(1)} mm, cúpula ${cupulaAncho.toFixed(1)} mm`);

  // Y el escalón: justo bajo el borde, el hueco mide lo que la PLANCHA entera
  // (con su borde plano), más que la boca del hueco de la cúpula.
  const escalon = huecoEnZ(hembra.mesh, a.max - DEFAULTS.sheetThickness / 2, cyH);
  check('hay escalón donde se apoya el borde de la plancha', escalon > boca + 2,
    `escalón ${escalon.toFixed(1)} mm > boca ${boca.toFixed(1)} mm`);

  // Abrir la holgura agranda la BOCA. No vale medir volumen: con más holgura el
  // hueco también es más hondo y el bloque crece con él, así que el cuenco puede
  // ganar material aunque el hueco sea mayor. Lo que importa es el sitio
  // alrededor de la cúpula, y eso es el ancho de la boca.
  const bocaCon = (h: number) => {
    const m = hacer({ formClearance: h }).find((x) => x.id === 'mold-down')!.mesh;
    return huecoEnZ(m, alto(m).max - DEFAULTS.sheetThickness - 0.2, 0);
  };
  const bApretada = bocaCon(0);
  const bHolgada = bocaCon(1);
  check('abrir la holgura agranda la boca del cuenco', bHolgada > bApretada + 1.5,
    `holgada ${bHolgada.toFixed(1)} mm > apretada ${bApretada.toFixed(1)} mm`);

  // Y es más hondo que la cúpula alta: si se queda corto, se aplasta el adorno.
  const hondo = a.max - a.min - 3 - DEFAULTS.sheetThickness;
  check('el hueco es más hondo que la cúpula', hondo >= DEFAULTS.formHeight,
    `${hondo.toFixed(1)} mm de hueco para ${DEFAULTS.formHeight} mm de cúpula`);
}

// --- Las planchas cierran ----------------------------------------------------
//
// Esto se escapó al principio: no se miraba, y la plancha salía con 80 grietas
// en cuanto había un dibujo. El calado se recortaba contra el borde recto de la
// zona del dibujo y el triangulador se comía puntos de esa recta. Se mira con
// dibujo, que es el caso que lo destapaba.
check('la plancha delantera cierra', aristasAbiertas(plancha.mesh) === 0,
  `${aristasAbiertas(plancha.mesh)} aristas abiertas`);
check('la plancha trasera cierra', aristasAbiertas(traseraPlana.mesh) === 0,
  `${aristasAbiertas(traseraPlana.mesh)} aristas abiertas`);

// --- La plancha es PLANA y fina ----------------------------------------------
{
  const h = altoSinCuello(plancha.mesh);
  const esperado = DEFAULTS.sheetThickness + DEFAULTS.reliefHeight;
  check('la plancha es fina', h <= esperado + 0.05, `${h.toFixed(2)} mm (grosor + relieve = ${esperado.toFixed(2)})`);
}

// --- El calado quita material ------------------------------------------------
{
  const maciza = hacer({ holePattern: 'none' }).find((p) => p.id === 'sheet')!;
  check('el calado quita material de verdad', volumen(plancha.mesh) < volumen(maciza.mesh) * 0.9,
    `calada ${volumen(plancha.mesh).toFixed(0)} vs maciza ${volumen(maciza.mesh).toFixed(0)} mm³`);

  // De serie el panal sigue por debajo del dibujo, como en un adorno de verdad.
  // Quitándolo, el dibujo queda sobre plancha maciza: tiene que haber más.
  check('de serie, el panal pasa por debajo del dibujo', DEFAULTS.holesOnDesign === true);
  const respetado = hacer({ holesOnDesign: false }).find((p) => p.id === 'sheet')!;
  check('respetar el dibujo deja más material que calarlo',
    volumen(respetado.mesh) > volumen(plancha.mesh),
    `respetado ${volumen(respetado.mesh).toFixed(0)} vs calado ${volumen(plancha.mesh).toFixed(0)}`);
}

// --- Las dos planchas son iguales y se pueden juntar --------------------------
{
  // Lisa = sin dibujo. Lleva el reborde, que sobresale 0,6 mm, y nada más.
  check('la trasera es lisa (sin dibujo, solo el reborde)',
    altoSinCuello(traseraPlana.mesh) <= DEFAULTS.sheetThickness + 0.6 + 0.02,
    `${altoSinCuello(traseraPlana.mesh).toFixed(2)} mm`);

  const caja = (m: Mesh) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      x0 = Math.min(x0, m.positions[i]); x1 = Math.max(x1, m.positions[i]);
      y0 = Math.min(y0, m.positions[i + 1]); y1 = Math.max(y1, m.positions[i + 1]);
    }
    return [x1 - x0, y1 - y0];
  };
  const [aw, ah] = caja(plancha.mesh);
  const [bw, bh] = caja(traseraPlana.mesh);
  check('las dos planchas tienen el mismo contorno', Math.abs(aw - bw) < 0.01 && Math.abs(ah - bh) < 0.01,
    `${aw.toFixed(1)}×${ah.toFixed(1)} vs ${bw.toFixed(1)}×${bh.toFixed(1)}`);

  const sola = hacer({ formBack: false });
  check('se puede prescindir de la trasera (y del tapón)',
    sola.length === 3 && !sola.some((x) => x.id === 'sheet-back' || x.id === 'cap'),
    sola.map((x) => x.label).join(', '));
}

// --- El tapón y el cuello ----------------------------------------------------
//
// El tapón tiene que entrar por el cuello —agujero más ancho que el cuello liso—
// y tiene que agarrar —más estrecho que las crestas de las estrías—. Si no entra
// no se cierra el adorno; si no agarra se cae al colgarlo.
{
  check('el tapón es un sólido cerrado', volumen(tapon.mesh) > 0 && aristasAbiertas(tapon.mesh) === 0,
    `${volumen(tapon.mesh).toFixed(0)} mm³, ${aristasAbiertas(tapon.mesh)} aristas abiertas`);

  const r = DEFAULTS.neckRadius;
  const cresta = r + 1.2 * 0.4;
  const interior = r + 1.2 * 0.2 + DEFAULTS.capClearance;
  check('el tapón entra por el cuello liso', interior > r, `agujero ${interior.toFixed(2)} > cuello ${r}`);
  check('y agarra en las estrías', interior < cresta, `agujero ${interior.toFixed(2)} < cresta ${cresta.toFixed(2)}`);

  // Cada plancha lleva MEDIO cuello: su alto es un radio (con la estría), así
  // que al juntar las dos por la cara plana sale un cuello redondo entero.
  check('el medio cuello mide un radio de alto', Math.abs(alto(traseraPlana.mesh).max - cresta) < 0.05,
    `${alto(traseraPlana.mesh).max.toFixed(2)} mm (radio + estría = ${cresta.toFixed(2)})`);
}

// --- Sin molde: las planchas salen ya abombadas ------------------------------
//
// El abombado parte triángulos y mueve vértices. Es fácil dejar una grieta —un
// vértice partido de un lado y no del otro— y el laminador no la perdona. Por
// eso se exige que la plancha abombada siga CERRADA, no solo que tenga forma.
{
  const sinMolde = hacer({ formMold: false });
  check('sin molde no salen moldes', !sinMolde.some((x) => x.id.startsWith('mold')),
    sinMolde.map((x) => x.label).join(', '));

  const abombada = sinMolde.find((x) => x.id === 'sheet-back')!;
  const sube = alto(abombada.mesh).max - DEFAULTS.sheetThickness;
  check('la plancha sin molde sale abombada', sube > DEFAULTS.formHeight * 0.8,
    `sube ${sube.toFixed(1)} mm con ${DEFAULTS.formHeight} mm de cúpula`);
  check('la plancha abombada sigue cerrada', aristasAbiertas(abombada.mesh) === 0,
    `${aristasAbiertas(abombada.mesh)} aristas abiertas`);

  // Abombar mueve en vertical: no puede crear ni quitar plástico de golpe.
  const vPlana = volumen(traseraPlana.mesh);
  const vAbomb = volumen(abombada.mesh);
  check('abombar conserva el material', Math.abs(vAbomb - vPlana) / vPlana < 0.05,
    `plana ${vPlana.toFixed(0)} mm³, abombada ${vAbomb.toFixed(0)} mm³`);

  // Y con molde, el visor tiene con qué enseñarla abombada sin tocar el archivo.
  check('con molde, las planchas traen su cúpula para el visor', !!plancha.dome && !!traseraPlana.dome);
}

// --- El nombre ---------------------------------------------------------------
{
  const letras: Loop[] = [{ pts: [[-8, 6], [8, 6], [8, 10], [-8, 10]] as Pt[], hole: false }];
  const conNombre = buildProduct({ ...sil, textLoops: letras }, { ...DEFAULTS, product: 'thermoform' });
  const delantera = conNombre.find((x) => x.id === 'sheet')!;
  check('con nombre, la delantera lleva la capa del nombre', !!delantera.textMesh?.positions.length);
  const hNombre = delantera.textMesh ? alto(delantera.textMesh).max : 0;
  const hDibujo = delantera.overlay ? alto(delantera.overlay).max : 0;
  check('el nombre queda más alto que el dibujo', hNombre > hDibujo,
    `nombre ${hNombre.toFixed(2)} mm, dibujo ${hDibujo.toFixed(2)} mm`);
  check('la trasera no lleva nombre', !conNombre.find((x) => x.id === 'sheet-back')!.textMesh);

  // El nombre NO quita agujeros: las letras van encima del panal. Se compara la
  // plancha con y sin nombre, aun con el dibujo protegido: el calado tiene que
  // ser el mismo, agujero por agujero.
  const sinN = buildProduct(sil, { ...DEFAULTS, product: 'thermoform', holesOnDesign: false }).find((x) => x.id === 'sheet')!;
  const conN = buildProduct({ ...sil, textLoops: letras }, { ...DEFAULTS, product: 'thermoform', holesOnDesign: false }).find((x) => x.id === 'sheet')!;
  const huecos = (pz: Piece) => pz.plate!.regions.reduce((n, r) => n + r.holes.length, 0);
  check('el nombre no quita agujeros del panal', huecos(sinN) === huecos(conN),
    `${huecos(sinN)} agujeros sin nombre, ${huecos(conN)} con nombre`);
}

// --- La pinza de abajo -------------------------------------------------------
//
// Cierra las dos planchas por abajo. Su ranura tiene que tragarse los DOS bordes
// planos juntos, y no ser tan honda que llegue a la cúpula y la aplaste.
{
  const pinza = piezas.find((x) => x.id === 'clip')!;
  check('hay pinza', !!pinza);
  check('la pinza es un sólido cerrado', volumen(pinza.mesh) > 0 && aristasAbiertas(pinza.mesh) === 0,
    `${volumen(pinza.mesh).toFixed(0)} mm³, ${aristasAbiertas(pinza.mesh)} aristas abiertas`);
  // La ranura: el hueco en la mitad del bloque, medido de lado a lado.
  const a = alto(pinza.mesh);
  const ranura = huecoEnZ(pinza.mesh, (a.min + a.max) / 2, 0.5);
  const dos = DEFAULTS.sheetThickness * 2;
  check('la ranura de la pinza traga las dos planchas', ranura > dos && ranura < dos + 0.6,
    `ranura ${ranura.toFixed(2)} mm para ${dos.toFixed(2)} mm de planchas`);
}

// --- Las formas también montan -----------------------------------------------
{
  const malas: string[] = [];
  for (const forma of ['circle', 'hexagon', 'triangle', 'diamond', 'star', 'egg', 'heart', 'square'] as const) {
    const ps = hacer({ moldShape: forma });
    if (ps.length !== 6 || ps.some((p) => volumen(p.mesh) <= 0)) malas.push(forma);
  }
  check('todas las formas de molde montan las seis piezas', malas.length === 0,
    malas.length ? `fallan: ${malas.join(', ')}` : 'círculo, hexágono, triángulo, rombo, estrella, huevo, corazón, cuadrado');
}

{
  const vacios: string[] = [];
  for (const pat of ['hexagon', 'circle', 'square', 'diamond', 'triangle'] as const) {
    const pz = hacer({ holePattern: pat }).find((p) => p.id === 'sheet');
    if (!pz || volumen(pz.mesh) <= 0) vacios.push(pat);
  }
  check('los cinco calados dan plancha', vacios.length === 0, vacios.join(', ') || 'panal, círculos, cuadrados, rombos, triángulos');
}

// --- El cuello nace de la plancha, también en el corazón ---------------------
//
// En el corazón, lo alto de la caja son las puntas de los lóbulos y en el centro
// no hay plancha: es el hueco de la muesca. El cuello se quedaba ahí flotando,
// suelto a un lado. Se exige que el cuello se meta en la plancha.
{
  const sueltos: string[] = [];
  for (const forma of ['circle', 'heart', 'star', 'egg'] as const) {
    const pz = hacer({ moldShape: forma }).find((x) => x.id === 'sheet-back')!;
    const q = pz.mesh.positions;
    // El cuello es lo único que sube más que la plancha y su reborde.
    const tope = DEFAULTS.sheetThickness + 0.6 + 0.1;
    let cuelloMinY = Infinity;
    let cuelloX = 0;
    let nC = 0;
    for (let i = 0; i < q.length; i += 3) {
      if (q[i + 2] > tope) {
        cuelloMinY = Math.min(cuelloMinY, q[i + 1]);
        cuelloX += q[i];
        nC++;
      }
    }
    cuelloX /= nC || 1;
    // Lo más alto de la plancha justo debajo del cuello.
    let planchaMaxY = -Infinity;
    for (let i = 0; i < q.length; i += 3) {
      const enPlancha = q[i + 2] <= DEFAULTS.sheetThickness + 0.01;
      if (enPlancha && Math.abs(q[i] - cuelloX) < 1.5 && q[i + 1] < cuelloMinY + 3) {
        planchaMaxY = Math.max(planchaMaxY, q[i + 1]);
      }
    }
    if (!(cuelloMinY < planchaMaxY)) {
      sueltos.push(`${forma} (cuello desde ${cuelloMinY.toFixed(1)}, plancha hasta ${planchaMaxY.toFixed(1)})`);
    }
  }
  check('el cuello se mete en la plancha en todas las formas', sueltos.length === 0,
    sueltos.join('; ') || 'círculo, corazón, estrella, huevo');
}

// --- Los moldes son lisos ----------------------------------------------------
//
// Apilando losas salían a terrazas: decenas de escalones horizontales. Ahora la
// cara de arriba se deforma entera. Se cuentan las alturas a las que hay caras
// planas mirando arriba por encima de la pestaña: liso, casi ninguna.
{
  const terrazas = (m: Mesh, desde: number) => {
    const niveles = new Set<number>();
    const p = m.positions;
    for (let i = 0; i < p.length; i += 9) {
      const z = [p[i + 2], p[i + 5], p[i + 8]];
      if (Math.max(...z) - Math.min(...z) > 1e-4) continue;
      if (z[0] <= desde) continue;
      const nz = (p[i + 3] - p[i]) * (p[i + 7] - p[i + 1]) - (p[i + 4] - p[i + 1]) * (p[i + 6] - p[i]);
      if (nz > 0) niveles.add(Math.round(z[0] * 100));
    }
    return niveles.size;
  };
  const tMacho = terrazas(macho.mesh, 2.6);
  check('la cúpula es lisa, sin terrazas', tMacho <= 2, `${tMacho} alturas con caras planas`);
}

console.log(failures ? `\n${failures} fallo(s).` : '\nTodo correcto.');
process.exitCode = failures ? 1 : 0;
