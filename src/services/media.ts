/**
 * CONSOL Media & Evidence Service
 * Handles SHA-256 evidence hashing, client-side validation and thumbnail generation.
 */

import config from '../config';

export async function sha256(input: string | Blob | ArrayBuffer): Promise<string> {
  const data = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : input instanceof ArrayBuffer
      ? input
      : await input.arrayBuffer();

  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function validateMedia(file: File): void {
  if (file.type.startsWith('image/') && file.size > config.MAX_PHOTO_BYTES) {
    throw new Error(`${file.name} is larger than 25 MB.`);
  }
  if (file.type.startsWith('video/') && file.size > config.MAX_VIDEO_BYTES) {
    throw new Error(`${file.name} is larger than 75 MB.`);
  }
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    throw new Error('Choose an image or video.');
  }
}

export async function generateThumbnailBlob(file: File, maxDim = 480): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null;

  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.82);
    });
  } catch {
    return null;
  }
}
