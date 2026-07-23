/// <reference types="vite/client" />

/** Configuración del envío al laminador. Se inyecta al compilar; ver lib/cloud.ts.
 *  La clave es la pública (anon): está pensada para viajar en el navegador. */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_KEY?: string;
  readonly VITE_SUPABASE_BUCKET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
