# CONSOL Geographic Evidence — development branch

Branch: `feature/geographic-evidence-field-map`

This is a **staged feature**, not a production deployment. Existing records, original photo bytes, SHA-256 hashes, XRF data, SOLOPTICS and SOLARIUM remain unchanged.

## Implemented in this branch

- Authenticated staff-only **Collection → Field Map** route, desktop/mobile layout.
- A **read-only** audit of original JPEG/HEIF/HEIC uploads in private `sample-images` storage.
- EXIF extraction via `exifr` (JPEG and iPhone HEIF), including GPS, reported error/altitude, and date/time when present.
- Original evidence SHA-256 verification **before** accepting EXIF coordinates.
- Explicit audit outcomes: GPS found, no GPS, integrity mismatch, or failed read.
- Map pins for recorded observations and *temporary* audit results; markers link back to specimen identity.
- Explicit import action with confirmation, only enabled after the migration is installed.
- Idempotent append-only geographic records; existing records are never overwritten.
- Opportunistic GPS indexing on new ordinary and SOLOPTICS evidence uploads *after* the migration exists. Any GPS failure is non-fatal for evidence acquisition.

## Before using or deploying

1. Run `npm install` to install `exifr` and `maplibre-gl`. The repository does not currently contain an npm lockfile.
2. Run `npm run build && npm test` and inspect any errors. **This environment cannot currently install dependencies / execute a complete Vite build; validation is required.**
3. Review `supabase/migrations/20261020_geographic_observations.sql` against current RLS/permission requirements. **Do not apply automatically.** The migration is NOT applied to the live Supabase project.
4. If approved, apply the migration in a controlled database deployment, then validate with a staging account before production.
5. Configure `VITE_GEO_MAP_STYLE_URL` to a trusted/private MapLibre style URL. **Do not use a third-party map provider without considering mine-location privacy:** tile requests can reveal which geographic areas staff inspect. Until configured, the map shows markers in an intentionally coordinate-only preview with no third-party tile requests.
6. Log in as authorised staff; open Collection → Field Map → **Scan original photos**. This fetches **full originals**, not thumbnails; on mobile it may use substantial data. It is read-only.
7. Review the source files, hashes, coordinates and GPS accuracy before selecting **Import GPS evidence**. Re-running the import safely skips existing image/source pairs.
8. Test camera upload with a full-resolution, GPS-tagged original; confirm the observation appears in the private Field Map.
9. Keep geolocation records and precise coordinates out of public repositories, telemetry and open asset feeds.

## Scientific provenance

- `photo_exif` means *where the camera was when the original photo was made*.
- `device_gps` means a separately consented phone fix at the recording moment.
- `reported_origin` is a claim about extraction location.
- `verified_origin` requires a distinct reviewed evidence workflow.
- These **must never** be silently converted into one another.
- The SQL policy deliberately permits ordinary staff clients to insert **only unverified photo EXIF** records bound to the same original media's registered SHA-256. It does not allow staff clients to label a point as geologically verified.
- The current staff-only RLS matches the scope of the existing specimen evidence. If finer-grained commercial access is required, add an explicit geo access list with server-enforced RLS *before production deployment*.
- EXIF capture timestamps may not include an explicit timezone; original literal metadata is preserved where it cannot safely be converted to UTC.
- The geographic table can be empty without blocking specimen registration or the Field Map UI.

## Known limits

- Full live Supabase image bytes were **not** downloaded or inspected from this assistant session. The 39 media metadata rows were audited read-only via SQL, but the actual EXIF audit must be run by an authenticated user in the branch's Field Map interface.
- The baseline coordinates shown in the map viewport are a camera starting point for the renderer; there are **no synthetic specimen pins**. All pins must be sourced from an observation.
- No clustering or verified-origin editing workflow yet. Marker overlap at very close sites needs follow-up clustering.
- The iPhone `getUserMedia` / Canvas capture workflow does **not** guarantee EXIF GPS; separately consented browser geolocation is a future enhancement. Device coordinates must never be relabelled as photo EXIF.
- The current implementation assumes staff can securely read original evidence via existing Storage RLS.
- No public/production deployment or live database migration has been executed.
