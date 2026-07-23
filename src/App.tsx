import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Image as ImageIcon, Layers, Wand2 } from 'lucide-react';
import { DEFAULTS, type Params, type Piece, type Silhouette } from './types';
import { autoLevels, loadImageData } from './lib/image';
import { buildPieces, vectorize } from './lib/pipeline';
import { byId } from './lib/catalog';
import { boxOf } from './lib/shapes';
import { ringHandle } from './lib/generators/catalog-parts';
import { arcTextImage, imageWithText, qrImage, textImage } from './lib/sources';
import { toStl } from './lib/stl';
import { toObj, toSvg, zipFiles } from './lib/formats';
import { isEmbedded, saveBlob } from './lib/save';
import { to3mf } from './lib/threemf';
import { applyWatermark, canWatermark, rasterizeText } from './lib/watermark';
import { triangleCount } from './lib/mesh';
import { dropToBed, spreadPieces } from './lib/layout';

type Fmt = '3mf' | 'stl' | 'obj' | 'svg';
const FORMATS: { id: Fmt; label: string; hint: string }[] = [
  { id: '3mf', label: '3MF (color)', hint: 'Todas las piezas y los colores, para Bambu/Orca.' },
  { id: 'stl', label: 'STL', hint: 'El clásico. Varias piezas van en un ZIP.' },
  { id: 'obj', label: 'OBJ', hint: 'Malla 3D genérica (Blender, Meshmixer…).' },
  { id: 'svg', label: 'SVG (corte láser)', hint: 'El contorno 2D en milímetros.' },
];

import { Viewer } from './components/Viewer';
import { Controls } from './components/Controls';
import { deletePreset, loadPresets, upsertPreset, type Preset } from './lib/presets';

export default function App() {
  const [params, setParams] = useState<Params>(DEFAULTS);
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets());
  const [presetName, setPresetName] = useState('');
  const [img, setImg] = useState<ImageData | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [silhouette, setSilhouette] = useState<Silhouette | null>(null);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exploded, setExploded] = useState(true);
  // Diálogo de descarga: qué formatos, nombre, y si separar las piezas.
  const [dlOpen, setDlOpen] = useState(false);
  const [dlFmts, setDlFmts] = useState<Set<Fmt>>(new Set<Fmt>(['3mf']));
  const [dlName, setDlName] = useState('');
  const [separate, setSeparate] = useState(true);
  const [mark, setMark] = useState('Barakaldesa Manitas 3D');
  const [markOn, setMarkOn] = useState(false);
  // Colores del visor y del 3MF: fondo = placa, trazo = relieve.
  const [bgColor, setBgColor] = useState('#e4d5c1');
  const [traceColor, setTraceColor] = useState('#8a5038');
  // Colores de las capas (productos «en capas de color»), elegibles uno a uno.
  const [layerColors, setLayerColors] = useState<string[]>([
    '#e4d5c1',
    '#c98f5a',
    '#8a5038',
    '#4e2b1f',
    '#2b1712',
  ]);
  // Ocultar el relieve para ver la placa lisa.
  const [hideTrace, setHideTrace] = useState(false);
  // Modo de vista del modelo: sólido, rayos X (transparente) o alámbrico.
  const [viewMode, setViewMode] = useState<'solid' | 'xray' | 'wire'>('solid');
  const fileRef = useRef<HTMLInputElement>(null);

  const set = useCallback(<K extends keyof Params>(k: K, v: Params[K]) => {
    setParams((prev) => ({ ...prev, [k]: v }));
  }, []);

  // Restaurar mantiene el producto elegido: solo se limpian los ajustes.
  const reset = useCallback(() => {
    setParams((prev) => ({ ...DEFAULTS, product: prev.product }));
  }, []);

  const open = useCallback(async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const data = await loadImageData(file);
      setImg(data);
      setPreview(URL.createObjectURL(file));
    } catch {
      setError('No se ha podido leer la imagen. Prueba con un PNG o un JPG.');
    } finally {
      setBusy(false);
    }
  }, []);

  // Pegar del portapapeles: en un editor así se usa más que el botón.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      );
      const file = item?.getAsFile();
      if (file) open(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open]);

  // La fuente real del pipeline: la imagen subida, texto rasterizado, la
  // mezcla de ambos, o un QR. Se recalcula solo cuando cambian sus entradas.
  const [source, setSource] = useState<ImageData | null>(null);
  const product = byId(params.product);

  useEffect(() => {
    let alive = true;
    const compose = async (): Promise<ImageData | null> => {
      if (product.needsQr) {
        if (!params.qrContent.trim()) return null;
        return qrImage(params.qrContent);
      }
      if (product.needsText) {
        const t = params.textContent;
        // Solo «Llavero imagen + texto» combina las dos cosas. En el resto de
        // productos de texto (letrero de letra grande, curvo, llavero de texto)
        // manda el texto: mezclar la imagen dejaba las letras diminutas al lado
        // del dibujo, y el filtro de islas pequeñas se las comía.
        if (product.id === 'keychain-image-text') {
          if (img && t.trim())
            return imageWithText(img, t, params.textScale, params.textX, params.textY);
          if (img) return img;
        }
        if (!t.trim()) return img;
        return params.product === 'sign-curved'
          ? arcTextImage(t, params.textScale, params.textCurve)
          : textImage(t, params.textScale);
      }
      return img;
    };
    // Pequeño debounce: que teclear un nombre no vectorice letra a letra.
    const timer = setTimeout(async () => {
      try {
        const composed = await compose();
        if (alive) setSource(composed);
      } catch {
        if (alive) setError('No se ha podido componer la fuente.');
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [img, product, params.textContent, params.textScale, params.textX, params.textY, params.textCurve, params.qrContent, params.product]);

  // Vectorizar es lo caro: solo cuando cambia algo que afecta al contorno.
  const vecKey = [
    params.threshold,
    params.detailThreshold,
    params.useDetailThreshold,
    params.invert,
    params.cleanup,
    params.simplify,
    params.smooth,
    params.minIslandPct,
    params.targetWidthMm,
    params.product,
    params.layers,
  ].join('|');

  useEffect(() => {
    if (!source) {
      setSilhouette(null);
      setPieces([]);
      return;
    }
    const t = setTimeout(() => {
      try {
        setSilhouette(vectorize(source, params));
        setError(null);
      } catch {
        setError('El contorno ha salido roto. Sube el umbral o la limpieza.');
      }
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, vecKey]);

  // Mallar es barato: se rehace con cada slider.
  useEffect(() => {
    if (!silhouette) return;
    try {
      setPieces(buildPieces(silhouette, params));
      setError(null);
    } catch {
      setError('No se ha podido generar la malla con estos valores.');
    }
  }, [silhouette, params]);

  // La marca grabada se aplica sobre las piezas ya construidas. Es lo último que
  // toca la geometría: firma del taller, no parte del diseño.
  const marked = useMemo(() => {
    const stamped = (() => {
      if (!markOn || !mark.trim()) return pieces;
      try {
        return applyWatermark(pieces, {
          text: mark,
          mode: 'engrave',
          depth: 0.6,
          heightMm: 4,
          // El canvas vive en el navegador; la librería en sí corre también en Node.
          raster: rasterizeText,
        });
      } catch {
        return pieces;
      }
    })();

    // Las piezas que traen color propio (las capas) reciben el que haya elegido
    // el usuario, en orden. Si no ha tocado nada, se quedan con el suyo.
    let i = 0;
    return stamped.map((p) => (p.tint ? { ...p, tint: layerColors[i++] ?? p.tint } : p));
  }, [pieces, markOn, mark, layerColors]);

  const stats = useMemo(
    () => ({
      tris: marked.reduce((n, p) => n + triangleCount(p.mesh), 0),
      w: silhouette?.widthMm ?? 0,
      h: silhouette?.heightMm ?? 0,
      loops: silhouette?.loops.length ?? 0,
    }),
    [marked, silhouette],
  );

  // Medidas reales de la pieza (caja envolvente en mm): ancho × largo × alto.
  const dims = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of marked) {
      const q = p.mesh.positions;
      for (let i = 0; i < q.length; i += 3) {
        if (q[i] < minX) minX = q[i];
        if (q[i] > maxX) maxX = q[i];
        if (q[i + 1] < minY) minY = q[i + 1];
        if (q[i + 1] > maxY) maxY = q[i + 1];
        if (q[i + 2] < minZ) minZ = q[i + 2];
        if (q[i + 2] > maxZ) maxZ = q[i + 2];
      }
    }
    if (!Number.isFinite(minX)) return null;
    return { w: maxX - minX, l: maxY - minY, h: maxZ - minZ };
  }, [marked]);

  const markable = pieces.some(canWatermark);
  const hasTrace = marked.some((p) => (p.overlay?.positions.length ?? 0) > 0);

  // Tirador de la anilla: solo en llaveros (los que exponen «ringPos») y con una
  // sola pieza. Arrastrarlo mueve la anilla a mano, como en MakerLab.
  const ringDrag = useMemo(() => {
    const prod = byId(params.product);
    if (!silhouette || !prod.fields.includes('ringPos') || marked.length !== 1) return null;
    const box = boxOf(silhouette.loops);
    const [hx, hy] = ringHandle(silhouette.loops, params);
    const holeDefault = box.maxY + Math.max(4, box.h * 0.06);
    return {
      pos: { x: hx, y: hy, z: params.thickness },
      move: (x: number, y: number) => {
        const nx = box.w ? (x - box.cx) / (box.w / 2) : 0;
        const ny = box.h ? (y - holeDefault) / (box.h / 2) : 0;
        setParams((prev) => ({
          ...prev,
          ringPos: Math.max(-1, Math.min(1, Math.round(nx * 1000) / 1000)),
          ringPosY: Math.max(-1.5, Math.min(1.5, Math.round(ny * 1000) / 1000)),
        }));
      },
    };
  }, [silhouette, params, marked.length]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) open(f);
  };

  const [notice, setNotice] = useState<string | null>(null);

  const download = async () => {
    if (!marked.length || !dlFmts.size) return;
    const name =
      (dlName.trim() || `moldelab-${params.product}`).replace(/[^\w\-]+/g, '_').slice(0, 40) ||
      'moldelab';
    const forExport = separate ? spreadPieces(marked) : dropToBed(marked);

    // Cada formato añade uno o varios archivos; si al final hay más de uno, se
    // empaquetan en un ZIP.
    const files: Record<string, Uint8Array> = {};
    const add = async (fn: string, blob: Blob) => {
      files[fn] = new Uint8Array(await blob.arrayBuffer());
    };

    if (dlFmts.has('3mf')) await add(`${name}.3mf`, to3mf(forExport, { bg: bgColor, trace: traceColor }));
    if (dlFmts.has('obj')) await add(`${name}.obj`, toObj(forExport.map((p) => ({ name: p.label, mesh: p.mesh }))));
    if (dlFmts.has('svg') && silhouette) await add(`${name}.svg`, toSvg(silhouette.loops));
    if (dlFmts.has('stl')) {
      if (forExport.length === 1)
        await add(`${name}.stl`, toStl(forExport[0].mesh, `MoldeLab ${forExport[0].label}`));
      else for (const pc of forExport) await add(`${name}-${pc.id}.stl`, toStl(pc.mesh, pc.label));
    }

    const names = Object.keys(files);
    if (!names.length) return;
    const single = names.length === 1;
    const blob = single ? new Blob([files[names[0]].buffer as ArrayBuffer]) : zipFiles(files);
    const outName = single ? names[0] : `${name}.zip`;

    const result = await saveBlob(blob, outName);
    if (result.ok) {
      setDlOpen(false);
      setNotice(`Guardado: ${outName} (${(blob.size / 1024).toFixed(0)} KB)`);
      setTimeout(() => setNotice(null), 4000);
    } else if (result.reason === 'sandboxed') {
      setError(
        'Este preview embebido bloquea las descargas. Abre la app en una pestaña propia del navegador (botón "abrir en nueva pestaña" del preview) y vuelve a darle.',
      );
    } else {
      setError('El navegador ha rechazado la descarga. Prueba en Chrome o Firefox de escritorio.');
    }
  };

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <aside className="panel">
        <header className="brand">
          <span className="mark" aria-hidden />
          <div>
            <h1>MoldeLab</h1>
            <p>Una imagen entra. Un STL sale.</p>
          </div>
        </header>

        <button className="upload" onClick={() => fileRef.current?.click()}>
          <ImageIcon size={16} />
          {img ? 'Cambiar imagen' : 'Subir imagen'}
          <kbd>o pega con Ctrl+V</kbd>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => e.target.files?.[0] && open(e.target.files[0])}
        />

        {preview && (
          <figure className="thumb">
            <img src={preview} alt="Imagen de origen" />
            <figcaption>
              {stats.loops} contorno{stats.loops === 1 ? '' : 's'} · {stats.w.toFixed(0)}×
              {stats.h.toFixed(0)} mm
            </figcaption>
          </figure>
        )}

        {img && (
          <button
            className="upload fix"
            onClick={() => {
              const { threshold, invert } = autoLevels(img);
              setParams((prev) => ({ ...prev, threshold, invert }));
            }}
            title="Ajusta el umbral y el fondo automáticamente"
          >
            <Wand2 size={15} />
            Arreglar imagen
          </button>
        )}

        <Controls p={params} set={set} reset={reset} />

        <div className="presets">
          <h3>Ajustes guardados</h3>
          <div className="preset-save">
            <input
              type="text"
              value={presetName}
              maxLength={30}
              placeholder="Nombre del ajuste…"
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && presetName.trim()) {
                  setPresets(upsertPreset(presetName, params));
                  setPresetName('');
                }
              }}
            />
            <button
              className="mini"
              disabled={!presetName.trim()}
              onClick={() => {
                setPresets(upsertPreset(presetName, params));
                setPresetName('');
              }}
            >
              Guardar
            </button>
          </div>
          {presets.length > 0 ? (
            <ul className="preset-list">
              {presets.map((pr) => (
                <li key={pr.name}>
                  <button
                    className="preset-load"
                    title="Cargar este ajuste"
                    onClick={() => setParams({ ...DEFAULTS, ...pr.params })}
                  >
                    {pr.name}
                  </button>
                  <button
                    className="preset-del"
                    title="Borrar"
                    onClick={() => setPresets(deletePreset(pr.name))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Guarda la configuración actual con un nombre para reutilizarla.</p>
          )}
        </div>

        {pieces.length > 0 && (
          <div className="colors">
            <h3>Colores</h3>
            {marked.filter((p) => p.tint).length > 0 ? (
              // Producto por capas: un color por capa, en el mismo orden en que
              // se apilan. Es lo que se lleva el 3MF a los filamentos.
              marked
                .filter((p) => p.tint)
                .map((p, i) => (
                  <label className="color-row" key={p.id}>
                    <input
                      type="color"
                      value={layerColors[i] ?? p.tint}
                      onChange={(e) =>
                        setLayerColors((prev) => {
                          const next = [...prev];
                          next[i] = e.target.value;
                          return next;
                        })
                      }
                    />
                    <span>{p.label}</span>
                  </label>
                ))
            ) : (
              <>
                <label className="color-row">
                  <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
                  <span>Fondo (la placa)</span>
                </label>
                <label className="color-row">
                  <input
                    type="color"
                    value={traceColor}
                    onChange={(e) => setTraceColor(e.target.value)}
                  />
                  <span>Trazo (el dibujo)</span>
                </label>
              </>
            )}
            {hasTrace && (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={hideTrace}
                  onChange={(e) => setHideTrace(e.target.checked)}
                />
                <span />
                Ocultar trazo (ver la placa lisa)
              </label>
            )}
          </div>
        )}

        {pieces.length > 0 && markable && (
          <div className="mark-box">
            <label className="toggle">
              <input type="checkbox" checked={markOn} onChange={(e) => setMarkOn(e.target.checked)} />
              <span />
              Grabar mi marca en la pieza
            </label>
            {markOn && (
              <>
                <input
                  className="mark-input"
                  type="text"
                  value={mark}
                  maxLength={32}
                  placeholder="Tu marca…"
                  onChange={(e) => setMark(e.target.value)}
                />
                <p className="hint">
                  Se graba en la cara de <strong>atrás</strong> (la que toca la cama). Dale la vuelta
                  a la pieza, o usa <strong>Rayos X</strong>, para verla.
                </p>
              </>
            )}
          </div>
        )}

        {pieces.length > 0 && !markable && (
          <div className="mark-box">
            <p className="hint">
              Esta pieza no admite marca: es de <strong>corte</strong> o hueca (cortador, contorno,
              peana). La marca se graba en piezas con una cara plana (placas, llaveros, sellos…).
            </p>
          </div>
        )}

        {pieces.length > 0 && (
          <footer className="actions">
            <button className="primary" onClick={() => setDlOpen(true)} disabled={!pieces.length}>
              <Download size={15} />
              Descargar…
            </button>
          </footer>
        )}
      </aside>

      {dlOpen && (
        <div className="modal-back" onClick={() => setDlOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Descargar archivos</h3>

            <label className="modal-field">
              Nombre del archivo
              <input
                type="text"
                value={dlName}
                maxLength={40}
                placeholder={`moldelab-${params.product}`}
                onChange={(e) => setDlName(e.target.value)}
              />
            </label>

            <div className="fmt-list">
              {FORMATS.map((f) => (
                <label key={f.id} className="fmt-row">
                  <input
                    type="checkbox"
                    checked={dlFmts.has(f.id)}
                    onChange={(e) =>
                      setDlFmts((prev) => {
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

            {pieces.length > 1 && (
              <label className="toggle">
                <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} />
                <span />
                Separar las piezas en la cama
              </label>
            )}

            <div className="modal-actions">
              <button className="ghost" onClick={() => setDlOpen(false)}>
                Cancelar
              </button>
              <button className="primary" onClick={download} disabled={!dlFmts.size}>
                <Download size={15} /> Descargar{dlFmts.size > 1 ? ' (ZIP)' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="stage">
        {isEmbedded() && (
          <div className="banner">
            Estás en un preview embebido: las descargas pueden estar bloqueadas. Si falla, abre la
            app en su propia pestaña.
          </div>
        )}
        {source ? (
          <>
            <Viewer
              pieces={marked}
              exploded={exploded}
              mark={markOn ? mark : null}
              bgColor={bgColor}
              traceColor={traceColor}
              hideTrace={hideTrace}
              viewMode={viewMode}
              ring={ringDrag?.pos ?? null}
              onRingMove={ringDrag?.move}
            />
            <div className="hud">
              {pieces.length > 1 && (
                <button className="chip" onClick={() => setExploded((v) => !v)}>
                  <Layers size={14} /> {exploded ? 'Juntar' : 'Separar'}
                </button>
              )}
              <button
                className="chip"
                onClick={() =>
                  setViewMode((m) => (m === 'solid' ? 'xray' : m === 'xray' ? 'wire' : 'solid'))
                }
                title="Cambiar cómo se ve el modelo"
              >
                {viewMode === 'solid' ? 'Sólido' : viewMode === 'xray' ? 'Rayos X' : 'Alámbrico'}
              </button>
              <span className="chip readout">{product.label}</span>
              {dims && (
                <span className="chip readout" title="Ancho × Largo × Alto">
                  {dims.w.toFixed(1)} × {dims.l.toFixed(1)} × {dims.h.toFixed(1)} mm
                </span>
              )}
              <span className="chip readout">
                {stats.tris.toLocaleString('es-ES')} triángulos
              </span>
            </div>
          </>
        ) : (
          <div className="empty">
            <div className="empty-inner">
              <h2>
                Suelta un dibujo.
                <br />
                Sale un molde.
              </h2>
              <p>
                Trazo negro sobre fondo blanco, o un PNG con transparencia. Cuanto más limpio el
                dibujo, más limpio el filo.
              </p>
              <button className="primary" onClick={() => fileRef.current?.click()}>
                <ImageIcon size={16} /> Elegir imagen
              </button>
            </div>
          </div>
        )}

        {busy && <div className="toast">Leyendo la imagen…</div>}
        {error && <div className="toast error">{error}</div>}
        {notice && <div className="toast good">{notice}</div>}
      </main>
    </div>
  );
}
