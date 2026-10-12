/**
 * El rodillo: que el estampado enrollado siga siendo un sólido cerrado, que
 * quede pegado al cilindro (ni flotando ni hundido) y que salga espejado.
 */
import { buildProduct } from '../src/lib/catalog';
import { DEFAULTS, type Loop, type Mesh, type Pt } from '../src/types';

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? '  — ' + extra : ''}`);
}

/** Aristas que no tienen exactamente una pareja en sentido contrario. */
function aristasSueltas(m: Mesh): number {
  const k = (i: number) => m.positions.slice(i, i + 3).map((v) => v.toFixed(4)).join(',');
  const cuenta = new Map<string, number>();
  for (let i = 0; i < m.positions.length; i += 9) {
    const v = [k(i), k(i + 3), k(i + 6)];
    for (let j = 0; j < 3; j++) {
      const a = v[j], b = v[(j + 1) % 3];
      cuenta.set(`${a}|${b}`, (cuenta.get(`${a}|${b}`) ?? 0) + 1);
    }
  }
  let sueltas = 0;
  for (const [e, n] of cuenta) {
    const [a, b] = e.split('|');
    if ((cuenta.get(`${b}|${a}`) ?? 0) !== n) sueltas++;
  }
  return sueltas;
}

// Una «L»: no es simétrica, así que se nota si está espejada.
const L: Pt[] = [[-6, -8], [6, -8], [6, -4], [-2, -4], [-2, 8], [-6, 8]];
const detail: Loop[] = [{ pts: L, hole: false }];
const sil = { loops: detail, detail, widthMm: 12, heightMm: 16 };
const p = { ...DEFAULTS, product: 'roller' as const, rollerRepeats: 4, rollerRows: 2 };
const piezas = buildProduct(sil, p);
const rod = piezas.find((x) => x.id === 'roller')!;

check('sale el rodillo, el mango y los dos tapones', !!rod && ['handle', 'cap-l', 'cap-r'].every((id) => piezas.some((x) => x.id === id)));
check('una copia del dibujo por celda', rod.overlayParts?.length === 8, `${rod.overlayParts?.length}`);

const sueltas = rod.overlayParts!.reduce((n, z) => n + aristasSueltas(z), 0);
check('el estampado enrollado está cerrado', sueltas === 0, `${sueltas} aristas sueltas`);
check('el tubo está cerrado', aristasSueltas({ positions: rod.mesh.positions.slice(0, rod.mesh.positions.length - rod.overlay!.positions.length) }) === 0);

const R = p.rollerDia / 2;
let rMin = Infinity, rMax = -Infinity;
for (const z of rod.overlayParts!) {
  for (let i = 0; i < z.positions.length; i += 3) {
    const r = Math.hypot(z.positions[i], z.positions[i + 1]);
    rMin = Math.min(rMin, r);
    rMax = Math.max(rMax, r);
  }
}
check('el relieve nace dentro del cilindro', rMin < R && rMin > R - 0.6, rMin.toFixed(2));
check('y sobresale lo que se pide', Math.abs(rMax - (R + p.reliefHeight)) < 0.05, rMax.toFixed(2));

// Espejo: en la L el palo largo está a la izquierda. Desenrollada sobre el
// rodillo (ángulo creciente = hacia la derecha), en la primera copia el palo
// debe quedar a la DERECHA de su centro.
const z0 = rod.overlayParts![0];
let suma = 0, n = 0;
for (let i = 0; i < z0.positions.length; i += 3) {
  suma += Math.atan2(z0.positions[i + 1], z0.positions[i]) * R;
  n++;
}
const centro = suma / n;
// Lo alto de la L (el palo) frente al centro de la copia.
let uPalo = 0, cPalo = 0;
const zs = z0.positions.filter((_, i) => i % 3 === 2);
const zTop = Math.max(...zs);
for (let i = 0; i < z0.positions.length; i += 3) {
  if (z0.positions[i + 2] > zTop - 2) { uPalo += Math.atan2(z0.positions[i + 1], z0.positions[i]) * R; cPalo++; }
}
check('el dibujo va espejado (en la masa se lee derecho)', uPalo / cPalo > centro, `palo ${(uPalo / cPalo).toFixed(1)} vs centro ${centro.toFixed(1)}`);

const tris = rod.mesh.positions.length / 9;
check('no pesa demasiado', tris < 120000, `${tris} triángulos`);

// --- Montado: cada pieza en su sitio -----------------------------------------
const colocar = (m: Mesh, M: number[]) => {
  const q = m.positions;
  const out: number[] = [];
  for (let i = 0; i < q.length; i += 3) {
    const [x, y, z] = [q[i], q[i + 1], q[i + 2]];
    out.push(M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11]);
  }
  return out;
};
const caja = (q: number[]) => {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  for (let i = 0; i < q.length; i += 3) {
    b.x0 = Math.min(b.x0, q[i]); b.x1 = Math.max(b.x1, q[i]);
    b.y0 = Math.min(b.y0, q[i + 1]); b.y1 = Math.max(b.y1, q[i + 1]);
    b.z0 = Math.min(b.z0, q[i + 2]); b.z1 = Math.max(b.z1, q[i + 2]);
  }
  return b;
};
const pieza = (id: string) => piezas.find((x) => x.id === id)!;
const cR = caja(colocar(rod.mesh, rod.montaje!));
const cM = caja(colocar(pieza('handle').mesh, pieza('handle').montaje!));
const cL = caja(colocar(pieza('cap-l').mesh, pieza('cap-l').montaje!));
const cD = caja(colocar(pieza('cap-r').mesh, pieza('cap-r').montaje!));
const W = p.rollerWidth;
const zEje = (cR.z0 + cR.z1) / 2;
check('montado, el rodillo apoya en la mesa', Math.abs(cR.z0) < 0.05, cR.z0.toFixed(2));
check('el rodillo cabe entre las patas', cR.x0 >= cM.x0 + 9 && cR.x1 <= cM.x1 - 9, `${cR.x0.toFixed(1)}..${cR.x1.toFixed(1)} en ${cM.x0.toFixed(1)}..${cM.x1.toFixed(1)}`);
check('el mango no toca la mesa', cM.z0 > 1, cM.z0.toFixed(1));
check('el mango está centrado en el eje', Math.abs((cM.y0 + cM.y1) / 2) < 0.01);
check('los tapones van en el eje del rodillo', [cL, cD].every((c) => Math.abs((c.z0 + c.z1) / 2 - zEje) < 0.05 && Math.abs((c.y0 + c.y1) / 2) < 0.05));
check('cada tapón se mete en el rodillo', cL.x1 > -W / 2 + 5 && cD.x0 < W / 2 - 5, `${cL.x1.toFixed(1)} / ${cD.x0.toFixed(1)}`);
check('y su cabeza queda fuera del mango', cL.x0 < cM.x0 && cD.x1 > cM.x1);

console.log(failures ? `\n${failures} fallo(s).` : '\nTodo correcto.');
process.exitCode = failures ? 1 : 0;
