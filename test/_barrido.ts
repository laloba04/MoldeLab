import { readPng } from './_png';
import { vectorize } from '../src/lib/pipeline';
import { buildProduct } from '../src/lib/catalog';
import { DEFAULTS, FIELD_META, type Mesh, type Params, type Pt } from '../src/types';

const img = readPng('C:/Users/User/AppData/Local/Temp/claude/C--Users-User-Downloads-pagina-3d/966d0b4d-6b6f-4542-89a9-5a768fffc8d6/scratchpad/persona.png') as any;

function trozos(m: Mesh, z: number): number {
  const S = 0.2, on = new Set<string>(), pos = m.positions;
  for (let i = 0; i < pos.length; i += 9) {
    const v = [[pos[i],pos[i+1],pos[i+2]],[pos[i+3],pos[i+4],pos[i+5]],[pos[i+6],pos[i+7],pos[i+8]]];
    const cr: Pt[] = [];
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k+1)%3];
      if ((a[2]-z)*(b[2]-z) < 0) { const t=(z-a[2])/(b[2]-a[2]); cr.push([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t]); }
    }
    if (cr.length !== 2) continue;
    const n = Math.max(2, Math.ceil(Math.hypot(cr[1][0]-cr[0][0], cr[1][1]-cr[0][1])/(S/2)));
    for (let k = 0; k <= n; k++) on.add(`${Math.round((cr[0][0]+(cr[1][0]-cr[0][0])*k/n)/S)},${Math.round((cr[0][1]+(cr[1][1]-cr[0][1])*k/n)/S)}`);
  }
  const seen = new Set<string>(); let n = 0;
  for (const s0 of on) { if (seen.has(s0)) continue; n++; const st=[s0];
    while (st.length) { const k = st.pop()!; if (seen.has(k)||!on.has(k)) continue; seen.add(k);
      const [x,y]=k.split(',').map(Number);
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) st.push(`${x+dx},${y+dy}`); } }
  return n;
}

/** ¿Salen las dos piezas de una sola pieza cada una? */
function ok(p: Params): string | null {
  const piezas = buildProduct(vectorize(img, p), p);
  const cor = piezas.find(x => x.role === 'blade');
  const sel = piezas.find(x => x.role === 'icing');
  const malos: string[] = [];
  if (cor) { const t = trozos(cor.mesh, Math.min(0.3, p.flangeHeight/2)); if (t !== 1) malos.push(`cortador ${t}`); }
  if (sel) { const t = trozos(sel.mesh, -0.8); if (t !== 1) malos.push(`sello ${t}`); }
  return malos.length ? malos.join(', ') : null;
}

const campos = [
  'targetWidthMm','cutterHeight','wallThickness','bladeThickness','bladeHeight',
  'flangeWidth','flangeHeight','cutterGrow','stampBase','stampRim','stampFit',
  'reliefHeight','reliefTaper','strokeWidth','threshold','cleanup','simplify','smooth','minIslandPct',
] as const;

let fallos = 0;
for (const f of campos) {
  const meta: any = (FIELD_META as any)[f];
  if (!meta || meta.toggle || meta.select) continue;
  const vals: number[] = [];
  const paso = (meta.max - meta.min) / 6;
  for (let v = meta.min; v <= meta.max + 1e-9; v += paso) vals.push(Math.round(v * 100) / 100);
  const malos: string[] = [];
  for (const v of vals) {
    const p = { ...DEFAULTS, product: 'cutter-stamp' as const, [f]: v } as Params;
    try { const r = ok(p); if (r) malos.push(`${v}→${r}`); }
    catch (e) { malos.push(`${v}→EXCEPCIÓN`); }
  }
  if (malos.length) { fallos++; console.log(`✘ ${String(meta.label).padEnd(24)} ${malos.join('  ')}`); }
  else console.log(`✔ ${String(meta.label).padEnd(24)} bien en los ${vals.length} valores`);
}
console.log(fallos ? `\n${fallos} ajuste(s) rompen la union.` : '\nNingun ajuste rompe la union.');
