/**
 * DEV-ONLY (VITE_USE_MOCKS): voice parsing by keyword matching, in-memory media and a canned
 * chat helper with escalation + a simulated clinician reply. Imported only by dev/mock.ts.
 */
import type {
  AiStatus,
  ChatMessage,
  ClinicianProfile,
  Conversation,
  MediaItem,
  RealtimeEvent,
  SafetyNotice,
  VoiceParseResult,
  VoiceParsedAnswer,
} from '@shared/types/api';
import type { TrackerDefinition, TrackerQuestion } from '@shared/types/tracker';
import { ApiError } from '../lib/errors';
import { localDay, localIso } from '../lib/time';

export const MOCK_AI_STATUS: AiStatus = {
  engine: 'rules',
  notice: 'Demo only: the helper uses made-up data and simple rules. It is not a doctor. Always follow your care team’s advice.',
};

export const MOCK_CLINICIANS: ClinicianProfile[] = [
  { id: 'demo-pulm', displayName: 'Dr. Alex Rivera', role: 'Pediatric pulmonologist', defaultView: 'pulmonology' },
  { id: 'demo-neuro', displayName: 'Dr. Priya Nair', role: 'Pediatric neurologist', defaultView: 'neurology' },
  { id: 'demo-nurse', displayName: 'Sam Okafor, RN', role: 'Nurse care coordinator', defaultView: 'all' },
];

// ── realtime ────────────────────────────────────────────────────────────────────
const subs = new Map<string, Set<(e: RealtimeEvent) => void>>();
export function mockSubscribe(patientId: string, cb: (e: RealtimeEvent | null) => void): () => void {
  const set = subs.get(patientId) ?? new Set();
  set.add(cb);
  subs.set(patientId, set);
  return () => void set.delete(cb);
}
function emit(e: RealtimeEvent) {
  subs.get(e.patientId)?.forEach((cb) => cb(e));
}

// ── safety screen ───────────────────────────────────────────────────────────────
export function safetyScreen(text: string): SafetyNotice | undefined {
  const t = text.toLowerCase();
  if (/(kill myself|hurt myself|suicid|end my life)/.test(t))
    return { level: 'emergency', message: 'You matter. Please talk to someone right now: call or text 988, or call 911 if you are in danger.' };
  if (/(can'?t breathe|cannot breathe|can'?t talk|lips (are |look )?(blue|grey|gray)|passing out)/.test(t))
    return { level: 'emergency', message: 'Use your rescue inhaler now and call 911. Tell an adult right away.' };
  if (/(really bad|much worse|getting worse|very short of breath)/.test(t))
    return { level: 'urgent', message: 'Follow the red or yellow zone of your action plan now. If it doesn’t get better, call your care team or 911.' };
  return undefined;
}

// ── voice parsing ───────────────────────────────────────────────────────────────
const NUM_WORDS: Record<string, number> = {
  zero: 0, none: 0, no: 0, once: 1, one: 1, twice: 2, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const sentences = (t: string) => t.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const findSentence = (t: string, re: RegExp) => sentences(t).find((s) => re.test(s.toLowerCase()));
const toNum = (w: string) => (/^\d+(\.\d+)?$/.test(w) ? Number(w) : NUM_WORDS[w]);

const SYNONYMS: Record<string, RegExp> = {
  coughing: /cough/,
  wheezing: /wheez/,
  'tight chest': /tight/,
  'shortness of breath': /short of breath|breathless|shortness of breath|hard to breathe/,
  'activity limitations': /couldn'?t (play|run|do)|sit out|stopped me/,
  'poor sleep': /poor sleep|didn'?t sleep|bad sleep/,
  'screen time': /screen|phone|computer|gaming/,
  'skipped meal': /skipped (a )?(meal|lunch|breakfast)/,
  'cold air': /cold air|cold outside/,
  'illness/cold': /a cold|sick|ill\b/,
};

function parseQuestion(q: TrackerQuestion, text: string): VoiceParsedAnswer {
  const lower = text.toLowerCase();
  const none: VoiceParsedAnswer = { questionId: q.id, value: null, confidence: 'low' };
  const yesNo = (pos: RegExp, neg: RegExp): VoiceParsedAnswer => {
    const n = findSentence(text, neg);
    if (n) return { questionId: q.id, value: 'false', confidence: 'high', evidence: n };
    const p = findSentence(text, pos);
    if (p) return { questionId: q.id, value: 'true', confidence: 'high', evidence: p };
    return none;
  };
  switch (q.role) {
    case 'nightWaking':
      return yesNo(/woke|wake up|waking/, /(didn'?t|did not|never) wake|slept (fine|well|through)|no waking/);
    case 'missedSchool':
      return yesNo(/missed school|stayed home|didn'?t go to school|skipped school/, /went to school|at school|didn'?t miss/);
    case 'headache':
      return yesNo(/headache|migraine|head hurt/, /no headache|didn'?t have a headache|head (was )?fine/);
    case 'bloodInStool':
      return yesNo(/blood/, /no blood|didn'?t see (any )?blood/);
    default:
      break;
  }
  if (q.type === 'faceScale' || q.type === 'iconChoice' || (q.type === 'singleChoice' && q.role === 'overallFeeling')) {
    const map: [RegExp, number][] = [
      [/awful|terrible|horrible|really bad/, 3],
      [/\bbad\b|not great|not good|sick|rough|crummy/, 2],
      [/\bok(ay)?\b|so-so|alright|fine-ish|meh/, 1],
      [/great|awesome|amazing|really good/, 0],
      [/\bgood\b|fine|well/, 0],
    ];
    for (const [re, sev] of map) {
      const sent = findSentence(text, re);
      if (!sent) continue;
      const opts = q.options ?? [];
      const word = sent.toLowerCase().match(re)?.[0] ?? '';
      const direct = opts.find((o) => o.label.toLowerCase() === word || o.value.toLowerCase() === word);
      const opt = direct ?? opts.find((o) => o.severity === sev);
      if (opt) return { questionId: q.id, value: opt.value, confidence: direct ? 'high' : 'medium', evidence: sent };
    }
    return none;
  }
  if (q.type === 'checkbox' || q.type === 'singleChoice') {
    const picked: string[] = [];
    let evidence: string | undefined;
    for (const o of q.options ?? []) {
      if (o.isNone) continue;
      const key = o.label.toLowerCase();
      const re = SYNONYMS[key] ?? SYNONYMS[o.value.trim().toLowerCase()] ?? new RegExp(key.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
      const sent = findSentence(text, re);
      if (sent) {
        picked.push(o.value);
        evidence ??= sent;
      }
    }
    if (q.type === 'singleChoice') return picked[0] ? { questionId: q.id, value: picked[0], confidence: 'medium', evidence } : none;
    if (picked.length) return { questionId: q.id, value: JSON.stringify(picked), confidence: 'high', evidence };
    const noneOpt = q.options?.find((o) => o.isNone);
    const neg = findSentence(text, q.role === 'triggers' ? /no idea what|no triggers|nothing set it off/ : /no symptoms|feel fine|nothing wrong|no cough/);
    if (noneOpt && neg) return { questionId: q.id, value: JSON.stringify([noneOpt.value]), confidence: 'medium', evidence: neg };
    return none;
  }
  if (q.type === 'scale1to10') {
    const m = lower.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(out of|\/)\s*(10|ten)/);
    if (m) return { questionId: q.id, value: String(toNum(m[1])), confidence: 'high', evidence: findSentence(text, /out of|\//) };
    return none;
  }
  if (q.type === 'number') {
    const cue: Record<string, RegExp> = {
      rescueMedUse: /(inhaler|puffer|albuterol|rescue)/,
      headacheDurationHours: /(lasted|for)\s/,
      sleepHours: /slept|sleep/,
      stoolFrequency: /(went|poop|bathroom|bowel)/,
    };
    const sent = q.role && cue[q.role] ? findSentence(text, cue[q.role]) : undefined;
    if (!sent) return none;
    const m = sent.toLowerCase().match(/\b(\d+(?:\.\d+)?|zero|none|once|twice|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(\s*(times?|hours?|hrs?))?/);
    if (m && toNum(m[1]) !== undefined) {
      const n = toNum(m[1])!;
      if ((q.min === undefined || n >= q.min) && (q.max === undefined || n <= q.max))
        return { questionId: q.id, value: String(n), confidence: m[2] ? 'high' : 'medium', evidence: sent };
    }
    if (q.role === 'rescueMedUse' && /didn'?t (use|need)/.test(sent.toLowerCase())) return { questionId: q.id, value: '0', confidence: 'medium', evidence: sent };
    return none;
  }
  if (q.type === 'text') {
    const sent = findSentence(text, /(also|and another thing|want (them|you) to know)/);
    return sent ? { questionId: q.id, value: sent, confidence: 'low', evidence: sent } : none;
  }
  return none; // spirometry is done with the device
}

export function mockParseVoice(tracker: TrackerDefinition, transcript: string): VoiceParseResult {
  const qs = [...tracker.questions].sort((a, b) => a.order - b.order);
  const answers = qs.map((q) => parseQuestion(q, transcript));
  const unanswered = answers.filter((a) => a.value === null).map((a) => a.questionId);
  const missing = qs.filter((q) => unanswered.includes(q.id) && q.type !== 'spirometry').map((q) => q.shortLabel.toLowerCase());
  return {
    trackerId: tracker.id,
    answers,
    unanswered,
    followUp: missing.length ? `Can you tell me about: ${missing.slice(0, 3).join(', ')}?` : undefined,
    safety: safetyScreen(transcript),
    engine: 'rules',
  };
}

// ── media ───────────────────────────────────────────────────────────────────────
const media = new Map<string, MediaItem[]>();
export function mockListMedia(patientId: string): MediaItem[] {
  return [...(media.get(patientId) ?? [])].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}
export function mockDeleteMedia(patientId: string, id: string) {
  const list = media.get(patientId) ?? [];
  if (!list.some((m) => m.id === id)) throw new ApiError('Not found', 404);
  media.set(patientId, list.filter((m) => m.id !== id));
  return { ok: true as const };
}
export async function mockUpload(url: string, file: File, onProgress?: (f: number) => void): Promise<MediaItem> {
  const u = new URL(url, 'http://mock');
  const patientId = decodeURIComponent(u.pathname.split('/')[3]);
  for (let i = 1; i <= 5; i++) {
    await new Promise((r) => setTimeout(r, 120));
    onProgress?.(i / 5);
  }
  const takenAt = u.searchParams.get('takenAt') ?? localIso();
  const item: MediaItem = {
    id: `media-${Date.now().toString(36)}`,
    patientId,
    kind: (u.searchParams.get('kind') as 'photo' | 'video') ?? 'photo',
    contentType: file.type,
    sizeBytes: file.size,
    caption: u.searchParams.get('caption') ?? undefined,
    takenAt,
    uploadedAt: new Date().toISOString(),
    date: takenAt.slice(0, 10) || localDay(),
    url: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '',
    conversationId: u.searchParams.get('conversationId') ?? undefined,
    trackerResponseId: u.searchParams.get('trackerResponseId') ?? undefined,
  };
  media.set(patientId, [item, ...(media.get(patientId) ?? [])]);
  emit({ type: 'media.created', patientId, media: item });
  return item;
}

// ── chat ────────────────────────────────────────────────────────────────────────
const convs = new Map<string, Conversation>();
let seq = 0;
const nowIso = () => localIso();
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`;

function msg(c: Conversation, m: Omit<ChatMessage, 'id' | 'conversationId' | 'createdAt'>): ChatMessage {
  const full: ChatMessage = { ...m, id: nextId('msg'), conversationId: c.id, createdAt: nowIso() };
  c.messages.push(full);
  c.updatedAt = full.createdAt;
  return full;
}

function aiReply(c: Conversation, text: string) {
  const t = text.toLowerCase();
  const safety = safetyScreen(text);
  if (safety) {
    msg(c, { author: 'ai', authorName: 'SMART@Home helper (AI)', text: 'This sounds serious. Please get help now.', safety });
    escalateConv(c, safety.level === 'emergency' ? 'urgent' : 'soon', 'safety', text);
    return;
  }
  if (/talk to|worse|a person|human|nurse|doctor/.test(t)) {
    msg(c, { author: 'ai', authorName: 'SMART@Home helper (AI)', text: "I'll ask your care team to join this chat. While you wait, follow your action plan." });
    escalateConv(c, /worse/.test(t) ? 'soon' : 'routine', 'ai', text);
    return;
  }
  if (/breathing test|spirometer|blow/.test(t)) {
    msg(c, {
      author: 'ai',
      authorName: 'SMART@Home helper (AI)',
      text: 'Stand up, breathe in as deep as you can, seal your lips on the mouthpiece, then blast out hard and keep going until you are empty. The app coaches you through 3 blows.',
      suggestedActions: ['breathing_test'],
    });
    return;
  }
  if (/medicine|inhaler|dose|pill/.test(t)) {
    msg(c, {
      author: 'ai',
      authorName: 'SMART@Home helper (AI)',
      text: "I can help with how to use the app, but I can't change your medicines. Your medicine list and reminders are in Medicines. For questions about doses, your care team can help.",
      suggestedActions: ['medicines', 'talk_to_care_team'],
    });
    return;
  }
  msg(c, {
    author: 'ai',
    authorName: 'SMART@Home helper (AI)',
    text: 'Thanks for asking. A quick check-in helps your care team see how you are doing. If you want a person to answer, tap "Talk to my care team".',
    suggestedActions: ['check_in', 'talk_to_care_team'],
  });
}

function escalateConv(c: Conversation, urgency: 'routine' | 'soon' | 'urgent', by: 'patient' | 'ai' | 'safety', reason: string) {
  if (c.status !== 'ai') return;
  c.status = 'waiting';
  c.escalation = {
    reason,
    urgency,
    summary: `Patient asked: "${c.messages.find((m) => m.author === 'patient')?.text ?? reason}"`,
    requestedAt: nowIso(),
    requestedBy: by,
    notifiedClinicianIds: ['demo-pulm', 'demo-nurse'],
  };
  msg(c, { author: 'system', authorName: 'SMART@Home', text: 'Your care team has been asked to join. They will reply here.' });
  emit({ type: 'conversation.escalated', conversationId: c.id, patientId: c.patientId, patientName: c.patientName, urgency, topic: c.topic });
  setTimeout(() => {
    if (c.status !== 'waiting') return;
    c.status = 'clinician';
    c.escalation!.claimedBy = 'demo-nurse';
    c.escalation!.claimedAt = nowIso();
    const m = msg(c, {
      author: 'clinician',
      authorName: 'Sam Okafor, RN',
      clinicianId: 'demo-nurse',
      text: "Hi, it's Sam from your care team. I read your messages. How are you feeling right now?",
    });
    c.unreadForPatient += 1;
    emit({ type: 'message.created', conversationId: c.id, patientId: c.patientId, message: m });
  }, 4000);
}

const clone = <T,>(x: T): T => structuredClone(x);

export function mockListConversations(patientId: string): Conversation[] {
  return [...convs.values()].filter((c) => c.patientId === patientId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(clone);
}

export function mockStartConversation(patientId: string, patientName: string, text: string, mediaIds?: string[]): Conversation {
  if (!text?.trim()) throw new ApiError('Message text is required', 400);
  const c: Conversation = {
    id: nextId('conv'),
    patientId,
    patientName,
    status: 'ai',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    topic: text.trim().slice(0, 40),
    messages: [],
    unreadForPatient: 0,
    unreadForClinician: {},
  };
  convs.set(c.id, c);
  msg(c, { author: 'patient', authorName: patientName, text: text.trim(), mediaIds });
  aiReply(c, text);
  return clone(c);
}

export function mockConversationRoute(method: string, rest: string, body: unknown): Conversation {
  const [cid, action] = rest.split('/');
  const c = convs.get(decodeURIComponent(cid));
  if (!c) throw new ApiError('Conversation not found', 404);
  const b = (body ?? {}) as { text?: string; mediaIds?: string[]; reason?: string };
  if (method === 'GET' && !action) return clone(c);
  if (method === 'POST' && action === 'messages') {
    if (!b.text?.trim()) throw new ApiError('Message text is required', 400);
    msg(c, { author: 'patient', authorName: c.patientName, text: b.text.trim(), mediaIds: b.mediaIds });
    if (c.status === 'ai') aiReply(c, b.text);
    return clone(c);
  }
  if (method === 'POST' && action === 'escalate') {
    escalateConv(c, 'routine', 'patient', b.reason ?? 'Patient asked for their care team');
    return clone(c);
  }
  if (method === 'POST' && action === 'read') {
    c.unreadForPatient = 0;
    return clone(c);
  }
  if (method === 'POST' && action === 'close') {
    c.status = 'closed';
    return clone(c);
  }
  throw new ApiError(`Mock has no route for ${method} conversations/${action}`, 404);
}
