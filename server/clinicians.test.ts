import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import type { ClinicianPreferences, ClinicianProfile } from '../shared/types/api';
import { createApp } from './app';
import { POINT_KEYS } from './data/clinicians';
import { createStore } from './data/store';

const TODAY = '2026-11-06';
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'smart-home-clin-'));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const setup = (cliniciansDir: string | null = null) => {
  const store = createStore({ today: TODAY, cliniciansDir, now: () => new Date('2026-11-06T15:00:00Z') });
  return { store, app: createApp(store) };
};

const validPrefs = (): ClinicianPreferences => ({
  clinicianId: 'demo-pulm',
  layouts: {
    pulmonology: {
      sections: [
        { id: 'lungFunction', visible: true, width: 'full' },
        { id: 'medications', visible: false, width: 'half' },
      ],
      headline: [
        { id: 'zone', visible: true },
        { id: 'rescueUse', visible: false },
      ],
    },
  },
  visitMode: {
    headline: true,
    dayCounts: false,
    calendar: true,
    achievements: true,
    points: { medication: true, rescue: false, abortive: true, lungFunction: true, symptoms: true, school: false, checkins: true },
  },
});

describe('clinicians', () => {
  it('GET /api/clinicians lists 4 demo clinicians', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/clinicians');
    expect(res.status).toBe(200);
    const list = res.body as ClinicianProfile[];
    expect(list.map((c) => c.id)).toEqual(['demo-pulm', 'demo-pcp', 'demo-nurse', 'demo-neuro']);
    expect(list.map((c) => c.defaultView)).toEqual(['pulmonology', 'primaryCare', 'nursing', 'neurology']);
  });

  it('returns defaults when nothing is saved', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/clinicians/demo-pcp/preferences');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      clinicianId: 'demo-pcp',
      layouts: {},
      visitMode: { headline: true, dayCounts: true, calendar: true, achievements: true, points: Object.fromEntries(POINT_KEYS.map((k) => [k, true])) },
    });
    expect(Object.keys(res.body.visitMode.points).sort()).toEqual(['abortive', 'checkins', 'lungFunction', 'medication', 'rescue', 'school', 'symptoms']);
  });

  it('PUT → GET round trip, persisted across a restart, cleared by reset', async () => {
    const dir = tmp();
    const { app } = setup(dir);
    const put = await request(app).put('/api/clinicians/demo-pulm/preferences').send(validPrefs());
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ ...validPrefs(), updatedAt: '2026-11-06T15:00:00.000Z' });
    expect((await request(app).get('/api/clinicians/demo-pulm/preferences')).body).toEqual(put.body);
    expect(existsSync(path.join(dir, 'demo-pulm.json'))).toBe(true);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);

    const restarted = setup(dir);
    expect((await request(restarted.app).get('/api/clinicians/demo-pulm/preferences')).body).toEqual(put.body);
    // Other clinicians are unaffected.
    expect((await request(restarted.app).get('/api/clinicians/demo-neuro/preferences')).body.layouts).toEqual({});

    expect((await request(restarted.app).post('/api/demo/reset')).status).toBe(200);
    expect(readdirSync(dir).filter((f) => f.endsWith('.json'))).toEqual([]);
    expect((await request(restarted.app).get('/api/clinicians/demo-pulm/preferences')).body.layouts).toEqual({});
  });

  it('merges saved preferences over defaults so new keys default to true', async () => {
    const dir = tmp();
    writeFileSync(
      path.join(dir, 'demo-nurse.json'),
      JSON.stringify({ clinicianId: 'demo-nurse', layouts: {}, visitMode: { headline: false, points: { rescue: false } } }),
    );
    const { app } = setup(dir);
    const body = (await request(app).get('/api/clinicians/demo-nurse/preferences')).body as ClinicianPreferences;
    expect(body.visitMode.headline).toBe(false);
    expect(body.visitMode.calendar).toBe(true);
    expect(body.visitMode.points.rescue).toBe(false);
    expect(body.visitMode.points.checkins).toBe(true);
    expect(Object.keys(body.visitMode.points)).toHaveLength(POINT_KEYS.length);
  });

  it('404 for an unknown clinician', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/clinicians/nobody/preferences')).status).toBe(404);
    expect((await request(app).put('/api/clinicians/nobody/preferences').send({ ...validPrefs(), clinicianId: 'nobody' })).status).toBe(404);
  });

  const mutate = (f: (p: any) => void) => {
    const p = validPrefs() as any;
    f(p);
    return p;
  };
  it.each([
    ['clinicianId mismatch', mutate((p) => (p.clinicianId = 'demo-pcp'))],
    ['layouts not an object', mutate((p) => (p.layouts = []))],
    ['section without visible', mutate((p) => delete p.layouts.pulmonology.sections[0].visible)],
    ['bad width', mutate((p) => (p.layouts.pulmonology.sections[0].width = 'wide'))],
    ['duplicate section id', mutate((p) => (p.layouts.pulmonology.sections[1].id = 'lungFunction'))],
    ['duplicate headline id', mutate((p) => (p.layouts.pulmonology.headline[1].id = 'zone'))],
    ['too many sections', mutate((p) => (p.layouts.pulmonology.sections = Array.from({ length: 51 }, (_, i) => ({ id: `s${i}`, visible: true, width: 'full' }))))],
    ['headline not array', mutate((p) => (p.layouts.pulmonology.headline = {}))],
    ['empty id', mutate((p) => (p.layouts.pulmonology.headline[0].id = ''))],
    ['unknown layout field', mutate((p) => (p.layouts.pulmonology.extra = 1))],
    ['visitMode flag not boolean', mutate((p) => (p.visitMode.calendar = 'yes'))],
    ['point not boolean', mutate((p) => (p.visitMode.points.rescue = 1))],
    ['unknown point key', mutate((p) => (p.visitMode.points.weather = true))],
    ['missing visitMode', mutate((p) => delete p.visitMode)],
    ['unknown top-level field', mutate((p) => (p.theme = 'dark'))],
  ])('400 on %s', async (_n, body) => {
    const { app } = setup();
    const res = await request(app).put('/api/clinicians/demo-pulm/preferences').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
  });
});
