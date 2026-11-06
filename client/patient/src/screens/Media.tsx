/** "Photos & videos": upload evidence for the care team, see and delete my uploads. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MediaItem } from '@shared/types/api';
import { api } from '../api';
import { useHome } from '../lib/home';
import { toApiError, type ApiError } from '../lib/errors';
import { shortDate, clockOf } from '../lib/time';
import { Icon } from '../components/Icon';
import { MediaPicker } from '../components/MediaPicker';
import { ErrorState } from '../components/States';
import ui from '../styles/ui.module.css';
import s from './Media.module.css';

export function MediaScreen() {
  const { patientId } = useHome();
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [open, setOpen] = useState<MediaItem | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.listMedia(patientId));
    } catch (e) {
      setError(toApiError(e));
    }
  }, [patientId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (open) {
    return (
      <Viewer
        item={open}
        patientId={patientId}
        onClose={() => setOpen(null)}
        onDeleted={(id) => {
          setItems((l) => (l ?? []).filter((x) => x.id !== id));
          setOpen(null);
        }}
      />
    );
  }

  return (
    <div className={ui.stack}>
      <Link to="/me" className={`${ui.btn} ${ui.ghost} ${ui.small} ${s.back}`}>
        <Icon name="chevronLeft" size={20} /> Me
      </Link>
      <h1 className={s.h1}>Photos &amp; videos</h1>
      <p className={ui.muted}>Show your care team things that are hard to describe, like a rash, swelling, or how your breathing sounds.</p>
      <MediaPicker patientId={patientId} onUploaded={(m) => setItems((l) => [m, ...(l ?? [])])} />
      <h2 className={ui.sectionTitle}>My uploads</h2>
      {error && <ErrorState error={error} onRetry={load} />}
      {!error && !items && <div className={ui.skeleton} style={{ height: 160 }} role="status" aria-label="Loading uploads" />}
      {items && items.length === 0 && <p className={ui.note}>Nothing yet. Your photos and videos will show up here.</p>}
      {items && items.length > 0 && (
        <ul className={s.grid}>
          {items.map((m) => (
            <li key={m.id}>
              <button type="button" className={s.tile} onClick={() => setOpen(m)} aria-label={`${m.kind === 'video' ? 'Video' : 'Photo'} from ${shortDate(m.date)}${m.caption ? `: ${m.caption}` : ''}`}>
                {m.kind === 'photo' ? (
                  <img src={m.url} alt="" loading="lazy" />
                ) : (
                  <video src={m.url} preload="metadata" muted playsInline aria-hidden="true" tabIndex={-1} />
                )}
                {m.kind === 'video' && (
                  <span className={s.videoBadge}>
                    <Icon name="video" size={14} /> Video
                  </span>
                )}
                <span className={s.meta}>
                  <span className={s.date}>{shortDate(m.date)}</span>
                  {m.caption && <span className={s.cap}>{m.caption}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className={s.privacy}>Only your care team can see these.</p>
    </div>
  );
}

function Viewer({ item, patientId, onClose, onDeleted }: { item: MediaItem; patientId: string; onClose: () => void; onDeleted: (id: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  async function remove() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.deleteMedia(patientId, item.id);
      onDeleted(item.id);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className={ui.stack}>
      <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.small} ${s.back}`} onClick={onClose}>
        <Icon name="chevronLeft" size={20} /> All uploads
      </button>
      <h1 className={s.h1} ref={headingRef} tabIndex={-1}>
        {item.kind === 'video' ? 'Video' : 'Photo'} from {shortDate(item.date)}
      </h1>
      <div className={s.viewer}>
        {item.kind === 'photo' ? <img src={item.url} alt={item.caption || 'Your photo'} /> : <video src={item.url} controls playsInline />}
      </div>
      {item.caption && <p>{item.caption}</p>}
      <p className={ui.note}>Taken at {clockOf(item.takenAt) || 'unknown time'}. Only your care team can see this.</p>
      {!confirm ? (
        <button type="button" className={`${ui.btn} ${ui.ghost} ${s.danger}`} onClick={() => setConfirm(true)}>
          <Icon name="trash" size={18} /> Delete
        </button>
      ) : (
        <div className={s.confirm} role="group" aria-label="Confirm delete">
          <p>Delete this {item.kind}? Your care team won't see it any more.</p>
          <div className={s.confirmRow}>
            <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={() => setConfirm(false)} disabled={busy}>
              Keep it
            </button>
            <button type="button" className={`${ui.btn} ${ui.small} ${s.dangerBtn}`} onClick={remove} disabled={busy}>
              {busy ? 'Deleting…' : 'Yes, delete'}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className={ui.inlineError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
