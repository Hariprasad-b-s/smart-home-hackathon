import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { MediaItem, RealtimeEvent } from '../../shared/types/api';
import { createApp } from '../app';
import { careTeamFor } from '../data/clinicians';
import { createStore } from '../data/store';
import { Q } from '../data/trackers';
import type { Audience, RealtimeHub } from '../realtime/hub';
import { sniffContentTypes } from './validation';

const TODAY = '2026-11-06';
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'smart-home-media-'));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// Tiny but magic-byte-valid files, built in the test.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(200, 7), Buffer.from([0xff, 0xd9])]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from('isommp42'),
  Buffer.alloc(2000, 3),
]);

function fakeHub() {
  const events: { event: RealtimeEvent; audience: Audience }[] = [];
  const hub: RealtimeHub = {
    publish: vi.fn((event: RealtimeEvent, audience: Audience) => void events.push({ event, audience })),
    subscribe: () => () => undefined,
    subscriberCount: () => 0,
  };
  return { hub, events };
}

function setup(persist = false) {
  const runtimeDir = persist ? tmp() : null;
  const mediaDir = persist ? tmp() : null;
  const { hub, events } = fakeHub();
  const store = createStore({ today: TODAY, runtimeDir, mediaDir, now: () => new Date('2026-11-06T16:00:00Z') });
  return { store, app: createApp(store, { hub }), hub, events, runtimeDir, mediaDir };
}

const upload = (app: ReturnType<typeof createApp>, patientId: string, body: Buffer, type: string, query: string) =>
  request(app).post(`/api/patients/${patientId}/media?${query}`).set('Content-Type', type).send(body);

describe('magic-byte sniffing', () => {
  it('recognises the supported containers', () => {
    expect(sniffContentTypes(JPEG)).toEqual(['image/jpeg']);
    expect(sniffContentTypes(PNG)).toEqual(['image/png']);
    expect(sniffContentTypes(MP4)).toContain('video/mp4');
    expect(sniffContentTypes(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toEqual(['image/webp']);
    expect(sniffContentTypes(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic')]))).toContain('image/heic');
    expect(sniffContentTypes(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypqt  ')]))).toContain('video/quicktime');
    expect(sniffContentTypes(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]))).toEqual(['video/webm']);
    expect(sniffContentTypes(Buffer.from('hello world'))).toEqual([]);
  });
});

describe('media endpoints', () => {
  it('uploads a photo and a video, lists, streams with Range, and deletes', async () => {
    const { store, app, events, runtimeDir, mediaDir } = setup(true);
    const doc = store.listPatients()[2];
    const photo = await upload(app, doc.id, JPEG, 'image/jpeg', `kind=photo&caption=${encodeURIComponent('  Rash on my arm ')}&takenAt=${encodeURIComponent('2026-11-05T18:30:00.000-05:00')}`);
    expect(photo.status).toBe(201);
    const p = photo.body as MediaItem;
    expect(p).toMatchObject({ patientId: doc.id, kind: 'photo', contentType: 'image/jpeg', sizeBytes: JPEG.length, caption: 'Rash on my arm', date: '2026-11-05', url: `/api/media/${p.id}/content` });
    expect(existsSync(path.join(mediaDir!, doc.id, `${p.id}.jpg`))).toBe(true);

    const video = await upload(app, doc.id, MP4, 'video/mp4', 'kind=video&trackerResponseId=abc-123');
    expect(video.status).toBe(201);
    const v = video.body as MediaItem;
    expect(v.takenAt.startsWith(TODAY)).toBe(true);
    expect(v.trackerResponseId).toBe('abc-123');

    // Events go to the patient and the care team.
    const created = events.filter((e) => e.event.type === 'media.created');
    expect(created).toHaveLength(2);
    expect(created[0].audience).toEqual({ patientId: doc.id, clinicianIds: careTeamFor(doc) });

    const list = (await request(app).get(`/api/patients/${doc.id}/media`)).body as MediaItem[];
    expect(list.map((m) => m.id)).toEqual([v.id, p.id]); // newest first
    expect(((await request(app).get(`/api/patients/${doc.id}/media?days=1`)).body as MediaItem[]).map((m) => m.id)).toEqual([v.id]);
    expect((await request(app).get(`/api/patients/${doc.id}/media?days=0`)).status).toBe(400);

    const full = await request(app).get(v.url).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toBe('video/mp4');
    expect(full.headers['content-disposition']).toBe('inline');
    expect(full.headers['x-content-type-options']).toBe('nosniff');
    expect(full.headers['cache-control']).toBe('private, max-age=3600');
    expect(Buffer.compare(full.body as Buffer, MP4)).toBe(0);

    const ranged = await request(app).get(v.url).set('Range', 'bytes=0-11');
    expect(ranged.status).toBe(206);
    expect(ranged.headers['content-range']).toBe(`bytes 0-11/${MP4.length}`);
    expect(ranged.headers['content-length']).toBe('12');

    // The runtime FHIR bundle holds a Media resource per upload.
    const bundle = store.runtimeBundle(doc.id)!;
    const mediaRes = bundle.entry.map((e) => e.resource).filter((r) => r.resourceType === 'Media');
    expect(mediaRes).toHaveLength(2);
    expect(mediaRes[0]).toMatchObject({
      status: 'completed',
      type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/media-type', code: 'image' }] },
      subject: { reference: `urn:uuid:${doc.profile.ehr!.sourcePatientId}` },
      createdDateTime: '2026-11-05T18:30:00.000-05:00',
      content: { contentType: 'image/jpeg', url: p.url, size: JPEG.length, title: 'Rash on my arm' },
    });

    // Export includes active Media.
    const exp = JSON.parse((await request(app).get(`/api/patients/${doc.id}/fhir`)).text);
    expect(exp.entry.filter((e: { resource: { resourceType: string } }) => e.resource.resourceType === 'Media')).toHaveLength(2);

    // Delete.
    expect((await request(app).delete(`/api/patients/${doc.id}/media/${p.id}`)).body).toEqual({ ok: true });
    expect(existsSync(path.join(mediaDir!, doc.id, `${p.id}.jpg`))).toBe(false);
    expect(((await request(app).get(`/api/patients/${doc.id}/media`)).body as MediaItem[]).map((m) => m.id)).toEqual([v.id]);
    expect((await request(app).get(p.url)).status).toBe(404);
    expect((await request(app).delete(`/api/patients/${doc.id}/media/${p.id}`)).status).toBe(404);
    expect(store.runtimeBundle(doc.id)!.entry.find((e) => e.resource.id === p.id)!.resource.status).toBe('entered-in-error');
    const exp2 = JSON.parse((await request(app).get(`/api/patients/${doc.id}/fhir`)).text);
    expect(exp2.entry.filter((e: { resource: { resourceType: string } }) => e.resource.resourceType === 'Media')).toHaveLength(1);

    // Restart: registry rebuilt from FHIR, deleted item stays deleted, bytes still served.
    const again = createStore({ today: TODAY, runtimeDir, mediaDir });
    const app2 = createApp(again, { hub: fakeHub().hub });
    const replayed = (await request(app2).get(`/api/patients/${doc.id}/media`)).body as MediaItem[];
    expect(replayed).toEqual([v]);
    const part = await request(app2)
      .get(v.url)
      .set('Range', 'bytes=4-7')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(part.status).toBe(206);
    expect((part.body as Buffer).toString('latin1')).toBe('ftyp');

    // Reset clears media files and items.
    await request(app2).post('/api/demo/reset');
    expect((await request(app2).get(`/api/patients/${doc.id}/media`)).body).toEqual([]);
    expect(existsSync(mediaDir!) ? readdirSync(mediaDir!) : []).toEqual([]);
  });

  it.each([
    ['spoofed type (PNG bytes as video/mp4)', PNG, 'video/mp4', 'kind=video', /looks like image\/png/],
    ['spoofed type (MP4 bytes as image/jpeg)', MP4, 'image/jpeg', 'kind=photo', /not image\/jpeg/],
    ['kind/type mismatch', JPEG, 'image/jpeg', 'kind=video', /does not match/],
    ['bad kind', JPEG, 'image/jpeg', 'kind=audio', /kind/],
    ['missing kind', JPEG, 'image/jpeg', '', /kind/],
    ['unsupported type', Buffer.from('hello'), 'text/plain', 'kind=photo', /Unsupported/],
    ['empty body', Buffer.alloc(0), 'image/jpeg', 'kind=photo', /Empty/],
    ['caption too long', JPEG, 'image/jpeg', `kind=photo&caption=${'x'.repeat(501)}`, /caption/],
    ['bad takenAt', JPEG, 'image/jpeg', 'kind=photo&takenAt=yesterday', /takenAt/],
  ])('400 on %s', async (_n, body, type, query, msg) => {
    const { store, app } = setup();
    const res = await upload(app, store.listPatients()[2].id, body, type, query);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(msg);
  });

  it('400 on an oversize photo (> 15 MB)', async () => {
    const { store, app } = setup();
    const big = Buffer.concat([JPEG.subarray(0, 6), Buffer.alloc(15 * 1024 * 1024)]);
    const res = await upload(app, store.listPatients()[2].id, big, 'image/jpeg', 'kind=photo');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/15 MB/);
  });

  it('404 for unknown patient / media', async () => {
    const { app } = setup();
    expect((await upload(app, 'nope', JPEG, 'image/jpeg', 'kind=photo')).status).toBe(404);
    expect((await request(app).get('/api/media/nope/content')).status).toBe(404);
  });
});

describe('voice check-ins with media evidence', () => {
  it('stores entryMode, transcript and mediaIds; FHIR round-trips them; publishes checkin.created', async () => {
    const { store, app, events, runtimeDir, mediaDir } = setup(true);
    const doc = store.listPatients()[2];
    const photo = (await upload(app, doc.id, JPEG, 'image/jpeg', 'kind=photo')).body as MediaItem;
    const res = await request(app)
      .post(`/api/patients/${doc.id}/tracker-responses`)
      .send({
        trackerId: 'asthma-v3',
        submittedAt: `${TODAY}T23:30:00.000-05:00`,
        entryMode: 'voice',
        transcript: '  I feel okay but I was wheezing after soccer  ',
        mediaIds: [photo.id],
        responses: [
          { questionId: Q.asthma.feeling, value: 'Okay' },
          { questionId: Q.asthma.symptoms, value: '["Wheezing"]' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.created).toMatchObject({ entryMode: 'voice', transcript: 'I feel okay but I was wheezing after soccer', mediaIds: [photo.id] });
    const checkin = events.find((e) => e.event.type === 'checkin.created')!;
    expect(checkin.event).toEqual({ type: 'checkin.created', patientId: doc.id });
    expect(checkin.audience.clinicianIds).toEqual(careTeamFor(doc));

    const qr = store.runtimeBundle(doc.id)!.entry.map((e) => e.resource).find((r) => r.id === res.body.created.id)!;
    const urls = qr.extension.map((e: { url: string }) => e.url.split('/').pop());
    expect(urls).toEqual(expect.arrayContaining(['entry-mode', 'voice-transcript', 'evidence-media']));
    expect(qr.extension.find((e: { url: string }) => e.url.endsWith('evidence-media')).valueReference.reference).toBe(`urn:uuid:${photo.id}`);

    const again = createStore({ today: TODAY, runtimeDir, mediaDir });
    const replayed = again
      .getPatient(doc.id)!
      .dailyLogs.flatMap((l) => l.trackerResponses ?? [])
      .find((r) => r.id === res.body.created.id);
    expect(replayed).toEqual(res.body.created);
  });

  it.each([
    ['unknown media id', () => ({ mediaIds: ['nope'] })],
    ['bad entryMode', () => ({ entryMode: 'telepathy' })],
    ['transcript not a string', () => ({ transcript: 42 })],
    ['transcript too long', () => ({ transcript: 'a'.repeat(4001) })],
    ['mediaIds not an array', () => ({ mediaIds: 'abc' })],
    ['too many mediaIds', (id: string) => ({ mediaIds: Array.from({ length: 11 }, () => id) })],
  ])('400 on %s', async (_n, make) => {
    const { store, app } = setup();
    const doc = store.listPatients()[2];
    const photo = (await upload(app, doc.id, JPEG, 'image/jpeg', 'kind=photo')).body as MediaItem;
    const res = await request(app)
      .post(`/api/patients/${doc.id}/tracker-responses`)
      .send({ trackerId: 'asthma-v3', responses: [], ...make(photo.id) });
    expect(res.status).toBe(400);
  });

  it('rejects media that belongs to another patient or was deleted', async () => {
    const { store, app } = setup();
    const [a, b] = [store.listPatients()[2], store.listPatients()[3]];
    const other = (await upload(app, b.id, JPEG, 'image/jpeg', 'kind=photo')).body as MediaItem;
    expect((await request(app).post(`/api/patients/${a.id}/tracker-responses`).send({ trackerId: 'asthma-v3', responses: [], mediaIds: [other.id] })).status).toBe(400);
    const mine = (await upload(app, a.id, JPEG, 'image/jpeg', 'kind=photo')).body as MediaItem;
    await request(app).delete(`/api/patients/${a.id}/media/${mine.id}`);
    expect((await request(app).post(`/api/patients/${a.id}/tracker-responses`).send({ trackerId: 'asthma-v3', responses: [], mediaIds: [mine.id] })).status).toBe(400);
  });
});

describe('check-in linking', () => {
  it('links media to the check-in that references it, even though it was uploaded first', async () => {
    const { store, app } = setup();
    const doc = store.listPatients().find((p) => p.trackers.some((t) => t.trackerId === 'asthma-v3'))!;
    const photo = (await upload(app, doc.id, JPEG, 'image/jpeg', 'kind=photo&caption=rash')).body as MediaItem;
    expect(photo.trackerResponseId).toBeUndefined();
    const checkIn = await request(app)
      .post(`/api/patients/${doc.id}/tracker-responses`)
      .send({ trackerId: 'asthma-v3', responses: [{ questionId: Q.asthma.feeling, value: 'Okay' }], mediaIds: [photo.id] });
    expect(checkIn.status).toBe(201);
    const list = (await request(app).get(`/api/patients/${doc.id}/media`)).body as MediaItem[];
    expect(list.find((m) => m.id === photo.id)?.trackerResponseId).toBe(checkIn.body.created.id);
  });
});
