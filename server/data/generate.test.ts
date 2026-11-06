import { describe, expect, it } from 'vitest';
import type { RawPatientDocument } from '../../shared/types/raw';
import type { TrackerQuestion } from '../../shared/types/tracker';
import { addDays, generatePatients, patientFileName, seedAsthmaRx } from './generate';
import { toAppMedication } from './synthea/appMeds';
import { SYNTHEA } from './synthea/seeds';
import { createStore } from './store';
import { Q, TRACKERS } from './trackers';

const TODAY = '2026-11-06';
const docs = generatePatients({ today: TODAY });
const byMrn = (n: number) => docs.find((d) => d.profile.mrn === `DEMO-${String(n).padStart(4, '0')}`)!;
const questionIndex = new Map(TRACKERS.map((t) => [t.id, new Map(t.questions.map((q) => [q.id, q]))]));

/** Throws when a non-empty raw answer cannot be decoded per its question type. */
function decode(q: TrackerQuestion, value: string): void {
  const optionValues = (q.options ?? []).map((o) => o.value);
  switch (q.type) {
    case 'yesNo':
      expect(['true', 'false', 'Yes', 'No']).toContain(value);
      break;
    case 'number':
    case 'scale1to10': {
      const n = Number(value);
      expect(Number.isFinite(n), `${q.id}="${value}"`).toBe(true);
      if (q.min !== undefined) expect(n).toBeGreaterThanOrEqual(q.min);
      if (q.max !== undefined) expect(n).toBeLessThanOrEqual(q.max);
      break;
    }
    case 'faceScale':
    case 'iconChoice':
    case 'singleChoice':
      expect(optionValues).toContain(value);
      break;
    case 'checkbox': {
      const arr = JSON.parse(value);
      expect(Array.isArray(arr)).toBe(true);
      const trimmed = optionValues.map((v) => v.trim());
      for (const v of arr) {
        expect(typeof v).toBe('string');
        expect(trimmed, `${q.id} value "${v}"`).toContain(v.trim());
      }
      break;
    }
    case 'spirometry':
      expect(Number.isNaN(Date.parse(value))).toBe(false);
      break;
    case 'text':
      break;
  }
}

function activityDays(doc: RawPatientDocument): string[] {
  const days = doc.dailyLogs
    .filter((l) => (l.trackerResponses?.length ?? 0) > 0 || (l.medicationAdministrations?.length ?? 0) > 0)
    .map((l) => l.day);
  for (const d of doc.medicalDevices ?? []) for (const r of d.baselineReadings) days.push(r.baselineReadingDate.slice(0, 10));
  return days;
}

describe('generatePatients', () => {
  it('is deterministic for the same inputs', () => {
    const again = generatePatients({ today: TODAY });
    expect(JSON.stringify(again)).toBe(JSON.stringify(docs));
    expect(JSON.stringify(generatePatients({ today: TODAY, seed: 7 }))).not.toBe(JSON.stringify(docs));
  });

  it('produces 10 synthetic adolescents with stable ids and DEMO MRNs', () => {
    expect(docs).toHaveLength(10);
    expect(new Set(docs.map((d) => d.id)).size).toBe(10);
    docs.forEach((d, i) => {
      expect(d.patientId).toBe(d.id);
      expect(d.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(d.profile.mrn).toBe(`DEMO-${String(i + 1).padStart(4, '0')}`);
      const age = (Date.parse(TODAY) - Date.parse(d.profile.dateOfBirth)) / (365.25 * 86_400_000);
      expect(age).toBeGreaterThanOrEqual(12);
      expect(age).toBeLessThan(19); // 12–18 inclusive
    });
    expect(new Set(docs.map(patientFileName)).size).toBe(10);
  });

  it('links every dose to a medication in the same document', () => {
    for (const d of docs) {
      const ids = new Set(d.medications.map((m) => m.id));
      for (const l of d.dailyLogs) for (const a of l.medicationAdministrations ?? []) expect(ids, `${d.profile.lastName} ${a.id}`).toContain(a.id);
    }
  });

  it('only references assigned trackers and known questions, and every answer decodes', () => {
    let answers = 0;
    for (const d of docs) {
      const assigned = new Set(d.trackers.map((t) => t.trackerId));
      for (const l of d.dailyLogs) {
        for (const r of l.trackerResponses ?? []) {
          expect(assigned).toContain(r.trackerId);
          expect(r.submittedAt.slice(0, 10)).toBe(l.day);
          const qs = questionIndex.get(r.trackerId)!;
          for (const resp of r.responses ?? []) {
            const q = qs.get(resp.questionId);
            expect(q, `${r.trackerId}/${resp.questionId}`).toBeDefined();
            if (resp.value === null || resp.value === '') continue;
            decode(q!, resp.value);
            answers++;
          }
        }
      }
    }
    expect(answers).toBeGreaterThan(5000);
  });

  it('keeps dailyLogs sorted, unique and limited to days with activity', () => {
    for (const d of docs) {
      const days = d.dailyLogs.map((l) => l.day);
      expect([...days].sort()).toEqual(days);
      expect(new Set(days).size).toBe(days.length);
      for (const l of d.dailyLogs) expect((l.trackerResponses?.length ?? 0) + (l.medicationAdministrations?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  it('includes the intended messiness', () => {
    const all = docs.flatMap((d) => d.dailyLogs);
    const values = all.flatMap((l) => (l.trackerResponses ?? []).flatMap((r) => (r.responses ?? []).map((x) => x.value)));
    expect(values).toContain('true');
    expect(values).toContain('Yes');
    expect(values).toContain('["None of these "]');
    expect(all.some((l) => (l.trackerResponses ?? []).some((r) => r.responses === undefined || r.responses.length === 0))).toBe(true);
    expect(all.some((l) => (l.medicationAdministrations ?? []).some((m) => m.value === '1'))).toBe(true);
    const blows = docs.flatMap((d) => d.medicalDevices?.flatMap((x) => x.baselineReadings) ?? []);
    expect(blows.some((b) => b.accepted && b.qualityReport?.quality === 'NotAcceptable')).toBe(true);
    expect(blows.some((b) => !b.accepted)).toBe(true);
  });

  it('has plausible adolescent spirometry stored in L/s', () => {
    for (const d of docs.slice(1)) {
      for (const r of d.medicalDevices?.[0]?.baselineReadings ?? []) {
        const f = r.fvcPlusResults;
        expect(f.pef).toBeGreaterThan(1);
        expect(f.pef).toBeLessThan(10); // L/s, not L/min
        expect(f.fev1).toBeLessThan(f.fvc);
        expect(f.fev1FvcRatio).toBeCloseTo((f.fev1 / f.fvc) * 100, 2);
      }
    }
  });

  it('replicates the brief\'s example account (patient #1)', () => {
    const p = byMrn(1);
    expect(p.trackers.map((t) => t.trackerId).sort()).toEqual(['asthma-v3', 'migraine-v2']);
    const excedrin = p.medications.filter((m) => m.name === 'Excedrin');
    expect(excedrin).toHaveLength(2);
    const archived = excedrin.find((m) => m.archived)!;
    const active = excedrin.find((m) => !m.archived)!;
    expect(active.howOften).toBe('As Needed');
    expect(active.relatedCondition).toBe('Migraine');
    expect(p.medications.find((m) => m.name.startsWith('Dulera'))?.howOften).toBe('Daily');

    const log = (day: string) => p.dailyLogs.find((l) => l.day === day)!;
    const d0328 = log('2025-03-28');
    expect(d0328.allMedicationsAdministered).toBe(true);
    expect(d0328.medicationAdministrations!.map((m) => [m.time, m.id])).toEqual([
      ['20:21', archived.id],
      ['19:21', archived.id],
      ['20:21', archived.id],
    ]);
    expect(log('2026-03-11').medicationAdministrations!.map((m) => m.time)).toEqual(['12:47']);
    expect(log('2026-05-05').medicationAdministrations!.map((m) => m.time)).toEqual(['19:51', '19:51']);
    expect(log('2026-06-24').medicationAdministrations!.map((m) => m.time)).toEqual(['09:31', '09:31']);
    for (const l of p.dailyLogs) if (l.day >= '2026-01-01' && l.medicationAdministrations) expect(l.allMedicationsAdministered).toBe(false);

    const dev = p.medicalDevices![0];
    expect(dev).toMatchObject({ name: 'Spirobank', serialNumber: 'Z125775', address: 'AAF17BF4-FB64-B5AB-D7C6-27344E9A81FA', protocol: 9, bootId: 'SM', advertisementName: 'SM-009-Z125775' });
    expect(dev.baselineReadings).toHaveLength(6);
    expect(dev.baselineReadings.map((r) => r.accepted)).toEqual([false, true, false, true, false, true]);
    expect(dev.baselineReadings.every((r) => r.baselineReadingDate.startsWith('2026-06-24') && r.qualityReport?.quality === 'NotAcceptable')).toBe(true);
    expect(dev.baselineReadings.flatMap((r) => r.qualityReport!.qualityIndications!)).toHaveLength(7);

    const asthmaSubs = p.dailyLogs.flatMap((l) => (l.trackerResponses ?? []).filter((r) => r.trackerId === 'asthma-v3'));
    expect(new Set(asthmaSubs.map((r) => r.submittedAt.slice(0, 10))).size).toBe(18);
    expect(asthmaSubs.map((r) => r.submittedAt.slice(0, 10)).sort().at(-1)).toBe('2026-05-05');
    const apr28 = asthmaSubs.filter((r) => r.submittedAt.startsWith('2025-04-28'));
    expect(apr28.length).toBeGreaterThanOrEqual(6);
    const feelings = apr28.map((r) => r.responses?.find((x) => x.questionId === Q.asthma.feeling)?.value);
    expect(feelings).toContain('Bad');
    expect(feelings).toContain('Great');
    const values = asthmaSubs.flatMap((r) => r.responses ?? []);
    expect(values.filter((x) => x.questionId === Q.asthma.spirometer).every((x) => !x.value)).toBe(true);
    expect(values.some((x) => x.value === '["None of these "]')).toBe(true);
    expect(p.earnedTrackerBadges).toEqual([
      { badgeName: 'TrackerBadge10', date: '2026-03-11T16:48:59.546Z' },
      { badgeName: 'TrackerBadge5', date: '2025-05-01T00:16:23.561Z' },
    ]);
    // Fixed dates: identical regardless of "today".
    const other = generatePatients({ today: '2027-02-01' })[0];
    expect(other.dailyLogs).toEqual(p.dailyLogs.map((l) => ({ ...l, trackerResponses: l.trackerResponses?.map((r) => ({ ...r, id: expect.any(String) })) })));
  });

  it('gives relative patients recent activity (except #1 example and #6 disengaged)', () => {
    const cutoff = addDays(TODAY, -3);
    docs.forEach((d, i) => {
      const days = activityDays(d);
      expect(days.every((x) => x <= TODAY), d.profile.lastName).toBe(true);
      const recent = days.some((x) => x >= cutoff);
      if (i === 0 || i === 5) expect(recent, d.profile.lastName).toBe(false);
      else expect(recent, d.profile.lastName).toBe(true);
    });
  });

  it('encodes the clinical stories', () => {
    const from = addDays(TODAY, -29);
    const windowLogs = (d: RawPatientDocument) => d.dailyLogs.filter((l) => l.day >= from);
    const dosesOf = (d: RawPatientDocument, ids: string[]) =>
      windowLogs(d).reduce((n, l) => n + (l.medicationAdministrations ?? []).filter((m) => ids.includes(m.id)).length, 0);
    const controllerAdherence = (d: RawPatientDocument) => {
      const ctrl = d.medications.filter((m) => m.howOften === 'Daily').map((m) => m.id);
      return dosesOf(d, ctrl) / 60;
    };
    expect(controllerAdherence(byMrn(2))).toBeGreaterThan(0.85);
    expect(controllerAdherence(byMrn(3))).toBeLessThan(0.5);
    expect(controllerAdherence(byMrn(4))).toBeGreaterThan(0.85);

    // #3 has at least 2 red-zone sessions (best PEF < 50 % PB) in the last 2 weeks.
    const p3 = byMrn(3);
    const pb = p3.asthmaTreatmentPlan!.personalBestPeakFlow!;
    const best = new Map<string, number>();
    for (const r of p3.medicalDevices![0].baselineReadings) {
      const day = r.baselineReadingDate.slice(0, 10);
      if (day >= addDays(TODAY, -13)) best.set(day, Math.max(best.get(day) ?? 0, r.fvcPlusResults.pef * 60));
    }
    expect([...best.values()].filter((v) => v / pb < 0.5).length).toBeGreaterThanOrEqual(2);

    expect(byMrn(4).asthmaTreatmentPlan!.expiration! > TODAY).toBe(true);
    expect(byMrn(6).asthmaTreatmentPlan!.expiration! < TODAY).toBe(true);
    expect(byMrn(10).asthmaTreatmentPlan!.personalBestPeakFlow ?? null).toBeNull();
    expect(new Set(byMrn(10).dailyLogs.map((l) => l.day)).size).toBe(4);

    // #7 triptan used on ≥ 10 days in the last 30.
    const p7 = byMrn(7);
    const riza = p7.medications.find((m) => m.name.startsWith('Rizatriptan'))!.id;
    expect(windowLogs(p7).filter((l) => l.medicationAdministrations?.some((m) => m.id === riza)).length).toBeGreaterThanOrEqual(10);

    // #8 weekly methotrexate.
    const mtx = byMrn(8).medications.find((m) => m.name === 'Methotrexate')!;
    expect(mtx.howOften).toBe('Weekly');
    expect(mtx.dosage?.timing).toMatchObject({ periodUnit: 'Weekly', frequency: 1 });

    // #9 has doses recorded against an archived duplicate controller.
    const p9 = byMrn(9);
    const archived = p9.medications.filter((m) => m.archived).map((m) => m.id);
    expect(p9.dailyLogs.some((l) => l.medicationAdministrations?.some((m) => archived.includes(m.id)))).toBe(true);
  });
});

describe('generatePatients for other dates and seeds', () => {
  it.each([
    ['2028-02-29', 1],
    ['2027-07-15', 42],
    ['2027-01-02', 99],
  ])('keeps invariants for today=%s seed=%i', (today, seed) => {
    const set = generatePatients({ today, seed });
    expect(set).toHaveLength(10);
    set.forEach((d, i) => {
      const meds = new Set(d.medications.map((m) => m.id));
      const assigned = new Set(d.trackers.map((t) => t.trackerId));
      for (const l of d.dailyLogs) {
        for (const a of l.medicationAdministrations ?? []) expect(meds).toContain(a.id);
        for (const r of l.trackerResponses ?? []) {
          expect(assigned).toContain(r.trackerId);
          for (const x of r.responses ?? []) {
            const q = questionIndex.get(r.trackerId)!.get(x.questionId)!;
            if (x.value) decode(q, x.value);
          }
        }
      }
      const days = activityDays(d);
      if (i !== 0) expect(days.every((x) => x <= today)).toBe(true);
      if (i !== 0 && i !== 5) expect(days.some((x) => x >= addDays(today, -3)), d.profile.lastName).toBe(true);
    });
  });
});

describe('Synthea seeds', () => {
  it('load from the committed seeds.json', () => {
    expect(SYNTHEA.source).toBe('synthea');
    expect(SYNTHEA.referenceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const asthma = SYNTHEA.seeds.filter((s) => s.asthma);
    expect(asthma.length).toBeGreaterThanOrEqual(10);
    expect(SYNTHEA.seeds.length - asthma.length).toBeGreaterThanOrEqual(2);
    for (const s of SYNTHEA.seeds) {
      expect(s.firstName + s.lastName).not.toMatch(/\d/);
      expect(s.problems.some((p) => /employment|stress|education|medication review/i.test(p.display))).toBe(false);
    }
    for (const s of asthma) expect(seedAsthmaRx(s), s.lastName).not.toBeNull();
  });

  it('maps Synthea prescriptions to app medications', () => {
    expect(toAppMedication('120 ACTUAT fluticasone propionate 0.044 MG/ACTUAT Metered Dose Inhaler [Flovent]')).toMatchObject({
      role: 'controller', name: 'Flovent HFA 44 mcg', howOften: 'Daily', quantity: 2, unit: 'puffs', frequency: 2, icon: 'Inhaler',
    });
    expect(toAppMedication('budesonide 0.25 MG/ML Inhalation Suspension')).toMatchObject({
      role: 'controller', name: 'Budesonide nebulizer 0.25 mg', frequency: 2, icon: 'Liquid',
    });
    expect(toAppMedication('NDA020983 200 ACTUAT albuterol 0.09 MG/ACTUAT Metered Dose Inhaler [Ventolin]')).toMatchObject({
      role: 'rescue', name: 'Albuterol (Ventolin HFA)', howOften: 'As Needed', icon: 'Inhaler',
    });
    expect(toAppMedication('NDA021457 200 ACTUAT albuterol 0.09 MG/ACTUAT Metered Dose Inhaler [ProAir]')?.name).toBe('Albuterol (ProAir HFA)');
    expect(toAppMedication('albuterol 0.83 MG/ML Inhalation Solution')).toMatchObject({ role: 'rescue', name: 'Albuterol nebulizer', howOften: 'As Needed' });
    expect(toAppMedication('Loratadine 5 MG Chewable Tablet')).toBeNull();
  });

  it('gives every patient except #1 a Synthea EHR background', () => {
    docs.forEach((d, i) => {
      if (i === 0) return expect(d.profile.ehr ?? null).toBeNull();
      expect(d.profile.ehr?.source, d.profile.lastName).toBe('synthea');
      expect(SYNTHEA.seeds.map((s) => s.id)).toContain(d.profile.ehr!.sourcePatientId);
      expect(d.profile.firstName).not.toMatch(/\d/);
    });
    expect(new Set(docs.slice(1).map((d) => d.profile.ehr!.sourcePatientId)).size).toBe(9);
    expect(byMrn(7).profile.ehr!.problems.map((p) => p.display)).toContain('Migraine without aura');
    expect(byMrn(8).profile.ehr!.problems.map((p) => p.display)).toContain("Crohn's disease of small intestine");
    expect(byMrn(8).profile.ehr!.medicationsOnFile.some((m) => /mesalamine/i.test(m.display))).toBe(true);
  });

  it('builds asthma app meds from the patient\'s own controller and rescue prescriptions', () => {
    for (const n of [2, 3, 4, 5, 6, 9, 10]) {
      const d = byMrn(n);
      const onFile = d.profile.ehr!.medicationsOnFile.map((m) => toAppMedication(m.display, m.rxnorm)).filter((x) => x !== null);
      const asthmaMeds = d.medications.filter((m) => m.relatedCondition === 'Asthma');
      const controllers = asthmaMeds.filter((m) => m.howOften === 'Daily');
      const rescues = asthmaMeds.filter((m) => m.howOften === 'As Needed');
      expect(controllers.length, d.profile.lastName).toBeGreaterThanOrEqual(1);
      expect(rescues).toHaveLength(1);
      for (const m of asthmaMeds) {
        expect(onFile.some((o) => o.name === m.name && o.howOften === m.howOften), `${d.profile.lastName}: ${m.name}`).toBe(true);
      }
      if (n !== 10) expect(d.asthmaTreatmentPlan!.personalBestPeakFlow).toBeGreaterThan(200);
    }
  });

  it('keeps Synthea dates relative to today', () => {
    const later = generatePatients({ today: '2027-05-01' });
    later.slice(1).forEach((d, i) => {
      const now = docs[i + 1];
      expect(d.profile.ehr!.sourcePatientId).toBe(now.profile.ehr!.sourcePatientId);
      const dAge = (Date.parse('2027-05-01') - Date.parse(d.profile.dateOfBirth)) / 864e5;
      const nAge = (Date.parse(TODAY) - Date.parse(now.profile.dateOfBirth)) / 864e5;
      expect(dAge).toBe(nAge);
      expect(d.profile.ehr!.lastClinicVisit! <= '2027-05-01').toBe(true);
    });
  });
});

describe('createStore', () => {
  it('honours explicit today and looks patients up by id', () => {
    const store = createStore({ today: TODAY });
    expect(store.today).toBe(TODAY);
    expect(store.trackers).toBe(TRACKERS);
    expect(store.listPatients()).toHaveLength(10);
    const first = store.listPatients()[3];
    expect(store.getPatient(first.id)).toBe(first);
    expect(store.getPatient('nope')).toBeUndefined();
  });

  it('defaults today to DEMO_TODAY', () => {
    const prev = process.env.DEMO_TODAY;
    process.env.DEMO_TODAY = '2026-07-01';
    try {
      expect(createStore().today).toBe('2026-07-01');
    } finally {
      if (prev === undefined) delete process.env.DEMO_TODAY;
      else process.env.DEMO_TODAY = prev;
    }
  });
});
