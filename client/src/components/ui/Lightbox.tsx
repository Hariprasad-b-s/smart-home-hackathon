import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { MediaItem } from '@shared/types';
import { Icon } from './Icon';
import { formatDate, formatTime } from '../../lib/format';
import s from './Lightbox.module.css';

interface Props {
  items: MediaItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** Shows a "Show this day" button when provided. */
  onShowDay?: (date: string) => void;
}

const FOCUSABLE = 'button:not([disabled]), video, a[href]';

/** Full-size photo / video viewer. Esc closes; ← → move between items; focus is trapped. */
export function Lightbox({ items, index, onIndex, onClose, onShowDay }: Props) {
  const item = items[index];
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => returnFocus.current?.focus?.();
  }, []);

  if (!item) return null;
  const prev = index > 0 ? index - 1 : null;
  const next = index < items.length - 1 ? index + 1 : null;

  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowLeft' && prev !== null && (e.target as HTMLElement).tagName !== 'VIDEO') {
      onIndex(prev);
    } else if (e.key === 'ArrowRight' && next !== null && (e.target as HTMLElement).tagName !== 'VIDEO') {
      onIndex(next);
    } else if (e.key === 'Tab' && panelRef.current) {
      const els = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!els.length) return;
      if (e.shiftKey && document.activeElement === els[0]) {
        e.preventDefault();
        els[els.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === els[els.length - 1]) {
        e.preventDefault();
        els[0].focus();
      }
    }
  };

  const time = /T(\d{2}:\d{2})/.exec(item.takenAt)?.[1];
  return (
    <div className={s.root} onKeyDown={onKey}>
      <div className={s.scrim} onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className={s.panel} role="dialog" aria-modal="true" aria-label={item.caption ? `${item.kind === 'video' ? 'Video' : 'Photo'}: ${item.caption}` : item.kind === 'video' ? 'Video' : 'Photo'} data-testid="lightbox">
        <div className={s.top}>
          <span className={s.count}>
            {index + 1} of {items.length}
          </span>
          <button ref={closeRef} type="button" className={s.iconBtn} onClick={onClose} aria-label="Close viewer">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className={s.stage}>
          <button type="button" className={`${s.iconBtn} ${s.nav}`} onClick={() => prev !== null && onIndex(prev)} disabled={prev === null} aria-label="Previous">
            <Icon name="chevronLeft" size={24} />
          </button>
          {item.kind === 'video' ? (
            <video key={item.id} className={s.media} src={item.url} controls preload="metadata" />
          ) : (
            <img key={item.id} className={s.media} src={item.url} alt={item.caption ?? 'Photo shared by the patient'} />
          )}
          <button type="button" className={`${s.iconBtn} ${s.nav}`} onClick={() => next !== null && onIndex(next)} disabled={next === null} aria-label="Next">
            <Icon name="chevronRight" size={24} />
          </button>
        </div>
        <div className={s.caption}>
          <div>
            <p className={s.captionText}>{item.caption ?? (item.kind === 'video' ? 'Video' : 'Photo')}</p>
            <p className={s.meta}>
              {formatDate(item.date)}
              {time ? `, ${formatTime(time)}` : ''}
              {item.trackerResponseId ? ', attached to a check-in' : item.conversationId ? ', shared in a chat' : ''}
            </p>
          </div>
          {onShowDay ? (
            <button type="button" className="btn" onClick={() => onShowDay(item.date)}>
              <Icon name="calendar" size={16} /> Show this day
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
