/**
 * Typed API client for every endpoint in shared/types/api.ts.
 * When `VITE_USE_MOCKS === 'true'` (dev only) responses come from src/dev/mockData.ts;
 * otherwise the real API is always used.
 */
import type {
  ApiError,
  ClinicianMessageRequest,
  Conversation,
  InboxItem,
  MediaItem,
  RealtimeEvent,
  ClinicianPreferences,
  ClinicianProfile,
  HealthResponse,
  PatientListResponse,
  PatientSummary,
  RawPatientDocument,
  TrackerDefinition,
} from '@shared/types';
import type { WindowDays } from '../lib/urlState';

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true';

export class ApiRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiRequestError('Could not reach the SMART@Home server. Check that the API is running.', 0);
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as Partial<ApiError>;
      if (body && typeof body.error === 'string') message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiRequestError(message, res.status);
  }
  return (await res.json()) as T;
}

const mocks = () => import('../dev/mockData');
const clinicianMocks = () => import('../dev/mockClinicians');
const messagingMocks = () => import('../dev/mockMessaging');

function summaryQuery(days: WindowDays, end?: string): string {
  const q = new URLSearchParams({ days: String(days) });
  if (end) q.set('end', end);
  return q.toString();
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  if (USE_MOCKS) {
    const m = await mocks();
    return { ok: true, patients: m.mockPatientList.patients.length, today: m.MOCK_TODAY };
  }
  return getJson<HealthResponse>('/api/health', signal);
}

export async function fetchTrackers(signal?: AbortSignal): Promise<TrackerDefinition[]> {
  if (USE_MOCKS) return (await mocks()).mockTrackers;
  return getJson<TrackerDefinition[]>('/api/trackers', signal);
}

export async function fetchPatients(signal?: AbortSignal): Promise<PatientListResponse> {
  if (USE_MOCKS) return (await mocks()).mockPatientList;
  return getJson<PatientListResponse>('/api/patients', signal);
}

export async function fetchPatientSummary(
  id: string,
  days: WindowDays,
  signal?: AbortSignal,
  end?: string,
): Promise<PatientSummary> {
  if (USE_MOCKS) {
    const m = await mocks();
    const s = m.getMockSummary(id, days);
    if (!s) throw new ApiRequestError('Patient not found', 404);
    return s;
  }
  return getJson<PatientSummary>(`/api/patients/${encodeURIComponent(id)}/summary?${summaryQuery(days, end)}`, signal);
}

export async function fetchPatientRaw(id: string, signal?: AbortSignal): Promise<RawPatientDocument> {
  return getJson<RawPatientDocument>(`/api/patients/${encodeURIComponent(id)}/raw`, signal);
}

/** URL for the per-day CSV export (used as a download link). */
export function exportCsvUrl(id: string, days: WindowDays, end?: string): string {
  return `/api/patients/${encodeURIComponent(id)}/export.csv?${summaryQuery(days, end)}`;
}

/** URL for the Synthea-style FHIR R4 Bundle (EHR background + home-monitoring data). */
export function fhirBundleUrl(id: string): string {
  return `/api/patients/${encodeURIComponent(id)}/fhir`;
}

export async function fetchClinicians(signal?: AbortSignal): Promise<ClinicianProfile[]> {
  if (USE_MOCKS) return (await clinicianMocks()).mockClinicians;
  return getJson<ClinicianProfile[]>('/api/clinicians', signal);
}

export async function fetchClinicianPrefs(clinicianId: string, signal?: AbortSignal): Promise<ClinicianPreferences> {
  if (USE_MOCKS) {
    const p = (await clinicianMocks()).getMockPreferences(clinicianId);
    if (!p) throw new ApiRequestError('Clinician not found', 404);
    return p;
  }
  return getJson<ClinicianPreferences>(`/api/clinicians/${encodeURIComponent(clinicianId)}/preferences`, signal);
}

export async function saveClinicianPrefs(clinicianId: string, prefs: ClinicianPreferences): Promise<ClinicianPreferences> {
  if (USE_MOCKS) {
    const p = (await clinicianMocks()).putMockPreferences(clinicianId, prefs);
    if (!p) throw new ApiRequestError('Clinician not found', 404);
    return p;
  }
  let res: Response;
  try {
    res = await fetch(`/api/clinicians/${encodeURIComponent(clinicianId)}/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(prefs),
    });
  } catch {
    throw new ApiRequestError('Could not reach the SMART@Home server to save your preferences.', 0);
  }
  if (!res.ok) {
    let message = `Saving preferences failed (${res.status})`;
    try {
      const body = (await res.json()) as Partial<ApiError>;
      if (typeof body?.error === 'string') message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiRequestError(message, res.status);
  }
  return (await res.json()) as ClinicianPreferences;
}

async function sendJson<T>(path: string, method: 'POST' | 'PUT', body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiRequestError('Could not reach the SMART@Home server.', 0);
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const b = (await res.json()) as Partial<ApiError>;
      if (typeof b?.error === 'string') message = b.error;
    } catch {
      /* ignore */
    }
    throw new ApiRequestError(message, res.status);
  }
  return (await res.json()) as T;
}

// ── Messaging, media, realtime ──

export async function fetchInbox(clinicianId: string, signal?: AbortSignal): Promise<InboxItem[]> {
  if (USE_MOCKS) return (await messagingMocks()).mockInbox(clinicianId);
  return getJson<InboxItem[]>(`/api/clinicians/${encodeURIComponent(clinicianId)}/inbox`, signal);
}

export async function fetchConversation(conversationId: string, signal?: AbortSignal): Promise<Conversation> {
  if (USE_MOCKS) {
    const c = (await messagingMocks()).mockConversation(conversationId);
    if (!c) throw new ApiRequestError('Conversation not found', 404);
    return c;
  }
  return getJson<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}`, signal);
}

export async function sendClinicianMessage(conversationId: string, body: ClinicianMessageRequest): Promise<Conversation> {
  if (USE_MOCKS) return (await messagingMocks()).mockSendMessage(conversationId, body);
  return sendJson<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, 'POST', body);
}

export async function claimConversation(conversationId: string, clinicianId: string): Promise<Conversation> {
  if (USE_MOCKS) return (await messagingMocks()).mockClaim(conversationId, clinicianId);
  return sendJson<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}/claim`, 'POST', { clinicianId });
}

export async function closeConversation(conversationId: string, clinicianId: string): Promise<Conversation> {
  if (USE_MOCKS) return (await messagingMocks()).mockClose(conversationId, clinicianId);
  return sendJson<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}/close`, 'POST', { by: clinicianId });
}

export async function markConversationRead(conversationId: string, clinicianId: string): Promise<Conversation> {
  if (USE_MOCKS) return (await messagingMocks()).mockRead(conversationId, clinicianId);
  return sendJson<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}/read`, 'POST', { reader: clinicianId });
}

export async function fetchPatientMedia(patientId: string, days: WindowDays, signal?: AbortSignal): Promise<MediaItem[]> {
  if (USE_MOCKS) return (await messagingMocks()).mockMedia(patientId, days);
  return getJson<MediaItem[]>(`/api/patients/${encodeURIComponent(patientId)}/media?days=${days}`, signal);
}

const REALTIME_TYPES: RealtimeEvent['type'][] = ['conversation.updated', 'conversation.escalated', 'message.created', 'media.created', 'checkin.created'];

/**
 * Subscribe to server-sent events for a clinician. Handles both unnamed `message` events and
 * events named by type. Returns an unsubscribe function.
 */
export function subscribeRealtime(
  clinicianId: string,
  onEvent: (e: RealtimeEvent) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  if (USE_MOCKS) {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    void messagingMocks().then((m) => {
      if (cancelled) return;
      unsub = m.mockSubscribe(clinicianId, onEvent);
      onStatus?.(true);
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }
  if (typeof EventSource === 'undefined') {
    onStatus?.(false);
    return () => {};
  }
  const es = new EventSource(`/api/events?clinicianId=${encodeURIComponent(clinicianId)}`);
  const handle = (ev: MessageEvent) => {
    try {
      const data = JSON.parse(String(ev.data)) as RealtimeEvent;
      if (data && typeof data.type === 'string') onEvent(data);
    } catch {
      /* heartbeat or malformed */
    }
  };
  es.onmessage = handle;
  for (const t of REALTIME_TYPES) es.addEventListener(t, handle as EventListener);
  es.onopen = () => onStatus?.(true);
  es.onerror = () => onStatus?.(false);
  return () => es.close();
}
