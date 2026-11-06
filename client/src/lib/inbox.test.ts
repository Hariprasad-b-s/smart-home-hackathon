import { describe, expect, it } from 'vitest';
import type { InboxItem } from '@shared/types';
import { filterInbox, formatDuration, sortInbox, waitingLabel } from './inbox';

const item = (id: string, urgency: InboxItem['urgency'], status: InboxItem['status'], requestedAt: string, claimedBy?: string): InboxItem => ({
  conversationId: id,
  patientId: id,
  patientName: id,
  conditions: [],
  status,
  urgency,
  topic: '',
  summary: '',
  lastMessage: { author: 'patient', text: '', createdAt: requestedAt },
  unread: 1,
  requestedAt,
  claimedBy,
});

const items = [
  item('routine-old', 'routine', 'waiting', '2026-11-05T08:00:00Z'),
  item('closed', 'urgent', 'closed', '2026-11-05T12:00:00Z'),
  item('soon-claimed', 'soon', 'clinician', '2026-11-05T09:00:00Z', 'me'),
  item('urgent', 'urgent', 'waiting', '2026-11-05T11:00:00Z'),
  item('soon-waiting-new', 'soon', 'waiting', '2026-11-05T10:30:00Z'),
  item('soon-waiting-old', 'soon', 'waiting', '2026-11-05T10:00:00Z'),
];

describe('inbox', () => {
  it('sorts by urgency, then waiting before claimed, then longest waiting; closed last', () => {
    expect(sortInbox(items).map((i) => i.conversationId)).toEqual(['urgent', 'soon-waiting-old', 'soon-waiting-new', 'soon-claimed', 'routine-old', 'closed']);
  });
  it('filters', () => {
    expect(filterInbox(items, 'waiting', 'me')).toHaveLength(4);
    expect(filterInbox(items, 'mine', 'me').map((i) => i.conversationId)).toEqual(['soon-claimed']);
    expect(filterInbox(items, 'open', 'me')).toHaveLength(5);
    expect(filterInbox(items, 'closed', 'me').map((i) => i.conversationId)).toEqual(['closed']);
  });
  it('describes waiting time', () => {
    expect(formatDuration(12 * 60_000)).toBe('12 min');
    expect(formatDuration(125 * 60_000)).toBe('2 h 5 min');
    expect(waitingLabel(items[0], Date.parse('2026-11-05T08:12:00Z'))).toBe('waiting 12 min');
  });
});
