import { describe, expect, it } from 'vitest';
import { dateRange } from './dates';
import { asthmaTracker, dose, emptyDoc, med, migraineTracker, nonAdherentUncontrolled, submit, TODAY, windowDays } from './__fixtures__/fixtures';
import { buildPatientSummary } from './index';
import type { TrackerDefinition } from '../types/tracker';

const ibdTracker: TrackerDefinition = {
  id: 'ibd-v1',
  name: 'Gut check',
  condition: 'ibd',
  conditionLabel: "Crohn's disease",
  version: 1,
  questions: [
    { id: 'i-stool', text: 'How many stools today?', shortLabel: 'Stools', type: 'number', role: 'stoolFrequency', order: 1, concernThreshold: 6 },
    { id: 'i-blood', text: 'Any blood?', shortLabel: 'Blood', type: 'yesNo', role: 'bloodInStool', order: 2 },
    { id: 'i-school', text: 'Missed school?', shortLabel: 'Missed school', type: 'yesNo', role: 'missedSchool', order: 3 },
  ],
};

describe('condition-agnostic metrics', () => {
  it('builds migraine metrics and flags abortive overuse', () => {
    const exc = med({ id: 'exc', name: 'Excedrin', howOften: 'As Needed', relatedTrackerId: 'migraine-v1' });
    const topa = med({ id: 'topa', name: 'Topiramate', howOften: 'Daily', dosage: { quantity: 25, unit: 'mg', timing: { frequency: 1 } }, relatedCondition: 'migraine', startDate: '2026-01-01' });
    const doc = emptyDoc({ trackers: [{ trackerId: 'migraine-v1', assignedDate: '2026-01-01', active: true }], medications: [exc, topa] });
    windowDays().forEach((day, i) => {
      const head = i % 3 === 0; // 10 days
      submit(doc, day, '21:00', { 'm-head': head ? 'Yes' : 'No', 'm-pain': head ? '8' : '', 'm-sleep': i < 9 ? '5' : '8' }, 'migraine-v1');
      if (head) dose(doc, day, exc, '10:00');
      dose(doc, day, topa, '08:00');
    });
    const s = buildPatientSummary(doc, [migraineTracker], { today: TODAY });
    const ids = s.headline.map((h) => h.id);
    expect(ids).toEqual(['medicationAdherence', 'symptomDays', 'headacheDays', 'abortiveUse', 'painAverage', 'sleepHours', 'hardDays', 'loggingConsistency']);
    expect(s.headline.find((h) => h.id === 'abortiveUse')).toMatchObject({ value: '10 days', status: 'concern' });
    expect(s.headline[0].label).toBe('Preventive adherence');
    expect(s.headline.find((h) => h.id === 'headacheDays')!.value).toBe('10 days');
    expect(s.headline.find((h) => h.id === 'painAverage')).toMatchObject({ value: '8/10', status: 'concern' });
    const flag = s.flags.find((f) => f.id === 'abortive-overuse-excedrin')!;
    expect(flag.severity).toBe('high');
    expect(s.medications.asNeeded[0]).toMatchObject({ role: 'abortive', daysUsed: 10, status: 'concern' });
    expect(s.flags.some((f) => f.id === 'sleep-short' && f.severity === 'low')).toBe(true);
    // 10 headache days at 100% preventive adherence → symptoms despite adherence (33% of logged days).
    expect(s.flags.some((f) => f.id === 'symptoms-despite-adherence-migraine')).toBe(true);
    expect(s.actionPlan).toBeUndefined();
    expect(s.spirometry).toBeUndefined();
  });

  it('builds IBD metrics, blood-in-stool and missed-school flags, rising stool frequency', () => {
    const doc = emptyDoc({ trackers: [{ trackerId: 'ibd-v1', assignedDate: '2026-01-01', active: true }] });
    dateRange('2026-05-02', '2026-05-31').forEach((day) => submit(doc, day, '20:00', { 'i-stool': '2', 'i-blood': 'No', 'i-school': 'No' }, 'ibd-v1'));
    windowDays().forEach((day, i) =>
      submit(doc, day, '20:00', { 'i-stool': i > 20 ? '7' : '4', 'i-blood': i === 25 || i === 27 ? 'Yes' : 'No', 'i-school': i >= 26 ? 'true' : 'false' }, 'ibd-v1'),
    );
    const s = buildPatientSummary(doc, [ibdTracker], { today: TODAY });
    expect(s.headline.map((h) => h.id)).toEqual(['symptomDays', 'stoolFrequency', 'bloodInStool', 'missedSchool', 'hardDays', 'loggingConsistency']);
    expect(s.headline.find((h) => h.id === 'stoolFrequency')!.trend).toMatchObject({ direction: 'up', meaning: 'worse' });
    const ids = s.flags.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['blood-in-stool', 'missed-school', 'stool-frequency-rising']));
    expect(s.flags[0].id).toBe('blood-in-stool');
    expect(s.days[26].hardDay).toBe(true);
    expect(s.days[0].roleValues).toEqual({ stoolFrequency: 4, bloodInStool: false, missedSchool: false });
  });

  it('puts the key adherence flag first among equally severe flags', () => {
    const s = buildPatientSummary(nonAdherentUncontrolled(), [asthmaTracker], { today: TODAY });
    expect(s.flags[0].id).toBe('uncontrolled-low-adherence-asthma');
    expect(s.patientFacing.points[0].text).toBe('You took your controller inhaler on 10 of 30 days, and every dose on 0 of them.');
  });

  it('notes plan expiry soon, blank submissions and the ignored legacy flag', () => {
    const doc = emptyDoc({ asthmaTreatmentPlan: { expiration: '2026-07-20', status: 'Green' } });
    for (const day of windowDays().slice(0, 5)) {
      submit(doc, day, '08:00', {});
      submit(doc, day, '09:00', { 'q-feel': 'Good' });
    }
    doc.dailyLogs[0].allMedicationsAdministered = true;
    const s = buildPatientSummary(doc, [asthmaTracker], { today: TODAY });
    expect(s.flags.find((f) => f.id === 'plan-expiring')).toMatchObject({ severity: 'low' });
    expect(s.actionPlan!.expiresInDays).toBe(20);
    expect(s.flags.some((f) => f.id === 'dq-blank-submissions')).toBe(true);
    expect(s.dataQuality.some((n) => n.id === 'all-meds-flag-ignored')).toBe(true);
    expect(s.engagement.loggingPct).toBe(17);
  });
});
