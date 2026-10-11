import { FONT_STYLES, type FontStyle } from '../lib/font';

/** La marca del taller, grabada en la cara de atrás de la pieza. */
export interface MarcaProps {
  /** ¿Admite marca alguna pieza? Las de corte y las huecas no. */
  admite: boolean;
  on: boolean;
  setOn: (v: boolean) => void;
  texto: string;
  setTexto: (v: string) => void;
  estilo: FontStyle;
  setEstilo: (v: FontStyle) => void;
  arco: boolean;
  setArco: (f: (v: boolean) => boolean) => void;
  tam: number;
  setTam: (v: number) => void;
  /** A ese tamaño, ¿ha cabido entera en alguna pieza? */
  cabe: boolean;
}

export function Marca(m: MarcaProps) {
  if (!m.admite)
    return (
      <div className="mark-box">
        <p className="hint">
          Esta pieza no admite marca: es de <strong>corte</strong> o hueca (cortador, contorno,
          peana). La marca se graba en piezas con una cara plana (placas, llaveros, sellos…).
        </p>
      </div>
    );

  return (
    <div className="mark-box">
      <label className="toggle">
        <input type="checkbox" checked={m.on} onChange={(e) => m.setOn(e.target.checked)} />
        <span />
        Grabar mi marca en la pieza
      </label>
      {m.on && (
        <>
          <input
            className="mark-input"
            type="text"
            value={m.texto}
            maxLength={32}
            placeholder="Tu marca…"
            onChange={(e) => m.setTexto(e.target.value)}
          />
          <div className="mark-fonts">
            {FONT_STYLES.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`mark-font${m.estilo === f.id ? ' on' : ''}`}
                style={{ fontFamily: `"${f.family}", var(--body)`, fontWeight: f.weight }}
                onClick={() => m.setEstilo(f.id)}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              className={`mark-font${m.arco ? ' on' : ''}`}
              onClick={() => m.setArco((v) => !v)}
            >
              En arco
            </button>
          </div>
          <div className="field">
            <div className="field-head">
              <label htmlFor="marca-tam">Tamaño de la letra</label>
              <output>
                {m.tam.toFixed(1)}
                <em>mm</em>
              </output>
            </div>
            <input
              id="marca-tam"
              type="range"
              min={3}
              max={16}
              step={0.5}
              value={m.tam}
              onChange={(e) => m.setTam(Number(e.target.value))}
            />
          </div>
          {!m.cabe && (
            <p className="hint warn">
              A ese tamaño no cabe entera en la pieza, así que no se graba: no vale poner media
              marca. Bájala o escribe menos.
            </p>
          )}
          <p className="hint">
            Se graba en la cara de <strong>atrás</strong> (la que toca la cama). Dale la vuelta a la
            pieza, o usa <strong>Rayos X</strong>, para verla.
          </p>
        </>
      )}
    </div>
  );
}
