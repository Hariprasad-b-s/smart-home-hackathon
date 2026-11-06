import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { MediaItem } from '@shared/types';
import { EmptyState, Icon, Lightbox, LoadingState, MediaThumb, Panel } from '../../components/ui';
import { formatLongDate, formatTime, plural } from '../../lib/format';
import s from './MediaPanel.module.css';

interface Props {
  /** undefined = still loading; null = failed. */
  media: MediaItem[] | null | undefined;
  span: 1 | 2;
  onSelectDay: (d: string) => void;
}

/** Photos and videos the patient shared, grouped by day, newest first. */
export function MediaPanel({ media, span, onSelectDay }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const items = media ?? [];
  const groups: { date: string; items: MediaItem[] }[] = [];
  for (const m of items) {
    const g = groups[groups.length - 1];
    if (g && g.date === m.date) g.items.push(m);
    else groups.push({ date: m.date, items: [m] });
  }
  return (
    <Panel
      id="media"
      title="Photos & videos"
      icon={<Icon name="image" />}
      span={span}
      subtitle={items.length ? `${plural(items.length, 'item')} shared by the patient in this period` : undefined}
    >
      {media === undefined ? (
        <LoadingState label="Loading photos and videos…" />
      ) : media === null ? (
        <p className={s.muted}>Photos and videos couldn’t be loaded.</p>
      ) : items.length === 0 ? (
        <EmptyState title="No photos or videos shared in this period" />
      ) : (
        groups.map((g) => (
          <section key={g.date} className={s.group} aria-label={formatLongDate(g.date)}>
            <h3 className={s.date}>{formatLongDate(g.date)}</h3>
            <ul className={s.grid}>
              {g.items.map((m) => {
                const time = /T(\d{2}:\d{2})/.exec(m.takenAt)?.[1];
                return (
                  <li key={m.id} className={s.item} data-testid="media-item">
                    <MediaThumb item={m} onOpen={() => setOpen(items.indexOf(m))} />
                    <p className={s.caption}>{m.caption ?? (m.kind === 'video' ? 'Video' : 'Photo')}</p>
                    <p className={s.meta}>
                      {time ? formatTime(time) : null}
                      {m.trackerResponseId ? (
                        <button type="button" className={s.link} onClick={() => onSelectDay(m.date)}>
                          With a check-in
                        </button>
                      ) : null}
                      {m.conversationId ? (
                        <Link className={s.link} to={`/inbox/${encodeURIComponent(m.conversationId)}`}>
                          In a chat
                        </Link>
                      ) : null}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {open !== null ? (
        <Lightbox
          items={items}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onShowDay={(d) => {
            setOpen(null);
            onSelectDay(d);
          }}
        />
      ) : null}
    </Panel>
  );
}
