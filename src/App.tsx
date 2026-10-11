import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Image as ImageIcon, Wand2 } from 'lucide-react';
import { DEFAULTS, type Piece, type Silhouette } from './types';
import { autoLevels, loadImageData } from './lib/image';
import { buildPieces, vectorize } from './lib/pipeline';
import { byId, productosDe } from './lib/catalog';
import { arcTextImage, imageWithText, textImage, textOnlyImage, useFont } from './lib/sources';
import { isEmbedded, saveBlob } from './lib/save';
import { applyWatermark, canWatermark, rasterizeText } from './lib/watermark';
import { FONT_STYLES, fontCss, type FontStyle } from './lib/font';
import { triangleCount } from './lib/mesh';
import { TEMPLATES, templatePreview, templateToBlob, type Template } from './lib/templates';
import { openInSlicer, SLICERS, uploadForSlicer, type Slicer } from './lib/cloud';
import { armarArchivo, medidas, type Fmt } from './lib/exportar';
import { tiradorAnilla, tiradorTexto } from './lib/tiradores';
import { loadSession, saveSession } from './lib/session';
import { watchForUpdates } from './lib/version';
import { useHistorial } from './hooks/useHistorial';

import { Viewer } from './components/Viewer';
import { Controls } from './components/Controls';
import { Presets } from './components/Presets';
import { Colores } from './components/Colores';
import { Marca } from './components/Marca';
import { Descarga } from './components/Descarga';
import { Portada } from './components/Portada';
import { Barra, type ViewMode } from './components/Barra';

// Lo último que se dejó la vez anterior: producto, ajustes y marca del taller.
const SAVED = loadSession();

/**
 * La aplicación entera: la columna de la izquierda (imagen y producto), la
 * vista 3D en el centro y la de la derecha (ajustes, colores, marca y
 * descargar).
 *
 * Aquí vive el ESTADO y el camino de la imagen a las piezas:
 *
 *   imagen (+ nombre) → fuente → silueta (vectorizar) → piezas (mallar)
 *                     → marca y colores → visor y archivo
 *
 * Lo que se dibuja está repartido en `components/` y las cuentas en `lib/`.
 *
 * `novedades`: esta es la página de NOVEDADES (/novedades/), donde se prueba lo
 * nuevo sin estorbar en el día a día del taller. Es otra página de verdad —su
 * dirección, su pestaña, sus ajustes guardados—, pero la misma aplicación por
 * dentro: lo que se arregla en una queda arreglado en la otra.
 */
export default function App({ novedades = false }: { novedades?: boolean }) {
  const { params, setParams, set, deshacer, rehacer, reset, puedeDeshacer, puedeRehacer } =
    useHistorial(SAVED.params ?? DEFAULTS);

  // El producto tiene que ser de la página en la que se está. Si no —se llega a
  // la de siempre con el termoformado puesto de la última vez, o al revés—, se
  // pasa al primero de esta página.
  useEffect(() => {
    if (!!byId(params.product).novedad === novedades) return;
    const primero = productosDe(novedades)[0];
    if (primero) setParams((prev) => ({ ...prev, product: primero.id }));
  }, [novedades, params.product, setParams]);

  // --- La imagen y lo que sale de ella -----------------------------------------
  const [img, setImg] = useState<ImageData | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [silhouette, setSilhouette] = useState<Silhouette | null>(null);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // «Generando…»: el vectorizado bloquea un instante con imágenes grandes, y sin
  // avisar parece que la web se ha colgado. Se enciende antes de calcular.
  const [computing, setComputing] = useState(false);
  // ¿Se ha publicado una versión nueva mientras esta pestaña estaba abierta?
  const [stale, setStale] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // --- Descargar y mandar al laminador -----------------------------------------
  const [dlOpen, setDlOpen] = useState(false);
  const [dlFmts, setDlFmts] = useState<Set<Fmt>>(new Set<Fmt>(['3mf']));
  const [dlName, setDlName] = useState('');
  const [separate, setSeparate] = useState(true);
  const [slicer, setSlicer] = useState<Slicer>('bambu');
  const [sending, setSending] = useState(false);

  // --- Marca del taller --------------------------------------------------------
  const [mark, setMark] = useState(SAVED.mark ?? 'Barakaldesa Manitas 3D');
  const [markOn, setMarkOn] = useState(false);
  const [markStyle, setMarkStyle] = useState<FontStyle>(SAVED.markStyle ?? 'redonda');
  const [markArc, setMarkArc] = useState(SAVED.markArc ?? false);
  const [markSize, setMarkSize] = useState(SAVED.markSize ?? 6);
  // Las tipografías de la marca acaban siendo geometría del STL, así que hay que
  // esperar a tenerlas cargadas: si se rasteriza antes, el canvas dibuja con la
  // letra de reserva y la pieza sale con otra fuente. Al terminar, este estado
  // cambia y la marca se vuelve a calcular con la buena.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let vivo = true;
    Promise.all(FONT_STYLES.map((f) => document.fonts.load(fontCss(f.id, 40))))
      .catch(() => {})
      .then(() => { if (vivo) setFontsReady(true); });
    return () => { vivo = false; };
  }, []);

  // --- Colores -----------------------------------------------------------------
  // Fondo (la placa), trazo (el relieve), nombre y una CUARTA tinta. Las tres
  // primeras las reparte la pieza sola; la cuarta no la usa nada por su cuenta,
  // está para pintar zonas a mano. Así siempre hay cuatro colores a mano, salga
  // la imagen que salga. El nombre va en rosa glaseado y no en cian: el cian es
  // el del tirador de la vista, y un nombre del mismo color que el tirador hace
  // que la bola parezca fondo de las letras.
  const [palette, setPalette] = useState(['#e4d5c1', '#8a5038', '#ff5fa2', '#4e8cff']);
  const [bgColor, traceColor, textColor] = palette;
  // Zonas pintadas a mano: 'idPieza#zona' -> número de color de la paleta. La
  // zona es 'base' (la placa), 'name' (el nombre) o 'pN' (cada trozo suelto del
  // dibujo). Lo que no esté aquí se queda con el color que le toca por defecto.
  const [zoneInk, setZoneInk] = useState<Record<string, number>>({});
  // Color con el que se pinta al tocar la pieza. Sin él, tocar no hace nada y el
  // ratón sigue sirviendo solo para girar el modelo.
  const [brush, setBrush] = useState<number | null>(null);
  // Colores de las capas (productos «en capas de color»), elegibles uno a uno.
  const [layerColors, setLayerColors] = useState(['#e4d5c1', '#c98f5a', '#8a5038', '#4e2b1f', '#2b1712']);
  // Ocultar el relieve para ver la placa lisa.
  const [hideTrace, setHideTrace] = useState(false);
  // Una sola tinta: ni relieve aparte ni filo turquesa ni capas. Se imprime del
  // tirón, sin cambios de filamento, que es como se hace la mayoría de las veces.
  const [oneColor, setOneColor] = useState(false);

  // --- Cómo se ve --------------------------------------------------------------
  const [exploded, setExploded] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('solid');
  // Mirar la pieza desde abajo: la marca del taller se graba en esa cara.
  const [flipped, setFlipped] = useState(false);
  // Termoformado: enseñar las planchas ya abombadas. Empieza encendido porque es
  // lo que se quiere ver; plana es como se imprime, y eso ya lo dice el botón.
  const [showFormed, setShowFormed] = useState(true);

  const open = useCallback(async (file: File | Blob) => {
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

  // Empezar desde una plantilla: se pinta y entra por el mismo camino que una
  // foto, así que la vista previa y todos los ajustes funcionan igual.
  const loadTemplate = useCallback(
    async (t: Template) => {
      try {
        await open(await templateToBlob(t));
      } catch {
        setError('No se ha podido cargar la plantilla.');
      }
    },
    [open],
  );

  // Si se publica una versión nueva, esta pestaña se entera y lo dice. Sin esto,
  // quien la tenga abierta desde antes sigue con la vieja sin saberlo.
  useEffect(
    () =>
      watchForUpdates((recienAbierta) => {
        // Recién abierta y con versión vieja en caché: se recarga sola, que es lo
        // que se esperaba del F5. Una sola vez por pestaña, con un pestillo en
        // sessionStorage: si el servidor contestara raro, no queremos una página
        // recargándose en bucle.
        try {
          if (recienAbierta && !sessionStorage.getItem('moldelab-recargada')) {
            sessionStorage.setItem('moldelab-recargada', '1');
            location.reload();
            return;
          }
        } catch {
          // Modo incógnito sin almacenamiento: se cae al aviso de siempre.
        }
        setStale(true);
      }),
    [],
  );

  // Recordar entre visitas: se guarda lo último (producto, ajustes, marca) con
  // un pequeño retardo, para no escribir en cada tirón de deslizador.
  useEffect(() => {
    const t = setTimeout(() => saveSession({ params, mark, markStyle, markArc, markSize }), 400);
    return () => clearTimeout(t);
  }, [params, mark, markStyle, markArc, markSize]);

  // Pegar del portapapeles: en un editor así se usa más que el botón.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) open(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open]);

  // --- De la imagen a las piezas -----------------------------------------------

  // La fuente real del pipeline: la imagen subida, texto rasterizado, la
  // mezcla de ambos, o un QR. Se recalcula solo cuando cambian sus entradas.
  const [source, setSource] = useState<ImageData | null>(null);
  // El nombre solo, en el mismo lienzo: es lo que permite levantarlo aparte.
  const [textSource, setTextSource] = useState<ImageData | null>(null);
  const product = byId(params.product);

  useEffect(() => {
    let alive = true;
    const compose = async (): Promise<ImageData | null> => {
      if (product.needsText) {
        const t = params.textContent;
        // Solo los productos de imagen + texto combinan las dos cosas. En el
        // resto de productos de texto (letrero de letra grande, curvo, llavero
        // de texto) manda el texto: mezclar la imagen dejaba las letras
        // diminutas al lado del dibujo, y el filtro de islas pequeñas se las
        // comía.
        if (product.imageAndText) {
          if (img && t.trim())
            // Los deslizadores van en %, la función en fracción.
            return imageWithText(img, t, params.textScale, params.textX / 100, params.textY / 100, params.textRot);
          if (img) return img;
        }
        if (!t.trim()) return img;
        return params.product === 'sign-curved'
          ? arcTextImage(t, params.textScale, params.textCurve)
          : textImage(t, params.textScale);
      }
      return img;
    };
    // La tipografía elegida, antes de componer nada.
    useFont(params.textFont);

    // Pequeño debounce: que teclear un nombre no vectorice letra a letra.
    const timer = setTimeout(async () => {
      try {
        const composed = await compose();
        if (!alive) return;
        setSource(composed);
        // Y aparte, el nombre solo: el generador lo necesita para levantarlo por
        // encima del dibujo en vez de dejarlo fundido con él.
        setTextSource(
          product.imageAndText && img && params.textContent.trim()
            ? textOnlyImage(img, params.textContent, params.textScale, params.textX / 100, params.textY / 100, params.textRot)
            : null,
        );
      } catch {
        if (alive) setError('No se ha podido componer la fuente.');
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [img, product, params.textContent, params.textScale, params.textFont, params.textRot, params.textX, params.textY, params.textCurve, params.product, fontsReady]);

  // Vectorizar es lo caro: solo cuando cambia algo que afecta al contorno.
  const vecKey = [
    params.threshold,
    params.detailThreshold,
    params.useDetailThreshold,
    params.colorAsInk,
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
      setComputing(false);
      return;
    }
    // Se enciende ANTES del setTimeout: así el navegador pinta el aviso durante
    // esos 60 ms y ya está en pantalla cuando el cálculo bloquea de verdad.
    setComputing(true);
    const t = setTimeout(() => {
      try {
        setSilhouette(vectorize(source, params, textSource));
        setError(null);
      } catch {
        setError('El contorno ha salido roto. Sube el umbral o la limpieza.');
        setComputing(false);
      }
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, textSource, vecKey]);

  // Mallar es barato: se rehace con cada slider. Aquí se apaga el aviso, cuando
  // la silueta ya está vectorizada y las piezas construidas.
  useEffect(() => {
    if (!silhouette) return;
    try {
      setPieces(buildPieces(silhouette, params));
      setError(null);
    } catch {
      setError('No se ha podido generar la malla con estos valores.');
    }
    setComputing(false);
  }, [silhouette, params]);

  // ¿Se ha llegado a grabar algo? Si a ese tamaño el texto no cabe entero dentro
  // de la pieza no se pone —medio texto al aire no vale— y sin avisar parecería
  // que la marca está rota.
  const [markFits, setMarkFits] = useState(true);

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
          heightMm: markSize,
          style: markStyle,
          arc: markArc,
          // El canvas vive en el navegador; el resto del módulo corre en Node.
          raster: rasterizeText,
        });
      } catch {
        return pieces;
      }
    })();

    const grabada =
      !markOn ||
      !mark.trim() ||
      stamped.some((p, i) => p.mesh.positions.length !== pieces[i]?.mesh.positions.length);
    setMarkFits(grabada);

    // Una sola tinta: se le quita a cada pieza tanto su color propio como el
    // relieve marcado aparte. Sin `overlay` no hay segundo color que repartir,
    // ni en el visor ni en el 3MF, así que el laminador no pide cambios de
    // filamento. La geometría no se toca: sigue siendo la misma pieza.
    if (oneColor) return stamped.map((p): Piece => ({ ...p, tint: undefined, overlay: undefined }));

    // Las piezas que traen color propio (las capas) reciben el que haya elegido
    // el usuario, en orden. Si no ha tocado nada, se quedan con el suyo.
    let i = 0;
    return stamped.map((p) => (p.tint ? { ...p, tint: layerColors[i++] ?? p.tint } : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieces, markOn, mark, markStyle, markArc, markSize, fontsReady, layerColors, oneColor]);

  const stats = useMemo(
    () => ({
      tris: marked.reduce((n, p) => n + triangleCount(p.mesh), 0),
      w: silhouette?.widthMm ?? 0,
      h: silhouette?.heightMm ?? 0,
      loops: silhouette?.loops.length ?? 0,
    }),
    [marked, silhouette],
  );
  const dims = useMemo(() => medidas(marked), [marked]);
  const markable = pieces.some(canWatermark);
  const hasTrace = marked.some((p) => (p.overlay?.positions.length ?? 0) > 0);

  // El color pintado a mano de una zona, si lo tiene. Lo comparten el visor y el
  // 3MF, así que el archivo sale pintado exactamente igual que se ve.
  const colorOf = useCallback(
    (pieceId: string, zone: string): string | undefined => {
      const n = zoneInk[`${pieceId}#${zone}`];
      return n === undefined ? undefined : palette[n];
    },
    [zoneInk, palette],
  );
  const paint = useCallback(
    (pieceId: string, zone: string) => {
      if (brush === null) return;
      setZoneInk((prev) => ({ ...prev, [`${pieceId}#${zone}`]: brush }));
    },
    [brush],
  );

  // Tiradores de la vista: la anilla del llavero y el nombre.
  const ringDrag = useMemo(
    () => tiradorAnilla(silhouette, params, marked.length > 0, setParams),
    [silhouette, params, marked.length, setParams],
  );
  const textDrag = useMemo(
    () => tiradorTexto(silhouette, source, img, params, marked.length, setParams),
    [silhouette, source, img, params, marked.length, setParams],
  );

  // --- Archivos ----------------------------------------------------------------

  const porDefecto = `moldelab-${params.product}`;
  const buildFile = () =>
    armarArchivo(marked, silhouette, {
      formatos: dlFmts,
      nombre: dlName,
      porDefecto,
      separar: separate,
      colores: { bg: bgColor, trace: traceColor, text: textColor },
      // Sin «todo de un color», las zonas pintadas a mano viajan al archivo.
      zona: oneColor ? undefined : colorOf,
    });

  const avisar = (texto: string, ms: number) => {
    setNotice(texto);
    setTimeout(() => setNotice(null), ms);
  };

  /**
   * Mandar al laminador. Sube el archivo a internet y le pasa la dirección:
   * el laminador se lo descarga él solo. Ver `lib/cloud.ts` para el porqué.
   */
  const sendToSlicer = async () => {
    const built = await buildFile();
    if (!built) return;
    setSending(true);
    setError(null);
    try {
      const up = await uploadForSlicer(built.blob, built.outName);
      if (!up.ok) {
        setError(
          up.reason === 'sin-configurar'
            ? 'Falta configurar el envío al laminador.'
            : `No se ha podido enviar el modelo (${up.reason}). Descárgalo y ábrelo a mano.`,
        );
        return;
      }
      openInSlicer(up.url, slicer);
      setDlOpen(false);
      avisar(
        `Enviado a ${SLICERS.find((x) => x.id === slicer)?.label}. Si te pide confirmar el enlace, dile que sí; y si no se abre, cierra el laminador y vuelve a darle.`,
        12000,
      );
    } finally {
      setSending(false);
    }
  };

  const download = async () => {
    const built = await buildFile();
    if (!built) return;
    const { blob, outName } = built;

    const result = await saveBlob(blob, outName);
    if (result.ok) {
      setDlOpen(false);
      avisar(`Guardado: ${outName} (${(blob.size / 1024).toFixed(0)} KB)`, 4000);
    } else if (result.reason === 'sandboxed') {
      setError(
        'Este preview embebido bloquea las descargas. Abre la app en una pestaña propia del navegador (botón "abrir en nueva pestaña" del preview) y vuelve a darle.',
      );
    } else {
      setError('El navegador ha rechazado la descarga. Prueba en Chrome o Firefox de escritorio.');
    }
  };

  // --- Lo que se ve ------------------------------------------------------------

  const elegirImagen = () => fileRef.current?.click();

  return (
    <div
      className={novedades ? 'app work novedades' : 'app work'}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) open(f);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => e.target.files?.[0] && open(e.target.files[0])}
      />

      <aside className="col col-left">
        <header className={novedades ? 'brand novedades' : 'brand'}>
          <span className="mark" aria-hidden />
          <div>
            <h1>MoldeLab{novedades && <em> Novedades</em>}</h1>
            <p>{novedades ? 'Lo nuevo, en pruebas.' : 'Una imagen entra. Un STL sale.'}</p>
          </div>
          <a
            className="to-page"
            href={novedades ? '../' : './novedades/'}
            title={novedades ? 'Volver a la página de siempre' : 'Ir a la página de novedades: lo nuevo, todavía en pruebas'}
          >
            {novedades ? '← Volver' : 'Novedades →'}
          </a>
        </header>

        <button className="upload" onClick={elegirImagen}>
          <ImageIcon size={16} />
          {img ? 'Cambiar imagen' : 'Subir imagen'}
          <kbd>o pega con Ctrl+V</kbd>
        </button>

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

        {img && (
          <details className="tpl-more">
            <summary>Empezar con una forma</summary>
            <div className="tpl-strip">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" onClick={() => loadTemplate(t)} title={t.label}>
                  <img src={templatePreview(t)} alt={t.label} />
                </button>
              ))}
            </div>
          </details>
        )}

        <Controls p={params} set={set} reset={reset} view="product" novedades={novedades} />
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
            <Viewer
              pieces={marked}
              exploded={exploded}
              formed={showFormed}
              mark={markOn ? mark : null}
              bgColor={bgColor}
              traceColor={traceColor}
              textColor={textColor}
              colorOf={oneColor ? undefined : colorOf}
              onPaint={brush === null || oneColor ? undefined : paint}
              hideTrace={hideTrace}
              viewMode={viewMode}
              oneColor={oneColor}
              flipped={flipped}
              ring={ringDrag?.pos ?? null}
              onRingMove={ringDrag?.move}
              text={textDrag?.pos ?? null}
              onTextMove={textDrag?.move}
              textRot={textDrag?.rot ?? null}
              onTextRot={textDrag?.girar}
            />
            <Barra
              deshacer={deshacer}
              rehacer={rehacer}
              puedeDeshacer={puedeDeshacer}
              puedeRehacer={puedeRehacer}
              variasPiezas={pieces.length > 1}
              exploded={exploded}
              toggleExploded={() => setExploded((v) => !v)}
              viewMode={viewMode}
              siguienteVista={() => setViewMode((m) => (m === 'solid' ? 'xray' : m === 'xray' ? 'wire' : 'solid'))}
              flipped={flipped}
              toggleFlipped={() => setFlipped((v) => !v)}
              abombable={marked.some((pc) => pc.dome)}
              showFormed={showFormed}
              toggleFormed={() => setShowFormed((v) => !v)}
              producto={product.label}
              dims={dims}
              triangulos={stats.tris}
            />
          </>
        ) : (
          <Portada elegir={elegirImagen} plantilla={loadTemplate} />
        )}

        {computing && (
          <div className="computing" role="status">
            <span className="spinner" aria-hidden />
            Generando…
          </div>
        )}
        {stale && (
          <div className="toast update">
            Hay una versión nueva de MoldeLab.
            <button type="button" onClick={() => location.reload()}>
              Actualizar
            </button>
          </div>
        )}
        {busy && <div className="toast">Leyendo la imagen…</div>}
        {error && <div className="toast error">{error}</div>}
        {notice && <div className="toast good">{notice}</div>}
      </main>

      <aside className="col col-right">
        <Controls p={params} set={set} reset={reset} view="tune" novedades={novedades} hayImagen={!!img} />
        <Presets params={params} cargar={setParams} />
        {pieces.length > 0 && (
          <>
            <Colores
              piezas={marked}
              oneColor={oneColor}
              setOneColor={setOneColor}
              palette={palette}
              setColor={(i, c) => setPalette((prev) => prev.map((x, j) => (j === i ? c : x)))}
              layerColors={layerColors}
              setLayerColor={(i, c) =>
                setLayerColors((prev) => {
                  const next = [...prev];
                  next[i] = c;
                  return next;
                })
              }
              brush={brush}
              setBrush={setBrush}
              hayPintadas={Object.keys(zoneInk).length > 0}
              quitarPintadas={() => {
                setZoneInk({});
                setBrush(null);
              }}
              hasTrace={hasTrace}
              hideTrace={hideTrace}
              setHideTrace={setHideTrace}
            />
            <Marca
              admite={markable}
              on={markOn}
              setOn={setMarkOn}
              texto={mark}
              setTexto={setMark}
              estilo={markStyle}
              setEstilo={setMarkStyle}
              arco={markArc}
              setArco={setMarkArc}
              tam={markSize}
              setTam={setMarkSize}
              cabe={markFits}
            />
            <footer className="actions">
              <button className="primary" onClick={() => setDlOpen(true)}>
                <Download size={15} />
                Descargar…
              </button>
            </footer>
          </>
        )}
      </aside>

      {dlOpen && (
        <Descarga
          cerrar={() => setDlOpen(false)}
          nombre={dlName}
          setNombre={setDlName}
          porDefecto={porDefecto}
          formatos={dlFmts}
          setFormatos={setDlFmts}
          variasPiezas={pieces.length > 1}
          separar={separate}
          setSeparar={setSeparate}
          slicer={slicer}
          setSlicer={setSlicer}
          enviando={sending}
          enviar={sendToSlicer}
          descargar={download}
        />
      )}
    </div>
  );
}
