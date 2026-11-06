import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { DaySummary, MediaItem, PatientSummary } from '@shared/types';
import { Chip, Icon, Lightbox, MediaThumb, StatusBadge, ZoneBadge } from '../../components/ui';
import { formatLongDate, formatTime, plural } from '../../lib/format';
import s from './DayDrawer.module.css';

interface Props {
  summary: PatientSummary;
  date: string;
  onClose: () => void;
  onNavigate: (date: string) => void;
  /** The patient's media for the window (filtered to this day here). */
  media?: MediaItem[];
}

/** Defensive: never show programmer brackets like ["Coughing","Tight Chest"]. */
export function cleanDisplay(v: string): string {
  const t = v.trim();
  if (t.startsWith('[') && t.endsWith(']')) {
    try {
      const arr = JSON.parse(t) as unknown;
      if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean).join(', ');
    } catch {
      /* not JSON */
    }
  }
  return t;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"]), summary';

/** Everything recorded on one day, in time order. Modal side drawer with focus trap. */
export function DayDrawer({ summary, date, onClose, onNavigate, media = [] }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const idx = summary.days.findIndex((d) => d.date === date);
  const day = idx >= 0 ? summary.days[idx] : undefined;
  const prev = idx > 0 ? summary.days[idx - 1].date : undefined;
  const next = idx >= 0 && idx < summary.days.length - 1 ? summary.days[idx + 1].date : undefined;

  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      returnFocus.current?.focus?.();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Tab' && panelRef.current) {
      const els = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled'));
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const trackerName = (id: string) => summary.patient.trackers.find((t) => t.id === id)?.name ?? 'Tracker';

  return (
    <div className={s.root} onKeyDown={onKeyDown}>
      <div className={s.scrim} onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className={s.panel} role="dialog" aria-modal="true" aria-labelledby="day-title">
        <header className={s.head}>
          <div className={s.nav}>
            <button type="button" className="btn btn-ghost" onClick={() => prev && onNavigate(prev)} disabled={!prev} aria-label="Previous day">
              <Icon name="chevronLeft" size={18} />
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => next && onNavigate(next)} disabled={!next} aria-label="Next day">
              <Icon name="chevronRight" size={18} />
            </button>
          </div>
          <h2 id="day-title" className={s.title}>
            {formatLongDate(date)}
          </h2>
          <button ref={closeRef} type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close day details">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className={s.body}>{day ? <DayContent day={day} trackerName={trackerName} media={dayMedia(media, day)} /> : <p className={s.muted}>This day is outside the selected period.</p>}</div>
      </div>
    </div>
  );
}

/** Media taken on this day, plus anything a submission links to. */
function dayMedia(media: MediaItem[], day: DaySummary): MediaItem[] {
  const linked = new Set(day.submissions.flatMap((x) => x.mediaIds ?? []));
  return media.filter((m) => m.date === day.date || linked.has(m.id)).sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}

function DayContent({ day, trackerName, media }: { day: DaySummary; trackerName: (id: string) => string; media: MediaItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!day.hasData && media.length === 0) {
    return <p className={s.empty}>No check-ins, doses or spirometry were recorded on this day.</p>;
  }
  return (
    <>
      <div className={s.tags}>
        {day.zone ? <ZoneBadge zone={day.zone} /> : null}
        {day.hardDay ? <StatusBadge status="watch" label="Hard day" /> : null}
        {day.symptomDay ? <StatusBadge status="watch" label="Symptom day" subtle /> : null}
        {day.discordant ? <StatusBadge status="concern" label="Feeling and symptoms disagree" /> : null}
      </div>

      <dl className={s.summary}>
        <div>
          <dt>Feeling</dt>
          <dd>
            {day.feeling ? (
              <>
                <strong>{day.feeling.label}</strong>
                {day.feeling.sequence && day.feeling.sequence.length > 1 ? (
                  <span className={s.changed} data-testid="feeling-sequence">
                    {' '}
                    changed during the day:{' '}
                    {day.feeling.sequence.map((l, i) => (
                      <span key={`${l}-${i}`} className={s.seqStep}>
                        {i > 0 ? <Icon name="arrowRight" size={12} /> : null}
                        <span className="sr-only">{i > 0 ? ' then ' : ''}</span>
                        {l}
                      </span>
                    ))}
                  </span>
                ) : null}
              </>
            ) : (
              <span className={s.muted}>Not answered</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Symptoms</dt>
          <dd>
            {day.symptoms.length ? (
              <span className={s.chips}>
                {day.symptoms.map((x) => (
                  <Chip key={x}>{x}</Chip>
                ))}
              </span>
            ) : (
              <span className={s.muted}>None reported</span>
            )}
          </dd>
        </div>
        {day.scheduledDosesExpected > 0 ? (
          <div>
            <dt>Scheduled doses</dt>
            <dd className="num">
              {day.scheduledDosesTaken} of {day.scheduledDosesExpected} marked taken
            </dd>
          </div>
        ) : null}
        <div>
          <dt>As-needed uses</dt>
          <dd className="num">{day.asNeededUses}</dd>
        </div>
        {day.spirometry ? (
          <div>
            <dt>Spirometry (latest)</dt>
            <dd className="num">
              Peak flow {day.spirometry.pefLpm} L/min
              {day.spirometry.pctPersonalBest !== undefined ? ` (${day.spirometry.pctPersonalBest}% of personal best)` : ''}, FEV1 {day.spirometry.fev1L.toFixed(2)} L
              {!day.spirometry.acceptable ? <span className={s.warn}> No acceptable blow; low confidence</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>

      {day.doses.length ? (
        <section aria-labelledby="doses-title">
          <h3 id="doses-title" className={s.sectionTitle}>
            Doses marked taken
          </h3>
          <ul className={s.doses}>
            {day.doses.map((d, i) => (
              <li key={`${d.time}-${i}`}>
                <time className="num">{formatTime(d.time)}</time>
                <span>
                  {d.medicationName}
                  {d.quantity > 1 ? ` × ${d.quantity}` : ''}
                </span>
                <Chip tone={d.kind === 'scheduled' ? 'purple' : 'magenta'}>{d.kind === 'scheduled' ? 'Scheduled' : 'As needed'}</Chip>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {media.length ? (
        <section aria-labelledby="media-title">
          <h3 id="media-title" className={s.sectionTitle}>
            Photos &amp; videos
          </h3>
          <div className={s.mediaStrip} data-testid="day-media">
            {media.map((m, i) => (
              <MediaThumb key={m.id} item={m} size="sm" onOpen={() => setOpen(i)} />
            ))}
          </div>
          {open !== null ? <Lightbox items={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} /> : null}
        </section>
      ) : null}

      <section aria-labelledby="subs-title">
        <h3 id="subs-title" className={s.sectionTitle}>
          Tracker submissions <span className={s.muted}>({plural(day.submissionCount, 'entry', 'entries')}{day.blankSubmissionCount ? `, ${day.blankSubmissionCount} blank` : ''})</span>
        </h3>
        {day.submissions.length === 0 ? <p className={s.muted}>No tracker submissions.</p> : null}
        <ol className={s.subs}>
          {day.submissions.map((sub) => (
            <li key={sub.responseId} className={`${s.sub} ${sub.blank ? s.subBlank : ''} ${sub.usedForDay ? s.subUsed : ''}`} data-testid="submission">
              <div className={s.subHead}>
                <time className="num">{formatTime(sub.time)}</time>
                <span className={s.subTracker}>{trackerName(sub.trackerId)}</span>
                {sub.usedForDay ? <StatusBadge status="good" label="Used for the day" /> : null}
                {sub.blank ? <Chip tone="muted">Blank: opened without answers</Chip> : null}
                {sub.entryMode === 'voice' ? (
                  <span className={s.voice} data-testid="voice-badge">
                    <Icon name="mic" size={13} /> Spoken check-in
                  </span>
                ) : null}
                {sub.mediaIds?.length ? (
                  <span className={s.subMedia}>
                    <Icon name="image" size={13} /> {sub.mediaIds.length}
                  </span>
                ) : null}
              </div>
              {sub.entryMode === 'voice' && sub.transcript ? (
                <details className={s.transcript}>
                  <summary>What the patient said</summary>
                  <blockquote data-testid="voice-transcript">{sub.transcript}</blockquote>
                  <p className={s.muted}>Answers were extracted automatically and confirmed by the patient.</p>
                </details>
              ) : null}
              {sub.answers.length ? (
                <dl className={s.answers}>
                  {sub.answers.map((a) => (
                    <div key={a.questionId}>
                      <dt>{a.shortLabel}</dt>
                      <dd>{cleanDisplay(a.display) || <span className={s.muted}>No answer</span>}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
