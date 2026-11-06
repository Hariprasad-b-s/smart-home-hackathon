/**
 * Conversation ⇄ FHIR R4 (Synthea style: urn:uuid fullUrls, subject = the patient's Synthea id).
 *
 *   conversation  → Basic (code chat-conversation: status, topic, unread counters)
 *   each message  → Communication (partOf → the Basic; sender/recipient Patient | Practitioner | Device)
 *   escalation    → Task (requested → in-progress → completed; priority routine | urgent | asap)
 *   AI helper     → Device "SMART@Home helper (AI)";  demo clinicians → Practitioner
 *
 * The mapping is lossless: fhirToConversation(conversationToFhir(c)) deep-equals c.
 */
import type { ChatMessage, Conversation, ConversationStatus, EscalationUrgency, SafetyNotice } from '../../shared/types/api';
import { CLINICIANS } from '../data/clinicians';
import { BASE, stableUuid, urn, type FhirResource } from '../fhir/constants';

const ext = (name: string) => `${BASE}/StructureDefinition/chat-${name}`;
export const CHAT_EXT = {
  patientAppId: ext('patient-app-id'),
  status: ext('status'),
  topic: ext('topic'),
  createdAt: ext('created-at'),
  updatedAt: ext('updated-at'),
  unreadForPatient: ext('unread-for-patient'),
  unreadForClinician: ext('unread-for-clinician'),
  conversationId: ext('conversation-id'),
  authorType: ext('author-type'),
  authorName: ext('author-name'),
  clinicianId: ext('clinician-id'),
  safety: ext('safety'),
  suggestedAction: ext('suggested-action'),
  mediaId: ext('media-id'),
  urgency: ext('escalation-urgency'),
  requestedBy: ext('escalation-requested-by'),
  notifiedClinician: ext('escalation-notified-clinician'),
  claimedAt: ext('escalation-claimed-at'),
} as const;

export const AI_DEVICE_ID = stableUuid('smart-home', 'ai-helper-device');
export const practitionerId = (clinicianId: string) => stableUuid('smart-home', 'practitioner', clinicianId);
export const taskId = (conversationId: string) => stableUuid('smart-home', 'chat-task', conversationId);
const AI_NAME = 'SMART@Home helper (AI)';

export function aiDeviceResource(): FhirResource {
  return {
    resourceType: 'Device',
    id: AI_DEVICE_ID,
    identifier: [{ system: `${BASE}/sid/device`, value: 'smart-home-ai-helper' }],
    status: 'active',
    manufacturer: 'SMART@Home (demo)',
    deviceName: [{ name: AI_NAME, type: 'user-friendly-name' }],
    type: { text: 'AI chat assistant (demo on synthetic data; not medical advice)' },
  };
}

export function practitionerResource(clinicianId: string): FhirResource {
  const c = CLINICIANS.find((x) => x.id === clinicianId);
  return {
    resourceType: 'Practitioner',
    id: practitionerId(clinicianId),
    identifier: [{ system: `${BASE}/sid/demo-clinician`, value: clinicianId }],
    active: true,
    name: [{ text: c?.displayName ?? clinicianId }],
    ...(c ? { qualification: [{ code: { text: c.role } }] } : {}),
  };
}

const TASK_STATUS: Record<ConversationStatus, string> = { ai: 'requested', waiting: 'requested', clinician: 'in-progress', closed: 'completed' };
const PRIORITY: Record<EscalationUrgency, string> = { routine: 'routine', soon: 'urgent', urgent: 'asap' };

type Ext = { url: string; [k: string]: unknown };

function senderRef(m: ChatMessage, patientRef: { reference: string; display: string }) {
  if (m.author === 'patient') return patientRef;
  if (m.author === 'ai') return { reference: urn(AI_DEVICE_ID), display: AI_NAME };
  if (m.author === 'clinician' && m.clinicianId) return { reference: urn(practitionerId(m.clinicianId)), display: m.authorName };
  return undefined; // system notices come from the app itself
}

/** All FHIR resources for one conversation (Basic, Communications, Task). */
export function conversationToFhir(c: Conversation, patientFhirId: string): FhirResource[] {
  const patientRef = { reference: urn(patientFhirId), display: c.patientName };
  const convRef = { reference: urn(c.id), display: `Chat: ${c.topic}` };
  const basic: FhirResource = {
    resourceType: 'Basic',
    id: c.id,
    identifier: [{ system: `${BASE}/sid/conversation`, value: c.id }],
    code: { coding: [{ system: `${BASE}/CodeSystem/basic-type`, code: 'chat-conversation', display: 'SMART@Home chat conversation' }], text: 'Chat conversation' },
    subject: patientRef,
    created: c.createdAt.slice(0, 10),
    author: patientRef,
    extension: [
      { url: CHAT_EXT.patientAppId, valueString: c.patientId },
      { url: CHAT_EXT.status, valueCode: c.status },
      { url: CHAT_EXT.topic, valueString: c.topic },
      { url: CHAT_EXT.createdAt, valueDateTime: c.createdAt },
      { url: CHAT_EXT.updatedAt, valueDateTime: c.updatedAt },
      { url: CHAT_EXT.unreadForPatient, valueInteger: c.unreadForPatient },
      ...Object.entries(c.unreadForClinician).map(([id, n]) => ({
        url: CHAT_EXT.unreadForClinician,
        extension: [
          { url: 'clinicianId', valueString: id },
          { url: 'count', valueInteger: n },
        ],
      })),
    ],
  };
  const careTeamRefs = (c.escalation?.notifiedClinicianIds ?? []).map((id) => ({ reference: urn(practitionerId(id)), display: CLINICIANS.find((x) => x.id === id)?.displayName ?? id }));
  const comms = c.messages.map((m, i): FhirResource => {
    const extension: Ext[] = [
      { url: CHAT_EXT.conversationId, valueString: c.id },
      { url: CHAT_EXT.authorType, valueCode: m.author },
      { url: CHAT_EXT.authorName, valueString: m.authorName },
    ];
    if (m.clinicianId) extension.push({ url: CHAT_EXT.clinicianId, valueString: m.clinicianId });
    if (m.safety)
      extension.push({
        url: CHAT_EXT.safety,
        extension: [
          { url: 'level', valueCode: m.safety.level },
          { url: 'message', valueString: m.safety.message },
        ],
      });
    for (const a of m.suggestedActions ?? []) extension.push({ url: CHAT_EXT.suggestedAction, valueCode: a });
    for (const id of m.mediaIds ?? []) extension.push({ url: CHAT_EXT.mediaId, valueString: id });
    const sender = senderRef(m, patientRef);
    const recipient = m.author === 'patient' ? [{ reference: urn(AI_DEVICE_ID), display: AI_NAME }, ...careTeamRefs] : [patientRef];
    const res: FhirResource = {
      resourceType: 'Communication',
      id: m.id,
      identifier: [{ system: `${BASE}/sid/chat-message`, value: m.id }],
      partOf: [convRef],
      status: 'completed',
      subject: patientRef,
      topic: { text: c.topic },
      sent: m.createdAt,
      ...(sender ? { sender } : {}),
      recipient,
      payload: [{ contentString: m.text }],
      extension,
    };
    if (i > 0) res.inResponseTo = [{ reference: urn(c.messages[i - 1].id) }];
    return res;
  });
  const out = [basic, ...comms];
  const e = c.escalation;
  if (e) {
    const extension: Ext[] = [
      { url: CHAT_EXT.urgency, valueCode: e.urgency },
      { url: CHAT_EXT.requestedBy, valueCode: e.requestedBy },
      ...e.notifiedClinicianIds.map((id) => ({ url: CHAT_EXT.notifiedClinician, valueString: id })),
    ];
    if (e.claimedAt) extension.push({ url: CHAT_EXT.claimedAt, valueDateTime: e.claimedAt });
    out.push({
      resourceType: 'Task',
      id: taskId(c.id),
      identifier: [{ system: `${BASE}/sid/chat-escalation`, value: c.id }],
      status: TASK_STATUS[c.status],
      intent: 'order',
      priority: PRIORITY[e.urgency],
      code: { coding: [{ system: `${BASE}/CodeSystem/task-type`, code: 'chat-escalation', display: 'Reply to patient chat' }], text: 'Reply to patient chat' },
      description: e.reason,
      focus: convRef,
      for: patientRef,
      authoredOn: e.requestedAt,
      lastModified: c.updatedAt,
      requester: e.requestedBy === 'patient' ? patientRef : { reference: urn(AI_DEVICE_ID), display: AI_NAME },
      ...(e.claimedBy ? { owner: { reference: urn(practitionerId(e.claimedBy)), display: CLINICIANS.find((x) => x.id === e.claimedBy)?.displayName ?? e.claimedBy } } : {}),
      note: [{ text: e.summary }],
      extension,
    });
  }
  return out;
}

/** Resources referenced by conversations (AI Device + Practitioners), deduplicated. */
export function referencedResources(convs: Conversation[]): FhirResource[] {
  const ids = new Set<string>();
  for (const c of convs) {
    for (const m of c.messages) if (m.clinicianId) ids.add(m.clinicianId);
    for (const id of c.escalation?.notifiedClinicianIds ?? []) ids.add(id);
    if (c.escalation?.claimedBy) ids.add(c.escalation.claimedBy);
  }
  return convs.length ? [aiDeviceResource(), ...[...ids].sort().map(practitionerResource)] : [];
}

// ───────────────────────────────── FHIR → Conversation ─────────────────────────────────

const exts = (r: FhirResource, url: string): Ext[] => ((r.extension ?? []) as Ext[]).filter((e) => e.url === url);
const ext1 = (r: FhirResource, url: string): Ext | undefined => exts(r, url)[0];
const sub = (e: Ext, url: string): Ext | undefined => ((e.extension ?? []) as Ext[]).find((x) => x.url === url);

/** Rebuild a conversation from its resources. Throws when the Basic is missing. */
export function fhirToConversation(resources: FhirResource[]): { conversation: Conversation; patientFhirId: string } {
  const basic = resources.find((r) => r.resourceType === 'Basic' && r.code?.coding?.some((c: { code?: string }) => c.code === 'chat-conversation'));
  if (!basic) throw new Error('No chat-conversation Basic resource');
  const unreadForClinician: Record<string, number> = {};
  for (const e of exts(basic, CHAT_EXT.unreadForClinician)) {
    const id = sub(e, 'clinicianId')?.valueString as string | undefined;
    if (id) unreadForClinician[id] = Number(sub(e, 'count')?.valueInteger ?? 0);
  }
  const messages: ChatMessage[] = resources
    .filter((r) => r.resourceType === 'Communication' && r.partOf?.some((p: { reference?: string }) => p.reference === urn(basic.id)))
    .map((r) => {
      const m: ChatMessage = {
        id: r.id,
        conversationId: basic.id,
        author: ext1(r, CHAT_EXT.authorType)?.valueCode as ChatMessage['author'],
        authorName: (ext1(r, CHAT_EXT.authorName)?.valueString as string) ?? '',
        text: (r.payload?.[0]?.contentString as string) ?? '',
        createdAt: r.sent,
      };
      const clinicianId = ext1(r, CHAT_EXT.clinicianId)?.valueString as string | undefined;
      if (clinicianId) m.clinicianId = clinicianId;
      const mediaIds = exts(r, CHAT_EXT.mediaId).map((e) => e.valueString as string);
      if (mediaIds.length) m.mediaIds = mediaIds;
      const s = ext1(r, CHAT_EXT.safety);
      if (s) m.safety = { level: sub(s, 'level')?.valueCode as SafetyNotice['level'], message: sub(s, 'message')?.valueString as string };
      const actions = exts(r, CHAT_EXT.suggestedAction).map((e) => e.valueCode as NonNullable<ChatMessage['suggestedActions']>[number]);
      if (actions.length) m.suggestedActions = actions;
      return m;
    });
  // Key order mirrors how routes build conversations, so round trips deep-equal.
  const conversation: Conversation = {
    id: basic.id,
    patientId: ext1(basic, CHAT_EXT.patientAppId)?.valueString as string,
    patientName: basic.subject?.display ?? '',
    status: ext1(basic, CHAT_EXT.status)?.valueCode as ConversationStatus,
    createdAt: ext1(basic, CHAT_EXT.createdAt)?.valueDateTime as string,
    updatedAt: ext1(basic, CHAT_EXT.updatedAt)?.valueDateTime as string,
    topic: ext1(basic, CHAT_EXT.topic)?.valueString as string,
    messages,
    unreadForPatient: Number(ext1(basic, CHAT_EXT.unreadForPatient)?.valueInteger ?? 0),
    unreadForClinician,
  };
  const task = resources.find((r) => r.resourceType === 'Task' && r.focus?.reference === urn(basic.id));
  if (task) {
    const owner = task.owner?.reference as string | undefined;
    const claimedBy = owner ? CLINICIANS.find((c) => urn(practitionerId(c.id)) === owner)?.id : undefined;
    const escalation: NonNullable<Conversation['escalation']> = {
      reason: task.description ?? '',
      urgency: ext1(task, CHAT_EXT.urgency)?.valueCode as EscalationUrgency,
      summary: task.note?.[0]?.text ?? '',
      requestedAt: task.authoredOn,
      requestedBy: ext1(task, CHAT_EXT.requestedBy)?.valueCode as 'patient' | 'ai' | 'safety',
      notifiedClinicianIds: exts(task, CHAT_EXT.notifiedClinician).map((e) => e.valueString as string),
    };
    if (claimedBy) escalation.claimedBy = claimedBy;
    const claimedAt = ext1(task, CHAT_EXT.claimedAt)?.valueDateTime as string | undefined;
    if (claimedAt) escalation.claimedAt = claimedAt;
    conversation.escalation = escalation;
  }
  const patientFhirId = String(basic.subject?.reference ?? '').replace(/^urn:uuid:/, '');
  return { conversation, patientFhirId };
}
