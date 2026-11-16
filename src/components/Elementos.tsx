import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { FIELD_META, type ElementoTermo } from '../types';

/**
 * Los textos e iconos del Termoformado 2, cara a cara: cada uno con su sitio,
 * giro, tamaño, altura, aspecto (macizo o enrejado) y color.
 */
const ICONOS = (FIELD_META.formIcon && 'select' in FIELD_META.formIcon ? FIELD_META.formIcon.options : []).filter((o) => o.value !== 'none');
const COLORES = FIELD_META.formColorRim && 'select' in FIELD_META.formColorRim ? FIELD_META.formColorRim.options : [];

let siguiente = 1;
const nuevoId = () => `e${Date.now().toString(36)}${siguiente++}`;

function nuevo(tipo: ElementoTermo['tipo'], cara: ElementoTermo['cara']): ElementoTermo {
  return {
    id: nuevoId(),
    tipo,
    cara,
    texto: tipo === 'texto' ? 'Love' : '',
    icono: 'heart',
    x: 0,
    y: tipo === 'texto' ? -40 : 30,
    rot: 0,
    tam: tipo === 'texto' ? 55 : 35,
    alto: 0,
    enrejado: tipo === 'icono',
    negrita: false,
    color: tipo === 'texto' ? '#1f1f24' : 'auto',
  };
}

function Deslizador(props: { label: string; unit: string; min: number; max: number; step: number; value: number; set: (v: number) => void }) {
  const { label, unit, min, max, step, value, set } = props;
  return (
    <div className="field">
      <div className="field-head">
        <label>{label}</label>
        <span className="num">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={Math.round(value * 100) / 100}
            onChange={(e) => {
              const n = Number(e.target.value.replace(',', '.'));
              if (Number.isFinite(n)) set(Math.min(max, Math.max(min, n)));
            }}
          />
          <em>{unit}</em>
        </span>
      </div>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
    </div>
  );
}

export function Elementos({ valor, poner }: { valor: ElementoTermo[]; poner: (v: ElementoTermo[]) => void }) {
  const lista = Array.isArray(valor) ? valor : [];
  const cambiar = (id: string, c: Partial<ElementoTermo>) => poner(lista.map((e) => (e.id === id ? { ...e, ...c } : e)));
  const mover = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= lista.length) return;
    const l = [...lista];
    [l[i], l[j]] = [l[j], l[i]];
    poner(l);
  };
  const cuenta = (c: ElementoTermo['cara']) => lista.filter((e) => e.cara === c).length;

  return (
    <div className="elems">
      <p className="elems-cuenta">
        Delante ({cuenta('delante')}) · Detrás ({cuenta('detras')})
      </p>
      <div className="elems-add">
        {(['delante', 'detras'] as const).map((cara) => (
          <div key={cara}>
            <small>{cara === 'delante' ? 'Delante' : 'Detrás'}</small>
            <button type="button" onClick={() => poner([...lista, nuevo('texto', cara)])}>
              <Plus size={13} /> Texto
            </button>
            <button type="button" onClick={() => poner([...lista, nuevo('icono', cara)])}>
              <Plus size={13} /> Icono
            </button>
          </div>
        ))}
      </div>

      {lista.map((e, i) => (
        <div className="elem" key={e.id}>
          <div className="elem-head">
            <span className="elem-tipo">{e.tipo === 'texto' ? 'TEXTO' : 'ICONO'}</span>
            <span className="elem-nombre">{e.tipo === 'texto' ? e.texto || '—' : ICONOS.find((o) => o.value === e.icono)?.label}</span>
            <button type="button" aria-label="Subir" onClick={() => mover(i, -1)}>
              <ChevronUp size={14} />
            </button>
            <button type="button" aria-label="Bajar" onClick={() => mover(i, 1)}>
              <ChevronDown size={14} />
            </button>
            <button type="button" aria-label="Quitar" onClick={() => poner(lista.filter((x) => x.id !== e.id))}>
              <X size={14} />
            </button>
          </div>

          <div className="seg">
            {(['delante', 'detras'] as const).map((c) => (
              <button key={c} type="button" className={e.cara === c ? 'on' : ''} onClick={() => cambiar(e.id, { cara: c })}>
                {c === 'delante' ? 'Delante' : 'Detrás'}
              </button>
            ))}
          </div>

          {e.tipo === 'texto' ? (
            <>
              <label className="field">
                <span className="field-head">
                  <span>Texto</span>
                </span>
                <input type="text" maxLength={30} value={e.texto} onChange={(ev) => cambiar(e.id, { texto: ev.target.value })} />
              </label>
              <label className="toggle">
                <input type="checkbox" checked={e.negrita} onChange={(ev) => cambiar(e.id, { negrita: ev.target.checked })} />
                <span />
                Negrita
              </label>
            </>
          ) : (
            <div className="elem-iconos">
              {ICONOS.map((o) => (
                <button key={o.value} type="button" className={e.icono === o.value ? 'on' : ''} onClick={() => cambiar(e.id, { icono: o.value })}>
                  {o.label}
                </button>
              ))}
            </div>
          )}

          <label className="field select">
            <span className="field-head">
              <span>Color</span>
            </span>
            <select value={e.color} onChange={(ev) => cambiar(e.id, { color: ev.target.value })}>
              {COLORES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value === 'auto' ? 'El del dibujo' : o.label}
                </option>
              ))}
            </select>
          </label>

          <div className="seg">
            <button type="button" className={!e.enrejado ? 'on' : ''} onClick={() => cambiar(e.id, { enrejado: false })}>
              Macizo
            </button>
            <button type="button" className={e.enrejado ? 'on' : ''} onClick={() => cambiar(e.id, { enrejado: true })}>
              Enrejado
            </button>
          </div>

          <Deslizador label="Izquierda / derecha" unit="%" min={-100} max={100} step={1} value={e.x} set={(v) => cambiar(e.id, { x: v })} />
          <Deslizador label="Abajo / arriba" unit="%" min={-100} max={100} step={1} value={e.y} set={(v) => cambiar(e.id, { y: v })} />
          <Deslizador label="Giro" unit="°" min={-180} max={180} step={1} value={e.rot} set={(v) => cambiar(e.id, { rot: v })} />
          <Deslizador label="Tamaño" unit="%" min={5} max={100} step={1} value={e.tam} set={(v) => cambiar(e.id, { tam: v })} />
          <Deslizador label="Altura sobre la plancha" unit="mm" min={0} max={2} step={0.1} value={e.alto} set={(v) => cambiar(e.id, { alto: v })} />
        </div>
      ))}
    </div>
  );
}
