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

  const value = p[field] as unknown as number;
  return (
    <label className="field">
      <span className="field-head">
        <span>{meta.label}</span>
        <output>
          {value}
          {meta.unit ? <em>{meta.unit}</em> : null}
        </output>
      </span>
      <input
        type="range"
        min={meta.min}
        max={meta.max}
        step={meta.step}
        value={value}
        onChange={(e) => set(field, Number(e.target.value) as never)}
      />
    </label>
  );
}

export function Controls({ p, set, reset }: Props) {
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
                  <strong>{prod.label}</strong>
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
                          <strong>{prod.label}</strong>
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
    </div>
  );
}
