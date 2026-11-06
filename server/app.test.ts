import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock analytics so these tests are independent of the (concurrently built) real engine.
vi.mock('../shared/analytics', () => ({
  buildPatientListItem: vi.fn((doc: { id: string; profile: { mrn: string } }) => ({
    id: doc.id,
    mrn: doc.profile.mrn,
    attentionScore: Number(doc.profile.mrn.slice(-2)),
  })),
  buildPatientSummary: vi.fn((doc: { id: string }, _t: unknown, opts: unknown) => ({ patient: { id: doc.id }, opts })),
  summaryToCsv: vi.fn(() => 'date,value\r\n2026-11-06,1\r\n'),
}));

import * as analytics from '../shared/analytics';
import { createApp } from './app';
import { createStore } from './data/store';

const TODAY = '2026-11-06';
const store = createStore({ today: TODAY });
const app = createApp(store);
const patient = store.listPatients()[2]; // story #3
const slug = patient.profile.lastName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

beforeEach(() => vi.clearAllMocks());

describe('API', () => {
  it('GET /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, patients: 10, today: TODAY });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('GET /api/trackers', async () => {
    const res = await request(app).get('/api/trackers');
    expect(res.status).toBe(200);
    expect(res.body.map((t: { id: string }) => t.id)).toEqual(['asthma-v3', 'migraine-v2', 'ibd-v1']);
  });

  it('GET /api/patients sorts by attentionScore desc', async () => {
    const res = await request(app).get('/api/patients');
    expect(res.status).toBe(200);
    expect(res.body.today).toBe(TODAY);
    const scores = res.body.patients.map((p: { attentionScore: number }) => p.attentionScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(res.body.patients).toHaveLength(10);
    expect(analytics.buildPatientListItem).toHaveBeenCalledWith(expect.anything(), store.trackers, TODAY);
  });

  it('GET /api/patients/:id/raw', async () => {
    const res = await request(app).get(`/api/patients/${patient.id}/raw`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(patient.id);
    expect(res.body.profile.mrn).toBe(patient.profile.mrn);
  });

  it('GET /api/patients/:id/summary passes window options', async () => {
    let res = await request(app).get(`/api/patients/${patient.id}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.opts).toEqual({ days: 30, end: TODAY, today: TODAY });

    res = await request(app).get(`/api/patients/${patient.id}/summary?days=all&end=2026-10-01`);
    expect(res.body.opts).toEqual({ days: 'all', end: '2026-10-01', today: TODAY });

    res = await request(app).get(`/api/patients/${patient.id}/summary?days=90`);
    expect(res.body.opts.days).toBe(90);
  });

  it.each([
    'days=0',
    'days=731',
    'days=abc',
    'days=1.5',
    'days=-3',
    'days=30&days=90',
    'end=2026-13-01',
    'end=2026-02-30',
    'end=yesterday',
    'end=2026-1-1',
  ])('400 on bad params (%s)', async (qs) => {
    for (const path of ['summary', 'export.csv']) {
      const res = await request(app).get(`/api/patients/${patient.id}/${path}?${qs}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
  });

  it('404 for unknown patient and unknown /api routes', async () => {
    for (const url of ['/api/patients/nope/summary', '/api/patients/nope/raw', '/api/patients/nope/export.csv', '/api/nothing', '/api/patients/x/y']) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(404);
      expect(res.headers['content-type']).toMatch(/json/);
      expect(res.body.error).toEqual(expect.any(String));
    }
  });

  it('GET /api/patients/:id/export.csv', async () => {
    const res = await request(app).get(`/api/patients/${patient.id}/export.csv?days=90&end=2026-10-31`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${slug}-90d-2026-10-31.csv"`);
    expect(res.text).toBe('date,value\r\n2026-11-06,1\r\n');
    expect(analytics.buildPatientSummary).toHaveBeenCalledWith(patient, store.trackers, { days: 90, end: '2026-10-31', today: TODAY });

    const all = await request(app).get(`/api/patients/${patient.id}/export.csv?days=all`);
    expect(all.headers['content-disposition']).toBe(`attachment; filename="${slug}-all-${TODAY}.csv"`);
  });

  it('500 JSON when analytics throws', async () => {
    vi.mocked(analytics.buildPatientSummary).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const res = await request(app).get(`/api/patients/${patient.id}/summary`);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/boom/);
  });
});
