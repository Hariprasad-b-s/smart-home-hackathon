import { describe, expect, it } from 'vitest';
import { asthmaTracker, emptyDoc, submit, TODAY } from './__fixtures__/fixtures';
import { buildPatientSummary } from './index';

const defs = [asthmaTracker];

describe('per-day collapse', () => {
  it('uses the last non-empty answer, unions symptoms, and records changes within the day', () => {
    const doc = emptyDoc();
    // Insert out of order on purpose.
    submit(doc, '2026-06-20', '20:30', { 'q-feel': 'Great', 'q-sym': '["None of these "]' });
    submit(doc, '2026-06-20', '08:10', { 'q-feel': 'Bad', 'q-sym': '["Coughing","Wheezing"]', 'q-night': 'Yes' });
    submit(doc, '2026-06-20', '12:00', { 'q-feel': '', 'q-sym': '[]' }); // blank
    const s = buildPatientSummary(doc, defs, { today: TODAY });
    const day = s.days.find((d) => d.date === '2026-06-20')!;

    expect(day.feeling).toEqual({ label: 'Great', severity: 0, changedDuringDay: true, worstLabel: 'Bad', sequence: ['Bad', 'Great'] });
    expect(day.symptoms).toEqual(['Coughing', 'Wheezing']);
    expect(day.symptomDay).toBe(true);
    expect(day.discordant).toBe(true); // "Great" while reporting symptoms
    expect(day.submissionCount).toBe(3);
    expect(day.blankSubmissionCount).toBe(1);
    expect(day.submissions.map((x) => x.time)).toEqual(['08:10', '12:00', '20:30']);
    expect(day.submissions.map((x) => x.usedForDay)).toEqual([true, false, true]);
    expect(day.submissions[1].blank).toBe(true);
    expect(day.roleValues.nightWaking).toBe(true);

    const tr = s.trackers[0];
    expect(tr.collapsedDays).toBe(1);
    expect(tr.blankSubmissions).toBe(1);
    expect(s.dataQuality.map((n) => n.id)).toEqual(expect.arrayContaining(['collapsed-days', 'blank-submissions']));
  });

  it('groups by the submission timestamp date, not the log day', () => {
    const doc = emptyDoc();
    submit(doc, '2026-06-10', '23:50', { 'q-feel': 'Okay' });
    // Move the response into the next day's log (late sync) — still belongs to Jun 10.
    const r = doc.dailyLogs[0].trackerResponses!.pop()!;
    doc.dailyLogs.push({ day: '2026-06-11', trackerResponses: [r] });
    const s = buildPatientSummary(doc, defs, { today: TODAY });
    expect(s.days.find((d) => d.date === '2026-06-10')!.feeling?.label).toBe('Okay');
    expect(s.days.find((d) => d.date === '2026-06-11')!.hasData).toBe(false);
  });

  it('ignores unknown question ids with a data-quality note', () => {
    const doc = emptyDoc();
    submit(doc, '2026-06-15', '09:00', { 'q-feel': 'Good', 'q-legacy': 'something' });
    const s = buildPatientSummary(doc, defs, { today: TODAY });
    expect(s.dataQuality.some((n) => n.id === 'unknown-questions')).toBe(true);
    expect(s.days.find((d) => d.date === '2026-06-15')!.submissions[0].answers).toHaveLength(1);
  });

  it('summarizes every question generically by type', () => {
    const doc = emptyDoc();
    submit(doc, '2026-06-01', '09:00', { 'q-feel': 'Bad', 'q-sym': '["Coughing"]', 'q-night': 'true', 'q-rescue': '2', 'q-notes': 'tired' });
    submit(doc, '2026-06-02', '09:00', { 'q-feel': 'Great', 'q-sym': '["None of these "]', 'q-night': 'No', 'q-rescue': '0' });
    const s = buildPatientSummary(doc, defs, { today: TODAY });
    const qs = s.trackers[0].questions;
    expect(qs.map((x) => x.kind)).toEqual(['categorical', 'multi', 'boolean', 'numeric', 'boolean', 'text', 'text']);
    const feel = qs[0];
    if (feel.kind !== 'categorical') throw new Error('kind');
    expect(feel.series).toHaveLength(30);
    expect(feel.distribution.find((d) => d.label === 'Bad')).toMatchObject({ days: 1, pct: 50, severity: 2 });
    const sym = qs[1];
    if (sym.kind !== 'multi') throw new Error('kind');
    expect(sym.answeredDays).toBe(2);
    expect(sym.anyDays).toBe(1);
    expect(sym.series[1].items).toEqual([]);
    expect(sym.series[2].items).toBeNull();
    const night = qs[2];
    if (night.kind !== 'boolean') throw new Error('kind');
    expect([night.yesDays, night.noDays, night.yesPct]).toEqual([1, 1, 50]);
    const rescue = qs[3];
    if (rescue.kind !== 'numeric') throw new Error('kind');
    expect(rescue.stats).toMatchObject({ mean: 1, min: 0, max: 2, last: 0 });
    const notes = qs[6];
    if (notes.kind !== 'text') throw new Error('kind');
    expect(notes.recent).toEqual([{ date: '2026-06-01', text: 'tired' }]);
  });
});

describe('voice check-in metadata', () => {
  it('passes entryMode, transcript and mediaIds through to the day submissions', async () => {
    const { buildPatientSummary } = await import('./index');
    const { generatePatients } = await import('../../server/data/generate');
    const { TRACKERS } = await import('../../server/data/trackers');
    const doc = structuredClone(generatePatients({ today: '2026-11-06' })[1]);
    const log = doc.dailyLogs.find((l) => l.day === '2026-11-06') ?? (doc.dailyLogs.push({ day: '2026-11-06', trackerResponses: [] }), doc.dailyLogs.at(-1)!);
    (log.trackerResponses ??= []).push({
      id: 'voice-1', trackerId: 'asthma-v3', submittedAt: '2026-11-06T21:00:00.000-05:00', entryMode: 'voice',
      transcript: '  I feel bad and I am wheezing  ', mediaIds: ['m1'],
      responses: [{ questionId: 'asthma-feeling', value: 'Bad' }],
    });
    const day = buildPatientSummary(doc, TRACKERS, { today: '2026-11-06', days: 1 }).days[0];
    const sub = day.submissions.find((x) => x.responseId === 'voice-1')!;
    expect(sub.entryMode).toBe('voice');
    expect(sub.transcript).toBe('I feel bad and I am wheezing');
    expect(sub.mediaIds).toEqual(['m1']);
    expect(day.submissions.filter((x) => x.responseId !== 'voice-1').every((x) => x.entryMode === undefined)).toBe(true);
  });
});
