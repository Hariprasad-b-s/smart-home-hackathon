import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ChatMessage, Conversation, MediaItem, PatientSummary } from '@shared/types';
import {
  ApiRequestError,
  claimConversation,
  closeConversation,
  fetchConversation,
  fetchPatientMedia,
  fetchPatientSummary,
  markConversationRead,
  sendClinicianMessage,
} from '../api';
import { Chip, EmptyState, ErrorState, Icon, Lightbox, LoadingState, MediaThumb, StatusIcon, ZoneBadge } from '../components/ui';
import { formatDate, formatLongDate, formatTime } from '../lib/format';
import { timeOf } from '../lib/inbox';
import { useClinicianPrefs } from '../state/ClinicianContext';
import { URGENCY_LABEL, useNotifications } from '../state/NotificationsContext';
import s from './ConversationPage.module.css';

export const QUICK_REPLIES = [
  'Thanks, I’m looking at your readings now.',
  'Please do a breathing test and check in, then I’ll take another look.',
  'Please call the clinic using the number on your action plan so we can talk this through.',
];

const REQUESTED_BY: Record<'patient' | 'ai' | 'safety', string> = { patient: 'Patient asked for the care team', ai: 'AI helper', safety: 'Safety screen' };

interface Pending {
  tempId: string;
  text: string;
  status: 'sending' | 'failed';
}

export function ConversationPage() {
  const { conversationId = '' } = useParams();
  const { clinician, clinicians } = useClinicianPrefs();
  const { subscribe, refreshInbox } = useNotifications();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [summary, setSummary] = useState<PatientSummary | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [text, setText] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ items: MediaItem[]; index: number } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const clinicianId = clinician?.id;

  const load = useCallback(() => {
    setError(null);
    fetchConversation(conversationId)
      .then(setConv)
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(String(e))));
  }, [conversationId]);

  useEffect(() => {
    setConv(null);
    setPending([]);
    load();
  }, [load]);

  const patientId = conv?.patientId;
  useEffect(() => {
    if (!patientId) return;
    const ctrl = new AbortController();
    fetchPatientMedia(patientId, 'all', ctrl.signal).then(setMedia).catch(() => {});
    fetchPatientSummary(patientId, 14, ctrl.signal).then(setSummary).catch(() => {});
    return () => ctrl.abort();
  }, [patientId]);

  const markRead = useCallback(() => {
    if (!clinicianId || document.visibilityState === 'hidden') return;
    markConversationRead(conversationId, clinicianId)
      .then(() => refreshInbox())
      .catch(() => {});
  }, [conversationId, clinicianId, refreshInbox]);

  // Mark read on open.
  const loadedId = conv?.id;
  useEffect(() => {
    if (loadedId) markRead();
  }, [loadedId, markRead]);

  // Realtime: new messages, status changes, new media.
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === 'message.created' && e.conversationId === conversationId) {
          setConv((c) => (c && !c.messages.some((m) => m.id === e.message.id) ? { ...c, messages: [...c.messages, e.message], updatedAt: e.message.createdAt } : c));
          if (e.message.author !== 'clinician' || e.message.clinicianId !== clinicianId) markRead();
        } else if (e.type === 'conversation.updated' && e.conversationId === conversationId) {
          load();
        } else if (e.type === 'media.created' && e.patientId === patientId) {
          setMedia((m) => (m.some((x) => x.id === e.media.id) ? m : [e.media, ...m]));
        }
      }),
    [subscribe, conversationId, clinicianId, patientId, load, markRead],
  );

  const messageCount = (conv?.messages.length ?? 0) + pending.length;
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messageCount]);

  const mediaById = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);

  const send = (body: string, tempId = `tmp-${Date.now()}`) => {
    const t = body.trim();
    if (!t || !clinicianId || !conv) return;
    setPending((p) => [...p.filter((x) => x.tempId !== tempId), { tempId, text: t, status: 'sending' }]);
    sendClinicianMessage(conv.id, { author: 'clinician', clinicianId, text: t })
      .then((c) => {
        setConv(c);
        setPending((p) => p.filter((x) => x.tempId !== tempId));
        refreshInbox();
      })
      .catch(() => setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, status: 'failed' } : x))));
  };

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(text);
      setText('');
    }
  };

  const act = (fn: () => Promise<Conversation>) => {
    setActionError(null);
    fn()
      .then((c) => {
        setConv(c);
        refreshInbox();
      })
      .catch((e: unknown) => setActionError(e instanceof Error ? e.message : 'That didn’t work. Try again.'));
  };

  if (error && !conv) {
    return error instanceof ApiRequestError && error.status === 404 ? (
      <EmptyState title="Conversation not found" action={<Link className="btn" to="/inbox">Back to messages</Link>}>
        It may have been removed, or the link is out of date.
      </EmptyState>
    ) : (
      <ErrorState title="Couldn’t load this conversation" error={error} onRetry={load} />
    );
  }
  if (!conv) return <LoadingState label="Loading conversation…" />;

  const esc = conv.escalation;
  const closed = conv.status === 'closed';
  const claimedByMe = !!esc?.claimedBy && esc.claimedBy === clinicianId;
  const nameOf = (id?: string) => clinicians.find((c) => c.id === id)?.displayName ?? id;
  const today = summary?.today;

  return (
    <div className={s.page}>
      <div className={s.crumbs}>
        <Link to="/inbox">
          <Icon name="chevronLeft" size={14} /> Messages
        </Link>
      </div>
      <header className={s.head}>
        <div>
          <h1 className={s.title}>{conv.patientName}</h1>
          <p className={s.topic}>{conv.topic}</p>
        </div>
        <div className={s.actions}>
          <span className={`${s.status} ${s[`status_${conv.status}`]}`}>
            {conv.status === 'waiting' ? 'Waiting for the care team' : conv.status === 'clinician' ? 'Care team replying' : conv.status === 'closed' ? 'Closed' : 'AI helper'}
          </span>
          {!closed && clinicianId && !claimedByMe ? (
            <button type="button" className="btn btn-primary" onClick={() => act(() => claimConversation(conv.id, clinicianId))}>
              I’m on it
            </button>
          ) : null}
          {!closed && clinicianId ? (
            confirmClose ? (
              <span className={s.confirm} role="group" aria-label="Confirm closing">
                Close this conversation?
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setConfirmClose(false);
                    act(() => closeConversation(conv.id, clinicianId));
                  }}
                >
                  Yes, close it
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmClose(false)}>
                  Keep open
                </button>
              </span>
            ) : (
              <button type="button" className="btn" onClick={() => setConfirmClose(true)}>
                Close conversation
              </button>
            )
          ) : null}
        </div>
      </header>
      {actionError ? <p className={s.actionError} role="alert">{actionError}</p> : null}

      <div className={s.layout}>
        <section className={s.thread} aria-label="Chat history">
          <ol className={s.messages} aria-live="polite" aria-relevant="additions">
            {conv.messages.map((m) => (
              <MessageRow key={m.id} m={m} mediaById={mediaById} onOpenMedia={(items, index) => setLightbox({ items, index })} />
            ))}
            {pending.map((p) => (
              <li key={p.tempId} className={`${s.msg} ${s.msgClinician} ${p.status === 'failed' ? s.msgFailed : ''}`} data-testid="pending-message">
                <div className={s.msgHead}>
                  <span className={s.author}>{clinician?.displayName ?? 'You'}</span>
                  <span className={s.time}>{p.status === 'sending' ? 'Sending…' : 'Not sent'}</span>
                </div>
                <p className={s.text}>{p.text}</p>
                {p.status === 'failed' ? (
                  <button type="button" className={s.retry} onClick={() => send(p.text, p.tempId)}>
                    <Icon name="refresh" size={13} /> Retry
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          <div ref={endRef} />
          {closed ? (
            <p className={s.closedNote}>This conversation is closed. The patient can start a new one from the app.</p>
          ) : clinicianId ? (
            <form
              className={s.composer}
              onSubmit={(e) => {
                e.preventDefault();
                send(text);
                setText('');
              }}
            >
              <div className={s.quick} role="group" aria-label="Quick replies">
                {QUICK_REPLIES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className={s.quickBtn}
                    onClick={() => {
                      setText(q);
                      textRef.current?.focus();
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
              <label className="sr-only" htmlFor="reply">
                Reply to {conv.patientName}
              </label>
              <div className={s.inputRow}>
                <textarea
                  id="reply"
                  ref={textRef}
                  className={`input ${s.textarea}`}
                  rows={3}
                  placeholder="Write a reply. Enter sends, Shift+Enter adds a new line."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onComposerKey}
                />
                <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
                  <Icon name="send" size={16} /> Send
                </button>
              </div>
            </form>
          ) : (
            <p className={s.closedNote}>Choose a clinician from the top bar to reply.</p>
          )}
        </section>

        <aside className={s.side}>
          {esc ? (
            <section className={`${s.card} ${s[`card_${esc.urgency}`]}`} aria-labelledby="esc-title" data-testid="escalation-card">
              <h2 id="esc-title" className={s.cardTitle}>
                <Icon name={esc.urgency === 'routine' ? 'message' : 'alertTriangle'} size={16} /> {URGENCY_LABEL[esc.urgency]} escalation
              </h2>
              <p className={s.reason}>{esc.reason}</p>
              <p className={s.summary}>{esc.summary}</p>
              <dl className={s.facts}>
                <div>
                  <dt>Requested by</dt>
                  <dd>{REQUESTED_BY[esc.requestedBy]}</dd>
                </div>
                <div>
                  <dt>When</dt>
                  <dd>
                    {formatDate(esc.requestedAt.slice(0, 10))}, {timeOf(esc.requestedAt)}
                  </dd>
                </div>
                {esc.claimedBy ? (
                  <div>
                    <dt>Claimed by</dt>
                    <dd>{claimedByMe ? 'You' : nameOf(esc.claimedBy)}</dd>
                  </div>
                ) : null}
              </dl>
            </section>
          ) : null}
          <PatientSnapshot summary={summary} patientId={conv.patientId} today={today} />
        </aside>
      </div>

      {lightbox ? <Lightbox items={lightbox.items} index={lightbox.index} onIndex={(i) => setLightbox((l) => (l ? { ...l, index: i } : l))} onClose={() => setLightbox(null)} /> : null}
    </div>
  );
}

function MessageRow({ m, mediaById, onOpenMedia }: { m: ChatMessage; mediaById: Map<string, MediaItem>; onOpenMedia: (items: MediaItem[], index: number) => void }) {
  const attachments = (m.mediaIds ?? []).map((id) => mediaById.get(id));
  const photos = attachments.filter((a): a is MediaItem => !!a && a.kind === 'photo');
  const cls = m.author === 'ai' ? s.msgAi : m.author === 'patient' ? s.msgPatient : m.author === 'clinician' ? s.msgClinician : s.msgSystem;
  const label = m.author === 'ai' ? 'AI helper' : m.authorName;
  const date = m.createdAt.slice(0, 10);
  return (
    <li className={`${s.msg} ${cls}`} data-testid={`msg-${m.author}`}>
      {m.author !== 'system' ? (
        <div className={s.msgHead}>
          <span className={s.author}>
            {m.author === 'ai' ? <Icon name="sparkle" size={13} /> : null}
            {label}
          </span>
          <time className={s.time} dateTime={m.createdAt} title={formatLongDate(date)}>
            {formatDate(date)}, {timeOf(m.createdAt)}
          </time>
        </div>
      ) : null}
      <p className={s.text}>
        {m.author === 'system' ? <span className={s.time}>{timeOf(m.createdAt)} </span> : null}
        {m.text}
      </p>
      {m.safety ? (
        <div className={`${s.safety} ${m.safety.level === 'emergency' ? s.safetyEmergency : ''}`} role="note" data-testid="safety-notice">
          <Icon name="alertOctagon" size={16} />
          <span>
            <strong>{m.safety.level === 'emergency' ? 'Emergency advice shown to patient' : 'Safety advice shown to patient'}:</strong> {m.safety.message}
          </span>
        </div>
      ) : null}
      {attachments.length ? (
        <div className={s.attachments}>
          {attachments.map((a, i) =>
            !a ? (
              <span key={m.mediaIds![i]} className={s.missing}>
                Attachment unavailable
              </span>
            ) : a.kind === 'video' ? (
              <figure key={a.id} className={s.videoWrap}>
                <video src={a.url} controls preload="metadata" aria-label={a.caption ?? 'Video from the patient'} />
                {a.caption ? <figcaption>{a.caption}</figcaption> : null}
              </figure>
            ) : (
              <figure key={a.id} className={s.photoWrap}>
                <MediaThumb item={a} onOpen={() => onOpenMedia(photos, photos.indexOf(a))} />
                {a.caption ? <figcaption>{a.caption}</figcaption> : null}
              </figure>
            ),
          )}
        </div>
      ) : null}
    </li>
  );
}

function PatientSnapshot({ summary, patientId, today }: { summary: PatientSummary | null; patientId: string; today?: string }) {
  if (!summary) {
    return (
      <section className={s.card} aria-label="Patient snapshot">
        <LoadingState label="Loading the last 14 days…" />
      </section>
    );
  }
  const zone = summary.actionPlan?.currentZone ?? [...summary.days].reverse().find((d) => d.zone)?.zone;
  const ctrl = summary.headline.find((h) => h.id === 'controllerAdherence') ?? summary.headline.find((h) => h.id === 'medicationAdherence');
  const latest = summary.spirometry?.latest;
  const lastCheckIn = [...summary.days]
    .reverse()
    .flatMap((d) => [...d.submissions].reverse().filter((x) => !x.blank).map((x) => ({ date: d.date, time: x.time })))[0];
  const todayDay = summary.days.find((d) => d.date === summary.today);
  const voice = todayDay?.submissions.filter((x) => x.entryMode === 'voice' && x.transcript);
  const isAsthma = summary.patient.trackers.some((t) => t.condition === 'asthma');

  return (
    <section className={s.card} aria-labelledby="snap-title" data-testid="patient-snapshot">
      <h2 id="snap-title" className={s.cardTitle}>
        Last 14 days
      </h2>
      <p className={s.snapWho}>
        {summary.patient.ageYears} years
        {summary.patient.trackers.map((t) => (
          <Chip key={t.id}>{t.conditionLabel}</Chip>
        ))}
      </p>
      <dl className={s.facts}>
        {isAsthma ? (
          <div>
            <dt>Zone</dt>
            <dd>
              <ZoneBadge zone={zone} />
            </dd>
          </div>
        ) : null}
        {ctrl ? (
          <div>
            <dt>{ctrl.label}</dt>
            <dd>
              <StatusIcon status={ctrl.status} size={14} /> {ctrl.value}
            </dd>
          </div>
        ) : null}
        {latest?.pctPersonalBest !== undefined ? (
          <div>
            <dt>Latest peak flow</dt>
            <dd>
              {latest.pctPersonalBest}% of personal best, {formatDate(latest.date)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Last check-in</dt>
          <dd>{lastCheckIn ? `${formatDate(lastCheckIn.date)}, ${formatTime(lastCheckIn.time)}` : 'None in the last 14 days'}</dd>
        </div>
      </dl>
      {summary.flags.length ? (
        <>
          <h3 className={s.subTitle}>Top flags</h3>
          <ul className={s.flags}>
            {summary.flags.slice(0, 3).map((f) => (
              <li key={f.id}>
                <StatusIcon status={f.severity === 'high' ? 'concern' : f.severity === 'medium' ? 'watch' : 'neutral'} size={14} /> {f.title}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {voice?.length ? (
        <>
          <h3 className={s.subTitle}>
            <Icon name="mic" size={14} /> Today’s spoken check-in
          </h3>
          {voice.map((v) => (
            <blockquote key={v.responseId} className={s.transcript}>
              {v.transcript}
            </blockquote>
          ))}
        </>
      ) : null}
      <div className={s.links}>
        <Link className="btn" to={`/patients/${encodeURIComponent(patientId)}`}>
          Open dashboard
        </Link>
        {today ? (
          <Link className="btn btn-ghost" to={`/patients/${encodeURIComponent(patientId)}?day=${today}`}>
            Open today in day view
          </Link>
        ) : null}
      </div>
    </section>
  );
}
