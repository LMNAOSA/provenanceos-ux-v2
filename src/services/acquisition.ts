/**
 * CONSOL Acquisition & Evidence Persistence Service
 * Models the scientific evidence lifecycle:
 * Pending -> Uploading -> Saved | Failed | Retryable
 * 
 * Guarantees:
 * 1. Scientific capture classification ('visible', 'fluorescence', 'phosphorescence') is strictly preserved.
 * 2. Original evidence is hashed with SHA-256 before storage.
 * 3. Partial upload failures retain unsaved files in the active session for retry or safe local export.
 * 4. Idempotent storage paths prevent orphaned/duplicate storage files during retries.
 */

import config from '../config';
import { getSupabase, api } from './supabase';
import { sha256, validateMedia, generateThumbnailBlob, resolveMediaMime } from './media';
import type { CaptureKind, SpecimenImage } from '../types';

export type UploadState = 'pending' | 'uploading' | 'saved' | 'failed' | 'retryable';

export interface ShotItem {
  id: string;
  file: File;
  url: string;
  captureKind: CaptureKind;
  mime: string;
  state: UploadState;
  error?: string;
  storagePath?: string;
  thumbPath?: string | null;
  sha256?: string;
  savedMediaId?: string;
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov'
};

/**
 * Creates a validated ShotItem with a clean blob URL.
 * Guarantees captureKind is explicitly assigned without array index coercion.
 */
export function createShotItem(file: File, kind: CaptureKind): ShotItem {
  validateMedia(file);
  const resolvedMime = resolveMediaMime(file) || 'application/octet-stream';

  const url = typeof URL !== 'undefined' ? URL.createObjectURL(file) : '';
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `shot-${Date.now()}-${Math.random()}`,
    file,
    url,
    captureKind: kind,
    mime: resolvedMime,
    state: 'pending'
  };
}

export function revokeShotUrl(shot: ShotItem): void {
  if (shot.url && typeof URL !== 'undefined') {
    URL.revokeObjectURL(shot.url);
  }
}

/**
 * Executes resilient evidence upload and registration.
 * Distinguishes storage upload state from database metadata insertion.
 */
export async function uploadEvidenceShot(
  sampleId: string,
  shot: ShotItem
): Promise<{ shot: ShotItem; image?: SpecimenImage }> {
  validateMedia(shot.file);

  const sb = getSupabase();
  const bucket = sb.storage.from(config.BUCKET);
  const mime = resolveMediaMime(shot.file) || shot.mime || 'application/octet-stream';

  // Step 1: Compute SHA-256 evidence hash if not already computed
  let hash = shot.sha256;
  if (!hash) {
    hash = await sha256(shot.file);
    shot.sha256 = hash;
  }

  // Step 2: Storage upload (reuse storagePath if retrying database insert)
  let storagePath = shot.storagePath;
  if (!storagePath) {
    const ext = EXTENSIONS[mime] || 'bin';
    const fileId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    storagePath = `${sampleId}/${fileId}.${ext}`;

    const { error: uploadError } = await bucket.upload(storagePath, shot.file, {
      contentType: mime,
      upsert: false
    });

    if (uploadError && !/already exists/i.test(uploadError.message)) {
      shot.state = 'failed';
      shot.error = `Storage upload failed: ${uploadError.message}`;
      throw new Error(shot.error);
    }
    shot.storagePath = storagePath;
  }

  // Step 3: Optional thumbnail generation for images
  let thumbPath = shot.thumbPath ?? null;
  let widthPx: number | null = null;
  let heightPx: number | null = null;

  if (mime.startsWith('image/')) {
    try {
      if (typeof createImageBitmap !== 'undefined') {
        const bmp = await createImageBitmap(shot.file);
        widthPx = bmp.width;
        heightPx = bmp.height;
        bmp.close?.();
      }
    } catch {
      // Non-fatal dimension probe failure
    }

    if (thumbPath === null) {
      try {
        const thumbBlob = await generateThumbnailBlob(shot.file, 480);
        if (thumbBlob) {
          const thumbFileId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-thumb`;
          const tp = `${sampleId}/${thumbFileId}_thumb.jpg`;
          const { error: thumbErr } = await bucket.upload(tp, thumbBlob, {
            contentType: 'image/jpeg',
            upsert: false
          });
          if (!thumbErr) {
            thumbPath = tp;
            shot.thumbPath = tp;
          }
        }
      } catch {
        // Thumbnail generation is non-fatal; full image remains authoritative
      }
    }
  }

  // Step 4: Authoritative Database Registration
  try {
    const imageRecord = await api.addMedia({
      sample_id: sampleId,
      storage_path: storagePath,
      thumb_path: thumbPath,
      file_name: shot.file.name,
      content_type: mime,
      size_bytes: shot.file.size,
      sha256: hash,
      capture_kind: shot.captureKind,
      media_type: mime,
      processing_method: 'original',
      is_original: true,
      derived_from_id: null,
      metadata: {
        file_last_modified: shot.file.lastModified || null,
        session_upload_at: new Date().toISOString()
      },
      width_px: widthPx,
      height_px: heightPx
    });

    shot.state = 'saved';
    shot.savedMediaId = imageRecord.id;
    shot.error = undefined;

    return { shot, image: imageRecord };
  } catch (dbErr) {
    // Storage upload succeeded but database insertion failed:
    // Mark as 'retryable' so re-attempt does not orphan another storage object.
    shot.state = 'retryable';
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    shot.error = `Database registration failed: ${msg}`;
    throw new Error(shot.error);
  }
}
