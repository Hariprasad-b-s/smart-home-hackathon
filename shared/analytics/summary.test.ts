import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adherentButSymptomatic,
  asthmaTracker,
  emptyDoc,
  migraineTracker,
  nonAdherentUncontrolled,
  submit,
  TODAY,
} from './__fixtures__/fixtures';
import { buildPatientListItem, buildPatientSummary, summaryToCsv } from './index';

const defs = [asthmaTracker, migraineTracker];

describe('window', () => {
  it('defaults to the last 30 days ending today with an equal prior window', () => {
    const s = buildPatientSummary(emptyDoc(), defs, { today: TODAY });
    expect(s.window).toEqual({
      start: '2026-06-01',
      end: TODAY,
      days: 30,
      label: 'Last 30 days',
      prior: { start: '2026-05-02', end: '2026-05-31' },
    });
    expect(s.days).toHaveLength(30);
    expect(s.days[0].date).toBe('2026-06-01');
    expect(s.days[29].date).toBe(TODAY);
  });

  it('supports custom lengths, past end dates and "all"', () => {
    const doc = emptyDoc();
    submit(doc, '2026-04-15', '09:00', { 'q-feel': 'Good' });
    const s7 = buildPatientSummary(doc, defs, { today: TODAY, days: 7 });
    expect(s7.days).toHaveLength(7);
    expect(s7.window.start).toBe('2026-06-24');
    const past = buildPatientSummary(doc, defs, { today: TODAY, end: '2026-03-31', days: 31 });
    expect(past.window.label).toBe('Mar 1 – Mar 31, 2026');
    const all = buildPatientSummary(doc, defs, { today: TODAY, days: 'all' });
    expect(all.window.start).toBe('2026-04-15');
    expect(all.window.days).toBe(77);
    expect(all.window.label).toBe('All time');
    expect(all.days).toHaveLength(77);
    const none = buildPatientSummary(emptyDoc(), defs, { today: TODAY, days: 'all' });
    expect(none.days).toHaveLength(1);
  });
});

describe('key clinical scenarios', () => {
  it('flags symptoms despite good adherence', () => {
    const s = buildPatientSummary(adherentButSymptomatic(), defs, { today: TODAY });
    const f = s.flags.find((x) => x.id === 'symptoms-despite-adherence-asthma');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('high');
    expect(f!.title).toMatch(/symptoms despite 100% controller adherence/i);
    expect(f!.detail).toMatch(/may not be controlling/);
    expect(s.flags.some((x) => x.id.startsWith('uncontrolled-low-adherence'))).toBe(false);
    expect(s.flags.some((x) => x.id.startsWith('adherence-low'))).toBe(false);
    const sym = s.headline.find((h) => h.id === 'symptomDays')!;
    expect(sym.value).toBe('12 of 30 days');
    expect(sym.trend?.direction).toBe('up');
    expect(sym.trend?.meaning).toBe('worse');
    expect(sym.trend?.text).toBe('+9 vs prior 30 days');
    expect(s.headline.map((h) => h.id).slice(0, 3)).toEqual(['zone', 'controllerAdherence', 'symptomDays']);
    expect(s.patientFacing.points.map((p) => p.text)).toContain('You took your controller inhaler on 30 of 30 days.');
    expect(s.patientFacing.headline).toBe('You had 18 good days and 12 hard days this month.');
  });

  it('flags uncontrolled asthma with low adherence and frequent rescue use', () => {
    const s = buildPatientSummary(nonAdherentUncontrolled(), defs, { today: TODAY });
    const ids = s.flags.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['uncontrolled-low-adherence-asthma', 'adherence-low-dulera', 'rescue-frequent']));
    expect(ids).not.toContain('symptoms-despite-adherence-asthma');
    const f = s.flags.find((x) => x.id === 'uncontrolled-low-adherence-asthma')!;
    expect(f.detail).toMatch(/before escalating therapy/);
    expect(s.flags.every((x, i, arr) => i === 0 || ['high', 'medium', 'low'].indexOf(arr[i - 1].severity) <= ['high', 'medium', 'low'].indexOf(x.severity))).toBe(true);
    const rescue = s.headline.find((h) => h.id === 'rescueUse')!;
    expect(rescue.value).toBe('2.8 days/wk');
    expect(rescue.status).toBe('concern');
    expect(s.days[0].asNeededUses).toBe(2);
    const item = buildPatientListItem(nonAdherentUncontrolled(), defs, TODAY);
    const calm = buildPatientListItem(adherentButSymptomatic(), defs, TODAY);
    expect(item.highFlags).toBeGreaterThanOrEqual(3);
    expect(item.adherenceStatus).toBe('concern');
    expect(item.currentZone).toBe('yellow');
    expect(item.attentionScore).toBeGreaterThan(calm.attentionScore);
  });

  it('flags missing activity with the last activity date', () => {
    const doc = emptyDoc();
    submit(doc, '2026-06-10', '09:00', { 'q-feel': 'Good' });
    const s = buildPatientSummary(doc, defs, { today: TODAY });
    expect(s.freshness).toMatchObject({ lastActivityDate: '2026-06-10', daysSinceLastActivity: 20, status: 'concern', totalDaysTracked: 1 });
    const f = s.flags.find((x) => x.id === 'no-recent-activity')!;
    expect(f.severity).toBe('high');
    expect(f.detail).toContain('Jun 10');
  });
});

describe('csv & determinism', () => {
  afterEach(() => vi.useRealTimers());

  it('writes one RFC 4180 row per day with quoting', () => {
    const tracker = {
      ...asthmaTracker,
      questions: asthmaTracker.questions.map((q) =>
        q.id === 'q-sym' ? { ...q, options: [...q.options!, { value: 'Itchy, "scratchy" throat', label: 'Itchy, "scratchy" throat' }] } : q,
      ),
    };
    const doc = emptyDoc();
    submit(doc, '2026-06-30', '09:00', { 'q-feel': 'Bad', 'q-sym': JSON.stringify(['Coughing', 'Itchy, "scratchy" throat']), 'q-rescue': '1' });
    const s = buildPatientSummary(doc, [tracker], { today: TODAY });
    const csv = summaryToCsv(s);
    const lines = csv.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(31);
    expect(lines[0].startsWith('date,has_data,submissions,blank_submissions,feeling,symptoms,symptom_day,hard_day,zone,')).toBe(true);
    expect(lines[0]).toContain('role_rescue_med_use');
    expect(lines[30]).toContain('"Coughing;Itchy, ""scratchy"" throat"');
    expect(lines[30].startsWith('2026-06-30,true,1,0,Bad,')).toBe(true);
  });

  it('is deterministic given opts.today regardless of the system clock', () => {
    const doc = adherentButSymptomatic();
    const before = JSON.stringify(doc);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T12:00:00Z'));
    const a = buildPatientSummary(structuredClone(doc), defs, { today: TODAY });
    vi.setSystemTime(new Date('2020-05-05T03:00:00Z'));
    const b = buildPatientSummary(doc, defs, { today: TODAY });
    expect(JSON.stringify(doc)).toBe(before); // input not mutated
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.generatedAt.startsWith(TODAY)).toBe(true);
    expect(JSON.stringify(a)).not.toMatch(/NaN|Infinity/);
  });
});
