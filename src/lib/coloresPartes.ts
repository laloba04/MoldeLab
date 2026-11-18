/**
 * Los colores de las partes (plancha, borde, tuerca, molde) no cambian la
 * forma. Para no rehacer la pieza entera al cambiar uno, se calcula con una
 * marca en su lugar ("@@campo") y aquí se cambia la marca por el color de
 * verdad, que es instantáneo.
 */
import type { Params, Piece } from '../types';

export const CAMPOS_COLOR = ['formColorPlate', 'formColorRim', 'formColorNut', 'formColorMold'] as const;

export const marcasDeColor: Partial<Params> = Object.fromEntries(
  CAMPOS_COLOR.map((f) => [f, `@@${f}`]),
) as Partial<Params>;

const real = (c: string | undefined, p: Params): string | undefined => {
  if (!c || !c.startsWith('@@')) return c;
  const v = p[c.slice(2) as (typeof CAMPOS_COLOR)[number]] as string | undefined;
  return v && v !== 'auto' ? v : undefined;
};

export function pintarColores(piezas: Piece[], p: Params): Piece[] {
  return piezas.map((pz) => {
    const conMarca = pz.tint?.startsWith('@@') || pz.partTints?.some((c) => c?.startsWith('@@'));
    if (!conMarca) return pz;
    return { ...pz, tint: real(pz.tint, p), partTints: pz.partTints?.map((c) => real(c, p)) };
  });
}
