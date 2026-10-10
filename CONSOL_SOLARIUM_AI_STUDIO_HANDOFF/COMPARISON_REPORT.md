# SOLARIUM PACKAGE COMPARISON — Verified 10 October 2026

## Packages inspected
- `opal-light-box-site (5).zip` — earlier standalone source and production build.
- `opallightbox-restyled.zip` — updated standalone source and production build.

## Decision
**Use `opallightbox-restyled.zip` as the authoritative source.** It contains every asset and source file required to run the existing light box. No files from the older package need to replace its renderer, model or textures. A `.gitignore` is added to this handoff but it does not affect rendering.

## Byte-for-byte identical across both
- `public/models/Matrixtwin_opal.glb` (2,342,792 bytes)
- `public/models/Matrixtwin_opal_domain_smooth.png` (2,499,269 bytes)
- `public/models/Matrixtwin_opal_flash_smooth.png` (951,736 bytes)
- Local Draco decoder JavaScript, wrapper and WASM
- package.json, package-lock.json and build script

## Changes in restyled package
- `src/App.tsx`: new branded header, intro, responsive lamp controls, chamber labels, footer and accessibility labels.
- `src/style.css`: redesigned responsive aesthetic, spacing, typography, surface/slider styling.
- `src/ThreeOpalViewer.tsx`: one renderer change only, `renderer.setSize(width, height, false)`, allowing CSS sizing to own the display size.
- `dist/app.js` and `dist/app.css`: updated prebuilt outputs corresponding to those changes.

## Important limitations
- Both packages are standalone websites, **not yet integrated** with CONSOL or its Supabase identity and asset system.
- `src/App.tsx` automatically calls `createRoot(document.getElementById('root')!)` at module load; this MUST be removed/split when imported into the main Vite app.
- `src/style.css` uses unscoped CSS including `body`, `main`, `header`, `aside` and `h1`; it MUST be scoped to SOLARIUM to avoid overwriting CONSOL's layout.
- Asset URLs are hardcoded to `/models/` and Draco decoder path `/draco/`; integrate under a collision-free path such as `/solarium/models/` and `/solarium/draco/`, or use an authorised specimen-specific manifest.
- The standalone `App.tsx` has `showInstruments={false}`. Viewer code has instrument props and telemetry hooks but the standalone page exposes only the focused lamp controls. A separate, working research control surface must be wired and tested; merely changing the flag is not proof the complete developer panel is present.
- Original opal optical response is a *visual lighting study*, not experimentally calibrated spectral data.
- This is a source-and-archive comparison; no browser/WebGL acceptance test against the integrated CONSOL application has yet been run.
