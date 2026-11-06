/**
 * Per-day collapsed status: one DaySummary per calendar day, plus internal evaluation
 * details (per tracker / per condition) used by metrics and flags.
 */
import type { ISODate } from '../types/raw';
import type { QuestionRole, Severity, TrackerQuestion } from '../types/tracker';
import type { DaySummary, Zone } from '../types/summary';
import type { CollapsedAnswer } from './collapse';
import type { Ctx } from './context';
import { dateRange } from './dates';
import { expectedOn, takenOn } from './medications';
import { symptomZone, worseZone } from './zones';

export type RoleValue = number | boolean | string[];
export type RoleValues = Partial<Record<QuestionRole, RoleValue>>;

/** Concern threshold of a numeric question (explicit, or mid-scale for 1–10 pain / symptom scores). */
export function concernThresholdOf(q: TrackerQuestion): number | undefined {
  if (typeof q.concernThreshold === 'number' && Number.isFinite(q.concernThreshold)) return q.concernThreshold;
  if (q.type === 'scale1to10' && (q.role === 'painSeverity' || q.role === 'symptomSeverity')) {
    return Math.round((q.max ?? 10) / 2);
  }
  return undefined;
}

export function isAtConcern(q: TrackerQuestion, v: number): boolean {
  const t = concernThresholdOf(q);
  if (t === undefined) return false;
  return q.direction === 'higherIsBetter' ? v < t : v >= t;
}

export interface TrackerDayEval {
  trackerId: string;
  condition: string;
  feeling?: CollapsedAnswer;
  symptoms: string[];
  symptomsAnswered: boolean;
  scoreAtConcern: boolean;
  painAtConcern: boolean;
  stoolAtConcern: boolean;
  missedSchool: boolean;
  bloodInStool: boolean;
  headache: boolean;
  nightWaking: boolean;
  rescueMedUse?: number;
  roles: RoleValues;
  symptomDay: boolean;
  /** Hard-day criteria other than zone. */
  hardDay: boolean;
}

function truthy(v: CollapsedAnswer['value']): boolean {
  if (v.kind === 'boolean') return v.value;
  if (v.kind === 'number') return v.value > 0;
  return false;
}

function mergeRole(roles: RoleValues, role: QuestionRole, v: RoleValue): void {
  const prev = roles[role];
  if (prev === undefined) roles[role] = Array.isArray(v) ? [...v] : v;
  else if (Array.isArray(prev) && Array.isArray(v)) {
    for (const x of v) if (!prev.includes(x)) prev.push(x);
  } else if (typeof prev === 'number' && typeof v === 'number') roles[role] = Math.max(prev, v);
  else if (typeof prev === 'boolean' && typeof v === 'boolean') roles[role] = prev || v;
  else roles[role] = v;
}

function roleValueOf(a: CollapsedAnswer): RoleValue | undefined {
  const v = a.value;
  switch (v.kind) {
    case 'boolean':
    case 'number':
      return v.value;
    case 'multi':
      return v.items;
    case 'choice':
      return v.severity;
    default:
      return undefined;
  }
}

export function evalTracker(trackerId: string, condition: string, answers: Map<string, CollapsedAnswer>): TrackerDayEval {
  const e: TrackerDayEval = {
    trackerId,
    condition,
    symptoms: [],
    symptomsAnswered: false,
    scoreAtConcern: false,
    painAtConcern: false,
    stoolAtConcern: false,
    missedSchool: false,
    bloodInStool: false,
    headache: false,
    nightWaking: false,
    roles: {},
    symptomDay: false,
    hardDay: false,
  };
  const sorted = [...answers.values()].sort((a, b) => a.question.order - b.question.order);
  for (const a of sorted) {
    const q = a.question;
    const role = q.role;
    if (!role) continue;
    const rv = roleValueOf(a);
    if (rv !== undefined && role !== 'overallFeeling') mergeRole(e.roles, role, rv);
    const num = a.value.kind === 'number' ? a.value.value : undefined;
    switch (role) {
      case 'overallFeeling':
        if (a.value.kind === 'choice' && (!e.feeling || a.time >= e.feeling.time)) e.feeling = a;
        if (a.value.kind === 'choice' && a.value.severity !== undefined) mergeRole(e.roles, role, a.value.severity);
        break;
      case 'symptoms':
        if (a.value.kind === 'multi') {
          e.symptomsAnswered = true;
          for (const it of a.value.items) if (!e.symptoms.includes(it)) e.symptoms.push(it);
        }
        break;
      case 'symptomSeverity':
        if (num !== undefined && isAtConcern(q, num)) e.scoreAtConcern = true;
        break;
      case 'painSeverity':
        if (num !== undefined && isAtConcern(q, num)) {
          e.scoreAtConcern = true;
          e.painAtConcern = true;
        }
        break;
      case 'stoolFrequency':
        if (num !== undefined && isAtConcern(q, num)) e.stoolAtConcern = true;
        break;
      case 'missedSchool':
        e.missedSchool ||= truthy(a.value);
        break;
      case 'bloodInStool':
        e.bloodInStool ||= truthy(a.value);
        break;
      case 'headache':
        e.headache ||= truthy(a.value);
        break;
      case 'nightWaking':
        e.nightWaking ||= truthy(a.value);
        break;
      case 'rescueMedUse':
        if (a.value.kind === 'number') e.rescueMedUse = Math.max(e.rescueMedUse ?? 0, a.value.value);
        else if (a.value.kind === 'boolean') e.rescueMedUse = Math.max(e.rescueMedUse ?? 0, a.value.value ? 1 : 0);
        break;
      default:
        break;
    }
  }
  const feelingSev = e.feeling?.value.kind === 'choice' ? e.feeling.value.severity : undefined;
  e.symptomDay =
    e.symptoms.length > 0 ||
    (feelingSev ?? 0) >= 2 ||
    e.scoreAtConcern ||
    e.headache ||
    e.nightWaking ||
    e.bloodInStool ||
    e.stoolAtConcern;
  e.hardDay =
    (feelingSev ?? 0) >= 2 ||
    e.painAtConcern ||
    e.missedSchool ||
    e.bloodInStool ||
    e.stoolAtConcern;
  return e;
}

export interface DayCalc {
  summary: DaySummary;
  /** ≥ 1 non-blank tracker submission. */
  logged: boolean;
  evals: TrackerDayEval[];
  /** condition → symptom day (only conditions with a check-in that day). */
  symptomByCondition: Map<string, boolean>;
  /** Asthma rescue uses (max of rescue-med doses and asthma tracker self-report). */
  rescueUses: number;
  /** Per-condition as-needed uses (doses and tracker self-report, max of the two). */
  asNeededByCondition: Map<string, number>;
  symptomZone?: Zone;
  feelingGood: boolean;
}

/** Symptoms that are hard to reconcile with "feeling great" (asthma red-flag symptoms). */
export const KEY_SYMPTOM_RE = /wheez|short(ness)?\s*of\s*breath|tight\s*chest|chest\s*tight/i;

function isGoodFeeling(severity: Severity | undefined): boolean {
  return severity === 0;
}

export function buildDays(ctx: Ctx, start: ISODate, end: ISODate): DayCalc[] {
  const out: DayCalc[] = [];
  const green = ctx.spiro.greenThresholdPct;
  for (const date of dateRange(start, end)) {
    const cd = ctx.collapse.days.get(date);
    const evals: TrackerDayEval[] = [];
    if (cd) {
      for (const def of ctx.assigned) {
        const answers = cd.answers.get(def.id);
        if (answers && answers.size) evals.push(evalTracker(def.id, def.condition, answers));
      }
    }

    // Feeling: last answer of the day across trackers.
    let feeling: DaySummary['feeling'];
    const feelings = evals.map((e) => e.feeling).filter((f): f is CollapsedAnswer => !!f);
    if (feelings.length) {
      const last = feelings.reduce((a, b) => (b.time >= a.time ? b : a));
      const v = last.value.kind === 'choice' ? last.value : undefined;
      if (v) {
        const labels = new Set(feelings.map((f) => (f.value.kind === 'choice' ? f.value.label : '')));
        let worst: CollapsedAnswer | undefined;
        for (const f of feelings) {
          if (f.worstSeverity !== undefined && (worst === undefined || f.worstSeverity > (worst.worstSeverity ?? -1))) worst = f;
        }
        const sequence = feelings
          .flatMap((f) => f.sequence ?? [])
          .sort((a, b) => a.time.localeCompare(b.time))
          .map((x) => x.label);
        feeling = {
          label: v.label,
          changedDuringDay: feelings.some((f) => f.changedDuringDay) || labels.size > 1,
          sequence,
        };
        if (v.severity !== undefined) feeling.severity = v.severity;
        if (worst?.worstLabel) feeling.worstLabel = worst.worstLabel;
      }
    }

    const symptoms: string[] = [];
    const roleValues: RoleValues = {};
    for (const e of evals) {
      for (const s of e.symptoms) if (!symptoms.includes(s)) symptoms.push(s);
      for (const [r, v] of Object.entries(e.roles) as [QuestionRole, RoleValue][]) mergeRole(roleValues, r, v);
    }

    // Medications.
    const doses: DaySummary['doses'] = [];
    let scheduledTaken = 0;
    let scheduledExpected = 0;
    let asNeededDoseUses = 0;
    let rescueDoseUses = 0;
    const asNeededDoseByCond = new Map<string, number>();
    for (const g of ctx.meds.groups) {
      const recs = g.doses.get(date) ?? [];
      for (const r of recs) {
        doses.push({ time: r.time, medicationName: g.name, kind: g.scheduled ? 'scheduled' : 'asNeeded', quantity: r.quantity });
      }
      if (g.scheduled) {
        scheduledExpected += expectedOn(g, date);
        scheduledTaken += takenOn(g, date);
      } else {
        const t = takenOn(g, date);
        asNeededDoseUses += t;
        if (g.role === 'rescue') rescueDoseUses += t;
        const c = g.condition ?? 'general';
        asNeededDoseByCond.set(c, (asNeededDoseByCond.get(c) ?? 0) + t);
      }
    }
    doses.sort((a, b) => a.time.localeCompare(b.time) || a.medicationName.localeCompare(b.medicationName));
    const trackerRescueTotal = evals.reduce((s, e) => s + (e.rescueMedUse ?? 0), 0);
    const asthmaEvals = evals.filter((e) => e.condition.toLowerCase() === 'asthma');
    const asthmaTrackerRescue = asthmaEvals.reduce((s, e) => s + (e.rescueMedUse ?? 0), 0);
    const rescueUses = Math.max(rescueDoseUses, asthmaTrackerRescue);
    const asNeededUses = Math.max(asNeededDoseUses, trackerRescueTotal);
    const asNeededByCondition = new Map<string, number>(asNeededDoseByCond);
    for (const e of evals) {
      if (e.rescueMedUse !== undefined) {
        asNeededByCondition.set(e.condition, Math.max(asNeededByCondition.get(e.condition) ?? 0, e.rescueMedUse));
      }
    }

    // Spirometry.
    // Day shows the LATEST session; the zone uses the WORST session so a red reading is never hidden.
    const daySessions = ctx.spiro.byDate.get(date) ?? [];
    const session = daySessions[daySessions.length - 1];
    let spirometry: DaySummary['spirometry'];
    if (session) {
      spirometry = { pefLpm: session.bestPefLpm, fev1L: session.bestFev1L, acceptable: session.reliable };
      if (session.pctPersonalBest !== undefined) spirometry.pctPersonalBest = session.pctPersonalBest;
    }
    let spiroZone: Zone | undefined;
    for (const x of daySessions) spiroZone = worseZone(spiroZone, x.zone);
    const pcts = daySessions.map((x) => x.pctPersonalBest).filter((x): x is number => x !== undefined);
    const minPct = pcts.length ? Math.min(...pcts) : undefined;

    // Zone (asthma patients only).
    let zone: Zone | undefined;
    let symZone: Zone | undefined;
    if (ctx.isAsthma) {
      const aFeelings = asthmaEvals.map((e) => e.feeling).filter((f): f is CollapsedAnswer => !!f);
      const aFeeling = aFeelings.length ? aFeelings.reduce((a, b) => (b.time >= a.time ? b : a)) : undefined;
      const aSymptoms = new Set(asthmaEvals.flatMap((e) => e.symptoms));
      symZone = symptomZone({
        feelingSeverity: aFeeling?.value.kind === 'choice' ? aFeeling.value.severity : undefined,
        symptomCount: aSymptoms.size,
        nightWaking: asthmaEvals.some((e) => e.nightWaking),
        rescueUses,
      });
      zone = worseZone(spiroZone, symZone);
    }

    const feelingSev = feeling?.severity;
    const feelingGood = !!feeling && isGoodFeeling(feeling.severity);
    const symptomDay = evals.some((e) => e.symptomDay);
    const hardDay = evals.some((e) => e.hardDay) || (feelingSev ?? 0) >= 2 || zone === 'yellow' || zone === 'red';
    const lowPef = minPct !== undefined && minPct < green;
    // Discordant: feels great/good (severity 0) yet ≥ 2 symptoms, a key symptom, or PEF < green threshold.
    const discordant = feelingGood && (symptoms.length >= 2 || symptoms.some((x) => KEY_SYMPTOM_RE.test(x)) || lowPef);

    const symptomByCondition = new Map<string, boolean>();
    for (const e of evals) symptomByCondition.set(e.condition, (symptomByCondition.get(e.condition) ?? false) || e.symptomDay);

    const submissionCount = cd?.submissions.length ?? 0;
    const summary: DaySummary = {
      date,
      hasData: submissionCount > 0 || doses.length > 0 || !!session,
      submissionCount,
      blankSubmissionCount: cd?.blankCount ?? 0,
      symptoms,
      symptomDay,
      hardDay,
      scheduledDosesTaken: scheduledTaken,
      scheduledDosesExpected: scheduledExpected,
      asNeededUses,
      roleValues,
      discordant,
      submissions: (cd?.submissions ?? []).map((s) => ({
        responseId: s.responseId,
        trackerId: s.trackerId,
        time: s.time,
        blank: s.blank,
        usedForDay: s.usedForDay,
        answers: s.answers,
        ...(s.entryMode ? { entryMode: s.entryMode } : {}),
        ...(s.transcript ? { transcript: s.transcript } : {}),
        ...(s.mediaIds ? { mediaIds: s.mediaIds } : {}),
      })),
      doses,
    };
    if (feeling) summary.feeling = feeling;
    if (zone) summary.zone = zone;
    if (spirometry) summary.spirometry = spirometry;
    out.push({
      summary,
      logged: (cd?.nonBlankCount ?? 0) > 0,
      evals,
      symptomByCondition,
      rescueUses,
      asNeededByCondition,
      symptomZone: symZone,
      feelingGood,
    });
  }
  return out;
}
