/**
 * CONSOL / Vanta Analytical Parser & Batch Ingestion Adapter
 * Strictly preserves the working vanta.js implementation without altering
 * any scientific parsing algorithms, classification rules, or regexes.
 * Includes mobile-safe CSV validation (iOS Files / Android Chrome) and
 * target-specimen-locked import plan construction.
 */

import config from '../config';
import { getSupabase, api } from './supabase';
import { sha256 } from './media';
import type {
  VantaParseResult,
  HistoricalParseResult,
  ElementalResult,
  VantaImportPlan,
  Analysis
} from '../types';

// Declare global Vanta on window/globalThis for UMD environment
declare global {
  interface Window {
    Vanta?: VantaRawApi;
  }
}

export interface VantaRawApi {
  parse(input: string): VantaParseResult;
  parseCSV(text: string, delim: string): string[][];
  classifyHeader(raw: string, prevEl?: string | null): { el: string; kind: 'value' | 'error'; unit?: string | null } | null;
  parseDateTime(dateStr: string, timeStr?: string): { iso: string; ambiguous: boolean } | null;
  sortElements(els: string[]): string[];
  parseHistoricalSoil(input: string): HistoricalParseResult;
  ELEMENT_ORDER: Record<string, number>;
}

let vantaInstance: VantaRawApi | null = null;

export async function getVantaInstance(): Promise<VantaRawApi> {
  if (vantaInstance) return vantaInstance;

  if (typeof window !== 'undefined' && window.Vanta) {
    vantaInstance = window.Vanta;
    return vantaInstance;
  }

  try {
    const imported = await import('../../vanta.js');
    vantaInstance = (imported.default || imported || (typeof window !== 'undefined' ? window.Vanta : undefined)) as unknown as VantaRawApi;
    if (vantaInstance && typeof vantaInstance.parse === 'function') {
      return vantaInstance;
    }
  } catch {
    if (typeof globalThis !== 'undefined' && (globalThis as unknown as { Vanta?: VantaRawApi }).Vanta) {
      vantaInstance = (globalThis as unknown as { Vanta?: VantaRawApi }).Vanta!;
      return vantaInstance;
    }
  }

  if (typeof window !== 'undefined' && window.Vanta) {
    vantaInstance = window.Vanta;
    return vantaInstance;
  }

  throw new Error('Vanta analytical parser module could not be initialized.');
}

export function getVantaSync(): VantaRawApi {
  if (vantaInstance) return vantaInstance;
  if (typeof window !== 'undefined' && window.Vanta) {
    vantaInstance = window.Vanta;
    return vantaInstance;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as unknown as { Vanta?: VantaRawApi }).Vanta) {
    vantaInstance = (globalThis as unknown as { Vanta?: VantaRawApi }).Vanta!;
    return vantaInstance;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const req = require('../../vanta.js');
    vantaInstance = req.default || req;
    if (vantaInstance) return vantaInstance;
  } catch {
    // ignore
  }
  throw new Error('Vanta parser is not loaded yet. Call getVantaInstance() or ensure vanta.js is evaluated.');
}

const REJECTED_VANTA_EXTENSIONS = new Set([
  'xlsx',
  'xls',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'heic',
  'heif',
  'mp4',
  'mov',
  'webm',
  'pdf',
  'zip',
  'glb'
]);

/**
 * Validates a candidate Vanta CSV file across desktop and mobile browsers
 * (where iOS Files or Android may report empty file.type or application/octet-stream).
 */
export function validateVantaCsvFile(file: { name?: string; size?: number; type?: string }): void {
  const maxBytes = config.MAX_RAW_CSV_BYTES || 50 * 1024 * 1024;
  if (typeof file.size === 'number' && file.size > maxBytes) {
    throw new Error('That export is larger than 50 MB — check the selected file.');
  }
  if (typeof file.size === 'number' && file.size === 0) {
    throw new Error('The selected file is empty.');
  }
  const ext = ((file.name || '').split('.').pop() || '').trim().toLowerCase();
  if (ext === 'xlsx' || ext === 'xls') {
    throw new Error('Vanta exports must be CSV (.csv). For Excel workbooks, use Reference Data import.');
  }
  if (ext && REJECTED_VANTA_EXTENSIONS.has(ext)) {
    throw new Error('Choose a Vanta CSV export (.csv).');
  }
}

export function storageResults(
  results: Record<string, ElementalResult>,
  unitsAssumed: boolean
): Record<string, ElementalResult> {
  if (!unitsAssumed) return results;
  return Object.fromEntries(
    Object.entries(results || {}).map(([el, r]) => [
      el,
      { ...r, unit: r.lod ? r.unit : 'UNVERIFIED' }
    ])
  );
}

/**
 * Builds a deterministic Vanta import plan.
 * Explicitly locks targetSpecimenId if provided so specimen-specific imports
 * never leak to other specimens.
 */
export async function buildVantaImportPlan(
  file: File,
  targetSpecimenId?: string | null
): Promise<VantaImportPlan & { targetSpecimenId: string | null }> {
  validateVantaCsvFile(file);

  const lockedTarget = targetSpecimenId ? targetSpecimenId.trim() : null;
  const text = await file.text();
  const vanta = await getVantaInstance();
  const parsed = vanta.parse(text);
  const fileHash = await sha256(file);

  const candidateIds = [...new Set(parsed.readings.map(r => r.sampleId).filter((id): id is string => Boolean(id)))];
  const known = lockedTarget ? new Set([lockedTarget]) : await api.knownIds(candidateIds);

  const rows: VantaImportPlan['rows'] = [];
  const skipped: VantaImportPlan['skipped'] = [];

  for (const r of parsed.readings) {
    let sid: string | null = null;
    let why: string | null = null;

    if (lockedTarget) {
      if (!r.sampleId || r.sampleId === lockedTarget) {
        sid = lockedTarget;
      } else {
        why = `row is labelled ${r.sampleId} (expected ${lockedTarget})`;
      }
    } else if (!r.sampleId) {
      why = 'no specimen ID in row';
    } else if (!known.has(r.sampleId)) {
      why = `${r.sampleId} is not registered`;
    } else {
      sid = r.sampleId;
    }

    if (sid) {
      const readingHash = await sha256(JSON.stringify(r.raw));
      rows.push({ r, sid, readingHash });
    } else {
      skipped.push({ r, why: why || 'unmatched row' });
    }
  }

  return {
    file,
    fileName: file.name,
    fileHash,
    parsed,
    rows,
    skipped,
    targetSpecimenId: lockedTarget
  };
}

export interface VantaImportExecutionResult {
  insertedCount: number;
  duplicateCount: number;
  skippedCount: number;
  batchId: string;
  rawFileId: string;
}

/**
 * Executes a verified VantaImportPlan:
 * 1. Uploads original CSV to vanta-raw bucket with bucket-compatible 'text/csv' MIME
 * 2. Registers raw_files row (idempotent by SHA-256)
 * 3. Upserts matched analyses in 250-row batches
 * 4. Records import_batches and import_unmatched_rows
 */
export async function executeVantaImport(
  plan: VantaImportPlan & { targetSpecimenId?: string | null },
  onProgress?: (statusText: string) => void
): Promise<VantaImportExecutionResult> {
  if (!plan?.parsed?.readings?.length) {
    throw new Error('No readings found in the import plan.');
  }

  const sb = getSupabase();
  onProgress?.('Preserving original Vanta CSV…');

  let raw = await api.rawByHash(plan.fileHash);
  if (!raw) {
    const storagePath = `${new Date().getFullYear()}/${plan.fileHash}.csv`;
    const { error: uploadErr } = await sb.storage
      .from(config.RAW_BUCKET)
      .upload(storagePath, plan.file, {
        contentType: 'text/csv',
        upsert: false
      });

    if (uploadErr && !/already exists|duplicate/i.test(uploadErr.message || '')) {
      throw uploadErr;
    }

    try {
      raw = await api.addRaw({
        file_name: plan.fileName,
        storage_path: storagePath,
        content_type: 'text/csv',
        size_bytes: plan.file.size,
        sha256: plan.fileHash,
        parser_version: config.PARSER_VERSION,
        metadata: {
          header_row: plan.parsed.headerRowNo,
          delimiter: plan.parsed.delimiter,
          elements: plan.parsed.elements,
          warnings: plan.parsed.warnings,
          units_assumed: plan.parsed.unitsAssumed,
          target_specimen_id: plan.targetSpecimenId || null
        }
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === '23505') {
        raw = await api.rawByHash(plan.fileHash);
      } else {
        throw err;
      }
    }
  }

  if (!raw) {
    throw new Error('Could not register raw Vanta export record.');
  }

  const lockedTarget = plan.targetSpecimenId || null;
  const payload: Partial<Analysis>[] = plan.rows.map(x => ({
    sample_id: x.sid,
    instrument: x.r.instrument || 'Vanta',
    method: x.r.method,
    reading_no: x.r.readingNo,
    measured_at: x.r.measuredAt,
    results: storageResults(x.r.results, plan.parsed.unitsAssumed),
    raw: x.r.raw,
    source_file: plan.fileName,
    source_sha256: plan.fileHash,
    reading_hash: x.readingHash,
    raw_file_id: raw!.id,
    parser_version: config.PARSER_VERSION,
    match_method: lockedTarget && !x.r.sampleId ? 'target_specimen' : 'sample_id',
    match_confidence: 1,
    match_basis:
      lockedTarget && !x.r.sampleId
        ? `attached directly to target specimen ${lockedTarget}`
        : 'exact specimen ID in source row'
  }));

  let inserted = 0;
  for (let i = 0; i < payload.length; i += 250) {
    onProgress?.(`Attaching readings (${Math.min(i + 250, payload.length)} of ${payload.length})…`);
    inserted += await api.addAnalyses(payload.slice(i, i + 250));
  }

  const dup = Math.max(0, payload.length - inserted);
  const batch = await api.addImport({
    raw_file_id: raw.id,
    parser_version: config.PARSER_VERSION,
    imported_count: inserted,
    duplicate_count: dup,
    skipped_count: plan.skipped.length,
    warnings: plan.parsed.warnings,
    metadata: {
      matched_specimens: [...new Set(payload.map(x => x.sample_id).filter(Boolean))],
      units_assumed: plan.parsed.unitsAssumed,
      target_specimen_id: lockedTarget
    }
  });

  if (plan.skipped.length > 0) {
    onProgress?.(`Recording ${plan.skipped.length} review row${plan.skipped.length === 1 ? '' : 's'}…`);
    const unmatchedRows = plan.skipped.slice(0, 5000).map(x => ({
      import_batch_id: batch.id,
      row_no: x.r.rowNo,
      sample_id: x.r.sampleId,
      reason: x.why,
      raw: x.r.raw
    }));
    for (let i = 0; i < unmatchedRows.length; i += 500) {
      await api.addUnmatched(unmatchedRows.slice(i, i + 500));
    }
  }

  return {
    insertedCount: inserted,
    duplicateCount: dup,
    skippedCount: plan.skipped.length,
    batchId: batch.id,
    rawFileId: raw.id
  };
}

export const vantaAdapter = {
  async parse(input: string): Promise<VantaParseResult> {
    const vanta = await getVantaInstance();
    return vanta.parse(input);
  },

  async parseHistoricalSoil(input: string): Promise<HistoricalParseResult> {
    const vanta = await getVantaInstance();
    return vanta.parseHistoricalSoil(input);
  },

  async sortElements(elements: string[]): Promise<string[]> {
    const vanta = await getVantaInstance();
    return vanta.sortElements(elements);
  },

  sortElementsSync(elements: string[]): string[] {
    try {
      const vanta = getVantaSync();
      return vanta.sortElements(elements);
    } catch {
      return [...elements];
    }
  },

  storageResults,
  validateVantaCsvFile,
  buildVantaImportPlan,
  executeVantaImport
};

export default vantaAdapter;
