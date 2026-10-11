import type { Piece } from '../types';

/**
 * Los colores de la pieza.
 *
 * Tres maneras: todo de un color (sin cambios de filamento), un color por capa
 * (productos en capas), o los cuatro de siempre —fondo, trazo, nombre y uno
 * extra— más el pincel para pintar a mano cada parte suelta.
 */
export interface ColoresProps {
  piezas: Piece[];
  oneColor: boolean;
  setOneColor: (v: boolean) => void;
  /** Fondo, trazo, nombre y el cuarto, en ese orden. */
  palette: string[];
  setColor: (i: number, c: string) => void;
  layerColors: string[];
  setLayerColor: (i: number, c: string) => void;
  /** Color del pincel (número de la paleta), o nada si está apagado. */
  brush: number | null;
  setBrush: (f: (b: number | null) => number | null) => void;
  hayPintadas: boolean;
  quitarPintadas: () => void;
  hasTrace: boolean;
  hideTrace: boolean;
  setHideTrace: (v: boolean) => void;
}

export function Colores(c: ColoresProps) {
  const capas = c.piezas.filter((p) => p.tint);
  const hayNombre = c.piezas.some((pc) => pc.textMesh?.positions.length);
  const fila = (i: number, texto: string) => (
    <label className="color-row" key={i}>
      <input type="color" value={c.palette[i]} onChange={(e) => c.setColor(i, e.target.value)} />
      <span>{texto}</span>
    </label>
  );

  return (
    <div className="colors">
      <h3>Colores</h3>
      <label className="toggle">
        <input type="checkbox" checked={c.oneColor} onChange={(e) => c.setOneColor(e.target.checked)} />
        <span />
        Todo de un color
      </label>
      {c.oneColor ? (
        fila(0, 'El color de toda la pieza')
      ) : capas.length > 0 ? (
        // Producto por capas: un color por capa, en el mismo orden en que se
        // apilan. Es lo que se lleva el 3MF a los filamentos.
        capas.map((p, i) => (
          <label className="color-row" key={p.id}>
            <input
              type="color"
              value={c.layerColors[i] ?? p.tint}
              onChange={(e) => c.setLayerColor(i, e.target.value)}
            />
            <span>{p.label}</span>
          </label>
        ))
      ) : (
        <>
          {fila(0, 'Fondo (la placa)')}
          {fila(1, 'Trazo (el dibujo)')}
          {fila(2, hayNombre ? 'El nombre' : 'Tercer color')}
          {fila(3, 'Cuarto color')}
        </>
      )}
      {c.oneColor && <p className="hint">Una sola tinta: sale del laminador sin cambios de filamento.</p>}
      {!c.oneColor && (
        <div className="paint">
          <p className="hint">
            Para pintar una parte suelta —un moflete, un ojo, el contorno—, elige un color aquí y
            tócala en la pieza.
          </p>
          <div className="paint-swatches">
            {c.palette.map((col, i) => (
              <button
                key={i}
                type="button"
                className={`swatch${c.brush === i ? ' on' : ''}`}
                style={{ background: col }}
                title={`Pintar con el color ${i + 1}`}
                aria-pressed={c.brush === i}
                onClick={() => c.setBrush((b) => (b === i ? null : i))}
              >
                {i + 1}
              </button>
            ))}
            <button type="button" className="mini" disabled={!c.hayPintadas} onClick={c.quitarPintadas}>
              Quitar
            </button>
          </div>
          {c.brush !== null && (
            <p className="hint warn">
              Pincel encendido: toca las partes que quieras pintar. Vuelve a pulsar el color para
              apagarlo y poder girar la pieza a gusto.
            </p>
          )}
        </div>
      )}
      {c.hasTrace && !c.oneColor && (
        <label className="toggle">
          <input type="checkbox" checked={c.hideTrace} onChange={(e) => c.setHideTrace(e.target.checked)} />
          <span />
          Ocultar trazo (ver la placa lisa)
        </label>
      )}
    </div>
  );
}
