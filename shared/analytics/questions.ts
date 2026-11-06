/**
 * Generic per-question summaries. Every question of every tracker gets a summary whose
 * `kind` is chosen from its type, so any tracker built in the no-code builder renders.
 */
import type { ISODate } from '../types/raw';
import type { TrackerDefinition, TrackerQuestion } from '../types/tracker';
import type {
  BooleanQuestionSummary,
  CategoricalQuestionSummary,
  MultiSelectQuestionSummary,
  NumericQuestionSummary,
  QuestionSummary,
  TextQuestionSummary,
  TrackerSummary,
} from '../types/summary';
import type { CollapseResult, CollapsedAnswer } from './collapse';
import { concernThresholdOf, isAtConcern } from './days';
import { makeTrend, mean, pctOf, round } from './humanize';

export function questionKind(q: TrackerQuestion): QuestionSummary['kind'] {
  switch (q.type) {
    case 'faceScale':
    case 'iconChoice':
    case 'singleChoice':
      return 'categorical';
    case 'checkbox':
      return 'multi';
    case 'number':
    case 'scale1to10':
      return 'numeric';
    case 'yesNo':
      return 'boolean';
    default:
      return 'text';
  }
}

type Getter = (date: ISODate) => CollapsedAnswer | undefined;

function base(def: TrackerDefinition, q: TrackerQuestion, answeredDays: number, windowDays: number) {
  const b = {
    questionId: q.id,
    trackerId: def.id,
    text: q.text,
    shortLabel: q.shortLabel,
    type: q.type,
    answeredDays,
    windowDays,
  };
  return q.role ? { ...b, role: q.role } : b;
}

function numericRangeStep(q: TrackerQuestion, priorMean: number): number {
  if (typeof q.min === 'number' && typeof q.max === 'number' && q.max > q.min) return Math.max(0.1, (q.max - q.min) * 0.05);
  return Math.max(0.1, Math.abs(priorMean) * 0.1);
}

export function summarizeQuestion(
  def: TrackerDefinition,
  q: TrackerQuestion,
  get: Getter,
  days: ISODate[],
  priorDays: ISODate[],
  versus: string,
): QuestionSummary {
  const kind = questionKind(q);
  const answers = days.map((d) => ({ date: d, a: get(d) }));
  const answered = answers.filter((x) => x.a !== undefined);
  const n = days.length;

  if (kind === 'categorical') {
    const series: CategoricalQuestionSummary['series'] = answers.map(({ date, a }) => {
      if (a?.value.kind !== 'choice') return { date, label: null };
      return a.value.severity !== undefined ? { date, label: a.value.label, severity: a.value.severity } : { date, label: a.value.label };
    });
    const counts = new Map<string, number>();
    for (const s of series) if (s.label !== null) counts.set(s.label, (counts.get(s.label) ?? 0) + 1);
    const distribution: CategoricalQuestionSummary['distribution'] = [];
    const seen = new Set<string>();
    for (const o of q.options ?? []) {
      if (seen.has(o.label)) continue;
      seen.add(o.label);
      const c = counts.get(o.label) ?? 0;
      const row: CategoricalQuestionSummary['distribution'][number] = { label: o.label, days: c, pct: pctOf(c, answered.length) ?? 0 };
      if (o.severity !== undefined) row.severity = o.severity;
      distribution.push(row);
    }
    for (const [label, c] of counts) if (!seen.has(label)) distribution.push({ label, days: c, pct: pctOf(c, answered.length) ?? 0 });
    return { ...base(def, q, answered.length, n), kind, distribution, series };
  }

  if (kind === 'multi') {
    const series: MultiSelectQuestionSummary['series'] = answers.map(({ date, a }) => ({
      date,
      items: a?.value.kind === 'multi' ? [...a.value.items] : null,
    }));
    const counts = new Map<string, number>();
    let anyDays = 0;
    for (const s of series) {
      if (!s.items) continue;
      if (s.items.length) anyDays++;
      for (const it of s.items) counts.set(it, (counts.get(it) ?? 0) + 1);
    }
    const optionOrder = (q.options ?? []).map((o) => o.label);
    const items = [...counts.entries()]
      .map(([label, d]) => ({ label, days: d, pct: pctOf(d, answered.length) ?? 0 }))
      .sort((a, b) => b.days - a.days || idx(optionOrder, a.label) - idx(optionOrder, b.label) || a.label.localeCompare(b.label));
    return { ...base(def, q, answered.length, n), kind, items, anyDays, series };
  }

  if (kind === 'numeric') {
    const series: NumericQuestionSummary['series'] = answers.map(({ date, a }) => ({
      date,
      value: a?.value.kind === 'number' ? a.value.value : null,
    }));
    const vals = series.map((s) => s.value).filter((v): v is number => v !== null);
    const priorVals = priorDays
      .map((d) => get(d))
      .map((a) => (a?.value.kind === 'number' ? a.value.value : null))
      .filter((v): v is number => v !== null);
    const m = mean(vals);
    const pm = mean(priorVals);
    const direction = q.direction ?? 'higherIsWorse';
    const out: NumericQuestionSummary = {
      ...base(def, q, answered.length, n),
      kind,
      direction,
      stats: {
        mean: m === null ? null : round(m, 1),
        min: vals.length ? Math.min(...vals) : null,
        max: vals.length ? Math.max(...vals) : null,
        last: vals.length ? vals[vals.length - 1] : null,
        daysAtConcern: vals.filter((v) => isAtConcern(q, v)).length,
      },
      series,
    };
    if (q.unit) out.unit = q.unit;
    if (typeof q.min === 'number') out.min = q.min;
    if (typeof q.max === 'number') out.max = q.max;
    const t = concernThresholdOf(q);
    if (t !== undefined) out.concernThreshold = t;
    if (m !== null && pm !== null) {
      const trend = makeTrend(m, pm, {
        higherIsWorse: direction !== 'higherIsBetter',
        mode: 'abs',
        minChange: numericRangeStep(q, pm),
        dp: 1,
        versus,
      });
      if (trend) out.trend = trend;
    }
    return out;
  }

  if (kind === 'boolean') {
    const series: BooleanQuestionSummary['series'] = answers.map(({ date, a }) => ({
      date,
      value: a?.value.kind === 'boolean' ? a.value.value : null,
    }));
    const yesDays = series.filter((s) => s.value === true).length;
    const noDays = series.filter((s) => s.value === false).length;
    return { ...base(def, q, answered.length, n), kind, yesDays, noDays, yesPct: pctOf(yesDays, yesDays + noDays) ?? 0, series };
  }

  const recent: TextQuestionSummary['recent'] = [];
  for (let i = answers.length - 1; i >= 0 && recent.length < 10; i--) {
    const a = answers[i].a;
    if (a?.value.kind === 'text' && a.value.text) recent.push({ date: answers[i].date, text: a.value.text });
  }
  return { ...base(def, q, answered.length, n), kind: 'text', recent };
}

function idx(list: string[], s: string): number {
  const i = list.indexOf(s);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

export function summarizeTracker(
  def: TrackerDefinition,
  collapse: CollapseResult,
  days: ISODate[],
  priorDays: ISODate[],
  versus: string,
  /** Denominator for completionPct (days since the later of window start and enrollment). */
  effectiveDays = days.length,
): TrackerSummary {
  let submissions = 0;
  let blankSubmissions = 0;
  let daysWithSubmission = 0;
  let collapsedDays = 0;
  for (const d of days) {
    const subs = collapse.days.get(d)?.submissions.filter((s) => s.trackerId === def.id) ?? [];
    submissions += subs.length;
    const nonBlank = subs.filter((s) => !s.blank).length;
    blankSubmissions += subs.length - nonBlank;
    if (nonBlank > 0) daysWithSubmission++;
    if (nonBlank > 1) collapsedDays++;
  }
  const questions = [...def.questions]
    .sort((a, b) => a.order - b.order)
    .map((q) => summarizeQuestion(def, q, (d) => collapse.days.get(d)?.answers.get(def.id)?.get(q.id), days, priorDays, versus));
  return {
    tracker: { id: def.id, name: def.name, condition: def.condition, conditionLabel: def.conditionLabel },
    submissions,
    blankSubmissions,
    daysWithSubmission,
    completionPct: pctOf(daysWithSubmission, effectiveDays) ?? 0,
    collapsedDays,
    questions,
  };
}
