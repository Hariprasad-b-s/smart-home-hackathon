/**
 * Disease-control assessment over the ENGAGED days of the window (enrollment → last activity),
 * scaled to the window length. Gates the key adherence-vs-control flags.
 *
 *  Asthma (NAEPP / EPR-3 impairment, age ≥ 12) — NOT WELL CONTROLLED if any:
 *    symptom days > 2/week · night waking > 2/month · rescue use > 2 days/week ·
 *    latest reliable or mean PEF < 80 % personal best · missed school / activity limitation ≥ 2 days.
 *    VERY POORLY CONTROLLED: symptoms (almost) daily, PEF < 60 %, or rescue several times a day.
 *  Migraine — not well controlled: headache days ≥ 8 per 30, missed school ≥ 2 days, or average pain ≥ 7.
 *  IBD — not well controlled: blood in stool ≥ 2 days, average stool frequency ≥ threshold, or ≥ 3 days
 *    with pain ≥ threshold.
 *  Other trackers — not well controlled when symptom days > 2/week.
 */
import type { Status } from '../types/summary';
import type { Ctx } from './context';
import type { DayCalc, TrackerDayEval } from './days';
import { mean, plural, round } from './humanize';
import type { SpirometryWindowResult } from './spirometry';

export type ControlLevel = 'well' | 'notWell' | 'veryPoor' | 'unknown';

export interface ControlAssessment {
  condition: string;
  level: ControlLevel;
  /** Drivers of "not well" / "very poorly" control, e.g. "rescue 4 days/wk". */
  reasons: string[];
  /** One line for the UI: "Not well controlled (NAEPP): rescue 4 days/wk, night waking 6×". */
  text: string;
  status: Status;
}

/** Minimum engaged days before control is assessed. */
export const MIN_ENGAGED_DAYS = 7;

const r1 = (n: number) => round(n, 1);
const truthy = (v: unknown) => v === true || (typeof v === 'number' && v > 0);

function finish(condition: string, level: ControlLevel, reasons: string[], suffix: string, unknownWhy?: string): ControlAssessment {
  const status: Status = level === 'well' ? 'good' : level === 'notWell' ? 'watch' : level === 'veryPoor' ? 'concern' : 'unknown';
  let text: string;
  if (level === 'unknown') text = `Control not assessed: ${unknownWhy ?? 'not enough data'}`;
  else {
    const head = level === 'well' ? 'Well controlled' : level === 'notWell' ? 'Not well controlled' : 'Very poorly controlled';
    text = `${head}${suffix}${reasons.length ? `: ${reasons.join(', ')}` : ''}`;
  }
  return { condition, level, reasons, text, status };
}

export function assessControl(
  ctx: Ctx,
  engaged: DayCalc[],
  spiro: SpirometryWindowResult | undefined,
): Map<string, ControlAssessment> {
  const out = new Map<string, ControlAssessment>();
  const n = ctx.engagedDays;
  const perWeek = (k: number) => (n > 0 ? k / (n / 7) : 0);
  const per30 = (k: number) => (n > 0 ? (k * 30) / n : 0);

  for (const c of ctx.conditions) {
    const key = c.toLowerCase();
    const evals = (d: DayCalc): TrackerDayEval[] => d.evals.filter((e) => e.condition === c);
    const logged = engaged.filter((d) => evals(d).length > 0).length;
    const suffix = key === 'asthma' ? ' (NAEPP)' : '';
    const sessions = key === 'asthma' ? (spiro?.summary.sessions ?? []).filter((s) => engaged.some((d) => d.summary.date === s.date)) : [];
    if (n < MIN_ENGAGED_DAYS) {
      out.set(c, finish(c, 'unknown', [], suffix, n === 0 ? 'no activity in this period' : `only ${plural(n, 'day')} of data`));
      continue;
    }
    if (logged < 3 && sessions.length === 0) {
      out.set(c, finish(c, 'unknown', [], suffix, `only ${plural(logged, 'check-in day')} in this period`));
      continue;
    }

    const notWell: string[] = [];
    const veryPoor: string[] = [];
    const countDays = (pred: (e: TrackerDayEval) => boolean) => engaged.filter((d) => evals(d).some(pred)).length;

    if (key === 'asthma') {
      const sym = perWeek(countDays((e) => e.symptoms.length > 0));
      const nights = countDays((e) => e.nightWaking);
      const rescueDays = engaged.filter((d) => d.rescueUses > 0).length;
      const rescueUses = engaged.reduce((s, d) => s + d.rescueUses, 0);
      const school = countDays((e) => e.missedSchool || truthy(e.roles.activityLimitation) || e.symptoms.some((x) => /activit/i.test(x)));
      const reliable = sessions.filter((s) => s.reliable && s.pctPersonalBest !== undefined);
      const latestPct = reliable.length ? reliable[reliable.length - 1].pctPersonalBest! : undefined;
      const meanPct = mean(reliable.map((s) => s.pctPersonalBest!));
      const green = spiro?.summary.greenThresholdPct ?? 80;
      if (sym > 2) (sym >= 6 ? veryPoor : notWell).push(`symptoms ${r1(sym)} days/wk`);
      if (per30(nights) > 2) notWell.push(`night waking ${nights}×`);
      if (perWeek(rescueDays) > 2) notWell.push(`rescue ${r1(perWeek(rescueDays))} days/wk`);
      if (rescueUses / n >= 2) veryPoor.push(`rescue ${r1(rescueUses / n)}×/day`);
      const pefLow = (latestPct !== undefined && latestPct < green) || (meanPct !== null && meanPct < green);
      if (pefLow) {
        const shown = latestPct !== undefined && latestPct < green ? `latest PEF ${latestPct}%` : `mean PEF ${round(meanPct!)}%`;
        const worst = Math.min(latestPct ?? 100, meanPct ?? 100);
        (worst < 60 ? veryPoor : notWell).push(`${shown} of personal best`);
      }
      if (school >= Math.max(2, Math.round((2 * n) / 30))) notWell.push(`missed school/activities ${school} days`);
    } else if (key === 'migraine') {
      const head = countDays((e) => e.headache);
      const school = countDays((e) => e.missedSchool);
      const pains = engaged.flatMap((d) => evals(d).map((e) => e.roles.painSeverity)).filter((v): v is number => typeof v === 'number');
      const avgPain = mean(pains);
      if (per30(head) >= 15) veryPoor.push(`${head} headache days`);
      else if (per30(head) >= 8) notWell.push(`${head} headache days`);
      if (school >= 2) notWell.push(`missed school ${school} days`);
      if (avgPain !== null && avgPain >= 7) notWell.push(`average pain ${r1(avgPain)}/10`);
    } else if (key === 'ibd') {
      const blood = countDays((e) => e.bloodInStool);
      const stools = engaged.flatMap((d) => evals(d).map((e) => e.roles.stoolFrequency)).filter((v): v is number => typeof v === 'number');
      const def = ctx.assigned.find((d) => d.condition === c);
      const threshold = def?.questions.find((q) => q.role === 'stoolFrequency')?.concernThreshold;
      const avgStool = mean(stools);
      const painDays = countDays((e) => e.painAtConcern);
      if (blood >= 2) notWell.push(`blood in stool ${blood} days`);
      if (threshold !== undefined && avgStool !== null && avgStool >= threshold) notWell.push(`${r1(avgStool)} stools/day`);
      if (painDays >= 3) notWell.push(`pain at concern level ${painDays} days`);
      if (notWell.length >= 2) veryPoor.push(...notWell.splice(0));
    } else {
      const sym = perWeek(countDays((e) => e.symptomDay));
      if (sym > 2) notWell.push(`symptoms ${r1(sym)} days/wk`);
    }

    const level: ControlLevel = veryPoor.length ? 'veryPoor' : notWell.length ? 'notWell' : 'well';
    out.set(c, finish(c, level, [...veryPoor, ...notWell], suffix));
  }
  return out;
}

export function isUncontrolled(a: ControlAssessment | undefined): boolean {
  return !!a && (a.level === 'notWell' || a.level === 'veryPoor');
}
