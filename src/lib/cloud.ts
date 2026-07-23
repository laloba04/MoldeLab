/**
 * «Descargar y abrir»: mandar el modelo directo al laminador.
 *
 * Una web no puede arrancar programas del ordenador —el navegador lo prohíbe—,
 * así que el camino es otro: Bambu Studio y Orca registran un protocolo propio
 * (`bambustudio://`, `orcaslicer://`) y Windows les pasa la URL entera como
 * argumento. Es lo mismo que usa el botón «Open in Bambu Studio» de MakerWorld.
 *
 * La pega: el laminador NO lee el archivo del disco, se lo descarga él de una
 * dirección de internet. Y MoldeLab genera el 3MF dentro del navegador, sin
 * servidor. De ahí este módulo: sube el archivo a un cubo público de Supabase,
 * saca su dirección y se la pasa al laminador.
 *
 * Dos cosas que conviene saber, y que no son culpa nuestra:
 *
 *  - Bambu Studio solo se fía de `makerworld`, `public-cdn.bblmw.com`,
 *    `amazonaws.com` y `aliyuncs.com`. Cualquier otra dirección —Supabase
 *    incluida— le hace enseñar un aviso de seguridad pidiendo confirmación.
 *  - Si el laminador ya está abierto, muchas veces solo salta a primer plano
 *    sin cargar nada. Es un fallo suyo conocido; hay que cerrarlo antes.
 *
 * Privacidad: el nombre del archivo es aleatorio (no se puede adivinar) y en
 * cada envío se borra el anterior, así que no se va acumulando el trabajo de
 * nadie en internet.
 */

export interface CloudConfig {
  url: string; // https://xxxx.supabase.co
  key: string; // clave pública (anon / publishable): va en el navegador a propósito
  bucket: string;
}

/** Configurado en tiempo de compilación. Sin esto, el botón ni se enseña. */
export const CLOUD: CloudConfig | null = readConfig();

function readConfig(): CloudConfig | null {
  const env = import.meta.env as Record<string, string | undefined>;
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_KEY?.trim();
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key, bucket: env.VITE_SUPABASE_BUCKET?.trim() || 'envios' };
}

export type Slicer = 'bambu' | 'orca';

export const SLICERS: { id: Slicer; label: string; scheme: string }[] = [
  { id: 'bambu', label: 'Bambu Studio', scheme: 'bambustudio' },
  { id: 'orca', label: 'Orca Slicer', scheme: 'orcaslicer' },
];

const LAST_KEY = 'moldelab-ultimo-envio';

/**
 * Nombre imposible de adivinar: el cubo es público, así que lo único que impide
 * que alguien vaya pescando modelos ajenos es que el nombre no se pueda acertar.
 * De ahí que el azar sea criptográfico y no `Math.random()`, que es predecible.
 */
function randomName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot) : '';
  if (typeof crypto.randomUUID === 'function') return `${crypto.randomUUID()}${ext}`;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const rnd = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${rnd}${ext}`;
}

/** Borra el envío anterior. Si falla da igual: es limpieza, no el trabajo. */
async function forgetPrevious(cfg: CloudConfig): Promise<void> {
  let prev: string | null = null;
  try {
    prev = localStorage.getItem(LAST_KEY);
  } catch {
    return;
  }
  if (!prev) return;
  try {
    await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${prev}`, {
      method: 'DELETE',
      headers: { apikey: cfg.key, authorization: `Bearer ${cfg.key}` },
    });
  } catch {
    /* sin conexión o ya no estaba: no es asunto nuestro */
  }
  try {
    localStorage.removeItem(LAST_KEY);
  } catch {
    /* nada que hacer */
  }
}

export type UploadResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'sin-configurar' | 'red' | 'rechazado'; detail?: string };

/** Sube el archivo y devuelve su dirección pública. */
export async function uploadForSlicer(blob: Blob, filename: string): Promise<UploadResult> {
  const cfg = CLOUD;
  if (!cfg) return { ok: false, reason: 'sin-configurar' };

  await forgetPrevious(cfg);
  const name = randomName(filename);

  let res: Response;
  try {
    res = await fetch(`${cfg.url}/storage/v1/object/${cfg.bucket}/${name}`, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        authorization: `Bearer ${cfg.key}`,
        'content-type': blob.type || 'application/octet-stream',
        'cache-control': 'max-age=3600',
      },
      body: blob,
    });
  } catch (e) {
    return { ok: false, reason: 'red', detail: (e as Error).message };
  }

  if (!res.ok) {
    return { ok: false, reason: 'rechazado', detail: `${res.status} ${await res.text()}`.slice(0, 200) };
  }

  try {
    localStorage.setItem(LAST_KEY, name);
  } catch {
    /* sin almacenamiento: solo perdemos la limpieza del siguiente envío */
  }

  return { ok: true, url: `${cfg.url}/storage/v1/object/public/${cfg.bucket}/${name}` };
}

/** Le pasa la dirección al laminador. Windows arranca el programa registrado. */
export function openInSlicer(fileUrl: string, slicer: Slicer): void {
  const scheme = SLICERS.find((s) => s.id === slicer)?.scheme ?? 'bambustudio';
  window.location.href = `${scheme}://open?file=${encodeURIComponent(fileUrl)}`;
}
