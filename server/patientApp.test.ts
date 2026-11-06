import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import type { PatientAppHome, WriteResult } from '../shared/types/api';
import type { RawBaselineReading, RawTrackerResponse } from '../shared/types/raw';
import type { PatientSummary } from '../shared/types/summary';
import { createApp } from './app';
import { addDays } from './data/generate';
import { createStore, type Store } from './data/store';
import { Q } from './data/trackers';

const TODAY = '2026-11-06'; // a Friday
const fixedNow = () => new Date('2026-11-06T17:00:00Z');
const tmpDirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'smart-home-fhir-'));
  tmpDirs.push(d);
  return d;
};
afterAll(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup(runtimeDir: string | null = null) {
  const store = createStore({ today: TODAY, now: fixedNow, runtimeDir });
  return { store, app: createApp(store) };
}
const asthma = (s: Store) => s.listPatients()[2]; // story #3, not taking controller
const migraine = (s: Store) => s.listPatients()[6];
const ibd = (s: Store) => s.listPatients()[7];
const combo = (s: Store) => s.listPatients()[8];
const late = (min: number) => `${TODAY}T23:${String(min).padStart(2, '0')}:00.000-05:00`;

async function summaryToday(app: ReturnType<typeof createApp>, id: string): Promise<PatientSummary> {
  const res = await request(app).get(`/api/patients/${id}/summary?days=1`);
  expect(res.status).toBe(200);
  return res.body;
}

function blow(min: number, pefLps: number, accepted = true): RawBaselineReading {
  return {
    baselineReadingDate: late(min),
    accepted,
    qualityReport: { quality: accepted ? 'Acceptable' : 'NotAcceptable', qualityIndications: [{ messageInstructions: 'KeepGoingUntilCompletelyEmpty' }] },
    fvcPlusResults: { fvc: 3.512345, fev1: 2.401234, fev1FvcRatio: 68.367, pef: pefLps, fef2575: 1.9, fev6: 3.4, fet: 6.2, pefTime: 88, extrapolatedVolume: 70 },
  };
}

describe('POST tracker-responses', () => {
  it('appends a raw check-in, recomputes the zone and shows up in the summary', async () => {
    const { store, app } = setup();
    const doc = asthma(store);
    const res = await request(app)
      .post(`/api/patients/${doc.id}/tracker-responses`)
      .send({
        trackerId: 'asthma-v3',
        submittedAt: late(50),
        responses: [
          { questionId: Q.asthma.spirometer, value: '' },
          { questionId: Q.asthma.feeling, value: 'Bad' },
          { questionId: Q.asthma.symptoms, value: '["Wheezing","Tight Chest"]' },
          { questionId: Q.asthma.nightWaking, value: 'true' },
          { questionId: Q.asthma.rescueUses, value: '2' },
        ],
      });
    expect(res.status).toBe(201);
    const body = res.body as WriteResult<RawTrackerResponse>;
    expect(body.ok).toBe(true);
    expect(body.created.submittedAt).toBe(late(50));
    expect(body.message).toMatch(/Check-in saved/);
    expect(['yellow', 'red']).toContain(body.zoneToday);
    expect(doc.asthmaTreatmentPlan!.status).toBe(body.zoneToday === 'red' ? 'Red' : 'Yellow');
    const log = doc.dailyLogs.find((l) => l.day === TODAY)!;
    expect(log.trackerResponses!.some((r) => r.id === body.created.id)).toBe(true);

    const s = await summaryToday(app, doc.id);
    expect(s.days[0].symptoms).toEqual(expect.arrayContaining(['Wheezing']));
    expect(s.days[0].symptomDay).toBe(true);
  });

  it('defaults submittedAt to server now on today with an offset', async () => {
    const { store, app } = setup();
    const res = await request(app).post(`/api/patients/${migraine(store).id}/tracker-responses`).send({
      trackerId: 'migraine-v2',
      responses: [{ questionId: Q.migraine.headache, value: 'false' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.created.submittedAt).toMatch(new RegExp(`^${TODAY}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}-05:00$`));
    expect(res.body.zoneToday).toBeUndefined();
  });

  it('awards TrackerBadge5 when the 5th check-in day is logged', async () => {
    const { store, app } = setup();
    const doc = store.listPatients()[9]; // new patient, 4 days of data
    let badge: WriteResult<unknown>['newBadge'];
    for (let i = 5; i < 40 && !badge; i++) {
      const day = addDays(TODAY, -i);
      const res = await request(app)
        .post(`/api/patients/${doc.id}/tracker-responses`)
        .send({ trackerId: 'asthma-v3', submittedAt: `${day}T19:00:00.000-05:00`, responses: [{ questionId: Q.asthma.feeling, value: 'Good' }] });
      expect(res.status).toBe(201);
      badge = res.body.newBadge;
    }
    expect(badge?.name).toMatch(/^TrackerBadge5$|^TrackerStreak7$/);
    expect(doc.earnedTrackerBadges!.map((b) => b.badgeName)).toContain(badge!.name);
  });

  it.each([
    ['unassigned tracker', { trackerId: 'ibd-v1', responses: [] }],
    ['unknown question', { trackerId: 'asthma-v3', responses: [{ questionId: 'nope', value: 'x' }] }],
    ['non-string value', { trackerId: 'asthma-v3', responses: [{ questionId: Q.asthma.rescueUses, value: 3 }] }],
    ['bad choice', { trackerId: 'asthma-v3', responses: [{ questionId: Q.asthma.feeling, value: 'Meh' }] }],
    ['checkbox not JSON', { trackerId: 'asthma-v3', responses: [{ questionId: Q.asthma.symptoms, value: 'Wheezing' }] }],
    ['checkbox unknown option', { trackerId: 'asthma-v3', responses: [{ questionId: Q.asthma.symptoms, value: '["Sneezing"]' }] }],
    ['number out of range', { trackerId: 'asthma-v3', responses: [{ questionId: Q.asthma.rescueUses, value: '99' }] }],
    ['number not numeric', { trackerId: 'asthma-v3', responses: [{ questionId: Q.asthma.rescueUses, value: 'two' }] }],
    ['bad yes/no', { trackerId: 'asthma-v3', responses: [{ questionId: Q.asthma.nightWaking, value: 'maybe' }] }],
    ['future submittedAt', { trackerId: 'asthma-v3', submittedAt: '2026-11-07T08:00:00.000-05:00', responses: [] }],
    ['bad submittedAt', { trackerId: 'asthma-v3', submittedAt: 'yesterday', responses: [] }],
    ['responses missing', { trackerId: 'asthma-v3' }],
  ])('400 on %s', async (_name, body) => {
    const { store, app } = setup();
    const res = await request(app).post(`/api/patients/${asthma(store).id}/tracker-responses`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it('accepts "None of these " with its stray whitespace and stores it verbatim', async () => {
    const { store, app } = setup();
    const res = await request(app)
      .post(`/api/patients/${asthma(store).id}/tracker-responses`)
      .send({ trackerId: 'asthma-v3', submittedAt: late(10), responses: [{ questionId: Q.asthma.symptoms, value: '["None of these "]' }] });
    expect(res.status).toBe(201);
    expect(res.body.created.responses[0].value).toBe('["None of these "]');
  });

  it('rejects non-JSON bodies and unknown patients', async () => {
    const { store, app } = setup();
    expect((await request(app).post(`/api/patients/${asthma(store).id}/tracker-responses`).type('text').send('hi')).status).toBe(400);
    expect((await request(app).post(`/api/patients/${asthma(store).id}/tracker-responses`).type('json').send('{bad')).status).toBe(400);
    expect((await request(app).post('/api/patients/nope/tracker-responses').send({})).status).toBe(404);
  });
});

describe('POST medication-administrations', () => {
  it('appends a dose that counts toward adherence', async () => {
    const { store, app } = setup();
    const doc = asthma(store);
    const controller = doc.medications.find((m) => m.howOften === 'Daily' && !m.archived)!;
    const before = (await summaryToday(app, doc.id)).days[0].scheduledDosesTaken;
    const res = await request(app).post(`/api/patients/${doc.id}/medication-administrations`).send({ medicationId: controller.id, time: '23:55' });
    expect(res.status).toBe(201);
    expect(res.body.created).toEqual({ id: controller.id, time: '23:55', name: controller.name, value: 1 });
    expect(res.body.message).toMatch(controller.name);
    const after = (await summaryToday(app, doc.id)).days[0].scheduledDosesTaken;
    expect(after).toBe(Math.min(before + 1, 2));
  });

  it('logs a rescue dose as an as-needed use', async () => {
    const { store, app } = setup();
    const doc = asthma(store);
    const rescue = doc.medications.find((m) => m.howOften === 'As Needed')!;
    const before = (await summaryToday(app, doc.id)).days[0].asNeededUses;
    const res = await request(app).post(`/api/patients/${doc.id}/medication-administrations`).send({ medicationId: rescue.id, time: '23:56', quantity: 2 });
    expect(res.status).toBe(201);
    expect(res.body.created.value).toBe(2);
    expect((await summaryToday(app, doc.id)).days[0].asNeededUses).toBeGreaterThan(before);
  });

  it.each([
    ['unknown medication', () => ({ medicationId: 'nope' })],
    ['bad time', (m: string) => ({ medicationId: m, time: '25:00' })],
    ['bad day', (m: string) => ({ medicationId: m, day: '2026-02-30' })],
    ['future day', (m: string) => ({ medicationId: m, day: '2026-11-07' })],
    ['bad quantity', (m: string) => ({ medicationId: m, quantity: -1 })],
  ])('400 on %s', async (_n, make) => {
    const { store, app } = setup();
    const doc = asthma(store);
    const res = await request(app).post(`/api/patients/${doc.id}/medication-administrations`).send(make(doc.medications[0].id));
    expect(res.status).toBe(400);
  });

  it('400 on an archived medication', async () => {
    const { store, app } = setup();
    const doc = combo(store);
    const archived = doc.medications.find((m) => m.archived)!;
    const res = await request(app).post(`/api/patients/${doc.id}/medication-administrations`).send({ medicationId: archived.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/archived/);
  });
});

describe('POST spirometry-sessions', () => {
  it('appends blows, derives a red zone from a very low PEF and stores it on the plan', async () => {
    const { store, app } = setup();
    // The day's zone uses the BEST blow of the day, so pick an asthma patient with no session today.
    const doc = store
      .listPatients()
      .find((d) => d.asthmaTreatmentPlan?.personalBestPeakFlow && d.medicalDevices?.[0] && !d.medicalDevices[0].baselineReadings.some((r) => r.baselineReadingDate.startsWith(TODAY)))!;
    expect(doc).toBeDefined();
    const pb = doc.asthmaTreatmentPlan!.personalBestPeakFlow!;
    const pef = (pb * 0.4) / 60;
    const before = doc.medicalDevices![0].baselineReadings.length;
    const res = await request(app).post(`/api/patients/${doc.id}/spirometry-sessions`).send({ readings: [blow(57, pef * 0.9, false), blow(58, pef)] });
    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(2);
    expect(res.body.zoneToday).toBe('red');
    expect(res.body.message).toMatch(/peak flow/);
    expect(doc.asthmaTreatmentPlan!.status).toBe('Red');
    expect(doc.medicalDevices![0].baselineReadings.length).toBe(before + 2);
    const s = await summaryToday(app, doc.id);
    expect(s.days[0].zone).toBe('red');
    expect(s.days[0].spirometry?.pefLpm).toBe(Math.round(pef * 60));
  });

  it('creates a Spirobank device for a patient without one', async () => {
    const { store, app } = setup();
    const doc = ibd(store);
    expect(doc.medicalDevices ?? []).toHaveLength(0);
    const res = await request(app).post(`/api/patients/${doc.id}/spirometry-sessions`).send({ readings: [blow(30, 6.1)] });
    expect(res.status).toBe(201);
    expect(doc.medicalDevices![0]).toMatchObject({ name: 'Spirobank', protocol: 9, bootId: 'SM' });
    expect(doc.medicalDevices![0].advertisementName).toBe(`SM-009-${doc.medicalDevices![0].serialNumber}`);
  });

  it.each([
    ['empty readings', { readings: [] }],
    ['missing fvcPlusResults', { readings: [{ baselineReadingDate: late(1), accepted: true }] }],
    ['non-numeric fev1', { readings: [{ ...blow(1, 6), fvcPlusResults: { ...blow(1, 6).fvcPlusResults, fev1: '2.4' } }] }],
    ['bad date', { readings: [{ ...blow(1, 6), baselineReadingDate: '06/24/2026 09:31' }] }],
    ['PEF in L/min', { readings: [blow(1, 408)] }],
  ])('400 on %s', async (_n, body) => {
    const { store, app } = setup();
    const res = await request(app).post(`/api/patients/${asthma(store).id}/spirometry-sessions`).send(body);
    expect(res.status).toBe(400);
  });
});

describe('GET app/home', () => {
  it('asthma patient: action plan, spirometer, meds, streaks, last 14 days', async () => {
    const { store, app } = setup();
    const doc = asthma(store);
    const res = await request(app).get(`/api/patients/${doc.id}/app/home`);
    expect(res.status).toBe(200);
    const home = res.body as PatientAppHome;
    expect(home.today).toBe(TODAY);
    expect(home.patient.firstName).toBe(doc.profile.firstName);
    expect(home.patient.conditions.map((c) => c.condition)).toEqual(['asthma']);
    expect(home.trackers[0].definition.id).toBe('asthma-v3');
    expect(Object.keys(home.actionPlan!.steps).sort()).toEqual(['green', 'red', 'yellow']);
    expect(home.actionPlan!.steps.red.join(' ')).toMatch(/911/);
    expect(home.actionPlan!.personalBestPefLpm).toBe(doc.asthmaTreatmentPlan!.personalBestPeakFlow);
    expect(home.spirometer).toMatchObject({ deviceName: 'MIR Spirobank Smart', serialNumber: doc.medicalDevices![0].serialNumber });
    expect(home.spirometer!.latest?.pefLpm).toBeGreaterThan(100);
    const ctrl = home.medications.find((m) => m.kind === 'scheduled')!;
    expect(ctrl.timesOfDay).toHaveLength(2);
    expect(ctrl.dosesDueToday).toBe(2);
    expect(ctrl.regimen).toMatch(/twice daily/);
    expect(home.medications.find((m) => m.kind === 'asNeeded')!.regimen).toBe('As needed');
    expect(home.last14Days).toHaveLength(14);
    expect(home.last14Days.at(-1)!.date).toBe(TODAY);
    expect(home.last14Days.every((d) => ['good', 'hard', 'none'].includes(d.status))).toBe(true);
    expect(home.engagement.longestStreak).toBeGreaterThanOrEqual(home.engagement.currentStreak);
  });

  it('migraine patient: no action plan, preventive + abortive meds', async () => {
    const { store, app } = setup();
    const home = (await request(app).get(`/api/patients/${migraine(store).id}/app/home`)).body as PatientAppHome;
    expect(home.actionPlan).toBeUndefined();
    expect(home.spirometer).toBeUndefined();
    const topi = home.medications.find((m) => m.name.startsWith('Topiramate'))!;
    expect(topi).toMatchObject({ kind: 'scheduled', timesOfDay: ['08:00', '20:30'], dosesDueToday: 2 });
    expect(home.medications.find((m) => m.name.startsWith('Rizatriptan'))!.kind).toBe('asNeeded');
    expect(home.medications.some((m) => m.name === 'Ibuprofen')).toBe(false); // archived only
  });

  it('IBD patient: weekly methotrexate is due on its reminder weekday', async () => {
    const { store, app } = setup();
    const home = (await request(app).get(`/api/patients/${ibd(store).id}/app/home`)).body as PatientAppHome;
    const mtx = home.medications.find((m) => m.name === 'Methotrexate')!;
    expect(mtx.howOften).toBe('Weekly');
    expect(mtx.dosesDueToday).toBe(1); // TODAY is a Friday, reminder daysOfWeek [5]
    expect(mtx.timesOfDay).toEqual(['18:00']);
    expect(mtx.regimen).toBe('15 mg once weekly');
    expect(home.trackers[0].definition.id).toBe('ibd-v1');
  });

  it('merges archived duplicates when counting today\'s doses', async () => {
    const { store, app } = setup();
    const doc = combo(store);
    const home = (await request(app).get(`/api/patients/${doc.id}/app/home`)).body as PatientAppHome;
    const names = home.medications.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('FHIR runtime persistence', () => {
  it('writes Synthea-style FHIR, replays on restart, and reset clears it', async () => {
    const dir = tempDir();
    const { store, app } = setup(dir);
    const doc = asthma(store);
    const tr = await request(app)
      .post(`/api/patients/${doc.id}/tracker-responses`)
      .send({ trackerId: 'asthma-v3', submittedAt: late(40), responses: [{ questionId: Q.asthma.symptoms, value: '["Coughing"]' }, { questionId: Q.asthma.nightWaking, value: 'Yes' }] });
    expect(tr.status).toBe(201);
    const controller = doc.medications.find((m) => m.howOften === 'Daily')!;
    expect((await request(app).post(`/api/patients/${doc.id}/medication-administrations`).send({ medicationId: controller.id, time: '23:41', quantity: 2 })).status).toBe(201);
    expect((await request(app).post(`/api/patients/${doc.id}/spirometry-sessions`).send({ readings: [blow(42, 5.5)] })).status).toBe(201);

    const file = path.join(dir, `${doc.id}.json`);
    expect(existsSync(file)).toBe(true);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    const bundle = JSON.parse(readFileSync(file, 'utf8'));
    expect(bundle).toMatchObject({ resourceType: 'Bundle', type: 'collection' });
    const types = bundle.entry.map((e: { resource: { resourceType: string } }) => e.resource.resourceType);
    expect(types[0]).toBe('Patient');
    expect(types).toEqual(expect.arrayContaining(['QuestionnaireResponse', 'MedicationAdministration', 'Device', 'Observation']));
    for (const e of bundle.entry) expect(e.fullUrl).toBe(`urn:uuid:${e.resource.id}`);
    const synthId = doc.profile.ehr!.sourcePatientId;
    expect(bundle.entry[0].resource.id).toBe(synthId);

    // Restart: a fresh store replays the FHIR file into the raw document.
    const again = setup(dir);
    const doc2 = again.store.getPatient(doc.id)!;
    const log = doc2.dailyLogs.find((l) => l.day === TODAY)!;
    const replayed = log.trackerResponses!.find((r) => r.id === tr.body.created.id)!;
    expect(replayed).toEqual(tr.body.created);
    expect(log.medicationAdministrations!.some((m) => m.time === '23:41' && m.value === 2)).toBe(true);
    expect(doc2.medicalDevices![0].baselineReadings.some((r) => r.baselineReadingDate === late(42))).toBe(true);
    expect(doc2.asthmaTreatmentPlan!.status).toBe(doc.asthmaTreatmentPlan!.status);
    expect((await summaryToday(again.app, doc.id)).days[0].symptoms).toContain('Coughing');

    // Reset drops every patient-app entry.
    expect((await request(again.app).post('/api/demo/reset')).body).toEqual({ ok: true });
    expect(readdirSync(dir).filter((f) => f.endsWith('.json'))).toEqual([]);
    const fresh = again.store.getPatient(doc.id)!;
    expect(fresh.dailyLogs.flatMap((l) => l.trackerResponses ?? []).some((r) => r.id === tr.body.created.id)).toBe(false);
    expect(setup(dir).store.getPatient(doc.id)!.dailyLogs.flatMap((l) => l.trackerResponses ?? []).some((r) => r.id === tr.body.created.id)).toBe(false);
  });
});
