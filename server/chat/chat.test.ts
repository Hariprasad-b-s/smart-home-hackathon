import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Conversation, InboxItem, RealtimeEvent } from '../../shared/types/api';
import { createApp } from '../app';
import { careTeamFor } from '../data/clinicians';
import { createStore } from '../data/store';
import { TRACKER_IDS } from '../data/trackers';
import { fhirPatientId } from '../fhir/toFhir';
import { createRealtimeHub } from '../realtime/hub';
import { fhirToConversation } from './fhir';
import { createChatRouter, ESCALATED_NOTICE } from './routes';
import { chatFhirResources, ChatStore, resetChat } from './store';

// Deterministic clock: every call advances one minute, so requestedAt ordering is stable.
let tick = 0;
const clock = () => new Date(Date.UTC(2026, 10, 6, 14, 0) + tick++ * 60_000);
const store = createStore({ today: '2026-11-06', now: clock });
const hub = createRealtimeHub();
const app = createApp(store, { hub });

/** A patient whose ONLY active tracker is `id` (so care teams don't overlap). */
const withTracker = (id: string) => store.listPatients().find((p) => p.trackers.filter((t) => t.active).every((t) => t.trackerId === id))!;
const asthma = withTracker(TRACKER_IDS.asthma);
const migraine = withTracker(TRACKER_IDS.migraine);

const start = (patientId: string, text: string, extra: Record<string, unknown> = {}) =>
  request(app).post(`/api/patients/${patientId}/conversations`).send({ author: 'patient', text, ...extra });
const say = (id: string, body: Record<string, unknown>) => request(app).post(`/api/conversations/${id}/messages`).send(body);

function listen(clinicianId?: string, patientId?: string) {
  const events: RealtimeEvent[] = [];
  const off = hub.subscribe({ clinicianId, patientId, send: (e) => events.push(e) });
  return { events, off };
}

beforeEach(() => resetChat());

describe('AI status', () => {
  it('reports the rule engine without credentials', async () => {
    const res = await request(app).get('/api/ai/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ engine: 'rules', notice: 'Demo AI on synthetic data. Not for real patient information. Not medical advice.' });
  });
});

describe('conversations', () => {
  it('AI conversation flow through the rule engine', async () => {
    const res = await start(asthma.id, 'how do I do the breathing test?');
    expect(res.status).toBe(201);
    const c: Conversation = res.body;
    expect(c.status).toBe('ai');
    expect(c.patientId).toBe(asthma.id);
    expect(c.topic).toBe('Breathing test help');
    expect(c.messages.map((m) => m.author)).toEqual(['patient', 'ai']);
    expect(c.messages[1].authorName).toBe('SMART@Home helper (AI)');
    expect(c.messages[1].suggestedActions).toEqual(['breathing_test']);
    expect(c.escalation).toBeUndefined();
    expect(c.unreadForPatient).toBe(0);

    const next = await say(c.id, { author: 'patient', text: 'thanks!' });
    expect(next.status).toBe(200);
    expect(next.body.messages.map((m: { author: string }) => m.author)).toEqual(['patient', 'ai', 'patient', 'ai']);

    const list = await request(app).get(`/api/patients/${asthma.id}/conversations`);
    expect(list.body.map((x: Conversation) => x.id)).toEqual([c.id]);
    expect((await request(app).get(`/api/conversations/${c.id}`)).body.messages).toHaveLength(4);
  });

  it('topic falls back to the first 6 words', async () => {
    const res = await start(asthma.id, 'what is the capital city of France again');
    expect(res.body.topic).toBe('what is the capital city of');
  });

  it('safety screen auto-escalates as urgent without an AI reply', async () => {
    const nurse = listen('demo-nurse');
    const res = await start(asthma.id, "I can't breathe and my lips are turning blue");
    nurse.off();
    const c: Conversation = res.body;
    expect(c.status).toBe('waiting');
    expect(c.messages.map((m) => m.author)).toEqual(['patient', 'system', 'system']);
    expect(c.messages[1].safety?.level).toBe('emergency');
    expect(c.messages[2].text).toBe(ESCALATED_NOTICE);
    expect(c.escalation).toMatchObject({ urgency: 'urgent', requestedBy: 'safety', notifiedClinicianIds: careTeamFor(asthma) });
    expect(c.escalation!.reason).toMatch(/Safety screen/);
    expect(nurse.events.some((e) => e.type === 'conversation.escalated' && e.urgency === 'urgent')).toBe(true);
  });

  it('asking for a human escalates and notifies the care team over the hub', async () => {
    const team = careTeamFor(asthma);
    expect(team).toEqual(expect.arrayContaining(['demo-nurse', 'demo-pulm']));
    const pulm = listen('demo-pulm');
    const neuro = listen('demo-neuro');
    const patient = listen(undefined, asthma.id);
    const c: Conversation = (await start(asthma.id, 'can I talk to a real nurse please')).body;
    pulm.off();
    neuro.off();
    patient.off();
    expect(c.status).toBe('waiting');
    expect(c.escalation).toMatchObject({ urgency: 'routine', requestedBy: 'ai', notifiedClinicianIds: team });
    expect(c.messages.at(-1)!.text).toBe(ESCALATED_NOTICE);
    const types = pulm.events.map((e) => e.type);
    expect(types).toContain('conversation.escalated');
    expect(pulm.events.filter((e) => e.type === 'message.created')).toHaveLength(3); // patient, AI, system
    expect(neuro.events).toHaveLength(0); // not on this patient's care team
    expect(patient.events.some((e) => e.type === 'message.created')).toBe(true);
    expect(patient.events.some((e) => e.type === 'conversation.escalated')).toBe(false);
    for (const id of team) expect(c.unreadForClinician[id]).toBe(3);

    // While waiting, patient messages go to the team, not to the AI.
    const more: Conversation = (await say(c.id, { author: 'patient', text: 'hello?' })).body;
    expect(more.messages.at(-1)!.author).toBe('patient');
    expect(more.messages).toHaveLength(4);
    expect(more.unreadForClinician['demo-pulm']).toBe(4);
  });

  it('patient escalate endpoint is idempotent', async () => {
    const c: Conversation = (await start(asthma.id, 'how do I check in?')).body;
    const a = await request(app).post(`/api/conversations/${c.id}/escalate`).send({ reason: 'I want a person' });
    expect(a.body.escalation).toMatchObject({ reason: 'I want a person', requestedBy: 'patient', urgency: 'routine' });
    const b = await request(app).post(`/api/conversations/${c.id}/escalate`);
    expect(b.status).toBe(200);
    expect(b.body.messages).toHaveLength(a.body.messages.length);
  });

  it('clinician joins and replies: status, join message and unread counts', async () => {
    const c: Conversation = (await start(asthma.id, 'can I talk to my doctor')).body;
    const patient = listen(undefined, asthma.id);
    const r1 = await say(c.id, { author: 'clinician', clinicianId: 'demo-pulm', text: 'Hi, this is Dr. Rivera. How are you breathing today?' });
    patient.off();
    expect(r1.status).toBe(200);
    const c1: Conversation = r1.body;
    expect(c1.status).toBe('clinician');
    expect(c1.escalation?.claimedBy).toBe('demo-pulm');
    expect(c1.messages.slice(-2).map((m) => [m.author, m.text])).toEqual([
      ['system', 'Dr. Alex Rivera joined the chat'],
      ['clinician', 'Hi, this is Dr. Rivera. How are you breathing today?'],
    ]);
    expect(c1.unreadForPatient).toBe(2);
    expect(c1.unreadForClinician['demo-pulm']).toBe(3); // the earlier messages; own messages don't count
    expect(c1.unreadForClinician['demo-nurse']).toBe(5);
    expect(patient.events.filter((e) => e.type === 'message.created')).toHaveLength(2);

    // Second message: no second join notice.
    const c2: Conversation = (await say(c.id, { author: 'clinician', clinicianId: 'demo-pulm', text: 'Any wheezing?' })).body;
    expect(c2.messages.filter((m) => m.text.includes('joined the chat'))).toHaveLength(1);

    // Patient reply is relayed, no AI answer.
    const c3: Conversation = (await say(c.id, { author: 'patient', text: 'a little wheezing' })).body;
    expect(c3.messages.at(-1)!.author).toBe('patient');
    expect(c3.unreadForClinician['demo-pulm']).toBe(4);

    const readP: Conversation = (await request(app).post(`/api/conversations/${c.id}/read`).send({ reader: 'patient' })).body;
    expect(readP.unreadForPatient).toBe(0);
    const readC: Conversation = (await request(app).post(`/api/conversations/${c.id}/read`).send({ reader: 'demo-pulm' })).body;
    expect(readC.unreadForClinician['demo-pulm']).toBe(0);
    expect(readC.unreadForClinician['demo-nurse']).toBeGreaterThan(0);

    // Another clinician can't claim; the claimer can close.
    expect((await request(app).post(`/api/conversations/${c.id}/claim`).send({ clinicianId: 'demo-nurse' })).status).toBe(409);
    const closed: Conversation = (await request(app).post(`/api/conversations/${c.id}/close`).send({ by: 'demo-pulm' })).body;
    expect(closed.status).toBe('closed');
    expect(closed.messages.at(-1)!.text).toBe('Dr. Alex Rivera closed this chat.');
    expect((await say(c.id, { author: 'patient', text: 'one more thing' })).status).toBe(409);
  });

  it('safety screen still runs while a clinician is handling the chat', async () => {
    const c: Conversation = (await start(asthma.id, 'talk to a nurse')).body;
    await request(app).post(`/api/conversations/${c.id}/claim`).send({ clinicianId: 'demo-nurse' });
    const r: Conversation = (await say(c.id, { author: 'patient', text: 'my inhaler is not helping at all' })).body;
    expect(r.status).toBe('clinician');
    expect(r.messages.at(-1)!.safety?.level).toBe('urgent');
    expect(r.escalation?.urgency).toBe('urgent');
  });

  it('clinician cannot post into a chat that was not escalated', async () => {
    const c: Conversation = (await start(asthma.id, 'hi')).body;
    expect((await say(c.id, { author: 'clinician', clinicianId: 'demo-pulm', text: 'hello' })).status).toBe(409);
  });

  it('validates input with clear 400s and 404s', async () => {
    expect((await start(asthma.id, '')).status).toBe(400);
    expect((await start(asthma.id, '   ')).status).toBe(400);
    expect((await start(asthma.id, 'x'.repeat(2001))).status).toBe(400);
    expect((await start(asthma.id, 'x'.repeat(2000))).status).toBe(201);
    expect((await start(asthma.id, 'hi', { mediaIds: 'abc' })).status).toBe(400);
    expect((await start(asthma.id, 'hi', { mediaIds: [1] })).status).toBe(400);
    expect((await start(asthma.id, 'hi', { mediaIds: Array.from({ length: 11 }, (_, i) => `m${i}`) })).status).toBe(400);
    const withMedia = await start(asthma.id, 'here is a photo of my rash', { mediaIds: ['media-1'] });
    expect(withMedia.body.messages[0].mediaIds).toEqual(['media-1']);
    expect((await start('nope', 'hi')).status).toBe(404);
    expect((await request(app).post(`/api/patients/${asthma.id}/conversations`).send('text')).status).toBe(400);
    expect((await request(app).get('/api/conversations/missing')).status).toBe(404);
    const c: Conversation = (await start(asthma.id, 'talk to a nurse')).body;
    expect((await request(app).post(`/api/conversations/${c.id}/claim`).send({ clinicianId: 'dr-nobody' })).status).toBe(404);
    expect((await request(app).post(`/api/conversations/${c.id}/read`).send({ reader: 'dr-nobody' })).status).toBe(404);
    expect((await request(app).post(`/api/conversations/${c.id}/close`).send({})).status).toBe(400);
    expect((await say(c.id, { author: 'clinician', clinicianId: 'dr-nobody', text: 'hi' })).status).toBe(404);
    expect((await say(c.id, { author: 'robot', text: 'hi' })).status).toBe(400);
    expect((await request(app).get('/api/clinicians/dr-nobody/inbox')).status).toBe(404);
  });
});

describe('inbox', () => {
  it('lists only escalated chats for the clinician, sorted urgent > soon > routine, oldest first, closed last', async () => {
    const routineOld: Conversation = (await start(asthma.id, 'can I talk to a nurse')).body;
    const soon: Conversation = (await start(asthma.id, 'my cough is getting worse')).body;
    const urgent: Conversation = (await start(asthma.id, "I can't breathe")).body;
    const routineNew: Conversation = (await start(asthma.id, 'I want to talk to my doctor')).body;
    const closedUrgent: Conversation = (await start(asthma.id, 'I passed out')).body;
    await request(app).post(`/api/conversations/${closedUrgent.id}/close`).send({ by: 'patient' });
    await start(asthma.id, 'how do I check in'); // not escalated
    const migraineChat: Conversation = (await start(migraine.id, 'can I talk to a nurse')).body;

    const res = await request(app).get('/api/clinicians/demo-pulm/inbox');
    expect(res.status).toBe(200);
    const items: InboxItem[] = res.body;
    expect(items.map((i) => i.conversationId)).toEqual([urgent.id, soon.id, routineOld.id, routineNew.id, closedUrgent.id]);
    expect(items[0]).toMatchObject({ urgency: 'urgent', status: 'waiting', patientId: asthma.id, conditions: expect.arrayContaining(['Asthma']) });
    expect(items[0].lastMessage.author).toBe('system');
    expect(items[0].unread).toBeGreaterThan(0);

    const nurse: InboxItem[] = (await request(app).get('/api/clinicians/demo-nurse/inbox')).body;
    expect(nurse.map((i) => i.conversationId)).toContain(migraineChat.id);
    const neuro: InboxItem[] = (await request(app).get('/api/clinicians/demo-neuro/inbox')).body;
    expect(neuro.map((i) => i.conversationId)).toEqual([migraineChat.id]);
  });
});

describe('voice check-in endpoint', () => {
  it('returns values that pass the tracker validation', async () => {
    const res = await request(app)
      .post(`/api/patients/${asthma.id}/voice-checkin/parse`)
      .send({ trackerId: TRACKER_IDS.asthma, transcript: 'Feeling okay. Coughing a bit, no wheezing. Used my inhaler once. Did not wake up at night.' });
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe('rules');
    expect(res.body.trackerId).toBe(TRACKER_IDS.asthma);
    const responses = res.body.answers.map((a: { questionId: string; value: string | null }) => ({ questionId: a.questionId, value: a.value }));
    expect(responses.filter((r: { value: unknown }) => r.value !== null).length).toBeGreaterThanOrEqual(4);
    const save = await request(app)
      .post(`/api/patients/${asthma.id}/tracker-responses`)
      .send({ trackerId: TRACKER_IDS.asthma, responses, entryMode: 'voice', transcript: 'Feeling okay.' });
    expect(save.status).toBe(201);
  });

  it('validates the request', async () => {
    const url = `/api/patients/${asthma.id}/voice-checkin/parse`;
    expect((await request(app).post(url).send({ trackerId: TRACKER_IDS.ibd, transcript: 'hi' })).status).toBe(400);
    expect((await request(app).post(url).send({ trackerId: TRACKER_IDS.asthma, transcript: '' })).status).toBe(400);
    expect((await request(app).post(url).send({ trackerId: TRACKER_IDS.asthma, transcript: 'x'.repeat(4001) })).status).toBe(400);
    expect((await request(app).post('/api/patients/nope/voice-checkin/parse').send({ trackerId: TRACKER_IDS.asthma, transcript: 'hi' })).status).toBe(404);
  });
});

describe('SSE /api/events', () => {
  let server: http.Server;
  afterAll(() => server?.close());

  it('rejects bad subscriptions', async () => {
    expect((await request(app).get('/api/events')).status).toBe(400);
    expect((await request(app).get('/api/events?patientId=a&clinicianId=b')).status).toBe(400);
    expect((await request(app).get('/api/events?patientId=nope')).status).toBe(404);
    expect((await request(app).get('/api/events?clinicianId=nope')).status).toBe(404);
  });

  it('delivers an event as a data frame', async () => {
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/events?clinicianId=demo-nurse`, { signal: ctrl.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(res.headers.get('cache-control')).toMatch(/no-cache/);
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const before = hub.subscriberCount();

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const trigger = fetch(`${base}/api/patients/${asthma.id}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: 'patient', text: 'can I talk to a nurse' }),
    });
    while (!/\ndata: .*\n\n/.test(buf)) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    await trigger;
    expect(buf.startsWith('retry: 3000\n\n')).toBe(true);
    const frame = buf.match(/event: (\S+)\ndata: (.*)\n\n/)!;
    const event = JSON.parse(frame[2]) as RealtimeEvent;
    expect(event.type).toBe(frame[1]);
    expect(event.type).toBe('conversation.escalated');
    expect(event).toMatchObject({ patientId: asthma.id, urgency: 'routine' });

    ctrl.abort();
    await reader.cancel().catch(() => {});
    for (let i = 0; i < 50 && hub.subscriberCount() >= before; i++) await new Promise((r) => setTimeout(r, 10));
    expect(hub.subscriberCount()).toBe(before - 1); // cleaned up on close
  });
});

describe('persistence (FHIR bundles)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.resolve(here, '../../.dev', `chat-test-${process.pid}-${Date.now()}`);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes Synthea-style bundles and reloads them losslessly', async () => {
    mkdirSync(dir, { recursive: true });
    const s2 = createStore({ today: '2026-11-06', now: clock });
    const h2 = createRealtimeHub();
    const app2 = express().use('/api', express.json(), createChatRouter(s2, h2, { chatDir: dir }));
    const doc = s2.getPatient(asthma.id)!;
    const c: Conversation = (await request(app2).post(`/api/patients/${doc.id}/conversations`).send({ author: 'patient', text: 'can I talk to a nurse', mediaIds: ['p1'] })).body;
    await request(app2).post(`/api/conversations/${c.id}/messages`).send({ author: 'clinician', clinicianId: 'demo-nurse', text: 'Hi! Nurse Jamie here.' });
    await request(app2).post(`/api/conversations/${c.id}/messages`).send({ author: 'patient', text: "my inhaler isn't helping" });
    const final: Conversation = (await request(app2).get(`/api/conversations/${c.id}`)).body;

    const file = path.join(dir, doc.id, `${c.id}.json`);
    expect(existsSync(file)).toBe(true);
    const bundle = JSON.parse(readFileSync(file, 'utf8'));
    expect(bundle).toMatchObject({ resourceType: 'Bundle', type: 'collection' });
    const resources = bundle.entry.map((e: { resource: { resourceType: string } }) => e.resource);
    for (const e of bundle.entry) expect(e.fullUrl).toBe(`urn:uuid:${e.resource.id}`);
    const comms = resources.filter((r: { resourceType: string }) => r.resourceType === 'Communication');
    expect(comms).toHaveLength(final.messages.length);
    expect(comms[0]).toMatchObject({ status: 'completed', subject: { reference: `urn:uuid:${fhirPatientId(doc)}` }, payload: [{ contentString: 'can I talk to a nurse' }] });
    expect(comms[1].inResponseTo).toEqual([{ reference: `urn:uuid:${comms[0].id}` }]);
    expect(comms[1].sender.display).toBe('SMART@Home helper (AI)');
    const task = resources.find((r: { resourceType: string }) => r.resourceType === 'Task');
    expect(task).toMatchObject({ status: 'in-progress', priority: 'asap', intent: 'order', owner: { display: 'Jamie Okonkwo, RN' } });
    expect(resources.some((r: { resourceType: string }) => r.resourceType === 'Device')).toBe(true);
    expect(resources.some((r: { resourceType: string }) => r.resourceType === 'Practitioner')).toBe(true);
    expect(fhirToConversation(resources).conversation).toEqual(final);

    // A fresh store (server restart) loads everything back.
    const reloaded = new ChatStore(dir);
    expect(reloaded.get(c.id)).toEqual(final);
    expect(chatFhirResources(doc.id).filter((r) => r.resourceType === 'Communication')).toHaveLength(final.messages.length);

    // Reset clears memory and files.
    resetChat();
    expect(existsSync(file)).toBe(false);
    expect(new ChatStore(dir).all()).toHaveLength(0);
  });

  it('null chatDir keeps everything in memory', () => {
    const s = new ChatStore(null);
    expect(s.all()).toEqual([]);
  });
});
