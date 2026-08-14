/**
 * Aviso de versión nueva.
 *
 * GitHub Pages sirve la página con `Cache-Control: max-age=600`, así que el
 * navegador se queda con ella diez minutos… y si la pestaña lleva abierta desde
 * antes de publicar, se queda con la vieja para siempre. Resultado: uno ve los
 * arreglos y otro no, sin saber por qué.
 *
 * Aquí se comprueba de vez en cuando —y al volver a la pestaña— si el archivo
 * que sirve el servidor sigue siendo el mismo. Como Vite le pone una huella al
 * nombre (`index-C225eX59.js`), basta con comparar ese nombre: si cambia, es que
 * hay versión nueva y se avisa para recargar. Sin service worker ni nada que
 * pueda quedarse pillado.
 */

const CHECK_MS = 5 * 60 * 1000;

/** El nombre del bundle que está corriendo AHORA en esta pestaña. */
function currentBundle(): string | null {
  for (const s of document.querySelectorAll('script[src]')) {
    const src = (s as HTMLScriptElement).getAttribute('src') ?? '';
    const m = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(src);
    if (m) return m[0];
  }
  return null;
}

/** El nombre del bundle que sirve el servidor ahora mismo. */
async function liveBundle(): Promise<string | null> {
  // La ruta va literal, sin construirla a partir de `location`. Sale la misma
  // —el navegador resuelve `./` contra la página— pero así no entra en el código
  // ningún dato que venga de fuera: la dirección se la puede inventar cualquiera
  // y no queremos que acabe decidiendo a dónde se pide.
  //
  // `no-store` es lo otro importante: sin eso el navegador contestaría con su
  // propia copia en caché y nunca nos enteraríamos de que hay versión nueva.
  const res = await fetch('./', { cache: 'no-store' });
  if (!res.ok) return null;
  const m = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(await res.text());
  return m ? m[0] : null;
}

/**
 * Avisa una sola vez cuando aparezca una versión nueva. Devuelve la función para
 * dejar de comprobar.
 */
export function watchForUpdates(onUpdate: () => void): () => void {
  const mine = currentBundle();
  // En desarrollo no hay bundle con huella: no hay nada que vigilar.
  if (!mine) return () => {};

  let done = false;
  const check = async () => {
    if (done || document.hidden) return;
    try {
      const live = await liveBundle();
      if (live && live !== mine) {
        done = true;
        onUpdate();
      }
    } catch {
      // Sin conexión o el servidor no contesta: se reintenta a la próxima.
    }
  };

  const timer = setInterval(check, CHECK_MS);
  // Al volver a la pestaña es cuando más probable es haberse quedado atrás.
  const onShow = () => {
    if (!document.hidden) check();
  };
  document.addEventListener('visibilitychange', onShow);

  return () => {
    done = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onShow);
  };
}
