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
  }
};

export default api;
