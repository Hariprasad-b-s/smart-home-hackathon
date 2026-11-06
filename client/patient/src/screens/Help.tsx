/** Help chat: the AI helper answers first; the patient can bring in their care team any time. */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ChatMessage, Conversation, MediaItem } from '@shared/types/api';
import { api } from '../api';
import { useChat } from '../lib/chat';
import { toApiError, type ApiError } from '../lib/errors';
import { useHome } from '../lib/home';
import { clockOf, shortDate } from '../lib/time';
import { Icon } from '../components/Icon';
import { MediaPicker, MediaThumbs } from '../components/MediaPicker';
import { AiStatusChip, SafetyBanner } from '../components/Safety';
import { ErrorState } from '../components/States';
import ui from '../styles/ui.module.css';
import s from './Help.module.css';

export const QUICK_QUESTIONS = [
  'My symptoms are getting worse',
  'Question about my medicine',
  'How do I do the breathing test?',
  'I want to talk to my care team',
];

export const AI_NOTE = "I'm an AI helper, not a doctor. I can't change your medicines.";

const STATUS_LABEL: Record<Conversation['status'], string> = {
  ai: 'AI helper',
  waiting: 'Waiting for care team',
  clinician: 'Care team',
  closed: 'Closed',
};

const sendOnEnter = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches;

function Composer({
  onSend,
  disabled,
  placeholder = 'Type your question',
  extra,
}: {
  onSend: (text: string) => Promise<boolean> | boolean;
  disabled?: boolean;
  placeholder?: string;
  extra?: ReactNode;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  async function send() {
    const t = text.trim();
    if (!t || busy.current) return;
    busy.current = true;
    setSending(true);
    try {
      if (await onSend(t)) setText('');
    } finally {
      busy.current = false;
      setSending(false);
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && sendOnEnter()) {
      e.preventDefault();
      void send();
    }
  };
  return (
    <div className={s.composer}>
      {extra}
      <div className={s.composerRow}>
        <textarea
          aria-label="Message"
          className={s.input}
          rows={1}
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder}
          disabled={disabled || sending}
        />
        <button type="button" className={s.send} onClick={send} disabled={disabled || sending || !text.trim()} aria-label="Send message">
          <Icon name="send" size={22} />
        </button>
      </div>
    </div>
  );
}

export function HelpHome() {
  const { patientId } = useHome();
  const { conversations, aiStatus, upsert } = useChat();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const busy = useRef(false);

  async function start(text: string): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setStarting(true);
    setError(null);
    try {
      const c = await api.startConversation(patientId, { author: 'patient', text });
      upsert(c);
      navigate(`/help/${encodeURIComponent(c.id)}`);
      return true;
    } catch (e) {
      setError(toApiError(e).message);
      return false;
    } finally {
      busy.current = false;
      setStarting(false);
    }
  }

  return (
    <div className={s.home}>
      <div className={s.titleRow}>
        <h1 className={s.h1}>Help</h1>
        <AiStatusChip status={aiStatus} />
      </div>
      <h2 className={s.h2}>Ask a quick question</h2>
      <div className={s.chips}>
        {QUICK_QUESTIONS.map((q) => (
          <button key={q} type="button" className={s.chip} onClick={() => start(q)} disabled={starting}>
            {q}
          </button>
        ))}
      </div>
      <Composer onSend={start} disabled={starting} placeholder="Or type your own question" />
      {error && (
        <p className={ui.inlineError} role="alert">
          {error}
        </p>
      )}
      <p className={ui.note}>If you can't breathe well or feel very sick, follow your action plan or call 911.</p>

      <h2 className={ui.sectionTitle}>Your chats</h2>
      {!conversations && <div className={ui.skeleton} style={{ height: 120 }} role="status" aria-label="Loading chats" />}
      {conversations && conversations.length === 0 && <p className={ui.note}>No chats yet. Ask anything above.</p>}
      {conversations && conversations.length > 0 && (
        <ul className={ui.group}>
          {conversations.map((c) => {
            const last = c.messages[c.messages.length - 1];
            return (
              <li key={c.id}>
                <Link to={`/help/${encodeURIComponent(c.id)}`} className={s.convRow}>
                  <span className={ui.rowBody}>
                    <span className={s.convTop}>
                      <span className={s.convTopic}>{c.topic || 'Chat'}</span>
                      <span className={s.convWhen}>{shortDate(c.updatedAt.slice(0, 10))}</span>
                    </span>
                    <span className={s.convLast}>{last ? `${last.author === 'patient' ? 'You: ' : ''}${last.text}` : ''}</span>
                    <span className={`${s.statusTag} ${s[`st_${c.status}`]}`}>{STATUS_LABEL[c.status]}</span>
                  </span>
                  {c.unreadForPatient > 0 && (
                    <span className={s.unread} aria-label={`${c.unreadForPatient} unread`}>
                      {c.unreadForPatient}
                    </span>
                  )}
                  <Icon name="chevronRight" size={20} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface Pending {
  key: string;
  text: string;
  mediaIds: string[];
  failed: boolean;
}

function StatusBanner({ c, clinicianName }: { c: Conversation; clinicianName?: string }) {
  const text = {
    ai: 'Chatting with the AI helper',
    waiting: "Waiting for your care team. They'll reply here. If it gets worse, follow your action plan or call 911.",
    clinician: `${clinicianName ?? 'Someone'} from your care team is here`,
    closed: 'This chat is closed. Start a new one any time.',
  }[c.status];
  return (
    <p className={`${s.banner} ${s[`b_${c.status}`]}`} role="status" data-testid="chat-status">
      {text}
    </p>
  );
}

export function HelpThread() {
  const { conversationId = '' } = useParams();
  const { patientId } = useHome();
  const { clinicians, upsert, onRealtime, aiStatus } = useChat();
  const navigate = useNavigate();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [attach, setAttach] = useState<MediaItem[]>([]);
  const [known, setKnown] = useState<Record<string, MediaItem>>({});
  const [confirmEsc, setConfirmEsc] = useState(false);
  const [escBusy, setEscBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const apply = useCallback(
    (c: Conversation) => {
      setConv(c);
      upsert(c);
      if (c.unreadForPatient > 0) {
        api.markRead(c.id).then(upsert, () => {});
      }
    },
    [upsert],
  );

  const load = useCallback(async () => {
    try {
      apply(await api.getConversation(conversationId));
      setError(null);
    } catch (e) {
      setError(toApiError(e));
    }
  }, [conversationId, apply]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      onRealtime((e) => {
        if (!e) return void load();
        if ((e.type === 'message.created' || e.type === 'conversation.updated') && e.conversationId === conversationId) void load();
      }),
    [onRealtime, load, conversationId],
  );

  const msgCount = (conv?.messages.length ?? 0) + pending.length;
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [msgCount]);

  async function deliver(p: Pending) {
    setPending((list) => list.map((x) => (x.key === p.key ? { ...x, failed: false } : x)));
    try {
      const c = await api.sendMessage(conversationId, { author: 'patient', text: p.text, ...(p.mediaIds.length ? { mediaIds: p.mediaIds } : {}) });
      setPending((list) => list.filter((x) => x.key !== p.key));
      apply(c);
      return true;
    } catch {
      setPending((list) => list.map((x) => (x.key === p.key ? { ...x, failed: true } : x)));
      return false;
    }
  }

  async function send(text: string) {
    const p: Pending = { key: `p-${Date.now()}-${Math.random()}`, text, mediaIds: attach.map((m) => m.id), failed: false };
    setPending((l) => [...l, p]);
    setAttach([]);
    await deliver(p);
    return true; // clear the composer either way; failed bubbles keep the text with a retry
  }

  async function escalate() {
    if (escBusy) return;
    setEscBusy(true);
    setActionError(null);
    try {
      apply(await api.escalate(conversationId, 'Patient asked to talk to their care team'));
      setConfirmEsc(false);
    } catch (e) {
      setActionError(toApiError(e).message);
    } finally {
      setEscBusy(false);
    }
  }

  if (error && !conv) return <ErrorState error={error} onRetry={load} title="Couldn't open this chat" />;
  if (!conv) return <div className={ui.skeleton} style={{ height: 240 }} role="status" aria-label="Loading chat" />;

  const claimedBy = conv.escalation?.claimedBy;
  const clinicianMsg = [...conv.messages].reverse().find((m) => m.author === 'clinician');
  const clinicianName = (claimedBy && clinicians[claimedBy]?.displayName) || (clinicianMsg?.clinicianId && clinicians[clinicianMsg.clinicianId]?.displayName) || clinicianMsg?.authorName;
  const firstAi = conv.messages.findIndex((m) => m.author === 'ai');
  const canEscalate = conv.status === 'ai';
  const latestSafety = [...conv.messages].reverse().find((m) => m.safety)?.safety;

  const action = (a: NonNullable<ChatMessage['suggestedActions']>[number]) => {
    if (a === 'check_in') navigate('/check-in');
    else if (a === 'breathing_test') navigate('/breathe');
    else if (a === 'medicines') navigate('/medicines');
    else setConfirmEsc(true);
  };
  const ACTION_LABEL = { check_in: 'Do a check-in', breathing_test: 'Do a breathing test', medicines: 'Open my medicines', talk_to_care_team: 'Talk to my care team' } as const;

  return (
    <div className={s.thread}>
      <div className={s.threadTop}>
        <Link to="/help" className={`${ui.btn} ${ui.ghost} ${ui.small}`}>
          <Icon name="chevronLeft" size={20} /> Help
        </Link>
        <AiStatusChip status={aiStatus} />
      </div>
      {latestSafety?.level === 'emergency' && <SafetyBanner notice={latestSafety} />}
      <h1 className={s.threadTitle}>{conv.topic || 'Chat'}</h1>
      <StatusBanner c={conv} clinicianName={clinicianName} />

      <ol className={s.messages} aria-label="Messages" aria-live="polite">
        {conv.messages.map((m, i) => (
          <li key={m.id} className={s[`row_${m.author}`]}>
            {i === firstAi && <p className={s.aiNote}>{AI_NOTE}</p>}
            <Message m={m} clinicians={clinicians} known={known} onAction={action} labels={ACTION_LABEL} disabledActions={!canEscalate} />
          </li>
        ))}
        {pending.map((p) => (
          <li key={p.key} className={s.row_patient}>
            <div className={`${s.bubble} ${s.mine} ${p.failed ? s.failed : s.sending}`}>
              <p>{p.text}</p>
              {p.failed ? (
                <p className={s.failNote}>
                  Not sent.{' '}
                  <button type="button" className={s.retry} onClick={() => deliver(p)}>
                    Try again
                  </button>
                </p>
              ) : (
                <p className={s.meta}>Sending…</p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div ref={endRef} />

      <div className={s.escalate}>
        {confirmEsc && canEscalate ? (
          <div className={s.confirm} role="group" aria-label="Confirm talking to your care team">
            <p>Ask your care team to join this chat? They'll see what you've written here and reply as soon as they can.</p>
            <div className={s.confirmRow}>
              <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={() => setConfirmEsc(false)} disabled={escBusy}>
                Not now
              </button>
              <button type="button" className={`${ui.btn} ${ui.small}`} onClick={escalate} disabled={escBusy}>
                {escBusy ? 'Asking…' : 'Yes, ask them'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={`${ui.btn} ${ui.secondary} ${ui.small} ${ui.block}`}
            onClick={() => setConfirmEsc(true)}
            disabled={!canEscalate}
          >
            <Icon name="users" size={18} />
            {conv.status === 'ai' ? 'Talk to my care team' : conv.status === 'closed' ? 'Chat closed' : conv.status === 'clinician' ? 'Your care team is in this chat' : 'Care team asked to join'}
          </button>
        )}
        {actionError && (
          <p className={ui.inlineError} role="alert">
            {actionError}
          </p>
        )}
      </div>

      {conv.status !== 'closed' ? (
        <Composer
          onSend={send}
          extra={
            <div className={s.attachRow}>
              <MediaThumbs items={attach} onRemove={(id) => setAttach((l) => l.filter((x) => x.id !== id))} />
              {attach.length < 10 && (
                <MediaPicker
                  patientId={patientId}
                  conversationId={conv.id}
                  label="Add photo"
                  onUploaded={(m) => {
                    setAttach((l) => [...l, m]);
                    setKnown((k) => ({ ...k, [m.id]: m }));
                  }}
                />
              )}
            </div>
          }
        />
      ) : (
        <Link to="/help" className={`${ui.btn} ${ui.block}`}>
          Start a new chat
        </Link>
      )}
    </div>
  );
}

function Message({
  m,
  clinicians,
  known,
  onAction,
  labels,
  disabledActions,
}: {
  m: ChatMessage;
  clinicians: Record<string, { displayName: string; role: string }>;
  known: Record<string, MediaItem>;
  onAction: (a: NonNullable<ChatMessage['suggestedActions']>[number]) => void;
  labels: Record<NonNullable<ChatMessage['suggestedActions']>[number], string>;
  disabledActions: boolean;
}) {
  if (m.author === 'system') return <p className={s.system}>{m.text}</p>;
  const time = clockOf(m.createdAt) || m.createdAt.slice(11, 16);
  const who =
    m.author === 'ai'
      ? 'SMART@Home helper · AI'
      : m.author === 'clinician'
        ? (() => {
            const c = m.clinicianId ? clinicians[m.clinicianId] : undefined;
            return c ? `${c.displayName} · ${c.role}` : m.authorName;
          })()
        : 'You';
  return (
    <div className={`${s.bubble} ${m.author === 'patient' ? s.mine : m.author === 'ai' ? s.ai : s.clinician}`}>
      <p className={s.who}>{who}</p>
      {m.safety && (
        <div className={`${s.safetyCard} ${m.safety.level === 'emergency' ? s.safetyEmergency : ''}`}>
          <p className={s.safetyText}>
            <Icon name="alert" size={18} /> {m.safety.message}
          </p>
          <div className={s.safetyLinks}>
            <a href="tel:911">Call 911</a>
            {/\b988\b/.test(m.safety.message) && (
              <>
                <a href="tel:988">Call 988</a>
                <a href="sms:988">Text 988</a>
              </>
            )}
          </div>
        </div>
      )}
      <p className={s.text}>{m.text}</p>
      {m.mediaIds && m.mediaIds.length > 0 && (
        <ul className={s.msgMedia}>
          {m.mediaIds.map((id) => {
            const k = known[id];
            const url = k?.url ?? `/api/media/${encodeURIComponent(id)}/content`;
            return (
              <li key={id}>{k?.kind === 'video' ? <video src={url} controls playsInline /> : <img src={url} alt={k?.caption || 'Attached photo'} />}</li>
            );
          })}
        </ul>
      )}
      {m.suggestedActions && m.suggestedActions.length > 0 && (
        <div className={s.actions}>
          {m.suggestedActions.map((a) => (
            <button
              key={a}
              type="button"
              className={`${ui.btn} ${ui.secondary} ${ui.small}`}
              onClick={() => onAction(a)}
              disabled={a === 'talk_to_care_team' && disabledActions}
            >
              {labels[a]}
            </button>
          ))}
        </div>
      )}
      <p className={s.meta}>{time}</p>
    </div>
  );
}
