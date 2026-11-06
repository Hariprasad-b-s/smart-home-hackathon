/** Photo/video evidence: client-side validation and XHR upload with progress. */
import type { MediaItem } from '@shared/types/api';
import { USE_MOCKS } from '../api';
import { ApiError, OFFLINE_MESSAGE, messageForStatus } from './errors';
import { localIso } from './time';

export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_CAPTION = 500;

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

export type MediaKind = 'photo' | 'video';

export function kindOf(file: { type: string; name?: string }): MediaKind | null {
  const t = file.type.toLowerCase();
  if (t.startsWith('image/')) return 'photo';
  if (t.startsWith('video/')) return 'video';
  const n = (file.name ?? '').toLowerCase();
  if (/\.(heic|heif)$/.test(n)) return 'photo';
  return null;
}

/** Guess a content type the server accepts when the browser leaves file.type empty (HEIC on some phones). */
export function contentTypeOf(file: { type: string; name?: string }): string {
  if (file.type) return file.type;
  const n = (file.name ?? '').toLowerCase();
  if (n.endsWith('.heic')) return 'image/heic';
  if (n.endsWith('.heif')) return 'image/heif';
  if (n.endsWith('.mov')) return 'video/quicktime';
  if (n.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

/** Returns a friendly error, or null when the file can be uploaded. */
export function validateMedia(file: { type: string; size: number; name?: string }): string | null {
  const kind = kindOf(file);
  if (!kind) return 'That file isn\'t a photo or video. Pick a photo or a video.';
  const type = contentTypeOf(file).toLowerCase();
  if (kind === 'photo' && !PHOTO_TYPES.includes(type)) return 'That photo type isn\'t supported. Try a JPG, PNG or HEIC photo.';
  if (kind === 'video' && !VIDEO_TYPES.includes(type)) return 'That video type isn\'t supported. Try an MP4 or MOV video.';
  if (kind === 'photo' && file.size > MAX_PHOTO_BYTES)
    return `That photo is ${mb(file.size)}. Photos can be up to 15 MB. Try a smaller one or take a new photo.`;
  if (kind === 'video' && file.size > MAX_VIDEO_BYTES)
    return `That video is ${mb(file.size)}. Videos can be up to 100 MB. Try a shorter clip (about 1 minute).`;
  if (file.size === 0) return 'That file is empty. Try another one.';
  return null;
}

export interface UploadOptions {
  caption?: string;
  trackerResponseId?: string;
  conversationId?: string;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export function uploadUrl(patientId: string, file: File, opts: UploadOptions): string {
  const q = new URLSearchParams();
  q.set('kind', kindOf(file) ?? 'photo');
  const caption = opts.caption?.trim().slice(0, MAX_CAPTION);
  if (caption) q.set('caption', caption);
  q.set('takenAt', localIso(new Date(file.lastModified || Date.now())));
  if (opts.trackerResponseId) q.set('trackerResponseId', opts.trackerResponseId);
  else if (opts.conversationId) q.set('conversationId', opts.conversationId);
  return `/api/patients/${encodeURIComponent(patientId)}/media?${q.toString()}`;
}

export async function uploadMedia(patientId: string, file: File, opts: UploadOptions = {}): Promise<MediaItem> {
  const err = validateMedia(file);
  if (err) throw new ApiError(err, 400);
  const url = uploadUrl(patientId, file, opts);
  if (USE_MOCKS) {
    const { mockUpload } = await import('../dev/mock');
    return mockUpload(url, file, opts.onProgress);
  }
  return new Promise<MediaItem>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', contentTypeOf(file));
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(1);
        resolve(data as MediaItem);
      } else {
        const msg =
          data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
            ? (data as { error: string }).error
            : messageForStatus(xhr.status);
        reject(new ApiError(msg, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError(OFFLINE_MESSAGE, 0, true));
    xhr.onabort = () => reject(new ApiError('Upload cancelled.', 0));
    opts.signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}
