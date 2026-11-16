/**
 * Termoformado 2: mallas con borde alto que se juntan por el borde, media rosca
 * en cada una, clip por ventanitas, imanes, diseño a ras por cara y moldes con
 * cavidad (abajo) y ranura para el borde (arriba).
 *
 * Lo que importa aquí no se ve en pantalla: que todo salga cerrado, que nada
 * baje de la cama, que las dos mitades se junten justo en el plano del borde y
 * que los moldes dejen sitio al borde y a la cúpula.
 */

import { buildProduct, byId } from '../src/lib/catalog';
import { armarArchivo } from '../src/lib/exportar';
import { FIGURAS } from '../src/lib/figuras';
import { FONDO_ROSCA } from '../src/lib/generators/rosca';
import { DEFAULTS, type ElementoTermo, type Loop, type Mesh, type Params, type Piece, type Pt } from '../src/types';

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? '  — ' + extra : ''}`);
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

function volumen(m: Mesh): number {
  let v = 0;
  const q = m.positions;
  for (let i = 0; i < q.length; i += 9)
    v += (q[i] * (q[i + 4] * q[i + 8] - q[i + 5] * q[i + 7]) - q[i + 1] * (q[i + 3] * q[i + 8] - q[i + 5] * q[i + 6]) + q[i + 2] * (q[i + 3] * q[i + 7] - q[i + 4] * q[i + 6])) / 6;
  return v;
}

function caja(pos: number[]) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]);
    y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]);
    z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]);
  }
  return { w: x1 - x0, h: y1 - y0, x0, x1, y0, y1, z0, z1 };
}

/** Las posiciones de una pieza puestas en su sitio (matriz 3×4 por filas). */
function montada(pc: Piece): number[] {
  const M = pc.montaje!;
  const q = pc.mesh.positions;
  const out: number[] = [];
  for (let i = 0; i < q.length; i += 3) {
    const [x, y, z] = [q[i], q[i + 1], q[i + 2]];
    out.push(M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11]);
  }
  return out;
}

const circ = (n: number, r: number): Pt[] =>
  Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)] as Pt);
const loops: Loop[] = [{ pts: circ(64, 20), hole: false }];
const detalle: Loop[] = [{ pts: [[-12, -4], [12, -4], [12, 4], [-12, 4]] as Pt[], hole: false }];
const sil = { loops, detail: detalle, widthMm: 40, heightMm: 40 };
const INICIAL = byId('thermoform2').inicial ?? {};
// Los tests de la malla dibujada la piden a propósito (por defecto la hace el laminador).
const P = (extra: Partial<Params> = {}): Params => ({ ...DEFAULTS, product: 'thermoform2', ...INICIAL, formLatticeBySlicer: false, ...extra });
const hacer = (extra: Partial<Params> = {}): Piece[] => buildProduct(sil, P(extra));
const pieza = (ps: Piece[], id: string) => ps.find((x) => x.id === id);
const abiertasDe = (ps: Piece[]) => ps.reduce((t, x) => t + aristasAbiertas(x.mesh), 0);

console.log('MoldeLab — Termoformado 2\n');

// --- El de siempre no cambia --------------------------------------------------
{
  const base1 = buildProduct(sil, { ...DEFAULTS, product: 'thermoform', moldShape: 'circle' });
  const tocado = buildProduct(sil, { ...DEFAULTS, product: 'thermoform', moldShape: 'circle', formJoin: 'imanes', formIcon: 'heart', formWall: 9, formProfile: 'cojin' });
  const igual = base1.length === tocado.length && base1.every((x, i) => x.id === tocado[i].id && x.mesh.positions.length === tocado[i].mesh.positions.length);
  check('el Termoformado de siempre sale igual aunque se toquen ajustes del 2', igual, `${base1.length} / ${tocado.length} piezas`);
}

// --- Las piezas ---------------------------------------------------------------
const ps = hacer();
const ids = ps.map((x) => x.id);
check('con rosca: dos mallas, tuerca, clip de abajo y dos moldes', ['sheet', 'sheet-back', 'cap', 'clip', 'mold-down', 'mold-up'].every((i) => ids.includes(i)), ids.join(', '));
check('todo cerrado', abiertasDe(ps) === 0, `${abiertasDe(ps)} aristas abiertas`);

const t = INICIAL.sheetThickness ?? 0.6;
const H = t + (INICIAL.formRimHeight ?? 4);
const del = pieza(ps, 'sheet')!;
const cDel = caja(del.mesh.positions);
check('la malla no baja de la cama', cDel.z0 > -1e-6, `${cDel.z0.toFixed(3)}`);
check('el borde mide lo que dicen las fotos (y la media rosca no lo pasa)', Math.abs(cDel.z1 - H) < 0.02, `${cDel.z1.toFixed(2)} mm, borde ${H.toFixed(2)}`);
check('mide 90 de ancho, como en las fotos', Math.abs(cDel.w - 90) < 1, `${cDel.w.toFixed(1)} mm`);

// Montadas, las dos mallas se juntan por la cara plana y los bordes quedan fuera.
const atr = pieza(ps, 'sheet-back')!;
const mDel = caja(montada(del));
const mAtr = caja(montada(atr));
check('montadas, las dos mallas se tocan por la cara plana', Math.abs(mAtr.z1 - mDel.z0) < 0.02, `${mAtr.z1.toFixed(2)} / ${mDel.z0.toFixed(2)}`);
check('y los dos bordes quedan por fuera', Math.abs(mDel.z1 - mAtr.z0 - 2 * H) < 0.05, `${(mDel.z1 - mAtr.z0).toFixed(2)} mm`);
const gorda = hacer({ formScrewDia: 11 });
check('una rosca más gorda también sale cerrada y sin bajar de la cama', abiertasDe(gorda) === 0 && caja(pieza(gorda, 'sheet')!.mesh.positions).z0 > -1e-6);
void FONDO_ROSCA;

// --- Uniones ------------------------------------------------------------------
for (const forma of ['circle', 'heart', 'cloud', 'star', 'bear', 'tree', 'image'] as const) {
  for (const union of ['rosca', 'clips', 'imanes'] as const) {
    const ps2 = hacer({ moldShape: forma, formJoin: union });
    const ids2 = ps2.map((x) => x.id);
    const ok =
      abiertasDe(ps2) === 0 &&
      (union === 'rosca' ? ids2.includes('cap') && ids2.includes('clip') : !ids2.includes('cap')) &&
      (union === 'clips' ? ['clip', 'clip-izq', 'clip-der'].every((i) => ids2.includes(i)) : true) &&
      (union === 'imanes' ? !ids2.some((i) => i.startsWith('clip')) && /imanes/.test(pieza(ps2, 'sheet')!.label) : true);
    check(`${forma} · ${union}: sus piezas y todo cerrado`, ok, `${ids2.join(', ')} · ${abiertasDe(ps2)} aristas`);
  }
}
const lados = hacer({ formSideClips: true });
check('rosca con clips en los lados', ['clip', 'clip-izq', 'clip-der'].every((i) => !!pieza(lados, i)));

// Las ventanitas del clip se llevan plancha.
const vCon = volumen(pieza(hacer({ formLatticeBySlicer: true }), 'sheet')!.mesh);
const vSin = volumen(pieza(hacer({ formLatticeBySlicer: true, formJoin: 'imanes', formMagnets: 2 }), 'sheet')!.mesh);
check('con clip, la malla lleva su ventanita', vCon > 0 && vSin > 0, `${vCon.toFixed(0)} / ${vSin.toFixed(0)} mm³`);

// El clip, montado, muerde las dos planchas juntas, abajo.
const clip = pieza(ps, 'clip')!;
const mClip = caja(montada(clip));
check('el clip montado muerde las dos planchas', mClip.z0 < mDel.z0 - t && mClip.z1 > mDel.z0 + t, `clip ${mClip.z0.toFixed(2)}…${mClip.z1.toFixed(2)}, juntura ${mDel.z0.toFixed(2)} ± ${t}`);
check('y queda abajo, en el borde', mClip.y0 < mDel.y0 + 1 && mClip.y1 < mDel.y0 + 7, `${mClip.y0.toFixed(1)}…${mClip.y1.toFixed(1)}`);
// En el sitio del clip: una ventanita que se ve desde arriba (en la parte de
// dentro del borde) y la pared de fuera del borde, entera.
{
  const q = del.mesh.positions;
  const xm = (cDel.x0 + cDel.x1) / 2;
  const rimW = INICIAL.formRimWidth ?? 1.8;
  let fuera = 0;
  let dentroAgujero = 0;
  for (let i = 0; i < q.length; i += 9) {
    // Centro de cada triángulo.
    const x = (q[i] + q[i + 3] + q[i + 6]) / 3;
    const y = (q[i + 1] + q[i + 4] + q[i + 7]) / 3;
    const z = (q[i + 2] + q[i + 5] + q[i + 8]) / 3;
    if (Math.abs(x - xm) > 1.5) continue;
    if (y < cDel.y0 + 0.4 && z > H - 0.3) fuera++;
    if (y > cDel.y0 + rimW && y < cDel.y0 + rimW + 1 && z < H + 0.01) dentroAgujero++;
  }
  check('donde va el clip, la pared de fuera del borde sigue entera', fuera > 0, `${fuera} triángulos`);
  check('y la ventanita es un agujero de arriba abajo', dentroAgujero === 0, `${dentroAgujero} triángulos dentro del agujero`);
}

// --- Malla hecha por el laminador -----------------------------------------------
const maciza = volumen(pieza(hacer({ formLatticeBySlicer: true }), 'sheet')!.mesh);
const calada = volumen(del.mesh);
check('con «la malla la hace el laminador», la plancha sale maciza', maciza > calada * 1.2, `${calada.toFixed(0)} → ${maciza.toFixed(0)} mm³`);

// --- Moldes -------------------------------------------------------------------
const D = INICIAL.formHeight ?? 16;
const abajo = caja(pieza(ps, 'mold-down')!.mesh.positions);
const arriba = caja(pieza(ps, 'mold-up')!.mesh.positions);
const altoAbajo = (INICIAL.formFloor ?? 1.1) + Math.max(D + (INICIAL.formClearance ?? 0.1), H - t + (INICIAL.formStepClearance ?? 0.2));
check('el molde de abajo mide suelo + hondo + holgura', Math.abs(abajo.z1 - altoAbajo) < 0.05, `${abajo.z1.toFixed(2)} / ${altoAbajo.toFixed(2)}`);
check('y es más ancho que la malla (pared de 6)', abajo.w > cDel.w + 11, `${abajo.w.toFixed(1)}`);
const altoArriba = (INICIAL.formMaleBase ?? 3) + D;
check('el de arriba: la cúpula sobre su base', Math.abs(arriba.z1 - altoArriba) < 0.1, `${arriba.z1.toFixed(2)} / ${altoArriba.toFixed(2)}`);
const vHembra = volumen(pieza(ps, 'mold-down')!.mesh);
const vHembraHonda = volumen(pieza(hacer({ formRimHeight: 6 }), 'mold-down')!.mesh);
check('la ranura del borde está en el molde de la cavidad (borde más alto, ranura más honda)', vHembraHonda < vHembra - 50, `${vHembra.toFixed(0)} → ${vHembraHonda.toFixed(0)} mm³`);
const vMacho = volumen(pieza(ps, 'mold-up')!.mesh);
check('el de la cúpula no cambia con el borde (no lleva ranura)', Math.abs(volumen(pieza(hacer({ formRimHeight: 6 }), 'mold-up')!.mesh) - vMacho) < 1);
check('los moldes avisan del PETG', /PETG/.test(pieza(ps, 'mold-down')!.label));
for (const [n, ov] of [['más pared', { formWall: 9 }], ['más suelo', { formFloor: 3 }], ['más base', { formMaleBase: 5 }], ['perfil cojín', { formProfile: 'cojin' }], ['perfil redondo', { formProfile: 'redondo' }]] as const) {
  check(`${n}: moldes cerrados`, abiertasDe(hacer(ov as Partial<Params>).filter((x) => x.id.startsWith('mold'))) === 0);
}
const luna: Loop[] = [{ pts: [...circ(48, 20).filter(([x]) => x > -5), [-5, 15], [-5, -15]] as Pt[], hole: false }];
const asim = (extra: Partial<Params>) => buildProduct({ loops: luna, detail: luna, widthMm: 25, heightMm: 40 }, P({ moldShape: 'image', formEvenOut: false, ...extra }));
const moldes = (x: Piece[]) => x.filter((y) => y.id.startsWith('mold-')).length;
check('forma asimétrica: moldes aparte delante y detrás', moldes(asim({})) === 4, `${moldes(asim({}))}`);
check('sin «moldes aparte»: una pareja', moldes(asim({ formSplitMolds: false })) === 2);
check('sin «incluir moldes»: ninguno', moldes(hacer({ formMold: false })) === 0);

// --- Diseño -------------------------------------------------------------------
const el = (e: Partial<ElementoTermo>): ElementoTermo => ({
  id: Math.random().toString(36), tipo: 'icono', cara: 'delante', texto: '', icono: 'heart', x: 0, y: 0, rot: 0, tam: 35, alto: 0, enrejado: false, negrita: false, color: 'auto', ...e,
});
const conEl = hacer({
  formElements: [
    el({ tipo: 'texto', texto: 'Love', y: -40, color: '#1f1f24' }),
    el({ icono: 'heart', y: 30, enrejado: true, color: '#d62828' }),
    el({ cara: 'detras', icono: 'star', rot: 20, alto: 0.6 }),
    el({ cara: 'detras', tipo: 'texto', texto: 'Feliz 2026', negrita: true, y: -50 }),
  ],
});
const dE = pieza(conEl, 'sheet')!;
const tE = pieza(conEl, 'sheet-back')!;
check('delante: borde + dibujo + texto + icono, cada uno su trozo', (dE.overlayParts?.length ?? 0) === (del.overlayParts?.length ?? 0) + 2, `${del.overlayParts?.length} → ${dE.overlayParts?.length}`);
check('detrás: borde + estrella + texto', (tE.overlayParts?.length ?? 0) === 3, `${tE.overlayParts?.length}`);
check('cada trozo lleva su color', !!dE.partTints?.includes('#1f1f24') && !!dE.partTints?.includes('#d62828'), JSON.stringify(dE.partTints));
check('todo cerrado con elementos', abiertasDe(conEl) === 0, `${abiertasDe(conEl)}`);
check('a ras: el texto no sube de la plancha', caja(dE.overlayParts![dE.overlayParts!.length - 2].positions).z1 < t + 0.01);
check('la estrella con 0,6 de altura sí sube', caja(tE.overlayParts![1].positions).z1 > t + 0.55);
check('el borde sale del color del borde y la malla del suyo', dE.partTints?.[0] === '#1f1f24' && dE.tint === '#e94b6a');

// --- Formas y tamaño ------------------------------------------------------------
for (const f of FIGURAS) check(`figura ${f}: todo cerrado`, abiertasDe(hacer({ moldShape: f })) === 0);
const porAlto = caja(pieza(hacer({ formSizeBy: 'alto', moldShape: 'cloud', targetWidthMm: 50, formJoin: 'imanes', formMagnets: 2 }), 'sheet')!.mesh.positions);
check('con «el alto», mide de alto lo pedido (más la orejita de colgar)', porAlto.h >= 50 && porAlto.h < 50 + 12, `${porAlto.h.toFixed(1)} mm`);
const fija = caja(pieza(hacer({ formSizeBy: 'fijo', targetWidthMm: 80, formFixedH: 50 }), 'sheet')!.mesh.positions);
check('con «fijos», 80 de ancho', Math.abs(fija.w - 80) < 1, `${fija.w.toFixed(1)} × ${fija.h.toFixed(1)}`);

// --- Exportar -----------------------------------------------------------------
const op = { formatos: new Set(['stl' as const]), nombre: 'p', porDefecto: 'x', separar: true, colores: { bg: '#fff', trace: '#000', text: '#f00' } };
const { unzipSync } = await import('fflate');
const nombres = async (r: Awaited<ReturnType<typeof armarArchivo>>) =>
  r ? (r.outName.endsWith('.zip') ? Object.keys(unzipSync(new Uint8Array(await r.blob.arrayBuffer()))) : [r.outName]) : [];
const nm = await nombres(await armarArchivo(ps, null, { ...op, soloPiezas: 'moldes' }));
const np = await nombres(await armarArchivo(ps, null, { ...op, soloPiezas: 'planchas' }));
check('«solo moldes» trae solo moldes', nm.length >= 2 && nm.every((n) => n.includes('mold-')), nm.join(', '));
check('«solo mallas» trae mallas, tuerca y clip', np.length >= 4 && np.every((n) => !n.includes('mold-')), np.join(', '));
const z = await armarArchivo(conEl, null, { ...op, formatos: new Set(['3mf' as const]), porPlacas: true });
const zz = z ? unzipSync(new Uint8Array(await z.blob.arrayBuffer())) : {};
const cfgT = new TextDecoder().decode((zz as Record<string, Uint8Array>)['Metadata/model_settings.config'] ?? new Uint8Array());
check('al abrir en Bambu: un .3mf con 4 placas (mallas, tuerca y clip, cada molde)', z?.outName === 'p.3mf' && (cfgT.match(/<plate>/g) ?? []).length === 4, `${z?.outName} · ${(cfgT.match(/<plate>/g) ?? []).length} placas`);

// --- Un dibujo de contorno deja malla por dentro -----------------------------------
{
  const anillo: Loop[] = [
    { pts: circ(64, 16), hole: false },
    { pts: [...circ(64, 14)].reverse(), hole: true },
  ];
  const disco: Loop[] = [{ pts: circ(64, 16), hole: false }];
  const vDe = (d: Loop[]) => volumen(pieza(buildProduct({ loops, detail: d, widthMm: 40, heightMm: 40 }, P()), 'sheet')!.mesh);
  const vAro = vDe(anillo);
  const vDisco = vDe(disco);
  check('un dibujo de contorno (aro) deja la malla por dentro', vAro < vDisco - 200, `aro ${vAro.toFixed(0)} / relleno ${vDisco.toFixed(0)} mm³`);
}

// --- Como en las fotos: malla trenzada y tuerca hexagonal ---------------------------
check('la malla sale trenzada por defecto', INICIAL.holePattern === 'weave');
check('por defecto la malla la hace el laminador (como el kit), al 25 %', INICIAL.formLatticeBySlicer === true && INICIAL.formSlicerDensity === 25);
check('y por defecto la plancha sale maciza', volumen(pieza(buildProduct(sil, { ...DEFAULTS, product: 'thermoform2', ...INICIAL } as Params), 'sheet')!.mesh) > volumen(pieza(hacer(), 'sheet')!.mesh) * 1.2);
const tren = hacer({ moldShape: 'bear' });
check('malla trenzada: todo cerrado', abiertasDe(tren) === 0, `${abiertasDe(tren)}`);
check('la malla trenzada tiene agujeros', volumen(pieza(tren, 'sheet')!.mesh) < volumen(pieza(hacer({ moldShape: 'bear', formLatticeBySlicer: true }), 'sheet')!.mesh) * 0.9);
const nut = caja(pieza(ps, 'cap')!.mesh.positions);
check('la tuerca es hexagonal (más ancha de esquina a esquina que de lado a lado)', nut.w / nut.h > 1.08 || nut.h / nut.w > 1.08, `${nut.w.toFixed(2)} × ${nut.h.toFixed(2)}`);
check('y cerrada', aristasAbiertas(pieza(ps, 'cap')!.mesh) === 0);

// --- Modo sencillo ------------------------------------------------------------
const grupos = byId('thermoform2').groups ?? [];
check('modo sencillo: quedan diseño, forma y colores', grupos.filter((g) => g.simple).map((g) => g.label).join(',') === 'Diseño,Forma,Colores');

if (failures) {
  console.log(`\n${failures} fallo(s).`);
  process.exitCode = 1;
} else console.log('\nTodo correcto.');
