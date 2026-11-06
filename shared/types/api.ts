/**
 * HTTP API — CONTRACT. Server listens on :8787; Vite proxies /api in dev.
 *
 * GET  /api/health                                   -> { ok: true, patients: number, today: ISODate }
 * GET  /api/trackers                                 -> TrackerDefinition[]
 * GET  /api/patients                                 -> PatientListResponse
 * GET  /api/patients/:id/summary?days=30|90|all&end=YYYY-MM-DD
 *                                                    -> PatientSummary  (404 ApiError if unknown id, 400 on bad params)
 * GET  /api/patients/:id/raw                         -> RawPatientDocument (synthetic data only)
 * GET  /api/patients/:id/export.csv?days=&end=       -> text/csv, one row per day (see analytics summaryToCsv)
 *
 *
 * ── Patient app (writes) — see "Patient app" section below ──
 * GET  /api/patients/:id/app/home                    -> PatientAppHome
 * POST /api/patients/:id/tracker-responses           body CreateTrackerResponseRequest       -> 201 WriteResult<RawTrackerResponse>
 * POST /api/patients/:id/medication-administrations  body CreateMedicationDoseRequest        -> 201 WriteResult<RawMedicationAdministration>
 * POST /api/patients/:id/spirometry-sessions         body CreateSpirometrySessionRequest     -> 201 WriteResult<RawBaselineReading[]>
 * POST /api/demo/reset                               -> { ok: true }  (drops all patient-app entries, regenerates synthetic data)
 * GET  /api/patients/:id/fhir                        -> FHIR R4 Bundle (type "collection", Synthea style):
 *                                                       Synthea EHR background + all home-monitoring data
 * GET  /api/fhir/Questionnaire                       -> FHIR R4 Bundle of Questionnaire resources (one per tracker)
 *
 * Storage of patient-app writes: each write is converted to FHIR R4 resources in Synthea's
 * format (urn:uuid fullUrls, US Core profiles, LOINC/RxNorm codings, subject = the patient's
 * Synthea Patient id) and appended to server/data/runtime/fhir/<patientId>.json (gitignored):
 *   check-in  -> QuestionnaireResponse      dose -> MedicationAdministration
 *   blow      -> Observation (spirometry)   device -> Device (Spirobank)
 * That FHIR store is the source of truth for patient-entered data; server/fhir maps it back
 * into the raw document (fhirToRaw) so the clinician summary reads it unchanged.
 * 400 ApiError on validation failure.
 *
 *
 * ── AI, voice, media, chat ──
 * GET  /api/ai/status                                -> AiStatus
 * POST /api/patients/:id/voice-checkin/parse         body VoiceParseRequest -> VoiceParseResult
 *      (does NOT save; the patient reviews, then submits via POST tracker-responses with entryMode 'voice')
 * POST /api/patients/:id/media?kind=photo|video&caption=&takenAt=&trackerResponseId=&conversationId=
 *      raw body (Content-Type image/jpeg|png|webp|heic|heif, video/mp4|quicktime|webm), photo ≤ 15 MB,
 *      video ≤ 100 MB                                -> 201 MediaItem   (400 bad type/size)
 * GET  /api/patients/:id/media?days=                 -> MediaItem[] newest first
 * GET  /api/media/:mediaId/content                   -> the file (supports HTTP Range for video)
 * DELETE /api/patients/:id/media/:mediaId            -> { ok: true }   (patient removes their upload)
 * GET  /api/patients/:id/conversations               -> Conversation[] newest first
 * POST /api/patients/:id/conversations               body PatientMessageRequest -> Conversation (with the AI reply)
 * GET  /api/conversations/:conversationId            -> Conversation
 * POST /api/conversations/:conversationId/messages   body PatientMessageRequest | ClinicianMessageRequest -> Conversation
 * POST /api/conversations/:conversationId/escalate   body { reason?: string } -> Conversation (patient asks for a human)
 * POST /api/conversations/:conversationId/claim      body { clinicianId } -> Conversation
 * POST /api/conversations/:conversationId/close      body { by: 'patient' | clinicianId } -> Conversation
 * POST /api/conversations/:conversationId/read       body { reader: 'patient' | clinicianId } -> Conversation
 * GET  /api/clinicians/:clinicianId/inbox            -> InboxItem[] (escalated conversations for this clinician's patients)
 * GET  /api/events?patientId=… | ?clinicianId=…      -> text/event-stream of RealtimeEvent (SSE; heartbeat every 25 s)
 * Chat messages, escalations and media are also stored as FHIR R4 (Communication, Media) in the
 * patient's Synthea-style bundle.
 *
 * ── Clinician preferences ──
 * GET  /api/clinicians                               -> ClinicianProfile[]  (demo clinicians; no real auth)
 * GET  /api/clinicians/:clinicianId/preferences      -> ClinicianPreferences (defaults when none saved)
 * PUT  /api/clinicians/:clinicianId/preferences      body ClinicianPreferences -> ClinicianPreferences
 *      Persisted in server/data/runtime/clinicians/<clinicianId>.json (gitignored). Applies to every
 *      patient the clinician opens. 400 on invalid body, 404 on unknown clinician.
 *
 * `days` accepts a positive integer (1–730) or "all". Default 30.
 * `end` defaults to the server's "today" (env DEMO_TODAY or the real local date).
 */
import type {
  HHmm,
  ISODate,
  ISODateTime,
  RawBaselineReading,
  RawHowOften,
  RawQuestionResponse,
} from './raw';
import type { TrackerDefinition } from './tracker';
import type { HeadlineMetricId, PatientFacingPointKey, PatientListItem, TrackerRef, Zone } from './summary';

export interface PatientListResponse {
  today: ISODate;
  patients: PatientListItem[];
}

export interface ApiError {
  error: string;
}

export interface HealthResponse {
  ok: true;
  patients: number;
  today: ISODate;
}

// ───────────────────────────────── Patient app ────────────────────────────────────

/** A check-in submitted from the patient app. Values MUST be encoded like the real app:
 *  yesNo "true"/"false", numbers as decimal strings, choice types = option.value verbatim
 *  (keep stray whitespace such as "None of these "), checkbox = JSON.stringify(option values[]),
 *  spirometry = the baselineReadingDate of the linked blow or "". */
export interface CreateTrackerResponseRequest {
  trackerId: string;
  /** Local ISO timestamp with offset. Defaults to server "now" on `today`. */
  submittedAt?: ISODateTime;
  responses: RawQuestionResponse[];
  /** 'voice' when answers came from speak mode (extracted, then reviewed by the patient). */
  entryMode?: 'form' | 'voice';
  /** Speak mode: the (possibly edited) speech-to-text transcript, ≤ 4000 chars. */
  transcript?: string;
  /** Photos/videos attached to this check-in (ids of this patient's MediaItems, ≤ 10). */
  mediaIds?: string[];
}

export interface CreateMedicationDoseRequest {
  medicationId: string;
  /** Defaults to server today. */
  day?: ISODate;
  /** Defaults to server local now. */
  time?: HHmm;
  /** Defaults to 1. */
  quantity?: number;
}

/** Blows exactly as the Spirobank SDK would deliver them (PEF in L/s, programmer-style
 *  coaching messages, 5–6 decimals). The patient app's device simulator produces these. */
export interface CreateSpirometrySessionRequest {
  readings: RawBaselineReading[];
}

export interface WriteResult<T> {
  ok: true;
  created: T;
  /** Derived action-plan zone for today after this write (asthma patients only). The
   *  server also stores it in asthmaTreatmentPlan.status / statusUpdatedAt. */
  zoneToday?: Zone;
  /** Encouraging feedback for the patient, e.g. "Check-in saved — 6 days in a row!". */
  message: string;
  /** Badge newly earned by this write, if any. */
  newBadge?: { name: string; label: string };
}

export interface PatientAppMedication {
  id: string;
  name: string;
  icon?: string;
  howOften: RawHowOften;
  /** "2 puffs twice daily", "As needed". */
  regimen: string;
  condition?: string;
  kind: 'scheduled' | 'asNeeded';
  /** Scheduled reminder times for today (empty for as-needed / weekly not due today). */
  timesOfDay: HHmm[];
  dosesDueToday: number;
  dosesTakenToday: number;
  takenTimesToday: HHmm[];
}

export interface PatientAppHome {
  today: ISODate;
  patient: {
    id: string;
    firstName: string;
    displayName: string;
    initials: string;
    ageYears: number;
    conditions: TrackerRef[];
  };
  trackers: {
    definition: TrackerDefinition;
    submittedToday: number;
    lastSubmittedAt?: ISODateTime;
  }[];
  medications: PatientAppMedication[];
  /** Asthma patients only. Steps are generic action-plan guidance; the UI must say
   *  "Follow the plan your care team gave you". */
  actionPlan?: {
    zone?: Zone;
    asOf?: ISODateTime;
    personalBestPefLpm?: number;
    greenThresholdPct: number;
    redThresholdPct: number;
    expired: boolean;
    steps: Record<Zone, string[]>;
  };
  spirometer?: {
    deviceName: string; // "MIR Spirobank Smart"
    serialNumber: string;
    latest?: { date: ISODate; pefLpm: number; fev1L: number; pctPersonalBest?: number; zone?: Zone };
  };
  engagement: {
    currentStreak: number;
    longestStreak: number;
    badges: { name: string; label: string; date: ISODate }[];
  };
  /** Oldest → newest, 14 entries ending today. */
  last14Days: { date: ISODate; status: 'good' | 'hard' | 'none' }[];
}

// ───────────────────────────────── Clinician preferences ──────────────────────────

export interface ClinicianProfile {
  id: string; // "demo-pulm"
  displayName: string; // "Dr. Alex Rivera"
  role: string; // "Pediatric pulmonologist"
  /** Specialty view opened by default (client SpecialtyId). */
  defaultView: string;
}

/** A clinician's own arrangement of one specialty view's dashboard. */
export interface DashboardLayout {
  /** Dashboard sections in display order (client SectionId strings). Unknown ids are ignored;
   *  sections missing from the list are appended in preset order and visible. */
  sections: { id: string; visible: boolean; width: 'full' | 'half' }[];
  /** Headline (30-second strip) metrics in display order. Missing ids are appended visible. */
  headline: { id: HeadlineMetricId; visible: boolean }[];
}

/** What the patient sees in visit mode. Every flag defaults to true except where noted. */
export interface VisitModeVisibility {
  /** "You had N good days and M hard days" sentence. */
  headline: boolean;
  /** Good / hard / nothing-recorded count cards. */
  dayCounts: boolean;
  /** Large calendar. */
  calendar: boolean;
  /** Streaks and badges ("Things to be proud of"). */
  achievements: boolean;
  /** Individual talking points by key. */
  points: Record<PatientFacingPointKey, boolean>;
}

export interface ClinicianPreferences {
  clinicianId: string;
  updatedAt?: string;
  /** Keyed by specialty view id ('all', 'pulmonology', …). Absent = use the preset. */
  layouts: Record<string, DashboardLayout>;
  visitMode: VisitModeVisibility;
}

// ───────────────────────────────── AI status ──────────────────────────────────────

export interface AiStatus {
  /** 'claude' when Anthropic credentials are configured, else the deterministic rule engine. */
  engine: 'claude' | 'rules';
  model?: string; // "claude-opus-5-5"
  /** Shown in both apps: AI use is demo-only on synthetic data. */
  notice: string;
}

// ───────────────────────────────── Voice check-in ─────────────────────────────────

export interface VoiceParseRequest {
  trackerId: string;
  /** Speech-to-text transcript (browser Web Speech API), possibly edited by the patient. ≤ 4000 chars. */
  transcript: string;
}

export interface VoiceParsedAnswer {
  questionId: string;
  /** Encoded exactly like CreateTrackerResponseRequest values (see raw.ts), or null = not mentioned. */
  value: string | null;
  confidence: 'high' | 'medium' | 'low';
  /** Short quote from the transcript that supports the answer. */
  evidence?: string;
}

export interface VoiceParseResult {
  trackerId: string;
  /** One entry per tracker question, in question order. */
  answers: VoiceParsedAnswer[];
  /** Question ids still unanswered (value null). */
  unanswered: string[];
  /** A friendly follow-up the app can show/speak for missing info. */
  followUp?: string;
  /** Present when the transcript describes an emergency or urgent symptoms. */
  safety?: SafetyNotice;
  engine: 'claude' | 'rules';
}

export interface SafetyNotice {
  level: 'emergency' | 'urgent';
  /** Plain-language instruction, e.g. "Use your rescue inhaler now and call 911 if…". */
  message: string;
}

// ───────────────────────────────── Media evidence ─────────────────────────────────

export interface MediaItem {
  id: string;
  patientId: string;
  kind: 'photo' | 'video';
  contentType: string;
  sizeBytes: number;
  caption?: string;
  /** Local ISO with offset (when the photo/video was taken, else upload time). */
  takenAt: string;
  uploadedAt: string;
  /** Patient-local day of takenAt. */
  date: ISODate;
  /** GET URL for the content (relative, e.g. "/api/media/<id>/content"). */
  url: string;
  trackerResponseId?: string;
  conversationId?: string;
}

// ───────────────────────────────── Chat & escalation ──────────────────────────────

export type ConversationStatus =
  | 'ai' // AI helper is answering
  | 'waiting' // escalated, waiting for a clinician
  | 'clinician' // a clinician has joined
  | 'closed';

export type EscalationUrgency = 'routine' | 'soon' | 'urgent';

export interface ChatMessage {
  id: string;
  conversationId: string;
  author: 'patient' | 'ai' | 'clinician' | 'system';
  /** Display name, e.g. "SMART@Home helper (AI)", "Dr. Alex Rivera". */
  authorName: string;
  clinicianId?: string;
  text: string;
  createdAt: string;
  mediaIds?: string[];
  safety?: SafetyNotice;
  /** AI suggestions the patient app can render as buttons. */
  suggestedActions?: ('check_in' | 'breathing_test' | 'medicines' | 'talk_to_care_team')[];
}

export interface Conversation {
  id: string;
  patientId: string;
  patientName: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
  /** Short topic, e.g. "Inhaler side effects". */
  topic: string;
  escalation?: {
    reason: string;
    urgency: EscalationUrgency;
    /** AI- or rule-written summary for the clinician (what the patient asked, relevant context). */
    summary: string;
    requestedAt: string;
    requestedBy: 'patient' | 'ai' | 'safety';
    /** Clinicians notified (care team for the patient's conditions + nurse). */
    notifiedClinicianIds: string[];
    claimedBy?: string;
    claimedAt?: string;
  };
  messages: ChatMessage[];
  unreadForPatient: number;
  /** Unread messages per clinician id. */
  unreadForClinician: Record<string, number>;
}

export interface PatientMessageRequest {
  author: 'patient';
  text: string;
  mediaIds?: string[];
}

export interface ClinicianMessageRequest {
  author: 'clinician';
  clinicianId: string;
  text: string;
}

export interface InboxItem {
  conversationId: string;
  patientId: string;
  patientName: string;
  conditions: string[];
  status: ConversationStatus;
  urgency: EscalationUrgency;
  topic: string;
  summary: string;
  lastMessage: { author: ChatMessage['author']; text: string; createdAt: string };
  unread: number;
  requestedAt: string;
  claimedBy?: string;
}

export type RealtimeEvent =
  | { type: 'conversation.updated'; conversationId: string; patientId: string; status: ConversationStatus }
  | { type: 'conversation.escalated'; conversationId: string; patientId: string; patientName: string; urgency: EscalationUrgency; topic: string }
  | { type: 'message.created'; conversationId: string; patientId: string; message: ChatMessage }
  | { type: 'media.created'; patientId: string; media: MediaItem }
  | { type: 'checkin.created'; patientId: string };
