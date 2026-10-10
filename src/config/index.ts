/**
 * CONSOL Configuration Module
 * Preserves the existing Supabase project, keys and storage buckets.
 */

declare global {
  interface Window {
    POS_CONFIG?: {
      SUPABASE_URL?: string;
      SUPABASE_KEY?: string;
      BUCKET?: string;
      RAW_BUCKET?: string;
    };
  }
}

const env = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
const windowConfig = typeof window !== 'undefined' ? window.POS_CONFIG : undefined;

export const config = {
  SUPABASE_URL:
    env?.VITE_SUPABASE_URL ||
    windowConfig?.SUPABASE_URL ||
    'https://npxvcedbesevknnxnuwf.supabase.co',
  SUPABASE_KEY:
    env?.VITE_SUPABASE_KEY ||
    windowConfig?.SUPABASE_KEY ||
    'sb_publishable_4VD9EcRGx6wStXB7m3fe1Q_RjKTk83Y',
  BUCKET:
    env?.VITE_BUCKET ||
    windowConfig?.BUCKET ||
    'sample-images',
  RAW_BUCKET:
    env?.VITE_RAW_BUCKET ||
    windowConfig?.RAW_BUCKET ||
    'vanta-raw',
  APP_LOGO: 'assets/app-light.png',
  SYS_LOGO: 'assets/Provwhlog.svg',
  PARSER_VERSION: 'pxrf-v2.0.0',
  HISTORICAL_PARSER_VERSION: 'historical-soil-v1.0.0',
  DEFAULT_LOCATION: 'Andamooka, South Australia',
  MAX_PHOTO_BYTES: 25 * 1024 * 1024,
  MAX_VIDEO_BYTES: 75 * 1024 * 1024,
};

export default config;
