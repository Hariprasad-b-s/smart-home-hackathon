/**
 * DEV-ONLY mock chat / inbox / media / realtime layer (synthetic; VITE_USE_MOCKS === 'true').
 * Images are tiny inline SVG data URLs; a fake emitter stands in for the SSE stream and
 * raises one new escalation shortly after start so the bell and toasts can be seen.
 */
import type {
  ChatMessage,
  ClinicianMessageRequest,
  Conversation,
  EscalationUrgency,
  InboxItem,
  MediaItem,
  RealtimeEvent,
} from '@shared/types';
import { MOCK_TODAY } from './mockData';
import { mockClinicians } from './mockClinicians';

const svg = (bg: string, fg: string, label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="${bg}"/><circle cx="240" cy="160" r="70" fill="${fg}" opacity="0.55"/><text x="240" y="300" font-family="sans-serif" font-size="26" text-anchor="middle" fill="#1f2a44">${label}</text></svg>`,
  )}`;

const day = (offset: number) => {
  const d = new Date(MOCK_TODAY + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};
const at = (offset: number, hhmm: string) => `${day(offset)}T${hhmm}:00.000-05:00`;

const media: MediaItem[] = [
  { id: 'm-jr-1', patientId: 'demo-jordan', kind: 'photo', contentType: 'image/svg+xml', sizeBytes: 2048, caption: 'Rash on my arm after lunch', takenAt: at(0, '13:05'), uploadedAt: at(0, '13:06'), date: day(0), url: svg('#fbe6ef', '#d4246f', 'Photo: arm'), conversationId: 'c-jordan-1' },
  { id: 'm-jr-2', patientId: 'demo-jordan', kind: 'video', contentType: 'video/mp4', sizeBytes: 4_200_000, caption: 'How I use my inhaler', takenAt: at(3, '19:40'), uploadedAt: at(3, '19:42'), date: day(3), url: 'data:video/mp4;base64,', trackerResponseId: `demo-jordan-${day(3)}-asthma-final` },
  { id: 'm-jr-3', patientId: 'demo-jordan', kind: 'photo', contentType: 'image/svg+xml', sizeBytes: 1800, caption: 'Peak flow meter reading', takenAt: at(3, '08:15'), uploadedAt: at(3, '08:16'), date: day(3), url: svg('#e4eef7', '#1d5c8f', 'Photo: meter'), trackerResponseId: `demo-jordan-${day(3)}-asthma-final` },
  { id: 'm-jr-4', patientId: 'demo-jordan', kind: 'photo', contentType: 'image/svg+xml', sizeBytes: 1900, caption: 'Spacer I got from the pharmacy', takenAt: at(9, '17:20'), uploadedAt: at(9, '17:21'), date: day(9), url: svg('#dcf1e4', '#3fa66b', 'Photo: spacer') },
  { id: 'm-eb-1', patientId: 'demo-ethan', kind: 'photo', contentType: 'image/svg+xml', sizeBytes: 2100, caption: 'What I ate before the pain', takenAt: at(1, '12:30'), uploadedAt: at(1, '12:31'), date: day(1), url: svg('#fbf1cf', '#e6b325', 'Photo: lunch') },
];

const AI = 'SMART@Home helper (AI)';
const msg = (conversationId: string, i: number, author: ChatMessage['author'], authorName: string, text: string, createdAt: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `${conversationId}-m${i}`,
  conversationId,
  author,
  authorName,
  text,
  createdAt,
  ...extra,
});

function conv(
  id: string,
  patientId: string,
  patientName: string,
  topic: string,
  urgency: EscalationUrgency,
  status: Conversation['status'],
  requestedBy: 'patient' | 'ai' | 'safety',
  reason: string,
  summary: string,
  messages: ChatMessage[],
  extra: Partial<NonNullable<Conversation['escalation']>> = {},
): Conversation {
  const last = messages[messages.length - 1];
  return {
    id,
    patientId,
    patientName,
    status,
    createdAt: messages[0].createdAt,
    updatedAt: last.createdAt,
    topic,
    escalation: {
      reason,
      urgency,
      summary,
      requestedAt: messages.find((m) => m.author === 'system')?.createdAt ?? last.createdAt,
      requestedBy,
      notifiedClinicianIds: mockClinicians.map((c) => c.id),
      ...extra,
    },
    messages,
    unreadForPatient: 0,
    unreadForClinician: Object.fromEntries(mockClinicians.map((c) => [c.id, status === 'closed' ? 0 : 2])),
  };
}

const conversations: Conversation[] = [
  conv(
    'c-jordan-1',
    'demo-jordan',
    'Jordan Reyes',
    'Rash after lunch, chest feels tight',
    'urgent',
    'waiting',
    'safety',
    'Safety screen: new rash with chest tightness (possible allergic reaction)',
    'Jordan reports a new itchy rash on the arm about 30 min after lunch and a tight chest. Peak flow this morning was 68% of personal best (yellow zone). Has a peanut allergy on file and an epinephrine auto-injector. The AI gave the action-plan yellow-zone steps and advised calling the clinic now.',
    [
      msg('c-jordan-1', 1, 'patient', 'Jordan', 'I got a rash on my arm after lunch and my chest feels kind of tight', at(0, '13:04'), { mediaIds: ['m-jr-1'] }),
      msg('c-jordan-1', 2, 'ai', AI, 'Thanks for telling me, Jordan. A new rash together with a tight chest can be a sign of an allergic reaction, so I’m letting your care team know right now.', at(0, '13:05'), {
        safety: { level: 'urgent', message: 'If your lips or tongue swell, or breathing gets hard, use your epinephrine auto-injector and call 911.' },
      }),
      msg('c-jordan-1', 3, 'system', 'System', 'Conversation sent to the care team (urgent).', at(0, '13:05')),
      msg('c-jordan-1', 4, 'patient', 'Jordan', 'ok. it’s not getting worse right now', at(0, '13:09')),
    ],
  ),
  conv(
    'c-malik-1',
    'demo-malik',
    'Malik Johnson',
    'Using rescue inhaler a lot this week',
    'soon',
    'waiting',
    'ai',
    'Rescue inhaler used on 5 of the last 7 days',
    'Malik asked whether it is OK to use albuterol every day. Rescue use 5 of 7 days, two red-zone peak flows this week. The AI explained the action plan and suggested talking to the care team about controller medicine.',
    [
      msg('c-malik-1', 1, 'patient', 'Malik', 'is it bad that I use my blue inhaler every day', at(0, '10:12')),
      msg('c-malik-1', 2, 'ai', AI, 'Needing your rescue inhaler most days usually means your asthma needs a closer look. I can’t change your medicines, but I’ll ask your care team to follow up.', at(0, '10:12'), { suggestedActions: ['breathing_test', 'talk_to_care_team'] }),
      msg('c-malik-1', 3, 'system', 'System', 'Conversation sent to the care team (soon).', at(0, '10:13')),
    ],
  ),
  conv(
    'c-ethan-1',
    'demo-ethan',
    'Ethan Brooks',
    'Question about missing a dose',
    'routine',
    'clinician',
    'patient',
    'Patient asked to talk to the care team',
    'Ethan missed his evening mesalamine yesterday and asks whether to take two doses today. The AI did not advise on dosing and passed the question on.',
    [
      msg('c-ethan-1', 1, 'patient', 'Ethan', 'I forgot my pill last night, should I take 2 today?', at(1, '08:30')),
      msg('c-ethan-1', 2, 'ai', AI, 'I can’t give dosing advice, but your care team can. I’ve sent them your question.', at(1, '08:30')),
      msg('c-ethan-1', 3, 'system', 'System', 'Conversation sent to the care team (routine).', at(1, '08:31')),
      msg('c-ethan-1', 4, 'clinician', 'Sam Lee, RN', 'Hi Ethan, thanks for asking. Please don’t double up. Just take your normal dose today. I’ll check with Dr. Ellis too.', at(1, '09:02'), { clinicianId: 'demo-nurse' }),
    ],
    { claimedBy: 'demo-nurse', claimedAt: at(1, '09:00') },
  ),
  conv(
    'c-sofia-1',
    'demo-sofia',
    'Sofia Martinez',
    'New spacer instructions',
    'routine',
    'closed',
    'patient',
    'Patient asked to talk to the care team',
    'Sofia asked how to clean her new spacer. Answered by nurse.',
    [
      msg('c-sofia-1', 1, 'patient', 'Sofia', 'how do I clean my spacer?', at(6, '16:00')),
      msg('c-sofia-1', 2, 'system', 'System', 'Conversation sent to the care team (routine).', at(6, '16:01')),
      msg('c-sofia-1', 3, 'clinician', 'Sam Lee, RN', 'Warm soapy water once a week, let it air dry. Don’t towel it dry.', at(6, '16:40'), { clinicianId: 'demo-nurse' }),
    ],
    { claimedBy: 'demo-nurse', claimedAt: at(6, '16:35') },
  ),
];

const CONDITIONS: Record<string, string[]> = {
  'demo-jordan': ['Asthma', 'Migraine'],
  'demo-malik': ['Asthma'],
  'demo-ethan': ['IBD'],
  'demo-sofia': ['Asthma'],
};

const clone = <T,>(x: T): T => structuredClone(x);
const listeners = new Set<{ clinicianId: string; cb: (e: RealtimeEvent) => void }>();
const emit = (e: RealtimeEvent) => listeners.forEach((l) => l.cb(e));

export function mockInbox(clinicianId: string): InboxItem[] {
  return conversations
    .filter((c) => c.escalation)
    .map((c) => {
      const last = c.messages[c.messages.length - 1];
      return {
        conversationId: c.id,
        patientId: c.patientId,
        patientName: c.patientName,
        conditions: CONDITIONS[c.patientId] ?? [],
        status: c.status,
        urgency: c.escalation!.urgency,
        topic: c.topic,
        summary: c.escalation!.summary,
        lastMessage: { author: last.author, text: last.text, createdAt: last.createdAt },
        unread: c.unreadForClinician[clinicianId] ?? 0,
        requestedAt: c.escalation!.requestedAt,
        claimedBy: c.escalation!.claimedBy,
      };
    });
}

export function mockConversation(id: string): Conversation | undefined {
  const c = conversations.find((x) => x.id === id);
  return c ? clone(c) : undefined;
}

function get(id: string): Conversation {
  const c = conversations.find((x) => x.id === id);
  if (!c) throw new Error('Conversation not found');
  return c;
}

export function mockSendMessage(id: string, body: ClinicianMessageRequest): Conversation {
  const c = get(id);
  const name = mockClinicians.find((x) => x.id === body.clinicianId)?.displayName ?? 'Care team';
  const m = msg(id, c.messages.length + 1, 'clinician', name, body.text, new Date().toISOString(), { clinicianId: body.clinicianId });
  c.messages.push(m);
  c.updatedAt = m.createdAt;
  if (c.status === 'waiting') c.status = 'clinician';
  if (c.escalation && !c.escalation.claimedBy) c.escalation.claimedBy = body.clinicianId;
  c.unreadForPatient += 1;
  emit({ type: 'message.created', conversationId: id, patientId: c.patientId, message: m });
  return clone(c);
}

export function mockClaim(id: string, clinicianId: string): Conversation {
  const c = get(id);
  if (c.escalation) {
    c.escalation.claimedBy = clinicianId;
    c.escalation.claimedAt = new Date().toISOString();
  }
  if (c.status === 'waiting') c.status = 'clinician';
  emit({ type: 'conversation.updated', conversationId: id, patientId: c.patientId, status: c.status });
  return clone(c);
}

export function mockClose(id: string, clinicianId: string): Conversation {
  const c = get(id);
  c.status = 'closed';
  const name = mockClinicians.find((x) => x.id === clinicianId)?.displayName ?? 'Care team';
  c.messages.push(msg(id, c.messages.length + 1, 'system', 'System', `${name} closed the conversation.`, new Date().toISOString()));
  emit({ type: 'conversation.updated', conversationId: id, patientId: c.patientId, status: 'closed' });
  return clone(c);
}

export function mockRead(id: string, clinicianId: string): Conversation {
  const c = get(id);
  c.unreadForClinician[clinicianId] = 0;
  return clone(c);
}

export function mockMedia(patientId: string, days: number | 'all'): MediaItem[] {
  const cutoff = days === 'all' ? '0000-00-00' : day(days - 1);
  return media.filter((m) => m.patientId === patientId && m.date >= cutoff).sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

let demoTimer: ReturnType<typeof setTimeout> | null = null;

export function mockSubscribe(clinicianId: string, cb: (e: RealtimeEvent) => void): () => void {
  const entry = { clinicianId, cb };
  listeners.add(entry);
  if (!demoTimer && !conversations.some((c) => c.id === 'c-lily-1')) {
    demoTimer = setTimeout(() => {
      const c = conv(
        'c-lily-1',
        'demo-lily',
        'Lily Chen',
        'Woke up coughing twice last night',
        'soon',
        'waiting',
        'ai',
        'Night waking reported 2 nights in a row',
        'Lily woke twice last night coughing and asked if she should go to school. Peak flow not done today. The AI suggested a breathing test and passed the question on.',
        [
          msg('c-lily-1', 1, 'patient', 'Lily', 'I woke up coughing twice last night, should I still go to school?', new Date().toISOString()),
          msg('c-lily-1', 2, 'system', 'System', 'Conversation sent to the care team (soon).', new Date().toISOString()),
        ],
      );
      conversations.unshift(c);
      CONDITIONS['demo-lily'] = ['Asthma'];
      emit({ type: 'conversation.escalated', conversationId: c.id, patientId: c.patientId, patientName: c.patientName, urgency: 'soon', topic: c.topic });
    }, 15_000);
  }
  return () => {
    listeners.delete(entry);
  };
}
