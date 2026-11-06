/**
 * Typed client for the patient-app endpoints (contract: shared/types/api.ts, "Patient app").
 * When VITE_USE_MOCKS === 'true' every call is answered by src/dev/mock.ts instead of fetch.
 */
import type {
  AiStatus,
  ClinicianProfile,
  Conversation,
  MediaItem,
  PatientMessageRequest,
  VoiceParseRequest,
  VoiceParseResult,
  CreateMedicationDoseRequest,
  CreateSpirometrySessionRequest,
  CreateTrackerResponseRequest,
  PatientAppHome,
  PatientListResponse,
  WriteResult,
} from '@shared/types/api';
import type {
  RawBaselineReading,
  RawMedicationAdministration,
  RawPatientDocument,
  RawTrackerResponse,
} from '@shared/types/raw';
import { ApiError, OFFLINE_MESSAGE, messageForStatus } from './lib/errors';

export { ApiError } from './lib/errors';

export type HttpMethod = 'GET' | 'POST' | 'DELETE';

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true';

async function request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
  if (USE_MOCKS) {
    const { mockRequest } = await import('./dev/mock');
    return mockRequest<T>(method, path, body);
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(OFFLINE_MESSAGE, 0, true);
  }
  let data: unknown = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : messageForStatus(res.status);
    throw new ApiError(err, res.status);
  }
  return data as T;
}

const p = (id: string) => `/api/patients/${encodeURIComponent(id)}`;
const c = (id: string) => `/api/conversations/${encodeURIComponent(id)}`;

export const api = {
  listPatients: () => request<PatientListResponse>('GET', '/api/patients'),
  getHome: (id: string) => request<PatientAppHome>('GET', `${p(id)}/app/home`),
  /** Used only for the 7-day medicine history (best effort). */
  getRaw: (id: string) => request<RawPatientDocument>('GET', `${p(id)}/raw`),
  submitCheckIn: (id: string, body: CreateTrackerResponseRequest) =>
    request<WriteResult<RawTrackerResponse>>('POST', `${p(id)}/tracker-responses`, body),
  markDose: (id: string, body: CreateMedicationDoseRequest) =>
    request<WriteResult<RawMedicationAdministration>>('POST', `${p(id)}/medication-administrations`, body),
  saveSpirometry: (id: string, body: CreateSpirometrySessionRequest) =>
    request<WriteResult<RawBaselineReading[]>>('POST', `${p(id)}/spirometry-sessions`, body),

  // ── AI, voice, media, chat ──
  aiStatus: () => request<AiStatus>('GET', '/api/ai/status'),
  parseVoice: (id: string, body: VoiceParseRequest) => request<VoiceParseResult>('POST', `${p(id)}/voice-checkin/parse`, body),
  listMedia: (id: string) => request<MediaItem[]>('GET', `${p(id)}/media`),
  deleteMedia: (id: string, mediaId: string) =>
    request<{ ok: true }>('DELETE', `${p(id)}/media/${encodeURIComponent(mediaId)}`),
  listConversations: (id: string) => request<Conversation[]>('GET', `${p(id)}/conversations`),
  startConversation: (id: string, body: PatientMessageRequest) => request<Conversation>('POST', `${p(id)}/conversations`, body),
  getConversation: (cid: string) => request<Conversation>('GET', c(cid)),
  sendMessage: (cid: string, body: PatientMessageRequest) => request<Conversation>('POST', `${c(cid)}/messages`, body),
  escalate: (cid: string, reason?: string) => request<Conversation>('POST', `${c(cid)}/escalate`, reason ? { reason } : {}),
  markRead: (cid: string) => request<Conversation>('POST', `${c(cid)}/read`, { reader: 'patient' }),
  listClinicians: () => request<ClinicianProfile[]>('GET', '/api/clinicians'),
};
