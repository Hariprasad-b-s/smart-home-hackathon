/**
 * AI & Chat HTTP routes (see shared/types/api.ts → "AI, voice, media, chat"; media is separate):
 * AI status, voice check-in parse, conversations + escalation, clinician inbox, SSE events.
 *
 * Conversation lifecycle:
 *   ai ──(AI/rule escalation, safety screen, patient asks)──► waiting ──(clinician claims/replies)──► clinician
 *   any ──close──► closed
 * While 'ai', each patient message gets a helper reply in the same request (unless the safety screen
 * fires: then a system safety notice + urgent escalation, no model call). While waiting/clinician,
 * patient messages are relayed to the care team only (the safety screen still runs).
 */
import { localNow } from '../patientApp';
import { randomUUID } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import type {
  ApiError,
  ChatMessage,
  Conversation,
  EscalationUrgency,
  InboxItem,
  RealtimeEvent,
  SafetyNotice,
  VoiceParseResult,
} from '../../shared/types/api';
import type { RawPatientDocument } from '../../shared/types/raw';
import { AI_AUTHOR_NAME, replyToPatient, type ChatReply } from '../ai/chatAgent';
import { buildChatContext, clinicianContextLine } from '../ai/context';
import { createAiEngine, type AiEngine } from '../ai/engine';
import { safetyCheck } from '../ai/safety';
import { firstWords, truncate } from '../ai/text';
import { parseVoiceCheckin } from '../ai/voice';
import { careTeamFor, CLINICIANS } from '../data/clinicians';
import type { Store } from '../data/store';
import { fhirPatientId } from '../fhir/toFhir';
import type { RealtimeHub } from '../realtime/hub';
import { initChatStore, onChatReset, type ChatStore } from './store';

export interface ChatRouterOptions {
  /** Conversation folder; null disables persistence (default under Vitest). */
  chatDir?: string | null;
  /** AI engine (inject a fake client in tests). Default: built from env; never a real client under Vitest. */
  ai?: AiEngine;
  /** SSE heartbeat interval (ms). Default 25 000. */
  heartbeatMs?: number;
}

export const ESCALATED_NOTICE = "I've shared this chat with your care team. They'll reply here. If it gets worse, follow your action plan or call 911.";
const MAX_TEXT = 2000;
const MAX_MEDIA = 10;
const MAX_TRANSCRIPT = 4000;
const URGENCY_RANK: Record<EscalationUrgency, number> = { urgent: 0, soon: 1, routine: 2 };

const errorBody = (error: string): ApiError => ({ error });
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const clinicianById = (id: unknown) => (typeof id === 'string' ? CLINICIANS.find((c) => c.id === id) : undefined);
const patientName = (doc: RawPatientDocument) => `${doc.profile.firstName} ${doc.profile.lastName}`.trim();

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function validateText(text: unknown): string {
  if (typeof text !== 'string') throw new HttpError(400, '"text" must be a string.');
  const t = text.trim();
  if (!t) throw new HttpError(400, '"text" must not be empty.');
  if (t.length > MAX_TEXT) throw new HttpError(400, `"text" must be at most ${MAX_TEXT} characters.`);
  return t;
}

function validateMediaIds(ids: unknown): string[] | undefined {
  if (ids === undefined) return undefined;
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string' || !x.trim() || x.length > 128)) {
    throw new HttpError(400, '"mediaIds" must be an array of media id strings.');
  }
  if (ids.length > MAX_MEDIA) throw new HttpError(400, `"mediaIds" can hold at most ${MAX_MEDIA} ids.`);
  return ids.length ? [...new Set(ids as string[])] : undefined;
}

function parsePatientMessage(body: unknown): { text: string; mediaIds?: string[] } {
  if (!isObj(body)) throw new HttpError(400, 'Body must be a JSON object.');
  if (body.author !== undefined && body.author !== 'patient') throw new HttpError(400, '"author" must be "patient".');
  const text = validateText(body.text);
  const mediaIds = validateMediaIds(body.mediaIds);
  return mediaIds ? { text, mediaIds } : { text };
}

/** Collects what changed during one request so notifications go out once, at the end. */
interface Change {
  messages: ChatMessage[];
  escalated: boolean;
}

export function createChatRouter(store: Store, hub: RealtimeHub, opts: ChatRouterOptions = {}): express.Router {
  const chats: ChatStore = initChatStore(opts.chatDir);
  const ai: AiEngine = opts.ai ?? createAiEngine(process.env.VITEST ? { client: null } : {});
  onChatReset(() => ai.limiter.reset());
  const heartbeatMs = opts.heartbeatMs ?? 25_000;
  // Patient-local ISO with offset, like every other patient-generated timestamp (see raw.ts).
  const nowIso = () => localNow(store).ts;
  const router = express.Router();

  // ───────────────────────────── helpers ─────────────────────────────

  const docFor = (id: string) => {
    const doc = store.getPatient(id);
    if (!doc) throw new HttpError(404, `Unknown patient "${id}".`);
    return doc;
  };
  const convFor = (id: string) => {
    const c = chats.get(id);
    if (!c) throw new HttpError(404, `Unknown conversation "${id}".`);
    return c;
  };
  const audience = (c: Conversation): string[] =>
    c.escalation ? [...new Set([...c.escalation.notifiedClinicianIds, ...(c.escalation.claimedBy ? [c.escalation.claimedBy] : [])])] : [];

  function add(
    c: Conversation,
    change: Change,
    m: Omit<ChatMessage, 'id' | 'conversationId' | 'createdAt'>,
    opts: { seenByPatient?: boolean; seenByClinician?: string } = {},
  ): ChatMessage {
    const msg: ChatMessage = { id: randomUUID(), conversationId: c.id, createdAt: nowIso(), ...m };
    c.messages.push(msg);
    c.updatedAt = msg.createdAt;
    if (msg.author !== 'patient' && !opts.seenByPatient) c.unreadForPatient++;
    for (const id of audience(c)) {
      if (id === opts.seenByClinician || (msg.author === 'clinician' && msg.clinicianId === id)) continue;
      c.unreadForClinician[id] = (c.unreadForClinician[id] ?? 0) + 1;
    }
    change.messages.push(msg);
    return msg;
  }

  function system(c: Conversation, change: Change, text: string, extra: Partial<ChatMessage> = {}, seen: { seenByPatient?: boolean; seenByClinician?: string } = {}) {
    return add(c, change, { author: 'system', authorName: 'SMART@Home', text, ...extra }, seen);
  }

  function escalate(
    c: Conversation,
    doc: RawPatientDocument,
    change: Change,
    e: { reason: string; urgency: EscalationUrgency; summary: string; requestedBy: 'patient' | 'ai' | 'safety' },
    seenByPatient: boolean,
  ): void {
    if (c.escalation) {
      if (URGENCY_RANK[e.urgency] < URGENCY_RANK[c.escalation.urgency]) {
        c.escalation.urgency = e.urgency;
        c.escalation.reason = e.reason;
        c.escalation.summary = `${e.summary}\n\nEarlier: ${c.escalation.summary}`;
        change.escalated = true;
      }
      return;
    }
    const team = careTeamFor(doc);
    c.escalation = { reason: e.reason, urgency: e.urgency, summary: e.summary, requestedAt: nowIso(), requestedBy: e.requestedBy, notifiedClinicianIds: team };
    if (c.status === 'ai') c.status = 'waiting';
    // Clinicians haven't seen anything yet: everything so far is unread for them.
    for (const id of team) c.unreadForClinician[id] = c.messages.length;
    change.escalated = true;
    system(c, change, ESCALATED_NOTICE, {}, { seenByPatient });
  }

  function notify(c: Conversation, change: Change): void {
    const clinicianIds = audience(c);
    const publish = (event: RealtimeEvent, toPatient = true) => hub.publish(event, { ...(toPatient ? { patientId: c.patientId } : {}), clinicianIds });
    if (change.escalated && c.escalation) {
      publish({ type: 'conversation.escalated', conversationId: c.id, patientId: c.patientId, patientName: c.patientName, urgency: c.escalation.urgency, topic: c.topic }, false);
    }
    for (const message of change.messages) publish({ type: 'message.created', conversationId: c.id, patientId: c.patientId, message });
    publish({ type: 'conversation.updated', conversationId: c.id, patientId: c.patientId, status: c.status });
  }

  const persist = (c: Conversation, doc: RawPatientDocument) => chats.save(c, fhirPatientId(doc));

  function safetySummary(label: string, text: string, doc: RawPatientDocument): string {
    return `Safety screen fired (${label}). Patient wrote: "${truncate(text, 240)}". Context: ${clinicianContextLine(buildChatContext(doc, store.trackers, store.today))}`;
  }

  /** Append a patient message and run the state machine. */
  async function handlePatientMessage(c: Conversation, doc: RawPatientDocument, msg: { text: string; mediaIds?: string[] }, change: Change): Promise<ChatReply | undefined> {
    if (c.status === 'closed') throw new HttpError(409, 'This chat is closed. Start a new chat to keep talking.');
    add(c, change, { author: 'patient', authorName: doc.profile.firstName, text: msg.text, ...(msg.mediaIds ? { mediaIds: msg.mediaIds } : {}) });
    const hit = safetyCheck(msg.text);
    if (hit) {
      system(c, change, hit.notice.message, { safety: hit.notice }, { seenByPatient: true });
      escalate(c, doc, change, { reason: `Safety screen: ${hit.label}`, urgency: 'urgent', summary: safetySummary(hit.label, msg.text, doc), requestedBy: 'safety' }, true);
      if (!c.topic) c.topic = truncate(hit.label, 60);
      return undefined;
    }
    if (c.status !== 'ai') return undefined; // a person is handling this chat
    const context = buildChatContext(doc, store.trackers, store.today);
    const reply = await replyToPatient(c, context, ai);
    if (c.status !== 'ai') return reply; // escalated/closed while the helper was thinking
    const safety: SafetyNotice | undefined = reply.safety;
    add(
      c,
      change,
      {
        author: 'ai',
        authorName: AI_AUTHOR_NAME,
        text: reply.text,
        ...(safety ? { safety } : {}),
        ...(reply.suggestedActions?.length ? { suggestedActions: reply.suggestedActions } : {}),
      },
      { seenByPatient: true },
    );
    if (reply.escalate) escalate(c, doc, change, { ...reply.escalate, requestedBy: safety ? 'safety' : 'ai' }, true);
    return reply;
  }

  const send = (res: Response, c: Conversation) => res.json(c);

  const route =
    (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res);
      } catch (err) {
        if (res.headersSent) return;
        if (err instanceof HttpError) res.status(err.status).json(errorBody(err.message));
        else {
          console.error('[chat] Request failed:', err);
          res.status(500).json(errorBody(`Chat request failed: ${(err as Error)?.message ?? String(err)}`));
        }
      }
    };

  const requireJsonObject = (req: Request, allowEmpty = false): Record<string, unknown> => {
    if (req.body === undefined && allowEmpty) return {};
    if (!req.is('application/json')) throw new HttpError(400, 'Body must be JSON (Content-Type: application/json).');
    if (!isObj(req.body)) throw new HttpError(400, 'Body must be a JSON object.');
    return req.body;
  };

  // ───────────────────────────── AI status & voice ─────────────────────────────

  router.get('/ai/status', (_req, res) => {
    res.json(ai.status());
  });

  router.post(
    '/patients/:id/voice-checkin/parse',
    route(async (req, res) => {
      const doc = docFor(String(req.params.id));
      const body = requireJsonObject(req);
      if (typeof body.trackerId !== 'string') throw new HttpError(400, '"trackerId" is required.');
      const tracker = store.trackers.find((t) => t.id === body.trackerId);
      if (!tracker || !doc.trackers.some((t) => t.trackerId === tracker.id && t.active)) {
        throw new HttpError(400, `Tracker "${body.trackerId}" is not assigned to this patient.`);
      }
      if (typeof body.transcript !== 'string') throw new HttpError(400, '"transcript" must be a string.');
      if (!body.transcript.trim()) throw new HttpError(400, '"transcript" must not be empty.');
      if (body.transcript.length > MAX_TRANSCRIPT) throw new HttpError(400, `"transcript" must be at most ${MAX_TRANSCRIPT} characters.`);
      const result: VoiceParseResult = await parseVoiceCheckin(doc, tracker, body.transcript, ai);
      res.json(result);
    }),
  );

  // ───────────────────────────── conversations ─────────────────────────────

  router.get(
    '/patients/:id/conversations',
    route((req, res) => {
      const doc = docFor(String(req.params.id));
      res.json(chats.listForPatient(doc.id));
    }),
  );

  router.post(
    '/patients/:id/conversations',
    route(async (req, res) => {
      const doc = docFor(String(req.params.id));
      const msg = parsePatientMessage(requireJsonObject(req));
      const now = nowIso();
      const c: Conversation = {
        id: randomUUID(),
        patientId: doc.id,
        patientName: patientName(doc),
        status: 'ai',
        createdAt: now,
        updatedAt: now,
        topic: '',
        messages: [],
        unreadForPatient: 0,
        unreadForClinician: {},
      };
      const change: Change = { messages: [], escalated: false };
      const reply = await handlePatientMessage(c, doc, msg, change);
      if (!c.topic) c.topic = truncate(reply?.topic?.trim() || firstWords(msg.text), 60);
      persist(c, doc);
      notify(c, change);
      res.status(201);
      send(res, c);
    }),
  );

  router.get(
    '/conversations/:conversationId',
    route((req, res) => send(res, convFor(String(req.params.conversationId)))),
  );

  router.post(
    '/conversations/:conversationId/messages',
    route(async (req, res) => {
      const c = convFor(String(req.params.conversationId));
      const doc = docFor(c.patientId);
      const body = requireJsonObject(req);
      const change: Change = { messages: [], escalated: false };
      if (body.author === 'clinician') {
        const clinician = clinicianById(body.clinicianId);
        if (!clinician) throw new HttpError(404, `Unknown clinician "${String(body.clinicianId)}".`);
        const text = validateText(body.text);
        if (c.status === 'closed') throw new HttpError(409, 'This chat is closed.');
        if (!c.escalation) throw new HttpError(409, 'This chat has not been shared with the care team.');
        join(c, clinician.id, change);
        add(c, change, { author: 'clinician', authorName: clinician.displayName, clinicianId: clinician.id, text });
      } else {
        await handlePatientMessage(c, doc, parsePatientMessage(body), change);
      }
      persist(c, doc);
      notify(c, change);
      send(res, c);
    }),
  );

  /** Claim if unclaimed, switch to 'clinician', and announce the first join of this clinician. */
  function join(c: Conversation, clinicianId: string, change: Change): void {
    const e = c.escalation!;
    if (!e.claimedBy) {
      e.claimedBy = clinicianId;
      e.claimedAt = nowIso();
    }
    if (!e.notifiedClinicianIds.includes(clinicianId) && e.claimedBy !== clinicianId) e.notifiedClinicianIds.push(clinicianId);
    c.status = 'clinician';
    const joined = c.messages.some((m) => m.clinicianId === clinicianId);
    if (!joined) {
      const name = clinicianById(clinicianId)?.displayName ?? clinicianId;
      system(c, change, `${name} joined the chat`, { clinicianId }, { seenByClinician: clinicianId });
    }
  }

  router.post(
    '/conversations/:conversationId/escalate',
    route((req, res) => {
      const c = convFor(String(req.params.conversationId));
      const doc = docFor(c.patientId);
      const body = requireJsonObject(req, true);
      if (body.reason !== undefined && typeof body.reason !== 'string') throw new HttpError(400, '"reason" must be a string.');
      const reason = typeof body.reason === 'string' && body.reason.trim() ? truncate(body.reason, 300) : 'Patient asked to talk to the care team';
      if (c.status === 'closed') throw new HttpError(409, 'This chat is closed.');
      if (c.escalation) return send(res, c); // already with the care team
      const recent = c.messages
        .filter((m) => m.author === 'patient')
        .slice(-3)
        .map((m) => `"${truncate(m.text, 160)}"`)
        .join(' ');
      const context = buildChatContext(doc, store.trackers, store.today);
      const change: Change = { messages: [], escalated: false };
      escalate(c, doc, change, { reason, urgency: 'routine', summary: `Patient asked for the care team.${recent ? ` Recent messages: ${recent}.` : ''} Context: ${clinicianContextLine(context)}`, requestedBy: 'patient' }, true);
      persist(c, doc);
      notify(c, change);
      send(res, c);
    }),
  );

  router.post(
    '/conversations/:conversationId/claim',
    route((req, res) => {
      const c = convFor(String(req.params.conversationId));
      const doc = docFor(c.patientId);
      const body = requireJsonObject(req);
      const clinician = clinicianById(body.clinicianId);
      if (!clinician) throw new HttpError(404, `Unknown clinician "${String(body.clinicianId)}".`);
      if (c.status === 'closed') throw new HttpError(409, 'This chat is closed.');
      if (!c.escalation) throw new HttpError(409, 'This chat has not been shared with the care team.');
      if (c.escalation.claimedBy && c.escalation.claimedBy !== clinician.id) {
        throw new HttpError(409, `Already claimed by ${clinicianById(c.escalation.claimedBy)?.displayName ?? c.escalation.claimedBy}.`);
      }
      const change: Change = { messages: [], escalated: false };
      join(c, clinician.id, change);
      c.unreadForClinician[clinician.id] = 0;
      persist(c, doc);
      notify(c, change);
      send(res, c);
    }),
  );

  router.post(
    '/conversations/:conversationId/close',
    route((req, res) => {
      const c = convFor(String(req.params.conversationId));
      const doc = docFor(c.patientId);
      const body = requireJsonObject(req);
      let byName: string;
      let seen: { seenByPatient?: boolean; seenByClinician?: string };
      if (body.by === 'patient') {
        byName = doc.profile.firstName;
        seen = { seenByPatient: true };
      } else {
        const clinician = clinicianById(body.by);
        if (!clinician) throw new HttpError(typeof body.by === 'string' ? 404 : 400, typeof body.by === 'string' ? `Unknown clinician "${body.by}".` : '"by" must be "patient" or a clinician id.');
        byName = clinician.displayName;
        seen = { seenByClinician: clinician.id };
      }
      if (c.status === 'closed') return send(res, c);
      const change: Change = { messages: [], escalated: false };
      c.status = 'closed';
      system(c, change, `${byName} closed this chat.`, {}, seen);
      persist(c, doc);
      notify(c, change);
      send(res, c);
    }),
  );

  router.post(
    '/conversations/:conversationId/read',
    route((req, res) => {
      const c = convFor(String(req.params.conversationId));
      const doc = docFor(c.patientId);
      const body = requireJsonObject(req);
      if (body.reader === 'patient') c.unreadForPatient = 0;
      else {
        const clinician = clinicianById(body.reader);
        if (!clinician) throw new HttpError(typeof body.reader === 'string' ? 404 : 400, typeof body.reader === 'string' ? `Unknown clinician "${body.reader}".` : '"reader" must be "patient" or a clinician id.');
        if (c.unreadForClinician[clinician.id] !== undefined) c.unreadForClinician[clinician.id] = 0;
      }
      persist(c, doc);
      send(res, c);
    }),
  );

  // ───────────────────────────── inbox ─────────────────────────────

  router.get(
    '/clinicians/:clinicianId/inbox',
    route((req, res) => {
      const clinician = clinicianById(req.params.clinicianId);
      if (!clinician) throw new HttpError(404, `Unknown clinician "${req.params.clinicianId}".`);
      const items: InboxItem[] = [];
      for (const c of chats.all()) {
        const e = c.escalation;
        if (!e || !(e.notifiedClinicianIds.includes(clinician.id) || e.claimedBy === clinician.id)) continue;
        const doc = store.getPatient(c.patientId);
        const conditions = doc
          ? doc.trackers.filter((t) => t.active).map((t) => store.trackers.find((d) => d.id === t.trackerId)?.conditionLabel ?? t.trackerId)
          : [];
        const last = c.messages[c.messages.length - 1];
        const item: InboxItem = {
          conversationId: c.id,
          patientId: c.patientId,
          patientName: c.patientName,
          conditions: [...new Set(conditions)],
          status: c.status,
          urgency: e.urgency,
          topic: c.topic,
          summary: e.summary,
          lastMessage: last ? { author: last.author, text: last.text, createdAt: last.createdAt } : { author: 'system', text: '', createdAt: c.updatedAt },
          unread: c.unreadForClinician[clinician.id] ?? 0,
          requestedAt: e.requestedAt,
        };
        if (e.claimedBy) item.claimedBy = e.claimedBy;
        items.push(item);
      }
      items.sort(
        (a, b) =>
          Number(a.status === 'closed') - Number(b.status === 'closed') ||
          URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
          a.requestedAt.localeCompare(b.requestedAt),
      );
      res.json(items);
    }),
  );

  // ───────────────────────────── SSE ─────────────────────────────

  router.get('/events', (req, res) => {
    const { patientId, clinicianId } = req.query;
    if (Array.isArray(patientId) || Array.isArray(clinicianId)) return void res.status(400).json(errorBody('Give each query parameter once.'));
    const hasP = typeof patientId === 'string' && patientId !== '';
    const hasC = typeof clinicianId === 'string' && clinicianId !== '';
    if (hasP === hasC) return void res.status(400).json(errorBody('Give exactly one of "patientId" or "clinicianId".'));
    let sub: { patientId?: string; clinicianId?: string };
    if (hasP) {
      const doc = store.getPatient(patientId as string);
      if (!doc) return void res.status(404).json(errorBody(`Unknown patient "${patientId}".`));
      sub = { patientId: doc.id };
    } else {
      if (!clinicianById(clinicianId)) return void res.status(404).json(errorBody(`Unknown clinician "${clinicianId}".`));
      sub = { clinicianId: clinicianId as string };
    }
    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const unsubscribe = hub.subscribe({
      ...sub,
      send: (event) => {
        if (res.writableEnded || res.destroyed) throw new Error('SSE stream closed');
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      },
    });
    const ping = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, heartbeatMs);
    ping.unref?.();
    const cleanup = () => {
      clearInterval(ping);
      unsubscribe();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
  });

  return router;
}
