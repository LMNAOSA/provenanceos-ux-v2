# GOOGLE AI STUDIO — SOLARIUM INSTALL DIRECTIVE

The attached `SOLARIUM_IMPORT` directory contains the verified latest standalone **opallightbox-restyled** source files and the original GLB, optical maps and local Draco decoder. It is a MODULE SOURCE PACKAGE, not a replacement for the existing CONSOL application.

**Current application:** React 19 / TypeScript / Vite `provenanceos-ux-v2`, inside the existing CONSOL branch. Preserve all existing authentication, routes, Supabase services, evidence capture and XRF import code.

## Implementation — one feature branch, one working vertical slice
1. Inspect the supplied archive and current repository. Confirm every source and binary asset exists. Never invent a new renderer or re-create the shaders.
2. Copy `src/ThreeOpalViewer.tsx` and the adapted Light Box UI into `src/modules/solarium/` with proper TypeScript imports. **Preserve renderer shader source unchanged** on first integration, including the restyled `renderer.setSize(width, height, false)` adjustment.
3. Convert the standalone `App.tsx` into an exported `SolariumPage` React component. Remove its `createRoot(...#root)` call and let CONSOL's existing `src/main.tsx` own the ONLY root. Keep the original UI, lamp defaults, controls, model and callback behaviour.
4. Scope the entire `src/style.css` to a SOLARIUM root class or CSS Modules. Do not allow global `header`, `main`, `aside`, `body`, `.stage` or `.slider` rules to alter CONSOL screens. Preserve the restyled look faithfully.
5. Place the provided demonstration GLB and optical maps under `public/solarium/models/` and Draco decoder under `public/solarium/draco/`. Update URLs and `DRACOLoader.setDecoderPath()` to those namespaced paths, or build a configurable asset-base interface. Do not break loaded assets. These files are demonstration assets; keep future confidential specimen models in authorised private storage.
6. Add a lazy-loaded `#/solarium` route to CONSOL's existing hash router, with a coherent navigation entry. Do NOT make a new Vercel project or replace the repository's `index.html`, `package.json`, `vite.config.ts` or `vercel.json` with the standalone site's files.
7. Demo mode must work when zero specimens are registered: use the original `Matrixtwin_opal.glb`, label it **Demonstration optical study**, and never insert a phantom specimen into Supabase.
8. Build **Explorer** with the exact restyled UI. For **Research Laboratory**, inspect the actual viewer props and hooks (`instrumentMode`, `showInstruments`, `sectionEnabled`, `sectionOffset`, `onOpticalMetricsChange`, `onFeaturesProjected`, telemetry). Expose ONLY verified functional instrumentation. Don't invent calibrated scientific measurements or claim the complete R&D interface is already in this standalone App.
9. Asset manifests for real specimens will come later via secure Supabase integration. Do not change production schema, RLS, storage policies or confidential evidence as part of this initial visual integration.
10. Preserve Three.js lifecycle cleanup, WebGL unavailable handling, camera orbit, reset, zoom, lamp direction/fill/intensity, background controls, green-blue flash, colour-map orientation, mobile layout and reduced-motion accommodation.
11. Test the Vite production build, lazy route loading, render readiness, real GLB/PNG/WASM network responses and WebGL display in a browser. Compare visual screenshots (desktop/mobile) to the restyled reference and provide direct UI for project-owner design approval. Tests/build alone are insufficient evidence of 3D rendering fidelity.
12. Deliver actual changed files, resolved dependency versions, test results, screenshot evidence and remaining defects. Do not deploy to `xrf.aosa.au` or push production/main without permission.

**Stop when the actual restyled original stone is visibly rotating with its optical lighting controls inside CONSOL.** Do not use placeholder geometry as successful completion.
