# ProvenanceOS™ — Australian Provenance Project

A field-first specimen registry for Andamooka material, pXRF evidence and visual capture.

## Field workflow

**Register once.**

Choose from:

AHM — Andamooka Hard Matrix,

ACC — Andamooka Coloured Concrete,

ACX — Andamooka Crystal Opal, or

OTH — Unknown / Other.

The database assigns the next class-specific number, so you'll never type an ID.

**Capture evidence.** Visible light is the normal specimen record. Fluorescence and phosphorescence are first-class capture modes and can be photographs or video.

**Import Vanta data in batches.** Export a periodic CSV from the Vanta. ProvenanceOS™ hashes and preserves the original CSV, parses the readings, and attaches every row carrying an exact specimen ID, not a horrible one-reading-at-a-time workflow.

**Review exceptions.** A missing, unknown or conflicting specimen ID is not guessed. The source row is retained as an unmatched record for human review.

**Measure carefully.** The camera can produce a 2D length estimate only when a known reference is visible in the same plane. It is explicitly labelled as a derived estimate, not laboratory metrology and not a guessed thickness.

**Create presentation cutouts.** Background removal uses on-device interactive segmentation. The original photograph remains untouched; the cutout is stored as a derived media item with a processing method and link to the source. Photograph the stone against the cleanest background possible.

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

## Treatment record

For treated material, record the treatment as a separate specimen event. ProvenanceOS should distinguish the treatment process from the subsequent analytical measurement.

A pXRF S result is an **observed elemental result**, not a measurement of “how much sulfuric acid was used” or a direct measure of treatment dose. For sugar/acid carbonisation, record the treatment method and whatever process information is actually known (for example, reagent identity/concentration, amount, duration, temperature, cycles, operator and pre/post-treatment mass). Do not back-calculate treatment dose from the final S reading.

The treatment record should remain linked to the specimen and its original analytical observations so treated and untreated states can be compared without rewriting either record.
