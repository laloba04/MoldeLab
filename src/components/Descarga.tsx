import { Download, Send } from 'lucide-react';
import { CLOUD, SLICERS, type Slicer } from '../lib/cloud';
import { FORMATS, type Fmt } from '../lib/exportar';

/** La ventana de descargar: nombre, formatos, separar piezas y laminador. */
export interface DescargaProps {
  cerrar: () => void;
  nombre: string;
  setNombre: (v: string) => void;
  porDefecto: string;
  formatos: Set<Fmt>;
  setFormatos: (f: (prev: Set<Fmt>) => Set<Fmt>) => void;
  variasPiezas: boolean;
  separar: boolean;
  setSeparar: (v: boolean) => void;
  slicer: Slicer;
  setSlicer: (v: Slicer) => void;
  enviando: boolean;
  enviar: () => void;
  descargar: () => void;
}

export function Descarga(d: DescargaProps) {
  return (
    <div
      className="modal-back"
      role="presentation"
      onClick={d.cerrar}
      onKeyDown={(e) => {
        if (e.key === 'Escape') d.cerrar();
      }}
    >
      {/* El diálogo para el clic fuera y las teclas: sin esto, cerrar la
          ventana sería solo cosa del ratón. */}
      <dialog
        className="modal"
        open
        aria-label="Descargar archivos"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <h3>Descargar archivos</h3>

        <label className="modal-field">
          Nombre del archivo
          <input
            type="text"
            value={d.nombre}
            maxLength={40}
            placeholder={d.porDefecto}
            onChange={(e) => d.setNombre(e.target.value)}
          />
        </label>

        <div className="fmt-list">
          {FORMATS.map((f) => (
            <label key={f.id} className="fmt-row">
              <input
                type="checkbox"
                checked={d.formatos.has(f.id)}
                onChange={(e) =>
                  d.setFormatos((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(f.id);
                    else next.delete(f.id);
                    return next;
                  })
                }
              />
              <span className="fmt-name">{f.label}</span>
              <small>{f.hint}</small>
            </label>
          ))}
        </div>

        {d.variasPiezas && (
          <label className="toggle">
            <input type="checkbox" checked={d.separar} onChange={(e) => d.setSeparar(e.target.checked)} />
            <span />
            Separar las piezas en la cama
          </label>
        )}

        {CLOUD && (
          <label className="color-row slicer-pick">
            <select value={d.slicer} onChange={(e) => d.setSlicer(e.target.value as Slicer)}>
              {SLICERS.map((sl) => (
                <option key={sl.id} value={sl.id}>
                  {sl.label}
                </option>
              ))}
            </select>
            <span>Laminador al que enviar</span>
          </label>
        )}

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={d.cerrar}>
            Cancelar
          </button>
          {CLOUD && (
            <button
              type="button"
              className="ghost send"
              onClick={d.enviar}
              disabled={!d.formatos.size || d.enviando}
              title="Sube el modelo y se lo pasa al laminador para que lo abra"
            >
              <Send size={15} /> {d.enviando ? 'Enviando…' : 'Descargar y abrir'}
            </button>
          )}
          <button type="button" className="primary" onClick={d.descargar} disabled={!d.formatos.size}>
            <Download size={15} /> Descargar{d.formatos.size > 1 ? ' (ZIP)' : ''}
          </button>
        </div>
      </dialog>
    </div>
  );
}
