/**
 * CONSOL Application Entry Point
 * Implements isolated runtime mounting:
 * - Default: React 19 Application Shell controls #app with a single ES module Supabase client.
 * - ?runtime=legacy: Dynamically loads UMD dependencies and hands control exclusively to app.js.
 * Ensures exactly ONE runtime initialises authentication and DOM manipulation.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const searchParams =
  typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;

const isLegacyRuntime = searchParams?.get('runtime') === 'legacy';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

if (isLegacyRuntime) {
  // Isolated fallback: load UMD Supabase + SheetJS, then legacy app.js without React mounting
  void (async () => {
    try {
      if (typeof window !== 'undefined' && !(window as unknown as { supabase?: unknown }).supabase) {
        await loadScript(
          'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js'
        );
      }
      if (typeof window !== 'undefined' && !(window as unknown as { XLSX?: unknown }).XLSX) {
        await loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');
      }
    } finally {
      const legacyScript = document.createElement('script');
      legacyScript.src = 'app.js?v=20261010-1';
      document.body.appendChild(legacyScript);
    }
  })();
} else {
  // Authoritative React 19 mount point
  const container = document.getElementById('app');
  if (container) {
    const root = createRoot(container);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  }
}
