import { useMemo, useState } from 'react';
import { ChevronDown, RotateCcw, Search } from 'lucide-react';
import {
  CATEGORIES,
  FIELD_META,
  TRACE_FIELDS,
  type Field,
  type Params,
  type ProductId,
} from '../types';
import { PRODUCTS, byId, searchProducts } from '../lib/catalog';

interface Props {
  p: Params;
  set: <K extends keyof Params>(k: K, v: Params[K]) => void;
  reset: () => void;
  /** Qué parte enseñar: solo el selector de producto, solo sus ajustes, o
   *  ambos (por defecto). Las maquetas nuevas los colocan en columnas distintas. */
  view?: 'product' | 'tune' | 'all';
}

/** El distintivo del producto en el menú, si lo tiene. */
function Badge({ kind }: { kind?: 'nuevo' | 'popular' }) {
  if (!kind) return null;
  return <span className={`badge ${kind}`}>{kind === 'nuevo' ? 'Nuevo' : 'Popular'}</span>;
}

/**
 * Topes que dependen de otros ajustes.
 *
 * Hay valores que la geometría no puede cumplir: un filo más gordo que la pared
 * de la que sale, o un filo más alto que el propio cortador. Antes el mando
 * dejaba ponerlos y el generador los recortaba en silencio — movías el mando, no
 * pasaba nada, y parecía que la app estaba rota. Ahora el mando llega justo
 * hasta donde tiene sentido, así lo que marca es siempre lo que sale.
 */
function limitOf(field: Field, p: Params, max: number): number {
  switch (field) {
    // El filo nace de la pared: no puede ser más gordo que ella.
    case 'bladeThickness':
      return Math.min(max, p.wallThickness);
    // El filo y la pestaña viven dentro de la altura del cortador. Los topes son
    // los mismos que aplica `profile()` en generators/cutter.ts.
    case 'bladeHeight':
      return Math.min(max, p.cutterHeight * 0.6);
    case 'flangeHeight':
      return Math.min(max, p.cutterHeight * 0.3);
    default:
      return max;
  }
}

/** Un control se dibuja solo a partir de su metadato. Sin JSX a mano por campo. */
function Control({ field, p, set }: { field: Field; p: Params; set: Props['set'] }) {
  const meta = FIELD_META[field];
  if (!meta) return null;

  if ('toggle' in meta) {
    const value = p[field] as unknown as boolean;
    return (
      <label className="toggle">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => set(field, e.target.checked as never)}
        />
        <span />
        {meta.label}
      </label>
    );
  }

  if ('select' in meta) {
    const value = p[field] as unknown as string;
    return (
      <label className="field select">
        <span className="field-head">
          <span>{meta.label}</span>
        </span>
        <select value={value} onChange={(e) => set(field, e.target.value as never)}>
          {meta.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const raw = p[field] as unknown as number;
  const max = limitOf(field, p, meta.max);
  // Si el tope bajó por culpa de otro ajuste, se enseña el valor que de verdad
  // se está usando, no el que quedó guardado de antes.
  const value = Math.min(raw, max);
  const capped = raw > max + 1e-9;

  return (
    <label className="field">
      <span className="field-head">
        <span>{meta.label}</span>
        <output className={capped ? 'capped' : undefined} title={capped ? `Limitado por otro ajuste (habías puesto ${raw})` : undefined}>
          {Math.round(value * 100) / 100}
          {meta.unit ? <em>{meta.unit}</em> : null}
        </output>
      </span>
      <input
        type="range"
        min={meta.min}
        max={max}
        step={meta.step}
        value={value}
        onChange={(e) => set(field, Number(e.target.value) as never)}
      />
    </label>
  );
}

export function Controls({ p, set, reset, view = 'all' }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ reposteria: true });

  const current = byId(p.product);
  const matches = useMemo(() => searchProducts(query), [query]);
  const searching = query.trim().length > 0;

  const pick = (id: ProductId) => {
    set('product', id);
    setQuery('');
  };

  // El umbral del detalle solo tiene sentido si está activado el interruptor.
  const traceFields = TRACE_FIELDS.filter(
    (f) => f !== 'detailThreshold' || p.useDetailThreshold,
  );

  return (
    <div className="controls">
      {view !== 'tune' && (
      <section>
        <h3>Tipo de producto</h3>

        <div className="search">
          <Search size={13} />
          <input
            type="search"
            placeholder="Buscar producto…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {searching ? (
          <ul className="products flat">
            {matches.length === 0 && <li className="none">Nada con ese nombre.</li>}
            {matches.map((prod) => (
              <li key={prod.id}>
                <button
                  className={prod.id === p.product ? 'product on' : 'product'}
                  onClick={() => pick(prod.id)}
                >
                  <strong>
                    {prod.label}
                    <Badge kind={prod.badge} />
                  </strong>
                  <small>{prod.hint}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          CATEGORIES.map((cat) => {
            const items = PRODUCTS.filter((x) => x.category === cat.id);
            const isOpen = open[cat.id] ?? false;
            return (
              <div key={cat.id} className="cat">
                <button
                  className="cat-head"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((o) => ({ ...o, [cat.id]: !isOpen }))}
                >
                  <span className="cat-icon" aria-hidden>
                    {cat.icon}
                  </span>
                  <span className="cat-label">{cat.label}</span>
                  <span className="count">{items.length}</span>
                  <ChevronDown size={14} className={isOpen ? 'chev open' : 'chev'} />
                </button>

                {isOpen && (
                  <ul className="products">
                    {items.map((prod) => (
                      <li key={prod.id}>
                        <button
                          className={prod.id === p.product ? 'product on' : 'product'}
                          onClick={() => pick(prod.id)}
                        >
                          <strong>
                            {prod.label}
                            <Badge kind={prod.badge} />
                          </strong>
                          <small>{prod.hint}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </section>
      )}

      {view !== 'product' && (
      <>
      {(current.needsText || current.needsQr) && (
        <section>
          <h3>{current.needsQr ? 'Contenido del QR' : 'Texto'}</h3>
          <div className="textsource">
            <input
              type="text"
              placeholder={current.needsQr ? 'https://tu-enlace.com' : 'Escribe aquí…'}
              value={current.needsQr ? p.qrContent : p.textContent}
              maxLength={current.needsQr ? 300 : 40}
              onChange={(e) =>
                set(current.needsQr ? 'qrContent' : 'textContent', e.target.value as never)
              }
            />
            <small>
              {current.needsQr
                ? 'Enlace, texto o Wi-Fi. Cuanto más corto, más gordos los módulos y mejor se escanea impreso.'
                : current.id === 'keychain-image-text'
                  ? 'Se coloca debajo de tu imagen, soldado a ella.'
                  : 'Fuente redonda y en negrita: aguanta la impresión.'}
            </small>
          </div>
        </section>
      )}

      <section>
        <h3>
          Ajustes
          <button className="mini" onClick={reset} title="Restaurar valores">
            <RotateCcw size={11} /> Restaurar
          </button>
        </h3>
        <p className="hint">{current.hint}</p>
        {current.fields.map((f) => (
          <Control key={f} field={f} p={p} set={set} />
        ))}
      </section>

      <section>
        <h3>Contorno</h3>
        {traceFields.map((f) => (
          <Control key={f} field={f} p={p} set={set} />
        ))}
      </section>
      </>
      )}
    </div>
  );
}
