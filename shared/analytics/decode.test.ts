import { describe, expect, it } from 'vitest';
import { asthmaTracker } from './__fixtures__/fixtures';
import { decodeAnswer } from './decode';
import { addDays, dateRange, diffDays, isoWeekStart } from './dates';
import { humanizeIdentifier, makeTrend } from './humanize';
import type { TrackerQuestion } from '../types/tracker';

const q = (id: string) => asthmaTracker.questions.find((x) => x.id === id)!;

describe('decodeAnswer', () => {
  it('decodes yes/no in all spellings, trimmed and case-insensitive', () => {
    const yn = q('q-night');
    expect(decodeAnswer(yn, 'Yes')).toEqual({ kind: 'boolean', value: true });
    expect(decodeAnswer(yn, 'true')).toEqual({ kind: 'boolean', value: true });
    expect(decodeAnswer(yn, ' TRUE ')).toEqual({ kind: 'boolean', value: true });
    expect(decodeAnswer(yn, '1')).toEqual({ kind: 'boolean', value: true });
    expect(decodeAnswer(yn, 'No')).toEqual({ kind: 'boolean', value: false });
    expect(decodeAnswer(yn, '0')).toEqual({ kind: 'boolean', value: false });
    expect(decodeAnswer(yn, 'maybe')).toBeNull();
  });

  it('treats "", null and "[]" as empty', () => {
    expect(decodeAnswer(q('q-night'), '')).toBeNull();
    expect(decodeAnswer(q('q-feel'), null)).toBeNull();
    expect(decodeAnswer(q('q-sym'), '[]')).toBeNull();
    expect(decodeAnswer(q('q-notes'), '   ')).toBeNull();
  });

  it('parses numbers and ignores NaN', () => {
    expect(decodeAnswer(q('q-rescue'), '2.5')).toEqual({ kind: 'number', value: 2.5 });
    expect(decodeAnswer(q('q-rescue'), ' 3 ')).toEqual({ kind: 'number', value: 3 });
    expect(decodeAnswer(q('q-rescue'), 'lots')).toBeNull();
  });

  it('maps choice values to labels and severity; keeps unknown values as text', () => {
    expect(decodeAnswer(q('q-feel'), ' great ')).toEqual({ kind: 'choice', label: 'Great', severity: 0, known: true });
    expect(decodeAnswer(q('q-feel'), 'Meh ')).toEqual({ kind: 'choice', label: 'Meh', known: false });
  });

  it('decodes checkbox JSON, drops "None of these " (trailing space) and maps labels', () => {
    expect(decodeAnswer(q('q-sym'), '["Coughing","Tight Chest"]')).toEqual({ kind: 'multi', items: ['Coughing', 'Tight chest'], noneSelected: false });
    expect(decodeAnswer(q('q-sym'), '["None of these "]')).toEqual({ kind: 'multi', items: [], noneSelected: true });
    expect(decodeAnswer(q('q-sym'), '["None of these"]')).toEqual({ kind: 'multi', items: [], noneSelected: true });
    expect(decodeAnswer(q('q-sym'), 'Coughing, Wheezing')).toEqual({ kind: 'multi', items: ['Coughing', 'Wheezing'], noneSelected: false });
    expect(decodeAnswer(q('q-sym'), '[" Sneezing "]')).toEqual({ kind: 'multi', items: ['Sneezing'], noneSelected: false });
  });

  it('trims spirometry answers and shows the linked blow as a clock time', () => {
    const sp: TrackerQuestion = q('q-spiro');
    expect(decodeAnswer(sp, ' 2026-06-24T09:31:12.120-04:00 ')).toEqual({ kind: 'text', text: 'Reading taken at 09:31' });
  });
});

describe('helpers', () => {
  it('humanizes programmer strings', () => {
    expect(humanizeIdentifier('KeepGoingUntilCompletelyEmpty')).toBe('Keep going until completely empty');
    expect(humanizeIdentifier('NotAcceptable')).toBe('Not acceptable');
    expect(humanizeIdentifier('BlowHarderPEF')).toBe('Blow harder PEF');
  });

  it('does date math on strings in UTC', () => {
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // US DST change
    expect(diffDays('2026-06-30', '2026-06-01')).toBe(29);
    expect(dateRange('2026-02-27', '2026-03-01')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
    expect(isoWeekStart('2026-06-28')).toBe('2026-06-22'); // Sunday → Monday before
  });

  it('builds trends with a true minus sign and clinical meaning', () => {
    const t = makeTrend(5, 9, { higherIsWorse: true, mode: 'abs', minChange: 1, versus: 'prior 30 days' });
    expect(t).toEqual({ direction: 'down', meaning: 'better', text: '−4 vs prior 30 days' });
    expect(makeTrend(10, 10, { higherIsWorse: true, mode: 'abs', minChange: 1, versus: 'x' })?.direction).toBe('flat');
  });
});

describe('spirometry prompt answers', () => {
  it('shows the linked blow timestamp as a clock time, never raw ISO', () => {
    const spiro = { id: 's', text: 'Please complete your spirometer reading', shortLabel: 'Spirometer', type: 'spirometry', order: 0 } as TrackerQuestion;
    expect(decodeAnswer(spiro, '2026-11-06T08:18:42.625-05:00')).toEqual({ kind: 'text', text: 'Reading taken at 08:18' });
    expect(decodeAnswer(spiro, 'done')).toEqual({ kind: 'text', text: 'done' });
  });
});
