/**
 * CONSOL Supabase Data Access Service
 * Exact extraction of existing queries, database contracts, and RPC calls from app.js.
 * Preserves production table names, sequence logic, and authorization models without alteration.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import config from '../config';
import type {
  Specimen,
  SpecimenOverview,
  SpecimenCounts,
  SpecimenDetail,
  SpecimenEvent,
  SpecimenMeasurement,
  SpecimenTreatment,
  SpecimenImage,
  RawFile,
  Analysis,
  ImportBatch,
  ImportUnmatchedRow,
  HistoricalDataset,
  HistoricalRecord,
  HistoricalObservation,
  SpecimenCode,
} from '../types';

const GLOBAL_SUPABASE_KEY = '__CONSOL_SUPABASE_SINGLETON__';
const globalSupabaseStore = globalThis as unknown as Record<string, unknown>;

let supabaseClient: SupabaseClient | null =
  (globalSupabaseStore[GLOBAL_SUPABASE_KEY] as SupabaseClient | undefined) || null;

export function getSupabase(): SupabaseClient {
  if (supabaseClient) return supabaseClient;
  if (!config.SUPABASE_URL || !config.SUPABASE_KEY) {
    throw new Error('Supabase URL and Key are required to initialize client.');
  }
  supabaseClient = createClient(config.SUPABASE_URL, config.SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  globalSupabaseStore[GLOBAL_SUPABASE_KEY] = supabaseClient;
  return supabaseClient;
}

function must<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data as T;
}

const urlCache = new Map<string, string>();

export function clearSignedUrlCache(): void {
  urlCache.clear();
}

/**
 * Generates signed URLs for storage assets using batching and caching.
 */
export async function signed(paths: (string | null | undefined)[] = []): Promise<(path: string | null | undefined) => string | null> {
  const sb = getSupabase();
  const validPaths = paths.filter((p): p is string => Boolean(p));
  const unique = [...new Set(validPaths)];
  const missing = unique.filter(p => !urlCache.has(p));

  if (missing.length) {
    for (let i = 0; i < missing.length; i += 50) {
      const part = missing.slice(i, i + 50);
      const res = await sb.storage.from(config.BUCKET).createSignedUrls(part, 3600);
      const data = must(res);
      (data || []).forEach((row, idx) => {
        if (row?.signedUrl) urlCache.set(part[idx], row.signedUrl);
      });
    }
  }

  return (path: string | null | undefined) => {
    if (!path) return null;
    return urlCache.get(path) || null;
  };
}

export async function checkSchema(): Promise<'ok' | 'missing' | 'offline'> {
  const sb = getSupabase();
  const { error } = await sb.from('staff').select('user_id').limit(1);
  if (!error) return 'ok';
  if (error.code === 'PGRST205' || error.code === '42P01') return 'missing';
  if (/failed to fetch|networkerror|load failed/i.test(error.message || '')) return 'offline';
  return 'ok'; // e.g. permission denied for signed-out role: tables exist
}

export const api = {
  async overview({ limit = 500 } = {}): Promise<SpecimenOverview[]> {
    const sb = getSupabase();
    return must(
      await sb
        .from('sample_overview')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)
    ) || [];
  },

  async counts(): Promise<SpecimenCounts> {
    const sb = getSupabase();
    const [samples, images, analyses] = await Promise.all([
      sb.from('samples').select('id', { count: 'exact', head: true }),
      sb.from('sample_images').select('id', { count: 'exact', head: true }),
      sb.from('analyses').select('id', { count: 'exact', head: true })
    ]);
    if (samples.error) throw samples.error;
    if (images.error) throw images.error;
    if (analyses.error) throw analyses.error;
    return {
      samples: samples.count || 0,
      photographed: images.count || 0,
      analysed: analyses.count || 0
    };
  },

  async sampleDetail(id: string): Promise<SpecimenDetail> {
    const sb = getSupabase();
    const [sample, images, analyses, events, measurements, treatments] = await Promise.all([
      sb.from('samples').select('*').eq('id', id).maybeSingle(),
      sb.from('sample_images').select('*').eq('sample_id', id).order('created_at', { ascending: true }),
      sb.from('analyses').select('*').eq('sample_id', id).order('measured_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }),
      sb.from('sample_events').select('*').eq('sample_id', id).order('created_at', { ascending: true }),
      sb.from('sample_measurements').select('*').eq('sample_id', id).order('created_at', { ascending: false }),
      sb.from('sample_treatments').select('*').eq('sample_id', id).order('created_at', { ascending: false })
    ]);

    const resolvedTreatments =
      treatments?.error && (treatments.error.code === 'PGRST205' || treatments.error.code === '42P01')
        ? []
        : must(treatments) || [];

    const detail: SpecimenDetail = {
      sample: must(sample),
      images: must(images) || [],
      analyses: must(analyses) || [],
      events: must(events) || [],
      measurements: must(measurements) || [],
      treatments: resolvedTreatments,
    };

    detail.urlOf = await signed(detail.images.flatMap(x => [x.storage_path, x.thumb_path]));
    return detail;
  },

  async events(): Promise<SpecimenEvent[]> {
    const sb = getSupabase();
    return must(
      await sb
        .from('sample_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
    ) || [];
  },

  async isStaff(): Promise<boolean> {
    const sb = getSupabase();
    return Boolean(must(await sb.rpc('is_staff')));
  },

  async knownIds(ids: string[] = []): Promise<Set<string>> {
    const sb = getSupabase();
    const wanted = [...new Set(ids.filter(Boolean))];
    const out = new Set<string>();
    for (let i = 0; i < wanted.length; i += 200) {
      const rows = must(
        await sb.from('samples').select('id').in('id', wanted.slice(i, i + 200))
      ) || [];
      rows.forEach(r => out.add(r.id));
    }
    return out;
  },

  async peekId(code: SpecimenCode = 'AHM'): Promise<string | null> {
    const sb = getSupabase();
    return must(await sb.rpc('peek_next_sample_id', { p_code: code }));
  },

  async addSample(payload: Partial<Specimen>): Promise<Specimen> {
    const sb = getSupabase();
    return must(await sb.from('samples').insert(payload).select('*').single());
  },

  async addMedia(payload: Partial<SpecimenImage>): Promise<SpecimenImage> {
    const sb = getSupabase();
    return must(await sb.from('sample_images').insert(payload).select('*').single());
  },

  async addRaw(payload: Partial<RawFile>): Promise<RawFile> {
    const sb = getSupabase();
    return must(await sb.from('raw_files').insert(payload).select('*').single());
  },

  async rawByHash(hash: string): Promise<RawFile | null> {
    const sb = getSupabase();
    return must(await sb.from('raw_files').select('*').eq('sha256', hash).maybeSingle());
  },

  async addAnalyses(rows: Partial<Analysis>[]): Promise<number> {
    if (!rows?.length) return 0;
    const sb = getSupabase();
    const data = must(
      await sb.from('analyses').upsert(rows, { onConflict: 'sample_id,reading_hash', ignoreDuplicates: true }).select('id')
    );
    return data?.length || 0;
  },

  async imports(): Promise<ImportBatch[]> {
    const sb = getSupabase();
    return must(
      await sb
        .from('import_batches')
        .select('*,raw_files(file_name,sha256)')
        .order('created_at', { ascending: false })
        .limit(50)
    ) || [];
  },

  async addImport(payload: Partial<ImportBatch>): Promise<ImportBatch> {
    const sb = getSupabase();
    return must(await sb.from('import_batches').insert(payload).select('*').single());
  },

  async addUnmatched(rows: Partial<ImportUnmatchedRow>[]): Promise<{ id: string }[]> {
    if (!rows?.length) return [];
    const sb = getSupabase();
    return must(await sb.from('import_unmatched_rows').insert(rows).select('id')) || [];
  },

  async saveMeasurement(payload: Partial<SpecimenMeasurement>): Promise<SpecimenMeasurement> {
    const sb = getSupabase();
    return must(await sb.from('sample_measurements').insert(payload).select('*').single());
  },

  async addTreatment(payload: Partial<SpecimenTreatment>): Promise<SpecimenTreatment> {
    const sb = getSupabase();
    return must(await sb.from('sample_treatments').insert(payload).select('*').single());
  },

  async historicalDatasets(): Promise<HistoricalDataset[]> {
    const sb = getSupabase();
    return must(
      await sb
        .from('historical_datasets')
        .select('*,raw_files(file_name,sha256)')
        .order('created_at', { ascending: false })
        .limit(50)
    ) || [];
  },

  async historicalByRawFile(rawFileId: string): Promise<HistoricalDataset | null> {
    const sb = getSupabase();
    return must(await sb.from('historical_datasets').select('*').eq('raw_file_id', rawFileId).maybeSingle());
  },

  async addHistoricalDataset(payload: Partial<HistoricalDataset>): Promise<HistoricalDataset> {
    const sb = getSupabase();
    return must(await sb.from('historical_datasets').insert(payload).select('*').single());
  },

  async addHistoricalRecords(rows: Partial<HistoricalRecord>[]): Promise<{ id: string; source_row_no: number }[]> {
    if (!rows?.length) return [];
    const sb = getSupabase();
    return must(await sb.from('historical_records').insert(rows).select('id,source_row_no')) || [];
  },

  async addHistoricalObservations(rows: Partial<HistoricalObservation>[]): Promise<number> {
    if (!rows?.length) return 0;
    const sb = getSupabase();
    const data = must(
      await sb
        .from('historical_observations')
        .upsert(rows, { onConflict: 'record_id,analyte', ignoreDuplicates: true })
        .select('id')
    );
    return data?.length || 0;
  },

  /**
   * Verifies exact persisted row counts in Supabase PostgreSQL for
   * historical_datasets, historical_records, and historical_observations.
   */
  async historicalCounts(): Promise<{ datasets: number; records: number; observations: number }> {
    const sb = getSupabase();
    const [dsRes, recRes, obsRes] = await Promise.all([
      sb.from('historical_datasets').select('id', { count: 'exact', head: true }),
      sb.from('historical_records').select('id', { count: 'exact', head: true }),
      sb.from('historical_observations').select('id', { count: 'exact', head: true })
    ]);
    return {
      datasets: dsRes.error ? 0 : (dsRes.count ?? 0),
      records: recRes.error ? 0 : (recRes.count ?? 0),
      observations: obsRes.error ? 0 : (obsRes.count ?? 0)
    };
  },

  /**
   * Loads all persisted historical_records and their linked historical_observations
   * for a specific dataset_id. Chunks observation queries by 20 record IDs per request
   * (<= ~660 observations per request) so PostgREST's 1,000-row response cap never truncates
   * datasets with 792+ elemental observations.
   */
  async historicalDatasetRecords(datasetId: string, datasetName?: string): Promise<HistoricalRecord[]> {
    if (!datasetId) return [];
    const sb = getSupabase();
    const rawRecords = must(
      await sb
        .from('historical_records')
        .select('*')
        .eq('dataset_id', datasetId)
        .order('source_row_no', { ascending: true })
        .limit(1000)
    ) || [];

    const toNum = (v: unknown): number | null => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const records: HistoricalRecord[] = rawRecords.map((r: Record<string, unknown>) => ({
      ...(r as unknown as HistoricalRecord),
      dataset_name: datasetName,
      source_row_no: Number(r.source_row_no || 0),
      duration_s: toNum(r.duration_s),
      sigma_value: toNum(r.sigma_value),
      res: toNum(r.res),
      escale: toNum(r.escale),
      shape_time: toNum(r.shape_time),
      raw: (r.raw && typeof r.raw === 'object' ? (r.raw as Record<string, string>) : {}),
      observations: []
    }));

    const recordIds = records.map(r => r.id).filter((id): id is string => Boolean(id));
    if (!recordIds.length) return records;

    const obsByRecord = new Map<string, HistoricalObservation[]>();
    const chunkSize = 20;
    for (let i = 0; i < recordIds.length; i += chunkSize) {
      const chunkIds = recordIds.slice(i, i + chunkSize);
      const rawObs = must(
        await sb
          .from('historical_observations')
          .select('*')
          .in('record_id', chunkIds)
          .order('analyte', { ascending: true })
          .limit(2000)
      ) || [];

      rawObs.forEach((o: Record<string, unknown>) => {
        const recId = String(o.record_id || '');
        if (!recId) return;
        const normalized: HistoricalObservation = {
          id: o.id as string | undefined,
          record_id: recId,
          analyte: String(o.analyte || ''),
          raw_value: o.raw_value !== null && o.raw_value !== undefined ? String(o.raw_value) : '',
          value: toNum(o.value),
          qualifier: o.qualifier ? String(o.qualifier) : null,
          detection_limit: toNum(o.detection_limit),
          raw_error: o.raw_error !== null && o.raw_error !== undefined ? String(o.raw_error) : null,
          error: toNum(o.error),
          unit: o.unit ? String(o.unit) : null,
          created_at: o.created_at as string | undefined
        };
        const list = obsByRecord.get(recId) || [];
        list.push(normalized);
        obsByRecord.set(recId, list);
      });
    }

    records.forEach(r => {
      if (r.id) {
        r.observations = obsByRecord.get(r.id) || [];
      }
    });

    return records;
  },

  /**
   * Loads historical records + observations across the provided historical datasets
   * (or fetches datasets first if omitted) for CONSOL scientific interrogation.
   */
  async allHistoricalRecordsWithObservations(datasets?: HistoricalDataset[]): Promise<HistoricalRecord[]> {
    const dsList = datasets ?? (await this.historicalDatasets());
    if (!dsList.length) return [];
    const perDataset = await Promise.all(
      dsList.slice(0, 10).map(ds => this.historicalDatasetRecords(ds.id, ds.name).catch(() => [] as HistoricalRecord[]))
    );
    return perDataset.flat();
  },

  async recentAnalyses(limit = 50): Promise<Analysis[]> {
    const sb = getSupabase();
    return must(
      await sb
        .from('analyses')
        .select('*')
        .order('measured_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit)
    ) || [];
  },

  async unmatchedCount(): Promise<number> {
    const sb = getSupabase();
    const res = await sb
      .from('import_unmatched_rows')
      .select('id', { count: 'exact', head: true });
    if (res.error) return 0;
    return res.count || 0;
  }
};

export default api;

