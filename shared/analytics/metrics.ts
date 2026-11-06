/**
 * Headline ("30-second") metrics. Only metrics with a data basis are emitted, in a fixed
 * clinical priority order. Rates use the ENGAGED days (enrollment → last activity) so a new
 * patient or one who stopped logging is not scored on days without data.
 */
import type { ISODate } from '../types/raw';
import type { HeadlineMetric, ScheduledMedicationSummary, Status, Zone } from '../types/summary';
import type { Ctx } from './context';
import { MIN_ENGAGED_DAYS } from './control';
import { fmtShort } from './dates';
import type { DayCalc } from './days';
import { adherenceStatus, capitalize, makeTrend, mean, pctOf, plural, round } from './humanize';
import { abortiveOveruseThreshold } from './medications';
import { weeklyDayStatus, type RoleStats, type WindowStats } from './stats';
import { parsePlanZone, zoneRank, zoneStatus } from './zones';

const ZONE_NUM: Record<Zone, number> = { green: 0, yellow: 1, red: 2 };
const STATUS_RANK: Record<Status, number> = { unknown: -1, neutral: 0, good: 0, watch: 1, concern: 2 };

function worseStatus(a: Status, b: Status): Status {
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

/** Never escalate past "watch" when fewer than 7 days of data back a weekly/monthly rate. */
function capShort(st: Status, days: number): Status {
  if (days <= 0) return 'unknown';
  return days < MIN_ENGAGED_DAYS && st === 'concern' ? 'watch' : st;
}

/** Derived zone of the most recent day with a zone basis, else the plan zone (patient-list contract). */
export function currentZone(ctx: Ctx, days: DayCalc[]): { zone?: Zone; date?: ISODate; source: 'derived' | 'plan' | 'none' } {
  for (let i = days.length - 1; i >= 0; i--) {
    const z = days[i].summary.zone;
    if (z) return { zone: z, date: days[i].summary.date, source: 'derived' };
  }
  const p = parsePlanZone(ctx.doc.asthmaTreatmentPlan?.status);
  return p ? { zone: p, source: 'plan' } : { source: 'none' };
}

/**
 * Headline zone: the most common derived zone over the last 7 days of the window (ties → worse),
 * or red if any of the last 3 days was red. Falls back to the plan zone.
 */
export function recentZone(ctx: Ctx, days: DayCalc[]): { zone?: Zone; source: 'derived' | 'plan' | 'none'; counts?: Record<Zone, number> } {
  const last7 = days.slice(-7);
  const counts: Record<Zone, number> = { green: 0, yellow: 0, red: 0 };
  for (const d of last7) if (d.summary.zone) counts[d.summary.zone]++;
  if (counts.green + counts.yellow + counts.red > 0) {
    if (days.slice(-3).some((d) => d.summary.zone === 'red')) return { zone: 'red', source: 'derived', counts };
    let best: Zone = 'green';
    for (const z of ['yellow', 'red'] as Zone[]) if (counts[z] >= counts[best]) best = z;
    return { zone: best, source: 'derived', counts };
  }
  const p = parsePlanZone(ctx.doc.asthmaTreatmentPlan?.status);
  return p ? { zone: p, source: 'plan' } : { source: 'none' };
}

function primaryCondition(ctx: Ctx): string {
  return ctx.conditions.length === 1 ? ctx.conditions[0] : 'general';
}

export function conditionLabel(ctx: Ctx, c: string | undefined): string {
  if (!c) return '';
  return ctx.assigned.find((d) => d.condition === c)?.conditionLabel ?? capitalize(c);
}

/** Scheduled meds that are relevant to show (measured, or currently prescribed but unmeasurable). */
function showable(ctx: Ctx, m: ScheduledMedicationSummary): boolean {
  if (m.dosesExpected > 0) return true;
  const g = ctx.meds.groups.find((x) => x.key === m.key);
  const current = !!g && (g.activeEnd === undefined || g.activeEnd >= ctx.window.start);
  return current && (m.measuredThrough !== undefined || !ctx.lastActivityDate);
}

function rankMeds(ctx: Ctx, meds: ScheduledMedicationSummary[]): ScheduledMedicationSummary[] {
  const rank = (m: ScheduledMedicationSummary) => {
    const c = m.condition ?? '';
    if (c === 'asthma') return 0;
    const i = ctx.conditions.indexOf(c);
    return i >= 0 ? 1 + i : 100;
  };
  return meds.filter((m) => showable(ctx, m)).sort((a, b) => rank(a) - rank(b) || b.dosesExpected - a.dosesExpected);
}

/** Primary scheduled medication: asthma controller first, then the first assigned condition, then most doses expected. */
export function primaryScheduled(ctx: Ctx, meds: ScheduledMedicationSummary[]): ScheduledMedicationSummary | undefined {
  return rankMeds(ctx, meds).find((m) => m.adherencePct !== null) ?? rankMeds(ctx, meds)[0];
}

function countTrend(cur: number, prior: number, priorBasis: boolean, versus: string, higherIsWorse: boolean | null = true) {
  if (!priorBasis) return undefined;
  return makeTrend(cur, prior, { higherIsWorse, mode: 'abs', minChange: 1, versus });
}

function flagSeries(days: DayCalc[], pred: (d: DayCalc) => boolean, basis: (d: DayCalc) => boolean) {
  return days.map((d) => ({ date: d.summary.date, value: basis(d) ? (pred(d) ? 1 : 0) : null }));
}

function roleCountMetric(
  id: HeadlineMetric['id'],
  label: string,
  rs: RoleStats | undefined,
  versus: string,
  unit: [string, string],
  status: (n: number) => Status,
  method: string,
): HeadlineMetric | undefined {
  if (!rs || rs.answered === 0) return undefined;
  const n = rs.yes.count;
  const m: HeadlineMetric = {
    id,
    label,
    value: plural(n, unit[0], unit[1]),
    numericValue: n,
    detail: `Reported on ${n} of ${plural(rs.answered, 'day')} with an answer`,
    status: status(n),
    sparkline: rs.series.map((s) => ({ date: s.date, value: s.value === null ? null : s.value > 0 ? 1 : 0 })),
    method,
    condition: rs.condition,
  };
  const t = countTrend(n, rs.yes.prior, rs.priorAnswered > 0, versus);
  if (t) m.trend = t;
  return m;
}

function adherenceMetric(ctx: Ctx, s: WindowStats, id: 'controllerAdherence' | 'medicationAdherence', med: ScheduledMedicationSummary, others: number): HeadlineMetric {
  const label = id === 'controllerAdherence' ? 'Controller adherence' : med.role === 'preventive' ? 'Preventive adherence' : 'Medication adherence';
  const condition = med.condition ?? primaryCondition(ctx);
  const sparkline = med.daily.map((d) => ({
    date: d.date,
    value: d.expected > 0 ? round((Math.min(d.taken, d.expected) / d.expected) * 100) : null,
  }));
  const method = `Doses of ${med.name} (${med.regimen}) the patient marked as taken, divided by doses scheduled while they were enrolled and using the app; extra doses on a day are not counted, and days after the patient stopped logging are not counted as missed.`;
  if (med.adherencePct === null) {
    return {
      id,
      label,
      value: ctx.lastActivityDate ? `No data since ${fmtShort(ctx.lastActivityDate)}` : 'No data yet',
      detail: `${med.name} (${med.regimen}) — adherence can't be measured while the patient isn't logging`,
      status: 'unknown',
      sparkline,
      method,
      condition,
    };
  }
  let detail = `${med.dosesTaken} of ${med.dosesExpected} ${med.name} doses marked taken`;
  if (med.measuredThrough) detail += ` · measured through ${fmtShort(med.measuredThrough)} (no data since)`;
  if (others) detail += ` · ${plural(others, 'other scheduled med')}`;
  const m: HeadlineMetric = {
    id,
    label,
    value: `${med.adherencePct}%`,
    numericValue: med.adherencePct,
    detail,
    status: adherenceStatus(med.adherencePct),
    sparkline,
    method,
    condition,
  };
  if (med.trend && s.engagedDays >= MIN_ENGAGED_DAYS) m.trend = med.trend;
  return m;
}

export function buildHeadline(ctx: Ctx, s: WindowStats): HeadlineMetric[] {
  const out: HeadlineMetric[] = [];
  const w = ctx.window;
  const v = ctx.versus;
  const ed = s.engagedDays;
  const per30 = (n: number) => (ed > 0 ? (n * 30) / ed : 0);

  // 1. Zone + NAEPP control (asthma).
  if (ctx.isAsthma) {
    const rz = recentZone(ctx, s.days);
    const control = s.control.get(ctx.conditions.find((c) => c.toLowerCase() === 'asthma') ?? 'asthma');
    if (rz.zone) {
      const z = s.zoneDays;
      const bad = z.yellow + z.red;
      const priorBad = s.priorZoneDays.yellow + s.priorZoneDays.red;
      const priorBasis = s.priorZoneDays.green + priorBad > 0;
      const zoneText = rz.source === 'plan' ? `plan zone ${capitalize(rz.zone)} (no recent data)` : `${z.green} green, ${z.yellow} yellow, ${z.red} red days`;
      let status = zoneStatus(rz.zone);
      if (control && control.level !== 'unknown') status = worseStatus(status, control.status);
      const m: HeadlineMetric = {
        id: 'zone',
        label: 'Asthma zone',
        value: capitalize(rz.zone),
        numericValue: zoneRank(rz.zone),
        detail: control ? `${control.text} · ${zoneText}` : zoneText,
        status,
        sparkline: s.days.map((d) => ({ date: d.summary.date, value: d.summary.zone ? ZONE_NUM[d.summary.zone] : null })),
        method:
          rz.source === 'plan'
            ? 'No day in the last week had a reading or check-in, so the zone stored on the action plan is shown. Control is assessed with NAEPP impairment criteria.'
            : 'Most common daily zone over the last 7 days (red if any of the last 3 days was red); each day is the worse of the peak-flow and symptom zones. Control uses NAEPP impairment criteria over the days the patient was logging.',
        condition: 'asthma',
      };
      const t = countTrend(bad, priorBad, priorBasis, v);
      if (t) m.trend = { ...t, text: t.text.replace(/^([+−]\d+)/, '$1 yellow/red days') };
      out.push(m);
    }
  }

  // 2. Adherence: asthma controller, then the primary non-asthma scheduled med.
  const ranked = rankMeds(ctx, s.meds.scheduled);
  const controller = ranked.find((m) => m.role === 'controller');
  const other = ranked.find((m) => m.role !== 'controller');
  if (controller) out.push(adherenceMetric(ctx, s, 'controllerAdherence', controller, ranked.filter((m) => m.role === 'controller').length - 1));
  if (other) out.push(adherenceMetric(ctx, s, 'medicationAdherence', other, ranked.filter((m) => m.role !== 'controller').length - 1));

  // 3. Symptom days.
  if (s.logged.count > 0) {
    const n = s.symptom.count;
    const perWeek = ed > 0 ? round(n / (ed / 7), 1) : 0;
    const m: HeadlineMetric = {
      id: 'symptomDays',
      label: 'Symptom days',
      value: `${n} of ${s.effectiveDays} days`,
      numericValue: n,
      detail: `≈${perWeek} days/week · ${plural(s.logged.count, 'day')} with a check-in`,
      status: weeklyDayStatus(n, ed),
      sparkline: flagSeries(s.days, (d) => d.summary.symptomDay, (d) => d.logged),
      method:
        'Days with a check-in that reported any symptom, felt moderate or worse, or scored at or above the concern level on a symptom question. Good is 2 days a week or fewer; 4 or more is a concern.',
      condition: primaryCondition(ctx),
    };
    const t = countTrend(n, s.symptom.prior, s.logged.prior > 0, v);
    if (t) m.trend = t;
    out.push(m);
  }

  // 4. Rescue use (asthma).
  if (s.rescue && ed > 0) {
    const r = s.rescue;
    const t = countTrend(r.daysUsed, r.priorDaysUsed, s.prior.some((d) => d.summary.hasData), v);
    let status: Status = r.perWeek > 2 ? 'concern' : 'good';
    if (status === 'good' && r.daysUsed > 0 && t?.direction === 'up') status = 'watch';
    const m: HeadlineMetric = {
      id: 'rescueUse',
      label: 'Rescue inhaler use',
      value: `${r.perWeek} days/wk`,
      numericValue: r.perWeek,
      detail: `${plural(r.uses, 'use')} on ${plural(r.daysUsed, 'day')}`,
      status: capShort(status, ed),
      sparkline: s.days.map((d) => ({ date: d.summary.date, value: d.summary.hasData ? d.rescueUses : null })),
      method:
        'Days with any rescue medication use (doses marked in the app or uses reported in the check-in, whichever is higher) per week of logging; more than 2 days a week means asthma is not well controlled.',
      condition: 'asthma',
    };
    if (t) m.trend = { ...t, text: t.text.replace(/^([+−]\d+)/, '$1 days') };
    out.push(m);
  }

  // 5. Lung function.
  const sp = s.spiro?.summary;
  if (sp && sp.sessions.length) {
    const last = sp.sessions[sp.sessions.length - 1];
    const pct = last.pctPersonalBest;
    const pbText = sp.personalBestPefLpm ? ` · personal best ${sp.personalBestPefLpm} L/min (${sp.personalBestSource})` : '';
    const m: HeadlineMetric = {
      id: 'lungFunction',
      label: 'Lung function',
      value: pct !== undefined ? `${pct}% of personal best` : `${last.bestPefLpm} L/min`,
      numericValue: pct ?? last.bestPefLpm,
      detail: `PEF ${last.bestPefLpm} L/min, FEV1 ${last.bestFev1L.toFixed(2)} L on ${fmtShort(last.date)}${last.reliable ? '' : ' (no accepted blow)'}${pbText}`,
      status: sp.status,
      sparkline: s.days.map((d) => ({
        date: d.summary.date,
        value: d.summary.spirometry ? (d.summary.spirometry.pctPersonalBest ?? d.summary.spirometry.pefLpm) : null,
      })),
      method:
        'Best peak flow (PEF) from the latest home spirometry session, using accepted blows only, as a percentage of the personal best' +
        (sp.personalBestSource === 'action plan' ? ' written on the action plan.' : ' (highest reliable reading on record).'),
      condition: 'asthma',
    };
    if (sp.pefTrend) m.trend = sp.pefTrend;
    out.push(m);
  }

  // 6. Headache days.
  const headache = roleCountMetric(
    'headacheDays',
    'Headache days',
    s.roles.get('headache'),
    v,
    ['day', 'days'],
    (n) => capShort(per30(n) >= 15 ? 'concern' : per30(n) >= 8 ? 'watch' : 'good', ed),
    'Days the check-in recorded a headache; 8 or more a month means migraine is not well controlled and 15 or more is the chronic-migraine range.',
  );
  if (headache) out.push(headache);

  // 7. Abortive (acute migraine) medication use.
  const abortive = s.meds.asNeeded.filter((m) => m.role === 'abortive');
  if (abortive.length && ed > 0) {
    const usedDates = new Set<string>();
    for (const m of abortive) for (const d of m.daily) if (d.uses > 0) usedDates.add(d.date);
    const priorDays = s.prior.filter((d) => (d.asNeededByCondition.get('migraine') ?? 0) > 0).length;
    const n = usedDates.size;
    const uses = abortive.reduce((t, m) => t + m.totalUses, 0);
    const thr = abortiveOveruseThreshold(ed);
    const m: HeadlineMetric = {
      id: 'abortiveUse',
      label: 'Acute migraine medication',
      value: plural(n, 'day'),
      numericValue: n,
      detail: `${abortive.map((x) => x.name).join(', ')}: ${plural(uses, 'use')}`,
      status: capShort(n >= thr ? 'concern' : n >= 0.7 * thr ? 'watch' : 'good', ed),
      sparkline: s.days.map((d) => ({ date: d.summary.date, value: d.summary.hasData ? (d.asNeededByCondition.get('migraine') ?? 0) : null })),
      method: 'Days an acute (abortive) migraine medication was used; 10 or more days a month risks medication-overuse headache.',
      condition: 'migraine',
    };
    const t = countTrend(n, priorDays, s.prior.some((d) => d.summary.hasData), v);
    if (t) m.trend = { ...t, text: t.text.replace(/^([+−]\d+)/, '$1 days') };
    out.push(m);
  }

  // 8. Pain average.
  const pain = s.roles.get('painSeverity');
  if (pain && pain.values.length) {
    const avg = mean(pain.values)!;
    const t = pain.question.concernThreshold ?? Math.round((pain.question.max ?? 10) / 2);
    const max = pain.question.max ?? 10;
    const pm = mean(pain.priorValues);
    const m: HeadlineMetric = {
      id: 'painAverage',
      label: 'Average pain',
      value: `${round(avg, 1)}/${max}`,
      numericValue: round(avg, 1),
      detail: `${plural(pain.concernDates.length, 'day')} at ${t}/${max} or higher`,
      status: avg >= t ? 'concern' : avg >= t - 2 ? 'watch' : 'good',
      sparkline: pain.series,
      method: 'Average of the daily pain score (last answer of each day) over days it was answered.',
      condition: pain.condition,
    };
    const tr = makeTrend(avg, pm, { higherIsWorse: true, mode: 'abs', minChange: 0.5, dp: 1, versus: v });
    if (tr) m.trend = tr;
    out.push(m);
  }

  // 9. Sleep.
  const sleep = s.roles.get('sleepHours');
  if (sleep && sleep.values.length) {
    const avg = mean(sleep.values)!;
    const t = sleep.question.concernThreshold;
    const higherIsBetter = sleep.question.direction !== 'higherIsWorse';
    const short = t !== undefined ? sleep.values.filter((x) => (higherIsBetter ? x < t : x >= t)).length : 0;
    let status: Status = 'neutral';
    if (t !== undefined) {
      status = avg < t - 1.5 ? 'concern' : avg < t || short / sleep.values.length >= 0.5 ? 'watch' : 'good';
    }
    const m: HeadlineMetric = {
      id: 'sleepHours',
      label: 'Sleep',
      value: `${round(avg, 1)} h`,
      numericValue: round(avg, 1),
      detail: t !== undefined ? `${short} of ${plural(sleep.values.length, 'night')} under ${t} h` : `${plural(sleep.values.length, 'night')} reported`,
      status,
      sparkline: sleep.series,
      method: `Average hours of sleep reported in the check-in${t !== undefined ? `; under ${t} hours counts as short sleep` : ''}.`,
      condition: sleep.condition,
    };
    const tr = makeTrend(avg, mean(sleep.priorValues), { higherIsWorse: !higherIsBetter, mode: 'abs', minChange: 0.5, dp: 1, unit: ' h', versus: v });
    if (tr) m.trend = tr;
    out.push(m);
  }

  // 10. Stool frequency.
  const stool = s.roles.get('stoolFrequency');
  if (stool && stool.values.length) {
    const avg = mean(stool.values)!;
    const t = stool.question.concernThreshold;
    const pm = mean(stool.priorValues);
    const m: HeadlineMetric = {
      id: 'stoolFrequency',
      label: 'Stool frequency',
      value: `${round(avg, 1)}/day`,
      numericValue: round(avg, 1),
      detail: `Up to ${Math.max(...stool.values)} a day` + (t !== undefined ? ` · ${plural(stool.concernDates.length, 'day')} at ${t}+` : ''),
      status: t !== undefined && avg >= t ? 'concern' : stool.concernDates.length > 0 ? 'watch' : 'good',
      sparkline: stool.series,
      method: 'Average number of stools per day reported in the check-in, over days it was answered.',
      condition: stool.condition,
    };
    const tr = makeTrend(avg, pm, { higherIsWorse: true, mode: 'abs', minChange: 0.5, dp: 1, versus: v });
    if (tr) m.trend = tr;
    out.push(m);
  }

  // 11. Blood in stool.
  const blood = roleCountMetric(
    'bloodInStool',
    'Blood in stool',
    s.roles.get('bloodInStool'),
    v,
    ['day', 'days'],
    (n) => (n >= 2 ? 'concern' : n === 1 ? 'watch' : 'good'),
    'Days the check-in recorded blood in the stool.',
  );
  if (blood) out.push(blood);

  // 12. Night waking.
  const night = roleCountMetric(
    'nightWaking',
    'Night waking',
    s.roles.get('nightWaking'),
    v,
    ['night', 'nights'],
    (n) => capShort(n === 0 ? 'good' : per30(n) <= 2 ? 'watch' : 'concern', ed),
    'Nights the patient reported waking because of symptoms; more than 2 a month means asthma is not well controlled.',
  );
  if (night) out.push(night);

  // 13. Missed school.
  const school = roleCountMetric(
    'missedSchool',
    'Missed school',
    s.roles.get('missedSchool'),
    v,
    ['day', 'days'],
    (n) => (n >= 2 ? 'concern' : n === 1 ? 'watch' : 'good'),
    'Days the check-in recorded missing school or work.',
  );
  if (school) out.push(school);

  // 14. Hard days.
  if (s.logged.count > 0) {
    const n = s.hard.count;
    const m: HeadlineMetric = {
      id: 'hardDays',
      label: 'Hard days',
      value: plural(n, 'day'),
      numericValue: n,
      detail: `${n} of ${plural(s.logged.count, 'day')} with a check-in`,
      status: weeklyDayStatus(n, ed),
      sparkline: flagSeries(s.days, (d) => d.summary.hardDay, (d) => d.logged),
      method:
        'Days the patient felt moderate or worse, was in the yellow or red zone, had pain at or above the concern level, missed school, or reported blood in stool. Good is 2 days a week or fewer; 4 or more is a concern.',
      condition: primaryCondition(ctx),
    };
    const t = countTrend(n, s.hard.prior, s.logged.prior > 0, v);
    if (t) m.trend = t;
    out.push(m);
  }

  // 15. Logging consistency (since enrollment).
  if (ctx.assigned.length && s.effectiveDays > 0) {
    const pct = pctOf(s.logged.count, s.effectiveDays) ?? 0;
    const priorPct = pctOf(s.logged.prior, w.days) ?? 0;
    const priorBasis = s.prior.some((d) => d.summary.hasData);
    const m: HeadlineMetric = {
      id: 'loggingConsistency',
      label: 'Check-in consistency',
      value: `${pct}%`,
      numericValue: pct,
      detail: `${s.logged.count} of ${s.effectiveDays} days with a check-in${s.effectiveDays < w.days ? ' since enrollment' : ''}`,
      status: capShort(pct >= 70 ? 'good' : pct >= 40 ? 'watch' : 'concern', s.effectiveDays),
      sparkline: s.days.map((d) => ({ date: d.summary.date, value: d.summary.date < ctx.effStart ? null : d.logged ? 1 : 0 })),
      method: 'Share of days since the later of the window start and enrollment with at least one check-in that had an answer (blank submissions do not count).',
      condition: 'general',
    };
    if (priorBasis) {
      const t = makeTrend(pct, priorPct, { higherIsWorse: false, mode: 'abs', minChange: 5, unit: ' pts', versus: v });
      if (t) m.trend = t;
    }
    out.push(m);
  }

  return out;
}

