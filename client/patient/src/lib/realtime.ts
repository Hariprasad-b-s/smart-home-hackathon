/**
 * Realtime updates for one patient: SSE (`GET /api/events?patientId=…`) with automatic
 * reconnect, falling back to a 15 s poll tick while SSE is unavailable. In mock mode the
 * events come from the in-memory mock.
 */
import type { RealtimeEvent } from '@shared/types/api';
import { USE_MOCKS } from '../api';

export const POLL_MS = 15_000;
const EVENT_TYPES: RealtimeEvent['type'][] = [
  'conversation.updated',
  'conversation.escalated',
  'message.created',
  'media.created',
  'checkin.created',
];

/** `onEvent(null)` = poll tick (refresh everything). Returns an unsubscribe function. */
export function subscribeRealtime(patientId: string, onEvent: (e: RealtimeEvent | null) => void): () => void {
  let closed = false;
  let es: EventSource | null = null;
  let poll: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let unsubMock: (() => void) | undefined;

  if (USE_MOCKS) {
    void import('../dev/mock').then((m) => {
      if (!closed) unsubMock = m.mockSubscribe(patientId, onEvent);
    });
    return () => {
      closed = true;
      unsubMock?.();
    };
  }

  const startPolling = () => {
    if (!poll) poll = setInterval(() => onEvent(null), POLL_MS);
  };
  const stopPolling = () => {
    clearInterval(poll);
    poll = undefined;
  };

  const connect = () => {
    if (closed) return;
    if (typeof EventSource === 'undefined') {
      startPolling();
      return;
    }
    es = new EventSource(`/api/events?patientId=${encodeURIComponent(patientId)}`);
    es.onopen = () => {
      failures = 0;
      stopPolling();
    };
    const handle = (msg: MessageEvent) => {
      try {
        const data = JSON.parse(msg.data) as RealtimeEvent;
        if (data && typeof data === 'object' && 'type' in data) onEvent(data);
      } catch {
        /* heartbeat / malformed */
      }
    };
    es.onmessage = handle;
    // Servers may also send named events (`event: message.created`).
    for (const t of EVENT_TYPES) es.addEventListener(t, handle as EventListener);
    es.onerror = () => {
      startPolling();
      // EventSource retries by itself while CONNECTING; when CLOSED we reconnect with backoff.
      if (es && es.readyState === 2) {
        es.close();
        failures += 1;
        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** failures));
      }
    };
  };
  connect();

  return () => {
    closed = true;
    es?.close();
    stopPolling();
    clearTimeout(retry);
  };
}
