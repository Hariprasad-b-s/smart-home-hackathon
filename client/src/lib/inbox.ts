import type { InboxItem } from '@shared/types';

export type InboxFilter = 'waiting' | 'mine' | 'open' | 'closed';

export const INBOX_FILTERS: { value: InboxFilter; label: string }[] = [
  { value: 'waiting', label: 'Needs reply' },
  { value: 'mine', label: 'Mine' },
  { value: 'open', label: 'All open' },
  { value: 'closed', label: 'Closed' },
];

const URGENCY_RANK = { urgent: 0, soon: 1, routine: 2 } as const;
const STATUS_RANK = { waiting: 0, clinician: 1, ai: 2, closed: 3 } as const;

/** Open items: urgency, then waiting before claimed, then longest-waiting first. Closed: newest first. */
export function sortInbox(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    const ca = a.status === 'closed';
    const cb = b.status === 'closed';
    if (ca !== cb) return ca ? 1 : -1;
    if (ca && cb) return b.lastMessage.createdAt.localeCompare(a.lastMessage.createdAt);
    return (
      URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      Date.parse(a.requestedAt) - Date.parse(b.requestedAt)
    );
  });
}

export function filterInbox(items: InboxItem[], filter: InboxFilter, clinicianId?: string): InboxItem[] {
  switch (filter) {
    case 'waiting':
      return items.filter((i) => i.status === 'waiting');
    case 'mine':
      return items.filter((i) => i.status !== 'closed' && !!clinicianId && i.claimedBy === clinicianId);
    case 'open':
      return items.filter((i) => i.status === 'waiting' || i.status === 'clinician');
    case 'closed':
      return items.filter((i) => i.status === 'closed');
  }
}

export function formatDuration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return 'under a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60 ? `${min % 60} min` : ''}`.trim();
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

/** "waiting 12 min" for unanswered escalations, "claimed" / "replied" otherwise. */
export function waitingLabel(i: InboxItem, now = Date.now()): string {
  if (i.status === 'waiting') return `waiting ${formatDuration(now - Date.parse(i.requestedAt))}`;
  if (i.status === 'closed') return 'closed';
  return i.claimedBy ? 'claimed' : 'open';
}

/** Local clock time from an ISO timestamp with offset ("2026-11-05T13:04:00-05:00" → "1:04 PM"). */
export function timeOf(iso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}
