import { describe, expect, it } from 'vitest';
import { asthmaTracker, dose, dulera, emptyDoc, med, migraineTracker, submit, TODAY, windowDays } from './__fixtures__/fixtures';
import { buildPatientSummary } from './index';
import { regimenText } from './medications';

const defs = [asthmaTracker, migraineTracker];

describe('medications', () => {
  it('merges archived duplicates by name and attributes their doses', () => {
    const archived = med({ id: 'exc-old', name: 'Excedrin ', howOften: 'As Needed', archived: true, archivedDate: '2026-02-01', relatedCondition: 'migraine' });
    const active = med({ id: 'exc-new', name: 'excedrin', howOften: 'As Needed', relatedCondition: 'Migraine', index: 2 });
    const doc = emptyDoc({
      trackers: [{ trackerId: 'migraine-v1', assignedDate: '2026-01-10', active: true }],
      medications: [archived, active],
    });
    dose(doc, '2026-06-03', archived, '10:00', '1');
    dose(doc, '2026-06-04', archived, '10:00', null);
    dose(doc, '2026-06-05', active, '10:00', 2);
    const s = buildPatientSummary(doc, defs, { today: TODAY });
    expect(s.medications.asNeeded).toHaveLength(1);
    const m = s.medications.asNeeded[0];
    expect(m.sourceIds.sort()).toEqual(['exc-new', 'exc-old']);
    expect(m.role).toBe('abortive');
    expect(m.condition).toBe('migraine');
    expect(m.totalUses).toBe(4); // "1" + null→1 + 2
    expect(m.daysUsed).toBe(3);
    expect(s.medications.notes[0]).toMatch(/2 doses recorded against an archived 'excedrin' entry were merged|2 doses recorded against an archived 'Excedrin' entry were merged/i);
    expect(s.dataQuality.some((n) => n.text.includes('archived'))).toBe(true);
  });

  it('computes twice-daily adherence with a per-day cap', () => {
    const d = dulera();
    const doc = emptyDoc({ medications: [d] });
    const days = windowDays();
    // 20 days full (2 doses), 5 days one dose, 1 day with 3 doses (capped at 2), 4 days none.
    days.slice(0, 20).forEach((day) => {
      dose(doc, day, d, '08:00');
      dose(doc, day, d, '20:00');
    });
    days.slice(20, 25).forEach((day) => dose(doc, day, d, '08:00'));
    dose(doc, days[25], d, '08:00');
    dose(doc, days[25], d, '12:00');
    dose(doc, days[25], d, '20:00');
    submit(doc, TODAY, '07:00', { 'q-feel': 'Good' }); // still engaged at window end
    const s = buildPatientSummary(doc, [asthmaTracker], { today: TODAY });
    const m = s.medications.scheduled[0];
    expect(m.regimen).toBe('2 puffs twice daily');
    expect(m.role).toBe('controller');
    expect(m.dosesExpected).toBe(60);
    expect(m.dosesTaken).toBe(40 + 5 + 2);
    expect(m.adherencePct).toBe(78);
    expect(m.status).toBe('watch');
    expect(m.fullDosePct).toBe(70); // 21 of 30 days
    expect(m.daily[25]).toEqual({ date: days[25], taken: 3, expected: 2 });
    expect(m.currentStreakDays).toBe(0);
    expect(s.days[0].scheduledDosesExpected).toBe(2);
    expect(s.medications.overallAdherencePct).toBe(78);
    const metric = s.headline.find((h) => h.id === 'controllerAdherence')!;
    expect(metric.label).toBe('Controller adherence');
    expect(metric.value).toBe('78%');
  });

  it('expects weekly meds once per ISO week and computes adherence per week', () => {
    const w = med({ id: 'mtx', name: 'Methotrexate', howOften: 'Weekly', dosage: { quantity: 1, unit: 'tablet', timing: { periodUnit: 'Weekly', frequency: 1 } }, startDate: '2026-01-01' });
    const doc = emptyDoc({ medications: [w] });
    // Window Jun 1 (Mon) – Jun 30 (Tue): weeks starting Jun 1, 8, 15, 22, 29 → 5 expected.
    dose(doc, '2026-06-03', w); // week 1
    dose(doc, '2026-06-14', w); // week 2 (Sunday)
    dose(doc, '2026-06-20', w); // week 3
    dose(doc, '2026-06-21', w); // extra in week 3 (capped)
    submit(doc, TODAY, '07:00', { 'q-feel': 'Good' });
    const s = buildPatientSummary(doc, [asthmaTracker], { today: TODAY });
    const m = s.medications.scheduled[0];
    expect(m.regimen).toBe('1 tablet weekly');
    expect(m.role).toBe('maintenance');
    expect(m.dosesExpected).toBe(5);
    expect(m.dosesTaken).toBe(3);
    expect(m.adherencePct).toBe(60);
    expect(m.daily.filter((x) => x.expected > 0).map((x) => x.date)).toEqual(['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']);
    expect(m.weekly.map((x) => x.pct)).toEqual([100, 100, 100, 0, 0]);
  });

  it('starts expectations at startDate and maps doses by name when the id is unknown', () => {
    const d = { ...dulera(), startDate: '2026-06-21' };
    const doc = emptyDoc({ medications: [d] });
    doc.dailyLogs.push({ day: '2026-06-25', medicationAdministrations: [{ id: 'stale-uuid', time: '08:00', name: 'Dulera', value: 1 }] });
    submit(doc, TODAY, '07:00', { 'q-feel': 'Good' });
    const s = buildPatientSummary(doc, [asthmaTracker], { today: TODAY });
    const m = s.medications.scheduled[0];
    expect(m.dosesExpected).toBe(20); // Jun 21–30 × 2
    expect(m.dosesTaken).toBe(1);
    expect(m.lastTakenDate).toBe('2026-06-25');
  });

  it('formats regimens', () => {
    expect(regimenText(med({ id: 'x', name: 'X', howOften: 'Daily', dosage: { quantity: 1, unit: 'puffs' } }), true, 'Daily', 1)).toBe('1 puff once daily');
    expect(regimenText(med({ id: 'x', name: 'X', howOften: 'Daily', dosage: { quantity: 10, unit: 'mg' } }), true, 'Daily', 3)).toBe('10 mg three times daily');
    expect(regimenText(med({ id: 'x', name: 'X', howOften: 'As Needed' }), false, null, 0)).toBe('As needed');
  });
});
