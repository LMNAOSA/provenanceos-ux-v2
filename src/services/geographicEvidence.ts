/**
 * Geo-evidence EXIF reader and private observation service.
 * Only original media bytes are parsed. Never geocode free-text fields, thumbnails,
 * or upload timestamps into geographic coordinates.
 */
import exifr from 'exifr';
import config from '../config';
import { getSupabase } from './supabase';

export const GEO_EXTRACTOR_VERSION = 'geo-exif-v1';
export type GeographicSource = 'photo_exif' | 'device_gps' | 'reported_origin' | 'verified_origin';
export type GeoVerificationStatus = 'unverified' | 'reviewed' | 'verified' | 'rejected';

export interface ExtractedPhotoGeo {
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  altitude_m: number | null;
  captured_at: string | null;
  camera_model: string | null;
}

export interface GeoObservation extends ExtractedPhotoGeo {
  id: string;
  sample_id: string;
  sample_image_id: string | null;
  source_type: GeographicSource;
  verification_status: GeoVerificationStatus;
  source_sha256: string | null;
  source_file_name: string | null;
  created_at: string;
}

export interface StoredPhoto {
  id: string;
  sample_id: string;
  file_name: string | null;
  storage_path: string;
  thumb_path: string | null;
  content_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
}

export type AuditStatus = 'gps_found' | 'no_gps' | 'integrity_mismatch' | 'failed';
export interface PhotoGeoAuditRow {
  photo: StoredPhoto;
  status: AuditStatus;
  geo: ExtractedPhotoGeo | null;
  actual_sha256: string | null;
  detail: string | null;
}
export interface GeoAuditProgress {
  completed: number;
  total: number;
  row: PhotoGeoAuditRow | null;
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}
function optionalDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  // Some EXIF timestamps lack time-zone offsets. Store exactly what the camera wrote.
  return typeof value === 'string' ? value : null;
}

/** Reads GPS stored in JPEG / HEIC / HEIF originals, including iPhone HEIF files. */
export async function extractPhotoGeo(original: Blob): Promise<ExtractedPhotoGeo | null> {
  const tags: Record<string, unknown> | undefined = await exifr.parse(original, {
    tiff: true, ifd0: true, exif: true, gps: true,
    xmp: false, iptc: false, icc: false,
  });
  if (!tags) return null;
  const latitude = finiteNumber(tags.latitude);
  const longitude = finiteNumber(tags.longitude);
  if (latitude === null || longitude === null ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return {
    latitude,
    longitude,
    accuracy_m: finiteNumber(tags.GPSHPositioningError),
    altitude_m: finiteNumber(tags.GPSAltitude),
    captured_at: optionalDate(tags.DateTimeOriginal ?? tags.CreateDate ?? tags.DateTime),
    camera_model: typeof tags.Model === 'string' ? tags.Model : null
  };
}
export async function hashOriginalBytes(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Staff access is enforced by the existing Supabase RLS policies. */
export async function listOriginalPhotos(): Promise<StoredPhoto[]> {
  const { data, error } = await getSupabase().from('sample_images')
    .select('id,sample_id,file_name,storage_path,thumb_path,content_type,size_bytes,sha256')
    .eq('is_original', true)
    .order('created_at', { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as StoredPhoto[];
}

export async function auditStoredPhoto(photo: StoredPhoto): Promise<PhotoGeoAuditRow> {
  try {
    const { data: original, error } = await getSupabase().storage.from(config.BUCKET).download(photo.storage_path);
    if (error || !original) throw error || new Error('Storage returned no original');
    const actual_sha256 = await hashOriginalBytes(original);
    if (photo.sha256 && actual_sha256.toLowerCase() !== photo.sha256.toLowerCase()) {
      return { photo, status: 'integrity_mismatch', geo: null, actual_sha256,
        detail: 'Original bytes do not match the registered SHA-256. No coordinates accepted.' };
    }
    try {
      const geo = await extractPhotoGeo(original);
      return { photo, status: geo ? 'gps_found' : 'no_gps', geo, actual_sha256, detail: null };
    } catch (e) {
      return { photo, status: 'failed', geo: null, actual_sha256,
        detail: e instanceof Error ? e.message : String(e) };
    }
  } catch (e) {
    return { photo, status: 'failed', geo: null, actual_sha256: null,
      detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Sequential read-only scan; caller controls cancellation/progress. No DB mutations. */
export async function auditOriginalPhotos(
  onProgress: (progress: GeoAuditProgress) => void,
  shouldStop: () => boolean = () => false
): Promise<PhotoGeoAuditRow[]> {
  const photos = await listOriginalPhotos();
  const rows: PhotoGeoAuditRow[] = [];
  onProgress({ completed: 0, total: photos.length, row: null });
  for (const photo of photos) {
    if (shouldStop()) break;
    const row = await auditStoredPhoto(photo);
    rows.push(row);
    onProgress({ completed: rows.length, total: photos.length, row });
  }
  return rows;
}

/** Reads only persisted coordinates; requires the staged migration to have been applied. */
export async function listGeographicObservations(): Promise<{ observations: GeoObservation[]; migrationMissing: boolean }> {
  const { data, error } = await getSupabase().from('geographic_observations')
    .select('id,sample_id,sample_image_id,latitude,longitude,accuracy_m,altitude_m,captured_at,source_type,verification_status,source_sha256,source_file_name,created_at')
    .order('created_at', { ascending: false }).limit(10000);
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01' ||
        /could not find the table|does not exist/i.test(error.message)) {
      return { observations: [], migrationMissing: true };
    }
    throw error;
  }
  return { observations: (data ?? []) as GeoObservation[], migrationMissing: false };
}

/** Append-only write. Idempotently skips previously imported (image, source) pairs. */
export async function savePhotoGeoObservation(photo: StoredPhoto, geo: ExtractedPhotoGeo, actualHash: string): Promise<'saved' | 'already_exists'> {
  const sb = getSupabase();
  const { data: existing, error: lookupError } = await sb.from('geographic_observations')
    .select('id').eq('sample_image_id', photo.id).eq('source_type', 'photo_exif').maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return 'already_exists';
  const { data: userData, error: userError } = await sb.auth.getUser();
  if (userError || !userData.user) throw userError || new Error('Authentication required');
  const { error } = await sb.from('geographic_observations').insert({
    sample_id: photo.sample_id,
    sample_image_id: photo.id,
    latitude: geo.latitude,
    longitude: geo.longitude,
    accuracy_m: geo.accuracy_m,
    altitude_m: geo.altitude_m,
    captured_at: geo.captured_at,
    source_type: 'photo_exif',
    source_sha256: actualHash,
    source_file_name: photo.file_name,
    extraction_version: GEO_EXTRACTOR_VERSION,
    verification_status: 'unverified',
    created_by: userData.user.id
  });
  if (error) {
    if (error.code === '23505') return 'already_exists';
    throw error;
  }
  return 'saved';
}
