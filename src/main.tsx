/**
 * CONSOL Application Entry Point
 * Implements isolated runtime mounting:
 * - Default: React 19 Application Shell controls #app.
 * - ?runtime=legacy: Hands control exclusively to app.js for operational fallback.
 * Ensures exactly ONE runtime initialises authentication and DOM manipulation.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const searchParams = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search)
  : null;

const isLegacyRuntime = searchParams?.get('runtime') === 'legacy';

if (isLegacyRuntime) {
  // Isolated fallback: load legacy app.js without React mounting
  if (typeof window !== 'undefined' && !(window as unknown as { XLSX?: unknown }).XLSX) {
    const xlsxScript = document.createElement('script');
    xlsxScript.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    document.head.appendChild(xlsxScript);
  }
  const legacyScript = document.createElement('script');
  legacyScript.src = 'app.js?v=20261008-1';
  document.body.appendChild(legacyScript);
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
