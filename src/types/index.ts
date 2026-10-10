/**
 * CONSOL / ProvenanceOS Specimen & Analytical Data Models
 * Authoritative TypeScript representations of the physical specimen registry,
 * analytical pXRF observations, evidence media, historical datasets, and metrology.
 */

export type SpecimenCode = 'AHM' | 'ACC' | 'ACX' | 'OTH';

export interface SpecimenTypeDefinition {
  code: SpecimenCode;
  name: string;
  short: string;
  note: string;
}

export const SPECIMEN_TYPES: SpecimenTypeDefinition[] = [
  { code: 'AHM', name: 'Andamooka Hard Matrix', short: 'Hard Matrix', note: 'opal-bearing hard matrix' },
  { code: 'ACC', name: 'Andamooka Coloured Concrete', short: 'Coloured Concrete', note: 'iron-stained / coloured concrete' },
  { code: 'ACX', name: 'Andamooka Crystal Opal', short: 'Crystal Opal', note: 'crystal / transparent opal' },
  { code: 'OTH', name: 'Unknown/Other/Mixed', short: 'Unknown / Other', note: 'use when classification is not yet defensible' }
];

export const SPECIMEN_TYPE_BY_CODE: Record<SpecimenCode, SpecimenTypeDefinition> = {
  AHM: SPECIMEN_TYPES[0],
  ACC: SPECIMEN_TYPES[1],
  ACX: SPECIMEN_TYPES[2],
  OTH: SPECIMEN_TYPES[3]
};

export interface Specimen {
  id: string;
  sample_code: SpecimenCode;
  location: string;
  sample_type: string;
  weight_g: number | null;
  dimensions: string | null;
  notes: string | null;
  created_at: string;
  created_by?: string | null;
}

export interface SpecimenOverview {
  id: string;
  sample_code: SpecimenCode;
  sample_type: string;
  location: string;
  weight_g: number | null;
  cover_path: string | null;
  cover_thumb_path: string | null;
  image_count: number;
  analysis_count: number;
  created_at: string;
}

export interface SpecimenCounts {
  samples: number;
  photographed: number;
  analysed: number;
}

export type CaptureKind = 'visible' | 'fluorescence' | 'phosphorescence';

export interface SpecimenImage {
  id: string;
  sample_id: string;
  storage_path: string;
  thumb_path: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  capture_kind: CaptureKind;
  media_type: string | null;
  processing_method: string;
  is_original: boolean;
  derived_from_id: string | null;
  metadata: Record<string, unknown> | null;
  width_px?: number | null;
  height_px?: number | null;
  created_at: string;
  created_by?: string | null;
}

export interface ElementalResult {
  value: number | null;
  unit: string;
  lod: boolean;
  limit?: number;
  error?: number;
}

export interface Analysis {
  id?: string;
  sample_id: string;
  instrument: string;
  method?: string | null;
  reading_no?: string | null;
  measured_at?: string | null;
  results: Record<string, ElementalResult>;
  raw: Record<string, string>;
  source_file?: string | null;
  source_sha256?: string | null;
  reading_hash: string;
  raw_file_id?: string | null;
  parser_version: string;
  match_method?: string;
  match_confidence?: number;
  match_basis?: string;
  created_at?: string;
}

export type EventKind = 'registered' | 'photographed' | 'analysed' | 'measured' | 'treated' | string;

export interface SpecimenEvent {
  id: string;
  sample_id: string;
  kind: EventKind;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface MeasurementDimensions {
  length_mm?: number;
  reference_mm?: number;
  reference_px?: number;
  object_px?: number;
  axis?: string;
  [key: string]: unknown;
}

export interface MeasurementReferenceMetadata {
  note?: string;
  source_image_id?: string;
  [key: string]: unknown;
}

export interface SpecimenMeasurement {
  id?: string;
  sample_id: string;
  method: string;
  dimensions: MeasurementDimensions;
  reference_metadata?: MeasurementReferenceMetadata;
  created_at?: string;
}

export type TreatmentStatus = 'unknown' | 'untreated' | 'treated';

export interface SpecimenTreatment {
  id?: string;
  sample_id: string;
  treatment_status: TreatmentStatus;
  treatment_method: string | null;
  reagent_name: string | null;
  reagent_concentration_pct: number | null;
  reagent_volume_ml: number | null;
  treatment_duration_min: number | null;
  temperature_c: number | null;
  cycle_count: number | null;
  pre_treatment_mass_g: number | null;
  post_treatment_mass_g: number | null;
  operator: string | null;
  treated_at: string;
  notes: string | null;
  created_at?: string;
}

export interface SpecimenDetail {
  sample: Specimen;
  images: SpecimenImage[];
  analyses: Analysis[];
  events: SpecimenEvent[];
  measurements: SpecimenMeasurement[];
  treatments: SpecimenTreatment[];
  urlOf?: (path: string | null | undefined) => string | null;
}

export interface RawFile {
  id: string;
  file_name: string;
  storage_path: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  parser_version: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ImportBatch {
  id: string;
  raw_file_id: string;
  parser_version: string;
  imported_count: number;
  duplicate_count: number;
  skipped_count: number;
  warnings: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  raw_files?: {
    file_name: string;
    sha256: string;
  };
}

export interface ImportUnmatchedRow {
  id?: string;
  import_batch_id: string;
  row_no: number;
  sample_id?: string | null;
  reason?: string | null;
  raw: Record<string, string>;
  created_at?: string;
}

export interface HistoricalDataset {
  id: string;
  name: string;
  dataset_type: string;
  description?: string | null;
  raw_file_id: string;
  parser_version: string;
  metadata: {
    record_count?: number;
    observation_count?: number;
    elements?: string[];
    units?: string[];
    locations?: string[];
    warnings?: string[];
    source_file?: string;
    source_sha256?: string;
    source_format?: string;
    workbook_sheet?: string | null;
    [key: string]: unknown;
  };
  created_at: string;
  raw_files?: {
    file_name: string;
    sha256: string;
  };
}

export interface HistoricalRecord {
  id?: string;
  dataset_id?: string;
  source_row_no: number;
  original_index?: string | null;
  location?: string | null;
  original_time?: string | null;
  measured_at_local?: string | null;
  time_ambiguous: boolean;
  original_sample?: string | null;
  material_type?: string | null;
  duration_s?: number | null;
  units?: string | null;
  sigma_value?: number | null;
  sequence?: string | null;
  res?: number | null;
  escale?: number | null;
  shape_time?: number | null;
  inspector?: string | null;
  cor_1?: string | null;
  cor_2?: string | null;
  misc?: string | null;
  note?: string | null;
  flags?: string | null;
  raw: Record<string, string>;
  created_at?: string;
  observations?: HistoricalObservation[];
}

export interface HistoricalObservation {
  id?: string;
  record_id?: string;
  analyte: string;
  raw_value: string;
  value: number | null;
  qualifier: string | null;
  detection_limit: number | null;
  raw_error: string | null;
  error: number | null;
  unit: string | null;
  created_at?: string;
}

/* Vanta Parser Types */
export interface VantaReading {
  rowNo: number;
  readingNo: string;
  measuredAt: string | null;
  method: string | null;
  instrument: string | null;
  sampleId: string | null;
  results: Record<string, ElementalResult>;
  raw: Record<string, string>;
}

export interface VantaParseResult {
  delimiter: string;
  headerRowNo: number;
  elements: string[];
  unitsAssumed: boolean;
  defaultUnit: string;
  readings: VantaReading[];
  warnings: string[];
}

export interface HistoricalParsedRecord {
  sourceRowNo: number;
  originalIndex?: string | null;
  location?: string | null;
  originalTime?: string | null;
  measuredAtLocal?: string | null;
  timeAmbiguous: boolean;
  originalSample?: string | null;
  materialType?: string | null;
  durationS?: number | null;
  units?: string | null;
  sigmaValue?: number | null;
  sequence?: string | null;
  res?: number | null;
  eScale?: number | null;
  shapeTime?: number | null;
  inspector?: string | null;
  cor1?: string | null;
  cor2?: string | null;
  misc?: string | null;
  note?: string | null;
  flags?: string | null;
  raw: Record<string, string>;
  observations: HistoricalObservation[];
}

export interface HistoricalParseResult {
  delimiter: string;
  headerRowNo: number;
  elements: string[];
  units: string[];
  warnings: string[];
  repeatedHeadersIgnored: number;
  records: HistoricalParsedRecord[];
  recordCount: number;
  observationCount: number;
  workbookSheet?: string;
  sourceFormat?: string;
  workbookSheets?: string[];
}

export interface VantaImportPlan {
  file: File;
  fileName: string;
  fileHash: string;
  parsed: VantaParseResult;
  rows: Array<{
    r: VantaReading;
    sid: string;
    readingHash: string;
  }>;
  skipped: Array<{
    r: VantaReading;
    why: string;
  }>;
}

export interface HistoricalImportPlan {
  file: File;
  fileName: string;
  fileHash: string;
  parsed: HistoricalParseResult;
}
