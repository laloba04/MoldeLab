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
import { byId, productosDe, searchProducts } from '../lib/catalog';

interface Props {
  p: Params;
  set: <K extends keyof Params>(k: K, v: Params[K]) => void;
  reset: () => void;
  /** Qué parte enseñar: solo el selector de producto, solo sus ajustes, o
   *  ambos (por defecto). Las maquetas nuevas los colocan en columnas distintas. */
  view?: 'product' | 'tune' | 'all';
  /** En la página de novedades: solo se ven sus productos y sus opciones. */
  novedades?: boolean;
  /** Si hay imagen subida: algunos ajustes de texto solo valen con ella. */
  hayImagen?: boolean;
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

/**
 * ¿Sirve este ajuste ahora mismo? Un mando que se mueve y no cambia nada parece
 * una avería, así que los que no aplican no se enseñan.
 *
 * - El radio de esquina, solo con formas que tienen esquinas. Con la forma del
 *   molde en corazón o círculo no hay nada que redondear.
 * - Tamaño y posición del texto, solo si hay imagen: sirven para colocar el
 *   nombre RESPECTO al dibujo. Sin dibujo, el nombre solo se encaja en la pieza
 *   y moverlo o agrandarlo no cambia nada.
 */
function sirve(f: Field, p: Params, campos: Field[], hayImagen: boolean): boolean {
  if (f === 'cornerRadius' && campos.includes('moldShape')) {
    return p.moldShape === 'rounded' || p.moldShape === 'square';
  }
  if ((f === 'textScale' || f === 'textX' || f === 'textY') && campos.includes('textX')) {
    return hayImagen;
  }
  // Lo que se corre cada fila solo cuenta colocando en diagonal.
  if (f === 'rollerShift') return p.rollerLayout === 'diagonal';
  // Con solo el mango no hay dibujo que colocar.
  if (p.product === 'roller' && p.rollerPart === 'handle') {
    return f === 'rollerPart' || f === 'rollerDia' || f === 'rollerWidth';
  }
  return true;
}

/** Un control se dibuja solo a partir de su metadato. Sin JSX a mano por campo. */
function Control({
  field,
  p,
  set,
  novedades = false,
}: {
  field: Field;
  p: Params;
  set: Props['set'];
  novedades?: boolean;
}) {
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
          {meta.options
            // Las opciones nuevas solo salen en la página de novedades. La que
            // ya esté elegida se enseña siempre, para no dejar el desplegable
            // en blanco si se llegó aquí desde la otra página con ella puesta.
            .filter((o) => novedades || !o.novedad || o.value === value)
            .map((o) => (
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

  // El valor se puede ESCRIBIR, no solo arrastrar.
  //
  // Con el deslizador solo, dar con una medida exacta es una lotería: para poner
  // 2,6 mm hay que acertar el píxel. Y es justo lo que se pide cuando la pieza
  // tiene que encajar con algo. El deslizador se queda para tantear a ojo.
  //
  // Se recorta a lo que el ajuste admite: escribir 500 en un tope de 250 pondría
  // 250, no dejaría la pieza en un estado imposible.
  const escribir = (texto: string) => {
    const n = Number(texto.replace(',', '.'));
    if (!Number.isFinite(n)) return;
    set(field, Math.min(max, Math.max(meta.min, n)) as never);
  };

  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={`c-${field}`}>{meta.label}</label>
        <span className={capped ? 'num capped' : 'num'}
          title={capped ? `Limitado por otro ajuste (habías puesto ${raw})` : undefined}>
          <input
            id={`c-${field}`}
            type="number"
            min={meta.min}
            max={max}
            step={meta.step}
            value={Math.round(value * 100) / 100}
            onChange={(e) => escribir(e.target.value)}
          />
          {meta.unit ? <em>{meta.unit}</em> : null}
        </span>
      </div>
      <input
        type="range"
        aria-label={meta.label}
        min={meta.min}
        max={max}
        step={meta.step}
        value={value}
        onChange={(e) => set(field, Number(e.target.value) as never)}
      />
    </div>
  );
}

export function Controls({ p, set, reset, view = 'all', novedades = false, hayImagen = false }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ reposteria: true });
  // Apartados de ajustes abiertos o cerrados, por producto y título.
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});

  const current = byId(p.product);
  const matches = useMemo(() => searchProducts(query, novedades), [query, novedades]);
  const lista = useMemo(() => productosDe(novedades), [novedades]);
  const searching = query.trim().length > 0;

  const pick = (id: ProductId) => {
    set('product', id);
    // Cada producto nuevo arranca con sus medidas: un jibbitz no puede heredar
    // los 70 mm del producto de antes.
    const inicial = byId(id).inicial;
    if (inicial && id !== p.product) {
      for (const [k, v] of Object.entries(inicial)) set(k as keyof Params, v as never);
    }
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
            const items = lista.filter((x) => x.category === cat.id);
            // Una categoría sin nada en esta página no se enseña.
            if (!items.length) return null;
            // En novedades hay poco: se enseña todo abierto.
            const isOpen = open[cat.id] ?? novedades;
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
      {current.needsText && (
        <section>
          <h3>Texto</h3>
          <div className="textsource">
            <input
              type="text"
              placeholder="Escribe aquí…"
              value={p.textContent}
              maxLength={40}
              onChange={(e) =>
                set('textContent', e.target.value as never)
              }
            />
            <small>
              {current.id === 'keychain-image-text'
                ? 'Debajo de tu imagen o encima de ella: se mueve con «Mover texto» o arrastrando el punto de la vista.'
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
        {current.groups
          ? current.groups.map((g) => {
              const campos = g.fields.filter((f) => sirve(f, p, current.fields, hayImagen));
              // Un apartado sin nada que tocar ahora mismo no se enseña.
              if (!campos.length) return null;
              const clave = `${current.id}:${g.label}`;
              const abierto = abiertos[clave] ?? !!g.open;
              return (
                <div key={g.label} className="cat grupo">
                  <button
                    className="cat-head"
                    aria-expanded={abierto}
                    onClick={() => setAbiertos((o) => ({ ...o, [clave]: !abierto }))}
                  >
                    <span className="cat-label">{g.label}</span>
                    <span className="count">{campos.length}</span>
                    <ChevronDown size={14} className={abierto ? 'chev open' : 'chev'} />
                  </button>
                  {abierto && (
                    <div className="grupo-body">
                      {g.hint && <p className="hint">{g.hint}</p>}
                      {campos.map((f) => (
                        <Control key={f} field={f} p={p} set={set} novedades={novedades} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          : current.fields.filter((f) => sirve(f, p, current.fields, hayImagen)).map((f) => (
              <Control key={f} field={f} p={p} set={set} novedades={novedades} />
            ))}
      </section>

      <section>
        <h3>Contorno</h3>
        {traceFields.map((f) => (
          <Control key={f} field={f} p={p} set={set} novedades={novedades} />
        ))}
      </section>
      </>
      )}
    </div>
  );
}
