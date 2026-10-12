import { FlipVertical, Layers, Redo2, Undo2 } from 'lucide-react';

export type ViewMode = 'solid' | 'xray' | 'wire';

/** La barra de botones encima de la vista 3D, y las medidas de la pieza. */
export interface BarraProps {
  deshacer: () => void;
  rehacer: () => void;
  puedeDeshacer: boolean;
  puedeRehacer: boolean;
  variasPiezas: boolean;
  /** Las piezas se pueden ver montadas (el rodillo en su mango). */
  montable?: boolean;
  exploded: boolean;
  toggleExploded: () => void;
  viewMode: ViewMode;
  siguienteVista: () => void;
  flipped: boolean;
  toggleFlipped: () => void;
  /** Solo si hay algo que se termoforma. */
  abombable: boolean;
  showFormed: boolean;
  toggleFormed: () => void;
  producto: string;
  dims: { w: number; l: number; h: number } | null;
  triangulos: number;
}

export function Barra(b: BarraProps) {
  return (
    <div className="hud">
      <button
        className="chip"
        onClick={b.deshacer}
        disabled={!b.puedeDeshacer}
        title="Deshacer el último cambio (Ctrl+Z)"
      >
        <Undo2 size={14} /> Deshacer
      </button>
      <button className="chip" onClick={b.rehacer} disabled={!b.puedeRehacer} title="Rehacer (Ctrl+Y)">
        <Redo2 size={14} />
      </button>
      {b.variasPiezas && (
        <button className="chip" onClick={b.toggleExploded}>
          <Layers size={14} />{' '}
          {b.montable
            ? b.exploded
              ? 'Ver montado'
              : 'Ver por piezas'
            : b.exploded
              ? 'Juntar'
              : 'Separar'}
        </button>
      )}
      <button className="chip" onClick={b.siguienteVista} title="Cambiar cómo se ve el modelo">
        {b.viewMode === 'solid' ? 'Sólido' : b.viewMode === 'xray' ? 'Rayos X' : 'Alámbrico'}
      </button>
      <button
        className={b.flipped ? 'chip on' : 'chip'}
        onClick={b.toggleFlipped}
        title="Mira la pieza desde abajo: ahí va grabada la marca"
      >
        <FlipVertical size={14} /> {b.flipped ? 'Ver por delante' : 'Ver por detrás'}
      </button>
      {b.abombable && (
        // Solo en lo que se termoforma: la plancha se imprime plana, y así se
        // ve también cómo queda una vez prensada.
        <button
          className={b.showFormed ? 'chip on' : 'chip'}
          onClick={b.toggleFormed}
          title="Las planchas se imprimen planas. Esto enseña cómo quedan una vez abombadas."
        >
          {b.showFormed ? 'Ver plana' : 'Ver abombada'}
        </button>
      )}
      <span className="chip readout">{b.producto}</span>
      {b.dims && (
        <span className="chip readout" title="Ancho × Largo × Alto">
          {b.dims.w.toFixed(1)} × {b.dims.l.toFixed(1)} × {b.dims.h.toFixed(1)} mm
        </span>
      )}
      <span className="chip readout">{b.triangulos.toLocaleString('es-ES')} triángulos</span>
    </div>
  );
}
