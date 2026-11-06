// @vitest-environment jsdom
import '../test/setup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MediaPicker } from '../components/MediaPicker';
import { MAX_PHOTO_BYTES, MAX_VIDEO_BYTES, uploadMedia, validateMedia } from './media';

/** File whose reported size we control (no need to allocate 100 MB). */
function fakeFile(name: string, type: string, size: number, lastModified = new Date('2026-11-06T09:15:00').getTime()) {
  const f = new File(['x'], name, { type, lastModified });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

class FakeXHR {
  static last: FakeXHR | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 0;
  responseText = '';
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXHR.last = this;
  }
  open(m: string, u: string) {
    this.method = m;
    this.url = u;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(b: unknown) {
    this.body = b;
  }
  abort() {
    this.onabort?.();
  }
  respond(status: number, data: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(data);
    this.onload?.();
  }
}

beforeEach(() => {
  FakeXHR.last = null;
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:preview';
  if (!URL.revokeObjectURL) (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
});
afterEach(() => vi.unstubAllGlobals());

describe('validateMedia', () => {
  it('enforces photo ≤ 15 MB and video ≤ 100 MB with friendly messages', () => {
    expect(validateMedia(fakeFile('a.jpg', 'image/jpeg', MAX_PHOTO_BYTES))).toBeNull();
    expect(validateMedia(fakeFile('a.jpg', 'image/jpeg', MAX_PHOTO_BYTES + 1))).toMatch(/Photos can be up to 15 MB/);
    expect(validateMedia(fakeFile('a.mp4', 'video/mp4', MAX_VIDEO_BYTES))).toBeNull();
    expect(validateMedia(fakeFile('a.mp4', 'video/mp4', MAX_VIDEO_BYTES + 1))).toMatch(/Videos can be up to 100 MB/);
    expect(validateMedia(fakeFile('a.pdf', 'application/pdf', 100))).toMatch(/isn't a photo or video/);
    expect(validateMedia(fakeFile('IMG_1.HEIC', '', 2_000_000))).toBeNull();
  });
});

describe('uploadMedia', () => {
  it('POSTs the raw file with query params, Content-Type and progress', async () => {
    const onProgress = vi.fn();
    const file = fakeFile('rash.jpg', 'image/jpeg', 1_000_000);
    const p = uploadMedia('demo-jordan', file, { caption: 'Rash on my arm', conversationId: 'conv-1', onProgress });
    await waitFor(() => expect(FakeXHR.last).not.toBeNull());
    const xhr = FakeXHR.last!;
    expect(xhr.method).toBe('POST');
    const url = new URL(xhr.url, 'http://x');
    expect(url.pathname).toBe('/api/patients/demo-jordan/media');
    expect(url.searchParams.get('kind')).toBe('photo');
    expect(url.searchParams.get('caption')).toBe('Rash on my arm');
    expect(url.searchParams.get('conversationId')).toBe('conv-1');
    expect(url.searchParams.get('takenAt')).toMatch(/^2026-11-06T09:15:00\.000[+-]\d\d:\d\d$/);
    expect(xhr.headers['Content-Type']).toBe('image/jpeg');
    expect(xhr.body).toBe(file);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 500_000, total: 1_000_000 });
    expect(onProgress).toHaveBeenCalledWith(0.5);
    xhr.respond(201, { id: 'm1', kind: 'photo', url: '/api/media/m1/content' });
    await expect(p).resolves.toMatchObject({ id: 'm1' });
  });

  it('rejects oversize files without sending and surfaces server errors', async () => {
    await expect(uploadMedia('p', fakeFile('big.mov', 'video/quicktime', MAX_VIDEO_BYTES + 5))).rejects.toThrow(/100 MB/);
    expect(FakeXHR.last).toBeNull();
    const p = uploadMedia('p', fakeFile('a.png', 'image/png', 10));
    await waitFor(() => expect(FakeXHR.last).not.toBeNull());
    FakeXHR.last!.respond(400, { error: 'Unsupported content type' });
    await expect(p).rejects.toThrow('Unsupported content type');
  });
});

describe('MediaPicker', () => {
  it('previews, captions, uploads with a progress bar and reports the item', async () => {
    const onUploaded = vi.fn();
    render(<MediaPicker patientId="p1" onUploaded={onUploaded} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add photo or video' }));
    expect(screen.getByTestId('media-camera')).toHaveAttribute('capture', 'environment');
    expect(screen.getByTestId('media-library')).not.toHaveAttribute('capture');
    expect(screen.getByText('Only your care team can see these.')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('media-library'), { target: { files: [fakeFile('huge.jpg', 'image/jpeg', MAX_PHOTO_BYTES * 2)] } });
    expect(screen.getByRole('alert')).toHaveTextContent(/up to 15 MB/);

    fireEvent.change(screen.getByTestId('media-camera'), { target: { files: [fakeFile('ok.jpg', 'image/jpeg', 2000)] } });
    expect(screen.getByAltText('Preview of your photo')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/What does this show/), { target: { value: 'Swollen ankle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send photo' }));
    await waitFor(() => expect(FakeXHR.last).not.toBeNull());
    FakeXHR.last!.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
    expect(await screen.findByRole('progressbar', { name: 'Uploading' })).toHaveAttribute('aria-valuenow', '25');
    expect(new URL(FakeXHR.last!.url, 'http://x').searchParams.get('caption')).toBe('Swollen ankle');
    FakeXHR.last!.respond(201, { id: 'm9', kind: 'photo', url: '/api/media/m9/content' });
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ id: 'm9' })));
  });
});
