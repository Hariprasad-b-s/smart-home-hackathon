/**
 * "Add photo or video": camera or library → preview + caption → upload with a progress bar.
 * Size/type limits are checked before anything is sent.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { MediaItem } from '@shared/types/api';
import { toApiError } from '../lib/errors';
import { MAX_CAPTION, kindOf, uploadMedia, validateMedia } from '../lib/media';
import { Icon } from './Icon';
import ui from '../styles/ui.module.css';
import s from './MediaPicker.module.css';

export function MediaPicker({
  patientId,
  conversationId,
  onUploaded,
  label = 'Add photo or video',
  startOpen = false,
}: {
  patientId: string;
  conversationId?: string;
  onUploaded: (item: MediaItem) => void;
  label?: string;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const captionId = useId();

  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(f: File | undefined) {
    if (!f) return;
    const err = validateMedia(f);
    setError(err);
    setFile(err ? null : f);
    setPreview(null);
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setCaption('');
    setProgress(null);
    setError(null);
  }

  async function upload() {
    if (!file || busy.current) return;
    busy.current = true;
    setError(null);
    setProgress(0);
    try {
      const item = await uploadMedia(patientId, file, { caption, conversationId, onProgress: setProgress });
      reset();
      setOpen(startOpen);
      onUploaded(item);
    } catch (e) {
      setError(toApiError(e).message);
      setProgress(null);
    } finally {
      busy.current = false;
    }
  }

  if (!open) {
    return (
      <button type="button" className={`${ui.btn} ${ui.secondary} ${ui.small}`} onClick={() => setOpen(true)}>
        <Icon name="camera" size={18} />
        {label}
      </button>
    );
  }

  const kind = file ? kindOf(file) : null;
  return (
    <div className={s.picker}>
      {!file && (
        <div className={s.sources}>
          <label className={s.source}>
            <input
              type="file"
              accept="image/*,video/*"
              capture="environment"
              className={ui.srOnly}
              onChange={(e) => pick(e.target.files?.[0])}
              data-testid="media-camera"
            />
            <Icon name="camera" size={26} />
            Take a photo or video
          </label>
          <label className={s.source}>
            <input type="file" accept="image/*,video/*" className={ui.srOnly} onChange={(e) => pick(e.target.files?.[0])} data-testid="media-library" />
            <Icon name="image" size={26} />
            Choose from my photos
          </label>
        </div>
      )}
      {file && (
        <div className={s.preview}>
          {preview && kind === 'photo' && <img src={preview} alt="Preview of your photo" />}
          {preview && kind === 'video' && <video src={preview} controls playsInline aria-label="Preview of your video" />}
          {!preview && <p className={ui.note}>{file.name}</p>}
          <label htmlFor={captionId} className={s.captionLabel}>
            What does this show? <span className={ui.note}>(optional)</span>
          </label>
          <textarea
            id={captionId}
            className={s.caption}
            rows={2}
            maxLength={MAX_CAPTION}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="For example: rash on my arm this morning"
            disabled={progress !== null}
          />
          <p className={s.count}>
            {caption.length}/{MAX_CAPTION}
          </p>
          {progress !== null && (
            <div className={s.progress} role="progressbar" aria-label="Uploading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          <div className={s.row}>
            <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={reset} disabled={progress !== null}>
              Choose another
            </button>
            <button type="button" className={`${ui.btn} ${ui.small}`} onClick={upload} disabled={progress !== null}>
              {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : `Send ${kind === 'video' ? 'video' : 'photo'}`}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className={ui.inlineError} role="alert">
          {error}
        </p>
      )}
      <p className={s.privacy}>Only your care team can see these.</p>
      {!startOpen && !file && (
        <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={() => (reset(), setOpen(false))}>
          Cancel
        </button>
      )}
    </div>
  );
}

/** Small strip of attached uploads (check-in review, chat composer). */
export function MediaThumbs({ items, onRemove }: { items: MediaItem[]; onRemove?: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className={s.thumbs} aria-label="Attached photos and videos">
      {items.map((m) => (
        <li key={m.id} className={s.thumb}>
          {m.kind === 'photo' ? <img src={m.url} alt={m.caption || 'Attached photo'} /> : <span className={s.videoThumb}><Icon name="video" size={22} /></span>}
          {onRemove && (
            <button type="button" className={s.remove} onClick={() => onRemove(m.id)} aria-label={`Remove ${m.kind}${m.caption ? `: ${m.caption}` : ''}`}>
              <Icon name="close" size={14} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
