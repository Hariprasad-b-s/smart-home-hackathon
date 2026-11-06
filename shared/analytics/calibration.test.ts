import { describe, expect, it } from 'vitest';
import type { RawEhrContext } from '../types/raw';
import {
  albuterol,
  asthmaTracker,
  dose,
  dulera,
  emptyDoc,
  med,
  migraineTracker,
  reading,
  spirometer,
  submit,
  TODAY,
  windowDays,
} from './__fixtures__/fixtures';
import { humanizeMedication, mapEhr } from './ehr';
import { buildPatientSummary } from './index';
import { weeklyDayStatus } from './stats';

const defs = [asthmaTracker, migraineTracker];

/** Fully adherent asthma patient; `symptomEvery` controls symptom frequency. */
function adherentAsthma(opts: { symptomDays: number[]; nightDays?: number[]; feelSym?: string; sym?: string }) {
  const d = dulera();
  const doc = emptyDoc({ medications: [d, albuterol()] });
  windowDays().forEach((day, i) => {
    dose(doc, day, d, '08:00');
    dose(doc, day, d, '20:00');
    const has = opts.symptomDays.includes(i);
    submit(doc, day, '19:00', {
      'q-feel': has ? (opts.feelSym ?? 'Okay') : 'Great',
      'q-sym': has ? (opts.sym ?? '["Coughing"]') : '["None of these "]',
      'q-night': opts.nightDays?.includes(i) ? 'Yes' : 'No',
    });
  });
  return doc;
}

describe('A. control-gated key flags and weekly status scale', () => {
  it('uses good ≤ 2 days/wk, watch above, concern ≥ 4 days/wk (capped with < 7 days)', () => {
    expect(weeklyDayStatus(3, 30)).toBe('good');
    expect(weeklyDayStatus(8, 30)).toBe('good');
    expect(weeklyDayStatus(12, 30)).toBe('watch');
    expect(weeklyDayStatus(18, 30)).toBe('concern');
    expect(weeklyDayStatus(5, 6)).toBe('watch');
    expect(weeklyDayStatus(1, 0)).toBe('unknown');
  });

  it('does not flag a well-controlled adherent patient', () => {
    const s = buildPatientSummary(adherentAsthma({ symptomDays: [3, 10, 17, 24, 29], feelSym: 'Okay' }), defs, { today: TODAY });
    const zone = s.headline.find((h) => h.id === 'zone')!;
    expect(zone.detail).toMatch(/^Well controlled \(NAEPP\)/);
    expect(zone.status).toBe('good');
    expect(zone.value).toBe('Green'); // most common zone over the last week, despite a symptom on the last day
    expect(s.flags.filter((f) => f.severity !== 'low')).toEqual([]);
    expect(s.headline.find((h) => h.id === 'hardDays')!.status).toBe('good');
  });

  it('fires "symptoms despite adherence" only when NAEPP says not well controlled, naming the drivers', () => {
    const s = buildPatientSummary(adherentAsthma({ symptomDays: [0, 1, 2], nightDays: [0, 5, 9] }), defs, { today: TODAY });
    const f = s.flags.find((x) => x.id === 'symptoms-despite-adherence-asthma')!;
    expect(f.detail).toContain('night waking 3×');
    expect(s.headline.find((h) => h.id === 'zone')!.detail).toMatch(/^Not well controlled \(NAEPP\): night waking 3×/);
  });

  it('does not fire "uncontrolled with low adherence" for a well-controlled patient', () => {
    const d = dulera();
    const doc = emptyDoc({ medications: [d] });
    windowDays().forEach((day, i) => {
      if (i % 3 === 0) dose(doc, day, d);
      submit(doc, day, '19:00', { 'q-feel': 'Great', 'q-sym': '["None of these "]' });
    });
    const s = buildPatientSummary(doc, defs, { today: TODAY });
    expect(s.flags.some((f) => f.id.startsWith('uncontrolled-low-adherence'))).toBe(false);
    expect(s.flags.find((f) => f.id === 'adherence-low-dulera')!.severity).toBe('high');
  });
});

describe('B. not logging is not "not taking"', () => {
  it('stops the adherence denominator at the last activity and lets the stale flag speak', () => {
    const d = dulera();
    const doc = emptyDoc({ medications: [d] });
    windowDays().slice(0, 20).forEach((day) => {
      dose(doc, day, d, '08:00');
      submit(doc, day, '19:00', { 'q-feel': 'Bad', 'q-sym': '["Wheezing"]' });
    });
    const s = buildPatientSummary(doc, defs, { today: TODAY });
    const m = s.medications.scheduled[0];
    expect(m.measuredThrough).toBe('2026-06-20');
    expect(m.dosesExpected).toBe(40);
    expect(m.adherencePct).toBe(50);
    expect(m.daily[25].expected).toBe(0);
    expect(s.flags.some((f) => f.id.startsWith('adherence-low') || f.id.startsWith('uncontrolled'))).toBe(false);
    const stale = s.flags.find((f) => f.id === 'no-recent-activity')!;
    expect(stale.detail).toContain('measured through Jun 20');
    expect(s.headline.find((h) => h.id === 'controllerAdherence')!.detail).toContain('measured through Jun 20');
    expect(s.dataQuality.some((n) => n.id === 'adherence-measured-through')).toBe(true);
  });

  it('reports unknown adherence when there is no activity in the window', () => {
    const d = dulera();
    const doc = emptyDoc({ medications: [d] });
    submit(doc, '2026-04-15', '09:00', { 'q-feel': 'Good' });
    const s = buildPatientSummary(doc, defs, { today: TODAY });
    const m = s.medications.scheduled[0];
    expect(m.adherencePct).toBeNull();
    expect(m.status).toBe('unknown');
    expect(s.medications.overallAdherencePct).toBeNull();
    expect(s.headline.find((h) => h.id === 'controllerAdherence')).toMatchObject({ value: 'No data since Apr 15', status: 'unknown' });
    expect(s.flags.map((f) => f.id)).toEqual(['no-recent-activity']);
  });
});

describe('C. new patients are rated from enrollment', () => {
  it('uses the effective start for rates and adds a new-patient flag', () => {
    const d = dulera();
    const doc = emptyDoc({ createdAt: '2026-06-26T12:00:00Z', trackers: [{ trackerId: 'asthma-v1', assignedDate: '2026-06-26', active: true }], medications: [{ ...d, startDate: null }, albuterol()] });
    for (const day of ['2026-06-26', '2026-06-27', '2026-06-28', '2026-06-29', '2026-06-30']) {
      dose(doc, day, d, '08:00');
      dose(doc, day, d, '20:00');
      submit(doc, day, '19:00', { 'q-feel': 'Bad', 'q-sym': '["Wheezing","Coughing"]', 'q-night': 'Yes' });
    }
    dose(doc, '2026-06-29', albuterol(), '12:00');
    dose(doc, '2026-06-30', albuterol(), '12:00');
    const s = buildPatientSummary(doc, defs, { today: TODAY });
    expect(s.patient.enrolledSince).toBe('2026-06-26');
    expect(s.patient.enrolledDays).toBe(4);
    expect(s.engagement.loggingPct).toBe(100);
    expect(s.headline.find((h) => h.id === 'loggingConsistency')!.value).toBe('100%');
    expect(s.headline.find((h) => h.id === 'symptomDays')!.value).toBe('5 of 5 days');
    expect(s.medications.scheduled[0].dosesExpected).toBe(10);
    expect(s.headline.every((h) => h.status !== 'concern')).toBe(true);
    expect(s.flags.find((f) => f.id === 'new-patient')).toMatchObject({ severity: 'low', title: 'New patient — 5 days of data' });
    expect(s.flags.some((f) => f.id.startsWith('symptoms-despite') || f.id === 'rescue-frequent')).toBe(false);
    expect(s.headline.find((h) => h.id === 'zone')!.detail).toMatch(/^Control not assessed: only 5 days of data/);
  });
});

describe('D. noise reduction', () => {
  it('only counts discordance for severity-0 feeling with key or multiple symptoms, and needs ≥ 40% of symptom days', () => {
    const doc = emptyDoc();
    const days = windowDays();
    submit(doc, days[0], '19:00', { 'q-feel': 'Great', 'q-sym': '["Coughing"]' }); // single mild symptom → not discordant
    submit(doc, days[1], '19:00', { 'q-feel': 'Great', 'q-sym': '["Wheezing"]' }); // key symptom
    submit(doc, days[2], '19:00', { 'q-feel': 'Great', 'q-sym': '["Coughing","Sneezing"]' }); // two symptoms
    submit(doc, days[3], '19:00', { 'q-feel': 'Good', 'q-sym': '["Wheezing"]' }); // Good is severity 1 in this fixture
    let s = buildPatientSummary(doc, defs, { today: TODAY });
    expect(s.days.slice(0, 4).map((d) => d.discordant)).toEqual([false, true, true, false]);
    expect(s.flags.some((f) => f.id === 'discordant-days')).toBe(false); // only 2 days
    submit(doc, days[4], '19:00', { 'q-feel': 'Great', 'q-sym': '["Tight Chest"]' });
    s = buildPatientSummary(doc, defs, { today: TODAY });
    expect(s.flags.find((f) => f.id === 'discordant-days')!.severity).toBe('medium'); // 3 of 5 symptom days
    for (const i of [6, 7, 8, 9, 10, 11]) submit(doc, days[i], '19:00', { 'q-feel': 'Bad', 'q-sym': '["Coughing"]' });
    s = buildPatientSummary(doc, defs, { today: TODAY });
    expect(s.flags.some((f) => f.id === 'discordant-days')).toBe(false); // 3 of 11 < 40%
  });

  it('keeps device quality conflicts as a data note and raises blank-submission flags only at ≥ 25%', () => {
    const blows = windowDays().slice(0, 5).map((d) => reading(`${d}T08:00:00.000-04:00`, { fev1: 2, fvc: 2.5, pef: 6, accepted: true, quality: 'NotAcceptable' }));
    const doc = emptyDoc({ medicalDevices: [spirometer(blows)] });
    windowDays().forEach((day, i) => {
      submit(doc, day, '19:00', { 'q-feel': 'Great' });
      if (i < 6) submit(doc, day, '08:00', {});
    });
    let s = buildPatientSummary(doc, defs, { today: TODAY });
    expect(s.flags.some((f) => f.id === 'dq-device-quality')).toBe(false);
    expect(s.dataQuality.find((n) => n.id === 'spirometry-quality-conflict')!.level).toBe('warning');
    expect(s.flags.some((f) => f.id === 'dq-blank-submissions')).toBe(false); // 6 of 36 = 17%
    for (const day of windowDays().slice(6, 12)) submit(doc, day, '08:00', {});
    s = buildPatientSummary(doc, defs, { today: TODAY });
    expect(s.flags.some((f) => f.id === 'dq-blank-submissions')).toBe(true); // 12 of 42 = 29%
  });
});

describe('E. new contract fields', () => {
  it('fills today, body measurements and EHR context', () => {
    const ehr: RawEhrContext = {
      source: 'synthea',
      problems: [
        { display: 'Acute bronchitis (disorder)', active: true },
        { display: 'Viral sinusitis (disorder)', active: false },
        { display: 'Perennial allergic rhinitis (disorder)', active: true },
        { display: 'Childhood asthma (disorder)', active: true },
      ],
      medicationsOnFile: [
        { display: '120 ACTUAT fluticasone propionate 0.044 MG/ACTUAT Metered Dose Inhaler [Flovent]', status: 'active' },
        { display: 'NDA020800 0.3 ML Epinephrine 1 MG/ML Auto-Injector', status: 'active' },
        { display: 'Amoxicillin 250 MG Oral Capsule', status: 'stopped' },
      ],
      allergies: ['Peanut (substance)'],
      lastClinicVisit: '2026-05-12',
      visitsLast12Months: 3,
    };
    const doc = emptyDoc();
    doc.profile = { ...doc.profile, heightCm: 158, weightKg: 49.5, ehr };
    const s = buildPatientSummary(doc, defs, { today: TODAY });
    expect(s.today).toBe(TODAY);
    expect(s.patient).toMatchObject({ heightCm: 158, weightKg: 49.5 });
    expect(s.patient.ehr).toEqual({
      source: 'synthea',
      problems: ['Childhood asthma', 'Perennial allergic rhinitis', 'Acute bronchitis'],
      allergies: ['Peanut'],
      medicationsOnFile: ['Flovent HFA 44 mcg inhaler', 'Epinephrine auto-injector 0.3 mg'],
      lastClinicVisit: '2026-05-12',
      visitsLast12Months: 3,
    });
    expect(mapEhr({ source: 'manual', problems: Array.from({ length: 12 }, (_, i) => ({ display: `Problem ${i}`, active: true })), medicationsOnFile: [], allergies: [] })!.problems).toHaveLength(8);
    expect(buildPatientSummary(emptyDoc(), defs, { today: TODAY }).patient.ehr).toBeUndefined();
  });

  it('humanizes RxNorm medication strings', () => {
    expect(humanizeMedication('120 ACTUAT fluticasone propionate 0.044 MG/ACTUAT Metered Dose Inhaler [Flovent]')).toBe('Flovent HFA 44 mcg inhaler');
    expect(humanizeMedication('NDA020800 0.3 ML Epinephrine 1 MG/ML Auto-Injector')).toBe('Epinephrine auto-injector 0.3 mg');
    expect(humanizeMedication('budesonide 0.25 MG/ML Inhalation Suspension')).toBe('Budesonide 0.25 mg/mL nebulizer');
    expect(humanizeMedication('60 ACTUAT fluticasone propionate 0.25 MG/ACTUAT / salmeterol 0.05 MG/ACTUAT Dry Powder Inhaler [Advair]')).toBe('Advair 250/50 mcg inhaler');
    expect(humanizeMedication('Montelukast 10 MG Oral Tablet')).toBe('Montelukast 10 mg tablet');
  });

  it('shows controller and medication adherence side by side, plus abortive use and sleep', () => {
    const d = dulera();
    const topa = med({ id: 'topa', name: 'Topiramate', howOften: 'Daily', relatedTrackerId: 'migraine-v1', startDate: '2026-01-01' });
    const riza = med({ id: 'riza', name: 'Rizatriptan', howOften: 'As Needed', relatedTrackerId: 'migraine-v1' });
    const doc = emptyDoc({
      trackers: [
        { trackerId: 'asthma-v1', assignedDate: '2026-01-10', active: true },
        { trackerId: 'migraine-v1', assignedDate: '2026-01-10', active: true },
      ],
      medications: [d, topa, riza],
    });
    windowDays().forEach((day, i) => {
      dose(doc, day, d, '08:00');
      dose(doc, day, d, '20:00');
      if (i % 2 === 0) dose(doc, day, topa);
      if (i % 10 === 0) dose(doc, day, riza);
      submit(doc, day, '19:00', { 'q-feel': 'Great', 'q-sym': '["None of these "]' });
      submit(doc, day, '21:00', { 'm-head': i % 10 === 0 ? 'Yes' : 'No', 'm-sleep': '6' }, 'migraine-v1');
    });
    const s = buildPatientSummary(doc, defs, { today: TODAY });
    const ids = s.headline.map((h) => h.id);
    expect(ids.slice(0, 3)).toEqual(['zone', 'controllerAdherence', 'medicationAdherence']);
    expect(s.headline.find((h) => h.id === 'medicationAdherence')).toMatchObject({ label: 'Preventive adherence', value: '50%' });
    expect(s.headline.find((h) => h.id === 'abortiveUse')).toMatchObject({ value: '3 days', status: 'good' });
    expect(s.headline.find((h) => h.id === 'sleepHours')).toMatchObject({ value: '6 h', status: 'watch' });
    expect(s.medications.asNeeded.find((m) => m.key === 'rizatriptan')!.perWeek).toBe(0.7); // days/week
  });
});

describe('patient-facing day counts', () => {
  it('partition the window exactly like the calendar (good + hard + nothing recorded)', async () => {
    const { generatePatients } = await import('../../server/data/generate');
    const { TRACKERS } = await import('../../server/data/trackers');
    const { buildPatientSummary } = await import('./index');
    for (const doc of generatePatients({ today: '2026-11-06' })) {
      const s = buildPatientSummary(doc, TRACKERS, { today: '2026-11-06' });
      const pf = s.patientFacing;
      const counted = s.days.filter((d) => d.date >= s.patient.enrolledSince);
      expect(pf.goodDays + pf.hardDays + pf.noDataDays).toBe(counted.length);
      expect(pf.hardDays).toBe(counted.filter((d) => d.hardDay).length);
    }
  });
});
