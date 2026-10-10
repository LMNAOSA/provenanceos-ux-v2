/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_KEY?: string;
  readonly VITE_BUCKET?: string;
  readonly VITE_RAW_BUCKET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
