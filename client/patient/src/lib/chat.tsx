/**
 * Help chat state shared by the tab bar (unread badge), Help home and threads. Holds the
 * conversation list, clinician names, AI status and the realtime subscription.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AiStatus, ClinicianProfile, Conversation, RealtimeEvent } from '@shared/types/api';
import { api } from '../api';
import { subscribeRealtime } from './realtime';

type Listener = (e: RealtimeEvent | null) => void;

interface ChatState {
  conversations: Conversation[] | null;
  unread: number;
  clinicians: Record<string, ClinicianProfile>;
  aiStatus: AiStatus | null;
  refresh: () => Promise<void>;
  /** Put a fresh copy of a conversation into the list (after a send/escalate). */
  upsert: (c: Conversation) => void;
  /** Subscribe to realtime events (null = poll tick). */
  onRealtime: (l: Listener) => () => void;
}

const ChatContext = createContext<ChatState | null>(null);

export function ChatProvider({ patientId, children }: { patientId: string; children: ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [clinicians, setClinicians] = useState<Record<string, ClinicianProfile>>({});
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const listeners = useRef(new Set<Listener>());

  const refresh = useCallback(async () => {
    try {
      setConversations(await api.listConversations(patientId));
    } catch {
      setConversations((c) => c ?? []);
    }
  }, [patientId]);

  useEffect(() => {
    void refresh();
    api.listClinicians().then(
      (list) => setClinicians(Object.fromEntries(list.map((c) => [c.id, c]))),
      () => {},
    );
    api.aiStatus().then(setAiStatus, () => setAiStatus(null));
  }, [refresh]);

  useEffect(
    () =>
      subscribeRealtime(patientId, (e) => {
        if (!e || e.type === 'message.created' || e.type === 'conversation.updated' || e.type === 'conversation.escalated') void refresh();
        listeners.current.forEach((l) => l(e));
      }),
    [patientId, refresh],
  );

  const upsert = useCallback((c: Conversation) => {
    setConversations((list) => {
      const rest = (list ?? []).filter((x) => x.id !== c.id);
      return [c, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }, []);

  const onRealtime = useCallback((l: Listener) => {
    listeners.current.add(l);
    return () => void listeners.current.delete(l);
  }, []);

  const unread = (conversations ?? []).reduce((n, c) => n + (c.unreadForPatient || 0), 0);
  const value = useMemo(
    () => ({ conversations, unread, clinicians, aiStatus, refresh, upsert, onRealtime }),
    [conversations, unread, clinicians, aiStatus, refresh, upsert, onRealtime],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatState {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
}

export function useOptionalChat(): ChatState | null {
  return useContext(ChatContext);
}
