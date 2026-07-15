import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Image as ImageIcon, Layers } from 'lucide-react';
import { DEFAULTS, type Params, type Piece, type Silhouette } from './types';
import { loadImageData } from './lib/image';
import { buildPieces, vectorize } from './lib/pipeline';
import { byId } from './lib/catalog';
import { arcTextImage, imageWithText, qrImage, textImage } from './lib/sources';
import { toStl, toZip } from './lib/stl';
import { isEmbedded, saveBlob } from './lib/save';
import { to3mf } from './lib/threemf';
import { applyWatermark, canWatermark, rasterizeText } from './lib/watermark';
import { triangleCount } from './lib/mesh';
import { Viewer } from './components/Viewer';
import { Controls } from './components/Controls';

export default function App() {
  const [params, setParams] = useState<Params>(DEFAULTS);
  const [img, setImg] = useState<ImageData | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [silhouette, setSilhouette] = useState<Silhouette | null>(null);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exploded, setExploded] = useState(true);
  const [fmt, setFmt] = useState<'3mf' | 'stl'>('3mf');
  const [mark, setMark] = useState('Barakaldesa Manitas 3D');
  const [markOn, setMarkOn] = useState(false);
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
        if (img && t.trim()) return imageWithText(img, t, params.textScale);
        if (img) return img;
        if (!t.trim()) return null;
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
  }, [img, product, params.textContent, params.textScale, params.textCurve, params.qrContent, params.product]);

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
  }, [pieces, markOn, mark]);

  const stats = useMemo(
    () => ({
      tris: marked.reduce((n, p) => n + triangleCount(p.mesh), 0),
      w: silhouette?.widthMm ?? 0,
      h: silhouette?.heightMm ?? 0,
      loops: silhouette?.loops.length ?? 0,
    }),
    [marked, silhouette],
  );

  const markable = pieces.some(canWatermark);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) open(f);
  };

  const [notice, setNotice] = useState<string | null>(null);

  const exportAll = async () => {
    // Un solo archivo siempre que se puede: el 3MF lleva todas las piezas como
    // objetos, con nombre y en milímetros. Lo que el STL nunca pudo.
    let blob: Blob;
    let name: string;
    if (fmt === '3mf') {
      blob = to3mf(marked);
      name = `moldelab-${params.product}.3mf`;
    } else if (marked.length === 1) {
      blob = toStl(marked[0].mesh, `MoldeLab ${marked[0].label}`);
      name = `moldelab-${params.product}.stl`;
    } else {
      blob = toZip(
        marked.map((pc) => ({ name: `moldelab-${params.product}-${pc.id}.stl`, mesh: pc.mesh })),
      );
      name = `moldelab-${params.product}.zip`;
    }

    const result = await saveBlob(blob, name);
    if (result.ok) {
      setNotice(`Guardado: ${name} (${(blob.size / 1024).toFixed(0)} KB)`);
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

        <Controls p={params} set={set} reset={reset} />

        {pieces.length > 0 && markable && (
          <div className="mark-box">
            <label className="toggle">
              <input type="checkbox" checked={markOn} onChange={(e) => setMarkOn(e.target.checked)} />
              <span />
              Grabar mi marca en la pieza
            </label>
            {markOn && (
              <input
                className="mark-input"
                type="text"
                value={mark}
                maxLength={32}
                placeholder="Tu marca…"
                onChange={(e) => setMark(e.target.value)}
              />
            )}
          </div>
        )}

        {pieces.length > 0 && (
          <footer className="actions">
            <div className="fmt" role="radiogroup" aria-label="Formato de descarga">
              <button
                role="radio"
                aria-checked={fmt === '3mf'}
                className={fmt === '3mf' ? 'on' : ''}
                onClick={() => setFmt('3mf')}
                title="Un archivo con todas las piezas, en milímetros"
              >
                3MF
              </button>
              <button
                role="radio"
                aria-checked={fmt === 'stl'}
                className={fmt === 'stl' ? 'on' : ''}
                onClick={() => setFmt('stl')}
                title="El clásico. Varias piezas salen en un ZIP"
              >
                STL
              </button>
            </div>
            <button className="primary" onClick={exportAll} disabled={!pieces.length}>
              <Download size={15} />
              {fmt === '3mf'
                ? `Descargar 3MF${pieces.length > 1 ? ` · ${pieces.length} piezas` : ''}`
                : pieces.length > 1
                  ? `Descargar ZIP · ${pieces.length} piezas`
                  : 'Descargar STL'}
            </button>
          </footer>
        )}
      </aside>

      <main className="stage">
        {isEmbedded() && (
          <div className="banner">
            Estás en un preview embebido: las descargas pueden estar bloqueadas. Si falla, abre la
            app en su propia pestaña.
          </div>
        )}
        {source ? (
          <>
            <Viewer pieces={marked} exploded={exploded} mark={markOn ? mark : null} />
            <div className="hud">
              {pieces.length > 1 && (
                <button className="chip" onClick={() => setExploded((v) => !v)}>
                  <Layers size={14} /> {exploded ? 'Juntar' : 'Separar'}
                </button>
              )}
              <span className="chip readout">{product.label}</span>
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
