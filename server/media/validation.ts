/**
 * Upload validation for photo/video evidence. The declared Content-Type must match the file's
 * MAGIC BYTES (never trust the header alone) and the requested `kind`.
 */
export type MediaKind = 'photo' | 'video';

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
export const ALLOWED_TYPES: string[] = [...PHOTO_TYPES, ...VIDEO_TYPES];

export const MAX_BYTES: Record<MediaKind, number> = { photo: 15 * 1024 * 1024, video: 100 * 1024 * 1024 };
export const MAX_CAPTION = 500;

export const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

const ascii = (b: Buffer, start: number, end: number) => (b.length >= end ? b.toString('latin1', start, end) : '');

const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4VH', 'M4VP', 'dash', 'MSNV', 'f4v ', '3gp4', '3gp5']);

/**
 * Content types the bytes are compatible with (empty = unrecognised). HEIC/HEIF and MP4/MOV
 * share container formats, so either label of the family is accepted.
 */
export function sniffContentTypes(b: Buffer): string[] {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ['image/jpeg'];
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ['image/png'];
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return ['image/webp'];
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return ['video/webm'];
  if (ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (HEIF_BRANDS.has(brand)) return ['image/heic', 'image/heif'];
    if (brand === 'qt  ') return ['video/quicktime', 'video/mp4'];
    if (MP4_BRANDS.has(brand)) return ['video/mp4', 'video/quicktime'];
  }
  return [];
}

export const kindOf = (contentType: string): MediaKind | undefined =>
  (PHOTO_TYPES as readonly string[]).includes(contentType) ? 'photo' : (VIDEO_TYPES as readonly string[]).includes(contentType) ? 'video' : undefined;

/** Base media type of a Content-Type header, lower-cased, without parameters. */
export const baseType = (header: string | undefined) => (header ?? '').split(';')[0].trim().toLowerCase();

/** Validate a body against declared type and kind. Returns an error message or null. */
export function validateUpload(body: unknown, declaredType: string, kind: unknown): string | null {
  if (kind !== 'photo' && kind !== 'video') return 'Query parameter "kind" must be "photo" or "video".';
  if (!ALLOWED_TYPES.includes(declaredType)) return `Unsupported Content-Type "${declaredType || '(none)'}". Allowed: ${ALLOWED_TYPES.join(', ')}.`;
  if (kindOf(declaredType) !== kind) return `kind "${kind}" does not match Content-Type "${declaredType}".`;
  if (!Buffer.isBuffer(body) || body.length === 0) return 'Empty upload.';
  if (body.length > MAX_BYTES[kind]) return `${kind === 'photo' ? 'Photos' : 'Videos'} must be at most ${MAX_BYTES[kind] / (1024 * 1024)} MB.`;
  const sniffed = sniffContentTypes(body);
  if (!sniffed.includes(declaredType)) {
    return sniffed.length
      ? `File content looks like ${sniffed[0]}, not ${declaredType}.`
      : `File content is not a valid ${declaredType} file.`;
  }
  return null;
}
