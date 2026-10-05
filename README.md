# ProvenanceOS UX V2 — Australian Provenance Project

A field-first specimen registry for Andamooka material, pXRF evidence and visual capture.

## Field workflow

**Register once.** Choose AHM — Andamooka Hard Matrix, ACC — Andamooka Coloured Concrete, ACX — Andamooka Crystal Opal, or OTH — Unknown / Other. The database assigns the next class-specific number, so the user never types an ID.

**Capture evidence.** Visible light is the normal specimen record. Fluorescence and phosphorescence are first-class capture modes and can be photographs or video.

**Import Vanta data in batches.** Export a periodic CSV from the Vanta. ProvenanceOS hashes and preserves the original CSV, parses the readings, and attaches every row carrying an exact specimen ID. There is no one-reading-at-a-time workflow.

**Review exceptions.** A missing, unknown or conflicting specimen ID is not guessed. The source row is retained as an unmatched record for human review.

**Measure carefully.** The camera can produce a 2D length estimate only when a known reference is visible in the same plane. It is explicitly labelled as a derived estimate, not laboratory metrology and not a guessed thickness.

**Create presentation cutouts.** Background removal uses on-device interactive segmentation. The original photograph remains untouched; the cutout is stored as derived media with a processing method and link to the source.

## Scientific defensibility

- Original Vanta CSV files are stored in a private bucket and hashed with SHA-256.
- The exact parsed Vanta row is retained in analyses.raw.
- Exact specimen-ID matching is recorded as the match method with full confidence; non-exact rows are not silently attached.
- Units that were absent from the export are stored as UNVERIFIED rather than silently treated as ppm.
- <LOD, ND and related values remain below-detection flags and are never converted to zero by the application.
- Original media are immutable evidence; thumbnails and masks are derivatives.
- Derived camera measurements retain reference pixels, specimen pixels and source image ID.
- IDs are unique and concurrency-safe but intentionally not gap-free.

## Vanta setup

Configure the Vanta export/Auto Export so the sample identifier is written into the export row, preferably through the Vanta Notes/Sample field. The exact specimen ID is the authoritative link between the instrument result and the physical specimen.

## Run

Serve the static site over HTTPS or localhost:

    python3 -m http.server 8787

Open http://127.0.0.1:8787.

## Supabase

Run supabase/schema.sql in the Supabase SQL editor. The browser uses only the publishable key in config.js; never put a service-role or secret key in the repository.

## Historical reference data

Historical soil/pXRF exports are kept separate from physical AHM/ACC/ACX/OTH specimens. Run `supabase/historical_reference.sql` once after the main schema. The importer preserves the original source file/hash, original row fields, repeated header rows, original sample labels, units, errors and below-detection qualifiers, then stores one historical record per source row and one observation per element.

This is reference evidence, not automatically ground truth: historical analytical methods and the original time/units context remain part of the record and are not silently normalised into modern specimen results.


## Tests

    node --test tests/vanta.test.js

The next important fixture is the first real Vanta export from the instrument that will run in the field. Add it to the parser tests before treating the export template as permanently locked.