/**
 * CONSOL Historical Dataset Import Service
 * Preserves historical soil and reference analytical records from CSV and XLSX.
 * Handles mobile browser MIME quirks (empty file.type / application/octet-stream on iOS/Android)
 * and vanta-raw storage bucket allowed_mime_types compatibility.
 */

import * as XLSXModule from 'xlsx';
import config from '../config';
import { getSupabase, api } from './supabase';
import { sha256 } from './media';
import vantaAdapter from './vantaAdapter';
import type {
  HistoricalParseResult,
  HistoricalImportPlan,
  HistoricalDataset,
  HistoricalObservation
} from '../types';

export function resolveHistoricalFileFormat(file: { name?: string; type?: string }): 'xlsx' | 'xls' | 'csv' {
  const ext = ((file.name || '').split('.').pop() || '').trim().toLowerCase();
  if (ext === 'xlsx') return 'xlsx';
  if (ext === 'xls') return 'xls';
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') return 'csv';

  const mime = (file.type || '').toLowerCase();
  if (mime.includes('spreadsheetml') || mime.includes('excel')) {
    return 'xlsx';
  }
  return 'csv';
}

/**
 * Resolves a storage upload contentType accepted by the vanta-raw bucket
 * (which restricts allowed_mime_types to ['text/csv','text/plain','application/csv','application/vnd.ms-excel']).
 */
export function resolveRawBucketUploadMime(format: 'xlsx' | 'xls' | 'csv'): string {
  if (format === 'xlsx' || format === 'xls') {
    return 'application/vnd.ms-excel';
  }
  return 'text/csv';
}

export async function parseHistoricalFile(file: File): Promise<HistoricalParseResult> {
  if (file.size > 50 * 1024 * 1024) {
    throw new Error('That source is larger than 50 MB — check the selected file.');
  }
  if (file.size === 0) {
    throw new Error('The selected file is empty.');
  }

  const format = resolveHistoricalFileFormat(file);

  if (format === 'xlsx' || format === 'xls') {
    const XLSX =
      (typeof window !== 'undefined' && (window as unknown as { XLSX?: typeof XLSXModule }).XLSX) ||
      XLSXModule;
    if (!XLSX || !XLSX.read) {
      throw new Error('The spreadsheet reader did not load. Reload the page and try again.');
    }

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    if (!wb.SheetNames.length) {
      throw new Error('No worksheet found.');
    }

    let lastError: Error | null = null;
    for (const sheetName of wb.SheetNames) {
      try {
        const ws = wb.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: true });
        const parsed = await vantaAdapter.parseHistoricalSoil(csv);
        parsed.workbookSheet = sheetName;
        parsed.sourceFormat = 'xlsx';
        parsed.workbookSheets = wb.SheetNames;
        return parsed;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }

    throw lastError || new Error('No worksheet contained a recognisable historical soil dataset.');
  }

  const csvText = await file.text();
  const parsed = await vantaAdapter.parseHistoricalSoil(csvText);
  parsed.sourceFormat = 'csv';
  return parsed;
}

export async function buildHistoricalImportPlan(file: File): Promise<HistoricalImportPlan> {
  const parsed = await parseHistoricalFile(file);
  const fileHash = await sha256(file);
  return {
    file,
    fileName: file.name,
    fileHash,
    parsed
  };
}

export async function loadBundled2018HistoricalFile(): Promise<File> {
  const candidateUrls = [
    '/supabase/2018_Historical_XRF_Data.xlsx',
    'supabase/2018_Historical_XRF_Data.xlsx'
  ];

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('text/html')) continue;
      const blob = await res.blob();
      if (blob.size > 0) {
        return new File([blob], '2018_Historical_XRF_Data.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
      }
    } catch {
      // try next candidate
    }
  }

  throw new Error('The bundled 2018 historical workbook could not be loaded.');
}

export async function executeHistoricalImport(
  plan: HistoricalImportPlan,
  datasetName: string,
  onProgress?: (statusText: string) => void
): Promise<HistoricalDataset> {
  if (!plan?.parsed?.records?.length) {
    throw new Error('No historical records found to import.');
  }

  const sb = getSupabase();
  const format = resolveHistoricalFileFormat(plan.file);
  const uploadMime = resolveRawBucketUploadMime(format);
  const canonicalMime =
    format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : format === 'xls'
        ? 'application/vnd.ms-excel'
        : 'text/csv';

  onProgress?.('Preserving original source file…');

  let raw = await api.rawByHash(plan.fileHash);
  if (raw) {
    const existing = await api.historicalByRawFile(raw.id);
    if (existing) {
      throw new Error('This historical source has already been imported.');
    }
  } else {
    const ext = format === 'xlsx' || format === 'xls' ? 'xlsx' : 'csv';
    const storagePath = `${new Date().getFullYear()}/historical/${plan.fileHash}.${ext}`;

    const { error: uploadErr } = await sb.storage
      .from(config.RAW_BUCKET)
      .upload(storagePath, plan.file, {
        contentType: uploadMime,
        upsert: false
      });

    if (uploadErr && !/already exists|duplicate/i.test(uploadErr.message || '')) {
      throw uploadErr;
    }

    try {
      raw = await api.addRaw({
        file_name: plan.fileName,
        storage_path: storagePath,
        content_type: canonicalMime,
        size_bytes: plan.file.size,
        sha256: plan.fileHash,
        parser_version: config.HISTORICAL_PARSER_VERSION,
        metadata: {
          header_row: plan.parsed.headerRowNo,
          delimiter: plan.parsed.delimiter,
          elements: plan.parsed.elements,
          warnings: plan.parsed.warnings,
          record_count: plan.parsed.recordCount,
          observation_count: plan.parsed.observationCount,
          source_format: plan.parsed.sourceFormat,
          workbook_sheet: plan.parsed.workbookSheet || null
        }
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === '23505') {
        raw = await api.rawByHash(plan.fileHash);
        if (raw && (await api.historicalByRawFile(raw.id))) {
          throw new Error('This historical source has already been imported.');
        }
      } else {
        throw err;
      }
    }
  }

  if (!raw) {
    throw new Error('Could not register historical raw file record.');
  }

  const cleanName = datasetName.trim() || plan.fileName.replace(/\.[^.]+$/, '');
  const locations = [...new Set(plan.parsed.records.map(r => r.location).filter((l): l is string => Boolean(l)))];

  const dataset = await api.addHistoricalDataset({
    name: cleanName,
    dataset_type: 'soil_reference',
    description: 'Historical soil / pXRF reference dataset',
    raw_file_id: raw.id,
    parser_version: config.HISTORICAL_PARSER_VERSION,
    metadata: {
      source_file: plan.fileName,
      source_sha256: plan.fileHash,
      record_count: plan.parsed.recordCount,
      observation_count: plan.parsed.observationCount,
      elements: plan.parsed.elements,
      units: plan.parsed.units,
      locations: locations.slice(0, 500),
      warnings: plan.parsed.warnings,
      source_format: plan.parsed.sourceFormat,
      workbook_sheet: plan.parsed.workbookSheet || null
    }
  });

  onProgress?.('Storing historical records…');

  const recordRows = plan.parsed.records.map(r => ({
    dataset_id: dataset.id,
    source_row_no: r.sourceRowNo,
    original_index: r.originalIndex,
    location: r.location,
    original_time: r.originalTime,
    measured_at_local: r.measuredAtLocal,
    time_ambiguous: r.timeAmbiguous,
    original_sample: r.originalSample,
    material_type: r.materialType,
    duration_s: r.durationS,
    units: r.units,
    sigma_value: r.sigmaValue,
    sequence: r.sequence,
    res: r.res,
    escale: r.eScale,
    shape_time: r.shapeTime,
    inspector: r.inspector,
    cor_1: r.cor1,
    cor_2: r.cor2,
    misc: r.misc,
    note: r.note,
    flags: r.flags,
    raw: r.raw
  }));

  const storedRecords: { id: string; source_row_no: number }[] = [];
  for (let i = 0; i < recordRows.length; i += 250) {
    const chunk = recordRows.slice(i, i + 250);
    const inserted = await api.addHistoricalRecords(chunk);
    storedRecords.push(...inserted);
  }

  const idByRow = new Map(storedRecords.map(r => [r.source_row_no, r.id]));
  const observations: Partial<HistoricalObservation>[] = [];

  plan.parsed.records.forEach(r => {
    const recordId = idByRow.get(r.sourceRowNo);
    if (!recordId) return;
    r.observations.forEach(o => {
      observations.push({
        record_id: recordId,
        analyte: o.analyte,
        raw_value: o.raw_value,
        value: o.value,
        qualifier: o.qualifier,
        detection_limit: o.detection_limit,
        raw_error: o.raw_error,
        error: o.error,
        unit: o.unit
      });
    });
  });

  onProgress?.('Storing elemental observations…');
  for (let i = 0; i < observations.length; i += 250) {
    await api.addHistoricalObservations(observations.slice(i, i + 250));
  }

  return dataset;
}
