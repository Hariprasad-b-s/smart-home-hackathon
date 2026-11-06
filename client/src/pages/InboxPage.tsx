import { useEffect, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { InboxItem } from '@shared/types';
import { Chip, EmptyState, Icon, LoadingState } from '../components/ui';
import { filterInbox, INBOX_FILTERS, sortInbox, timeOf, waitingLabel, type InboxFilter } from '../lib/inbox';
import { useClinicianPrefs } from '../state/ClinicianContext';
import { URGENCY_LABEL, useNotifications } from '../state/NotificationsContext';
import s from './InboxPage.module.css';

const isFilter = (v: string | null): v is InboxFilter => INBOX_FILTERS.some((f) => f.value === v);
const AUTHOR: Record<InboxItem['lastMessage']['author'], string> = { patient: 'Patient', ai: 'AI helper', clinician: 'Care team', system: 'System' };

export function InboxPage() {
  const { clinician, clinicians } = useClinicianPrefs();
  const { inbox, inboxLoaded, refreshInbox } = useNotifications();
  const [params, setParams] = useSearchParams();
  const filter: InboxFilter = isFilter(params.get('filter')) ? (params.get('filter') as InboxFilter) : 'waiting';
  const [, setTick] = useState(0);

  useEffect(() => {
    refreshInbox();
    const t = setInterval(() => setTick((n) => n + 1), 30_000); // keep "waiting N min" fresh
    return () => clearInterval(t);
  }, [refreshInbox]);

  const rows = sortInbox(filterInbox(inbox, filter, clinician?.id));
  const counts = Object.fromEntries(INBOX_FILTERS.map((f) => [f.value, filterInbox(inbox, f.value, clinician?.id).length])) as Record<InboxFilter, number>;
  const nameOf = (id?: string) => clinicians.find((c) => c.id === id)?.displayName ?? id;

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>('a[data-row]')];
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = links[Math.max(0, Math.min(links.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  if (!clinician) {
    return (
      <EmptyState title="Messages need a signed-in clinician">
        Choose a clinician from the menu in the top bar to see escalated conversations.
      </EmptyState>
    );
  }

  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>Messages</h1>
        <p className={s.lede}>Conversations the AI helper passed to your care team. The full chat history is in each thread.</p>
      </header>
      <div className={s.filters} role="tablist" aria-label="Filter conversations">
        {INBOX_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            className={`${s.filter} ${filter === f.value ? s.filterOn : ''}`}
            onClick={() => setParams(f.value === 'waiting' ? {} : { filter: f.value }, { replace: true })}
          >
            {f.label} <span className={s.filterCount}>{counts[f.value]}</span>
          </button>
        ))}
      </div>
      {!inboxLoaded ? (
        <LoadingState label="Loading messages…" />
      ) : rows.length === 0 ? (
        <EmptyState title={filter === 'waiting' ? 'Nobody is waiting for a reply' : 'No conversations here'}>
          {filter === 'waiting' ? 'New escalations appear here and in the bell as they arrive.' : 'Try another filter.'}
        </EmptyState>
      ) : (
        <ul className={s.list} onKeyDown={onListKey} aria-label="Conversations">
          {rows.map((i) => (
            <li key={i.conversationId} data-testid="inbox-row">
              <Link to={`/inbox/${encodeURIComponent(i.conversationId)}`} className={`${s.row} ${s[`row_${i.urgency}`]} ${i.status === 'closed' ? s.rowClosed : ''}`} data-row>
                <div className={s.rowTop}>
                  <span className={`${s.urgency} ${s[`urgency_${i.urgency}`]}`}>
                    <Icon name={i.urgency === 'routine' ? 'message' : 'alertTriangle'} size={13} />
                    {URGENCY_LABEL[i.urgency]}
                  </span>
                  <strong className={s.name}>{i.patientName}</strong>
                  {i.conditions.map((c) => (
                    <Chip key={c}>{c}</Chip>
                  ))}
                  <span className={s.wait}>{waitingLabel(i)}</span>
                  {i.unread && i.status !== 'closed' ? <span className={s.unread}>{i.unread} new</span> : null}
                </div>
                <p className={s.topic}>{i.topic}</p>
                <p className={s.summary}>{i.summary}</p>
                <p className={s.last}>
                  <span className={s.lastWho}>{AUTHOR[i.lastMessage.author]}, {timeOf(i.lastMessage.createdAt)}:</span> {i.lastMessage.text}
                </p>
                {i.claimedBy ? <p className={s.claimed}>Claimed by {i.claimedBy === clinician.id ? 'you' : nameOf(i.claimedBy)}</p> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
