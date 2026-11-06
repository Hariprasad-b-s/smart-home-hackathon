import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { RawPatientDocument } from '../../shared/types/raw';
import { createApp } from '../app';
import { generatePatients } from '../data/generate';
import { createStore } from '../data/store';
import { Q, TRACKERS } from '../data/trackers';
import type { FhirBundle, FhirResource } from './constants';
import { fhirToRaw } from './fromFhir';
import { docToEntries, entriesToFhir, makeContext } from './toFhir';

const TODAY = '2026-11-06';
const docs = generatePatients({ today: TODAY });

/** Canonical multisets of a document's tracker responses, doses and readings. */
function canon(entries: ReturnType<typeof docToEntries>) {
  const sortKeys = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(sortKeys)
      : x && typeof x === 'object'
        ? Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)]))
        : x;
  const s = (x: unknown) => JSON.stringify(sortKeys(x));
  return {
    responses: entries.filter((e) => e.kind === 'trackerResponse').map((e) => s(e)).sort(),
    doses: entries.filter((e) => e.kind === 'medicationAdministration').map((e) => s(e)).sort(),
    readings: entries.flatMap((e) => (e.kind === 'spirometry' ? e.data.map(s) : [])).sort(),
    devices: entries.filter((e) => e.kind === 'device').map((e) => s({ ...e.data, baselineReadingDate: null })).sort(),
    badges: entries.filter((e) => e.kind === 'badge').map((e) => s(e)).sort(),
  };
}

describe('raw ⇄ FHIR round trip', () => {
  it.each(docs.map((d) => [d.profile.lastName, d] as [string, RawPatientDocument]))('is lossless for %s', (_n, doc) => {
    const entries = docToEntries(doc);
    const resources = entriesToFhir(entries, makeContext(doc, TRACKERS, 'empty'));
    expect(new Set(resources.map((r) => r.id)).size).toBe(resources.length);
    const back = fhirToRaw(resources, TRACKERS);
    expect(canon(back)).toEqual(canon(entries));
  });
});

describe('voice check-in fields round-trip', () => {
  it.each([
    { entryMode: 'voice' as const, transcript: 'I was wheezing after soccer', mediaIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'] },
    { entryMode: 'form' as const, transcript: null, mediaIds: [] },
    { entryMode: 'voice' as const },
  ])('keeps %o', (extra) => {
    const doc = structuredClone(docs[2]);
    const log = doc.dailyLogs.at(-1)!;
    const r = { ...structuredClone(log.trackerResponses?.[0] ?? { id: 'x', trackerId: 'asthma-v3', submittedAt: `${log.day}T19:00:00.000-05:00`, responses: [] }), id: 'voice-1', ...extra };
    const entries = [{ kind: 'trackerResponse' as const, day: log.day, data: r }];
    const back = fhirToRaw(entriesToFhir(entries, makeContext(doc, TRACKERS, 'empty')), TRACKERS);
    expect(back).toEqual(entries);
  });
});

describe('FHIR endpoints', () => {
  const store = createStore({ today: TODAY });
  const app = createApp(store);

  it('GET /api/fhir/Questionnaire returns one Questionnaire per tracker', async () => {
    const res = await request(app).get('/api/fhir/Questionnaire');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/fhir\+json/);
    const b = JSON.parse(res.text) as FhirBundle;
    expect(b.resourceType).toBe('Bundle');
    expect(b.entry.map((e) => e.resource.id)).toEqual(['asthma-v3', 'migraine-v2', 'ibd-v1']);
    const asthma = b.entry[0].resource;
    const types = new Set(b.entry.flatMap((e) => e.resource.item.map((i: { type: string }) => i.type)));
    for (const t of ['boolean', 'decimal', 'integer', 'choice', 'open-choice']) expect(types).toContain(t);
    const symptoms = asthma.item.find((i: { linkId: string }) => i.linkId === Q.asthma.symptoms);
    expect(symptoms.answerOption.map((o: { valueCoding: { code: string } }) => o.valueCoding.code)).toContain('None of these ');
  });

  it.each([2, 0, 6, 7])('GET /api/patients/:id/fhir is a valid Synthea-style bundle (patient %i)', async (i) => {
    const doc = store.listPatients()[i];
    const res = await request(app).get(`/api/patients/${doc.id}/fhir`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/fhir\+json/);
    const b = JSON.parse(res.text) as FhirBundle;
    expect(b).toMatchObject({ resourceType: 'Bundle', type: 'collection' });
    const patient = b.entry[0].resource;
    expect(patient.resourceType).toBe('Patient');
    expect(patient.identifier.some((x: { value: string }) => x.value === doc.profile.mrn)).toBe(true);
    expect(patient.address[0].city).toBe('Cincinnati');
    if (doc.profile.ehr) expect(patient.id).toBe(doc.profile.ehr.sourcePatientId);

    const questionnaires = new Set(
      JSON.parse((await request(app).get('/api/fhir/Questionnaire')).text).entry.map((e: { resource: FhirResource }) => e.resource.url),
    );
    const ref = `urn:uuid:${patient.id}`;
    const byType = new Map<string, FhirResource[]>();
    for (const { fullUrl, resource: r } of b.entry) {
      expect(r.resourceType).toEqual(expect.any(String));
      expect(r.id).toEqual(expect.any(String));
      if (r.resourceType !== 'Questionnaire') expect(fullUrl).toBe(`urn:uuid:${r.id}`);
      if (!['Patient', 'Questionnaire'].includes(r.resourceType)) expect((r.subject ?? r.patient)?.reference, r.resourceType).toBe(ref);
      if (r.resourceType === 'QuestionnaireResponse') expect(questionnaires).toContain(r.questionnaire);
      byType.set(r.resourceType, [...(byType.get(r.resourceType) ?? []), r]);
    }
    expect(byType.get('QuestionnaireResponse')?.length).toBeGreaterThan(5);
    if (doc.profile.ehr) {
      expect(byType.get('Condition')?.length).toBeGreaterThan(0);
      expect(byType.get('Observation')!.some((o) => o.code.coding[0].code === '8302-2')).toBe(true);
    }
    const blows = (byType.get('Observation') ?? []).filter((o) => o.code.coding[0].code === 'spirometry-blow');
    if (doc.medicalDevices?.length) {
      expect(blows.length).toBe(doc.medicalDevices[0].baselineReadings.length);
      for (const o of blows) {
        const codes = o.component.map((c: { code: { coding: { system: string; code: string }[] } }) => c.code.coding[0]);
        expect(codes.every((c: { system: string }) => c.system === 'http://loinc.org')).toBe(true);
        expect(codes.map((c: { code: string }) => c.code)).toEqual(['20150-9', '19868-9', '19926-5', '19935-6']);
        expect(o.device.reference).toMatch(/^urn:uuid:/);
      }
      expect(byType.get('Device')).toHaveLength(1);
    }
    // The export itself round-trips back to the same home-monitoring data.
    expect(canon(fhirToRaw(b, TRACKERS))).toEqual(canon(docToEntries(doc)));
  });

  it('asthma doses carry RxNorm codes from the Synthea prescriptions', async () => {
    const doc = store.listPatients()[2];
    const b = JSON.parse((await request(app).get(`/api/patients/${doc.id}/fhir`)).text) as FhirBundle;
    const mas = b.entry.map((e) => e.resource).filter((r) => r.resourceType === 'MedicationAdministration');
    expect(mas.length).toBeGreaterThan(10);
    expect(mas.every((m) => m.medicationCodeableConcept.coding?.[0]?.system === 'http://www.nlm.nih.gov/research/umls/rxnorm')).toBe(true);
    expect(mas.every((m) => m.extension[0].url.endsWith('app-medication-id'))).toBe(true);
  });

  it('404 for an unknown patient', async () => {
    expect((await request(app).get('/api/patients/nope/fhir')).status).toBe(404);
  });
});
