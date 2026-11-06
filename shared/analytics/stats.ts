/**
 * Window-level aggregates shared by headline metrics, flags and patient-facing text.
 */
import type { ISODate } from '../types/raw';
import type { QuestionRole, TrackerQuestion } from '../types/tracker';
import type { DataFreshness, MedicationSummary, Status } from '../types/summary';
import { engagedRange, type Ctx } from './context';
import { assessControl, MIN_ENGAGED_DAYS, type ControlAssessment } from './control';
import type { DayCalc, RoleValue } from './days';
import { isAtConcern } from './days';
import { diffDays, maxDate, minDate } from './dates';
import type { SpirometryWindowResult } from './spirometry';
import { round } from './humanize';

export interface CountStat {
  count: number;
  prior: number;
  dates: ISODate[];
}

export interface ConditionSymptoms {
  days: number;
  logged: number;
  priorDays: number;
  priorLogged: number;
  dates: ISODate[];
}

export interface RoleStats {
  role: QuestionRole;
  condition: string;
  question: TrackerQuestion;
  answered: number;
  priorAnswered: number;
  /** Days with a "yes" (or a number > 0). */
  yes: CountStat;
  values: number[];
  priorValues: number[];
  /** Days at/over the concern threshold (numeric roles). */
  concernDates: ISODate[];
  series: { date: ISODate; value: number | null }[];
}

export interface WindowStats {
  days: DayCalc[];
  prior: DayCalc[];
  logged: CountStat;
  symptom: CountStat;
  hard: CountStat;
  discordant: CountStat;
  bySymptomCondition: Map<string, ConditionSymptoms>;
  zoneDays: { green: number; yellow: number; red: number; unknown: number };
  priorZoneDays: { green: number; yellow: number; red: number; unknown: number };
  /** Asthma rescue uses (doses + tracker self-report). Undefined when no basis. */
  rescue?: { daysUsed: number; uses: number; perWeek: number; priorDaysUsed: number; dates: ISODate[] };
  meds: MedicationSummary;
  spiro?: SpirometryWindowResult;
  freshness: DataFreshness;
  roles: Map<QuestionRole, RoleStats>;
  /** Window days from max(window start, enrollment) through the last engaged day. */
  engaged: DayCalc[];
  engagedDays: number;
  /** Days from max(window start, enrollment) to window end. */
  effectiveDays: number;
  control: Map<string, ControlAssessment>;
}

/** Symptom-/hard-day status: good ≤ 2 days/week, watch above, concern ≥ 4 days/week (capped at watch with < 7 days of data). */
export function weeklyDayStatus(count: number, days: number): Status {
  if (days <= 0) return 'unknown';
  const perWeek = count / (days / 7);
  let st: Status = perWeek >= 4 ? 'concern' : perWeek > 2 ? 'watch' : 'good';
  if (days < MIN_ENGAGED_DAYS && st === 'concern') st = 'watch';
  return st;
}

const truthy = (v: RoleValue | undefined) => v === true || (typeof v === 'number' && v > 0);

function count(days: DayCalc[], pred: (d: DayCalc) => boolean): ISODate[] {
  return days.filter(pred).map((d) => d.summary.date);
}

function countStat(win: DayCalc[], prior: DayCalc[], pred: (d: DayCalc) => boolean): CountStat {
  const dates = count(win, pred);
  return { count: dates.length, prior: count(prior, pred).length, dates };
}

function zoneCounts(days: DayCalc[]) {
  const z = { green: 0, yellow: 0, red: 0, unknown: 0 };
  for (const d of days) z[d.summary.zone ?? 'unknown']++;
  return z;
}

export function roleQuestions(ctx: Ctx, role: QuestionRole): { q: TrackerQuestion; condition: string }[] {
  const out: { q: TrackerQuestion; condition: string }[] = [];
  for (const def of ctx.assigned) for (const q of def.questions) if (q.role === role) out.push({ q, condition: def.condition });
  return out;
}

const STAT_ROLES: QuestionRole[] = [
  'missedSchool',
  'nightWaking',
  'activityLimitation',
  'rescueMedUse',
  'painSeverity',
  'symptomSeverity',
  'headache',
  'headacheDurationHours',
  'stoolFrequency',
  'bloodInStool',
  'sleepHours',
];

function roleStats(ctx: Ctx, win: DayCalc[], prior: DayCalc[], role: QuestionRole): RoleStats | undefined {
  const qs = roleQuestions(ctx, role);
  if (!qs.length) return undefined;
  const conds = [...new Set(qs.map((x) => x.condition))];
  const q = qs[0].q;
  const val = (d: DayCalc) => d.summary.roleValues[role];
  const num = (v: RoleValue | undefined) => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : null);
  const series = win.map((d) => ({ date: d.summary.date, value: num(val(d)) }));
  const values = series.map((s) => s.value).filter((v): v is number => v !== null);
  const priorValues = prior.map((d) => num(val(d))).filter((v): v is number => v !== null);
  return {
    role,
    condition: conds.length === 1 ? conds[0] : 'general',
    question: q,
    answered: win.filter((d) => val(d) !== undefined).length,
    priorAnswered: prior.filter((d) => val(d) !== undefined).length,
    yes: countStat(win, prior, (d) => truthy(val(d))),
    values,
    priorValues,
    concernDates: series.filter((s) => s.value !== null && isAtConcern(q, s.value)).map((s) => s.date),
    series,
  };
}

export function freshnessStatus(daysSince: number | undefined): Status {
  if (daysSince === undefined) return 'unknown';
  if (daysSince <= 2) return 'good';
  if (daysSince <= 7) return 'watch';
  return 'concern';
}

export function computeFreshness(ctx: Ctx, win: DayCalc[]): DataFreshness {
  const ev = ctx.events.filter((e) => e.date <= ctx.window.end);
  const last = ev[ev.length - 1];
  const lastOf = (k: string) => [...ev].reverse().find((e) => e.kind === k)?.date;
  const activeDates = new Set(ev.map((e) => e.date));
  const daysSince = last ? Math.max(0, diffDays(ctx.window.end, last.date)) : undefined;
  const f: DataFreshness = {
    status: freshnessStatus(daysSince),
    activeDaysInWindow: win.filter((d) => d.summary.hasData).length,
    totalDaysTracked: activeDates.size,
  };
  if (last) {
    f.lastActivityAt = last.ts;
    f.lastActivityDate = last.date;
    f.daysSinceLastActivity = daysSince;
    f.firstActivityDate = ev[0].date;
  }
  const t = lastOf('tracker');
  const m = lastOf('dose');
  const s = lastOf('spirometry');
  if (t) f.lastTrackerSubmissionDate = t;
  if (m) f.lastMedicationDoseDate = m;
  if (s) f.lastSpirometryDate = s;
  return f;
}

export function computeStats(
  ctx: Ctx,
  win: DayCalc[],
  prior: DayCalc[],
  meds: MedicationSummary,
  spiro: SpirometryWindowResult | undefined,
): WindowStats {
  const bySymptomCondition = new Map<string, ConditionSymptoms>();
  for (const c of ctx.conditions) {
    const has = (d: DayCalc) => d.symptomByCondition.has(c);
    const sym = (d: DayCalc) => d.symptomByCondition.get(c) === true;
    bySymptomCondition.set(c, {
      days: win.filter(sym).length,
      logged: win.filter(has).length,
      priorDays: prior.filter(sym).length,
      priorLogged: prior.filter(has).length,
      dates: count(win, sym),
    });
  }

  let rescue: WindowStats['rescue'];
  const hasRescueMed = meds.asNeeded.some((m) => m.role === 'rescue');
  const hasRescueQ = roleQuestions(ctx, 'rescueMedUse').some((x) => x.condition.toLowerCase() === 'asthma');
  if (ctx.isAsthma && (hasRescueMed || hasRescueQ)) {
    const dates = count(win, (d) => d.rescueUses > 0);
    rescue = {
      daysUsed: dates.length,
      uses: win.reduce((s, d) => s + d.rescueUses, 0),
      perWeek: ctx.engagedDays > 0 ? round(dates.length / (ctx.engagedDays / 7), 1) : 0,
      priorDaysUsed: prior.filter((d) => d.rescueUses > 0).length,
      dates,
    };
  }

  const roles = new Map<QuestionRole, RoleStats>();
  for (const r of STAT_ROLES) {
    const s = roleStats(ctx, win, prior, r);
    if (s) roles.set(r, s);
  }

  const range = engagedRange(ctx);
  const engaged = range ? win.filter((d) => d.summary.date >= range.start && d.summary.date <= range.end) : [];
  return {
    engaged,
    engagedDays: ctx.engagedDays,
    effectiveDays: ctx.effectiveDays,
    control: assessControl(ctx, engaged, spiro),
    days: win,
    prior,
    logged: countStat(win, prior, (d) => d.logged),
    symptom: countStat(win, prior, (d) => d.summary.symptomDay),
    hard: countStat(win, prior, (d) => d.summary.hardDay),
    discordant: countStat(win, prior, (d) => d.summary.discordant),
    bySymptomCondition,
    zoneDays: zoneCounts(win),
    priorZoneDays: zoneCounts(prior),
    rescue,
    meds,
    spiro,
    freshness: computeFreshness(ctx, win),
    roles,
  };
}

/** Most recent date of a list (for flag ordering). */
export function latest(dates: ISODate[] | undefined): ISODate | undefined {
  return dates && dates.length ? maxDate(...dates) : undefined;
}

export function earliest(dates: ISODate[] | undefined): ISODate | undefined {
  return dates && dates.length ? minDate(...dates) : undefined;
}
