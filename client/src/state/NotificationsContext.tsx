/**
 * Clinician notifications: inbox of escalated conversations, realtime events (SSE with a
 * 20 s polling fallback while disconnected), escalation toasts and optional desktop alerts.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EscalationUrgency, InboxItem, RealtimeEvent } from '@shared/types';
import { fetchInbox, subscribeRealtime } from '../api/client';
import { Icon } from '../components/ui/Icon';
import { useClinicianPrefs } from './ClinicianContext';

export const POLL_MS = 20_000;
export const DESKTOP_ALERTS_KEY = 'smart-home-desktop-alerts';

interface EscalationToast {
  id: number;
  conversationId: string;
  patientName: string;
  topic: string;
  urgency: EscalationUrgency;
}

export interface NotificationsValue {
  inbox: InboxItem[];
  inboxLoaded: boolean;
  /** Sum of unread over waiting / clinician conversations. */
  unreadCount: number;
  refreshInbox: () => void;
  /** Listen to every realtime event (open thread, dashboard refresh pill …). */
  subscribe: (fn: (e: RealtimeEvent) => void) => () => void;
  connected: boolean;
  desktopAlerts: 'unsupported' | 'off' | 'on' | 'denied';
  enableDesktopAlerts: () => void;
  disableDesktopAlerts: () => void;
}

const NotificationsContext = createContext<NotificationsValue>({
  inbox: [],
  inboxLoaded: false,
  unreadCount: 0,
  refreshInbox: () => {},
  subscribe: () => () => {},
  connected: false,
  desktopAlerts: 'unsupported',
  enableDesktopAlerts: () => {},
  disableDesktopAlerts: () => {},
});

export const useNotifications = () => useContext(NotificationsContext);

export const isOpenStatus = (s: InboxItem['status']) => s === 'waiting' || s === 'clinician';
export const unreadTotal = (items: InboxItem[]) => items.filter((i) => isOpenStatus(i.status)).reduce((a, i) => a + i.unread, 0);

export const URGENCY_LABEL: Record<EscalationUrgency, string> = { urgent: 'Urgent', soon: 'Soon', routine: 'Routine' };

function readDesktopPref(): boolean {
  try {
    return window.localStorage.getItem(DESKTOP_ALERTS_KEY) === 'on';
  } catch {
    return false;
  }
}
function writeDesktopPref(on: boolean) {
  try {
    window.localStorage.setItem(DESKTOP_ALERTS_KEY, on ? 'on' : 'off');
  } catch {
    /* storage blocked */
  }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { clinician } = useClinicianPrefs();
  const clinicianId = clinician?.id;
  const navigate = useNavigate();
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<EscalationToast[]>([]);
  const [desktopOn, setDesktopOn] = useState(readDesktopPref);
  const listeners = useRef(new Set<(e: RealtimeEvent) => void>());
  const connectedRef = useRef(false);
  const desktopRef = useRef(desktopOn);
  desktopRef.current = desktopOn;

  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const permission = supported ? Notification.permission : 'denied';
  const desktopAlerts: NotificationsValue['desktopAlerts'] = !supported ? 'unsupported' : permission === 'denied' ? 'denied' : desktopOn && permission === 'granted' ? 'on' : 'off';

  const refreshInbox = useCallback(() => {
    if (!clinicianId) return;
    fetchInbox(clinicianId)
      .then((items) => {
        setInbox(items);
        setInboxLoaded(true);
      })
      .catch(() => {
        /* keep the last list; the poll will try again */
      });
  }, [clinicianId]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  // Inbox load + realtime subscription per clinician.
  useEffect(() => {
    setInbox([]);
    setInboxLoaded(false);
    if (!clinicianId) return;
    refreshInbox();
    const onEvent = (e: RealtimeEvent) => {
      listeners.current.forEach((fn) => fn(e));
      if (e.type === 'conversation.escalated') {
        const id = Date.now() + Math.random();
        setToasts((t) => [...t, { id, conversationId: e.conversationId, patientName: e.patientName, topic: e.topic, urgency: e.urgency }]);
        if (e.urgency !== 'urgent') setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 12_000);
        if (desktopRef.current && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
          try {
            new Notification(`${URGENCY_LABEL[e.urgency]}: ${e.patientName}`, { body: e.topic, tag: e.conversationId });
          } catch {
            /* some browsers require a service worker */
          }
        }
      }
      if (e.type === 'conversation.escalated' || e.type === 'conversation.updated' || e.type === 'message.created') refreshInbox();
    };
    const unsub = subscribeRealtime(clinicianId, onEvent, (c) => {
      connectedRef.current = c;
      setConnected(c);
    });
    const poll = setInterval(() => {
      if (!connectedRef.current) refreshInbox();
    }, POLL_MS);
    return () => {
      unsub();
      clearInterval(poll);
      connectedRef.current = false;
      setConnected(false);
    };
  }, [clinicianId, refreshInbox]);

  const subscribe = useCallback((fn: (e: RealtimeEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const enableDesktopAlerts = useCallback(() => {
    if (!('Notification' in window)) return;
    // Permission is requested only from this explicit click.
    void Notification.requestPermission().then((p) => {
      const on = p === 'granted';
      writeDesktopPref(on);
      setDesktopOn(on);
    });
  }, []);
  const disableDesktopAlerts = useCallback(() => {
    writeDesktopPref(false);
    setDesktopOn(false);
  }, []);

  const value = useMemo<NotificationsValue>(
    () => ({
      inbox,
      inboxLoaded,
      unreadCount: unreadTotal(inbox),
      refreshInbox,
      subscribe,
      connected,
      desktopAlerts,
      enableDesktopAlerts,
      disableDesktopAlerts,
    }),
    [inbox, inboxLoaded, refreshInbox, subscribe, connected, desktopAlerts, enableDesktopAlerts, disableDesktopAlerts],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <div className="escalation-region no-print" aria-live="assertive" aria-relevant="additions">
        {toasts.map((t) => (
          <div key={t.id} className={`escalation-toast escalation-${t.urgency}`} role={t.urgency === 'urgent' ? 'alert' : 'status'} data-testid="escalation-toast">
            <Icon name={t.urgency === 'routine' ? 'message' : 'alertTriangle'} size={20} />
            <div className="escalation-body">
              <p className="escalation-title">
                {URGENCY_LABEL[t.urgency]} message: {t.patientName}
              </p>
              <p className="escalation-topic">{t.topic}</p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                dismiss(t.id);
                navigate(`/inbox/${encodeURIComponent(t.conversationId)}`);
              }}
            >
              Open
            </button>
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </NotificationsContext.Provider>
  );
}
