/**
 * Guardar un archivo desde el navegador es un problema de tres capas, y cada
 * una falla de una manera distinta:
 *
 *  1. `showSaveFilePicker` (Chrome/Edge): el diálogo nativo de "Guardar como".
 *     Es la única vía que funciona dentro de muchos previews embebidos, porque
 *     el permiso lo concede el usuario en el diálogo, no el iframe. En Firefox
 *     y Safari no existe; en un iframe cross-origin lanza SecurityError.
 *
 *  2. Ancla + blob (el clásico): funciona en cualquier pestaña normal. Su
 *     trampa: en un iframe con sandbox sin `allow-downloads` el click se
 *     ignora EN SILENCIO — no hay excepción, no hay evento, nada. Por eso no
 *     se puede "detectar el fallo": hay que detectar el entorno antes.
 *
 *  3. Si estamos embebidos y el picker no está o ha sido bloqueado, no hay
 *     magia que valga: se informa al usuario de que abra la app en una
 *     pestaña propia, que es la solución real.
 */

export type SaveOutcome =
  | { ok: true; via: 'picker' | 'anchor' }
  | { ok: false; reason: 'sandboxed' | 'error' };

declare global {
  interface Window {
    showSaveFilePicker?: (opts: {
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<{
      createWritable: () => Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>;
    }>;
  }
}

/** ¿Corremos dentro de un iframe? (preview embebido, artefacto, editor online) */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Si ni siquiera podemos preguntarlo, es un iframe cross-origin seguro.
    return true;
  }
}

export async function saveBlob(blob: Blob, filename: string): Promise<SaveOutcome> {
  // --- 1) Diálogo nativo -----------------------------------------------------
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const dot = filename.lastIndexOf('.');
      const ext = dot >= 0 ? filename.slice(dot) : '';
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: ext
          ? [
              {
                description: 'Modelo 3D',
                accept: { [blob.type || 'application/octet-stream']: [ext] },
              },
            ]
          : undefined,
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return { ok: true, via: 'picker' };
    } catch (e) {
      const name = (e as Error).name;
      // Cancelar el diálogo no es un fallo: el usuario ha decidido.
      if (name === 'AbortError') return { ok: true, via: 'picker' };
      // SecurityError / NotAllowedError: el entorno lo veta. Seguimos abajo.
    }
  }

  // --- 2) Ancla clásica -------------------------------------------------------
  // En un iframe con sandbox el click se traga sin error, así que si estamos
  // embebidos y hemos llegado hasta aquí, lo honesto es avisar, no fingir.
  if (isEmbedded()) return { ok: false, reason: 'sandboxed' };

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    // Revocar en caliente aborta la descarga en Firefox/Safari: el fetch
    // interno del navegador aún no ha empezado. 10 s de margen.
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 10_000);
    return { ok: true, via: 'anchor' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
