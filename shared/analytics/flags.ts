/**
 * Clinical flags: short, evidence-backed call-outs ordered high → low severity, then most recent.
 * Ids are stable so the UI can key / dismiss them.
 */
import type { ISODate } from '../types/raw';
import type { ClinicalFlag, ScheduledMedicationSummary } from '../types/summary';
import type { Ctx } from './context';
import { addDays, diffDays, fmtShort } from './dates';
import { capitalize, pctOf, plural, round } from './humanize';
import { isUncontrolled, MIN_ENGAGED_DAYS } from './control';
import { abortiveOveruseThreshold } from './medications';
import { conditionLabel } from './metrics';
import { latest, type WindowStats } from './stats';
import { parsePlanZone } from './zones';

const SEV_RANK = { high: 0, medium: 1, low: 2 } as const;
/** The brief's key adherence-vs-control flags lead their severity group. */
const KEY_PREFIXES = ['symptoms-despite-adherence-', 'uncontrolled-low-adherence-'];

function clip(s: string, n = 70): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

/** Preferred text when it fits the 70-char title budget, else the shorter fallback. */
function fit(preferred: string, fallback: string): string {
  return preferred.length <= 70 ? preferred : fallback;
}

function roleWord(m: ScheduledMedicationSummary): string {
  return m.role === 'maintenance' ? 'daily medication' : m.role;
}

export function sortFlags(flags: ClinicalFlag[], end: ISODate): ClinicalFlag[] {
  return [...flags].sort((a, b) => {
    const s = SEV_RANK[a.severity] - SEV_RANK[b.severity];
    if (s) return s;
    const da = latest(a.dates) ?? end;
    const db = latest(b.dates) ?? end;
    const pa = KEY_PREFIXES.some((k) => a.id.startsWith(k)) ? 0 : 1;
    const pb = KEY_PREFIXES.some((k) => b.id.startsWith(k)) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (da !== db) return da < db ? 1 : -1;
    return a.id.localeCompare(b.id);
  });
}

export function buildFlags(ctx: Ctx, s: WindowStats): ClinicalFlag[] {
  const flags: ClinicalFlag[] = [];
  const w = ctx.window;
  const v = ctx.versus;
  const scale = Math.max(1, s.engagedDays) / 30;
  const add = (f: ClinicalFlag) => {
    f.title = clip(f.title);
    if (f.dates && !f.dates.length) delete f.dates;
    flags.push(f);
  };

  // ── Key pair: symptoms despite adherence / uncontrolled with low adherence (per condition) ──
  const single = ctx.conditions.length === 1 ? ctx.conditions[0] : undefined;
  const byCond = new Map<string, ScheduledMedicationSummary[]>();
  for (const m of s.meds.scheduled) {
    const c = m.condition ?? single;
    if (!c || m.dosesExpected === 0) continue;
    byCond.set(c, [...(byCond.get(c) ?? []), m]);
  }
  const enoughData = s.engagedDays >= MIN_ENGAGED_DAYS;
  for (const [c, meds] of byCond) {
    if (!enoughData) break;
    const taken = meds.reduce((n, m) => n + m.dosesTaken, 0);
    const expected = meds.reduce((n, m) => n + m.dosesExpected, 0);
    const adh = pctOf(taken, expected);
    const control = s.control.get(c);
    if (adh === null || !isUncontrolled(control)) continue;
    const key = c.toLowerCase();
    const label = conditionLabel(ctx, c) || 'symptoms';
    const sym = s.bySymptomCondition.get(c);
    const medNames = meds.map((m) => m.name).join(' + ');
    const evidence = control!.reasons.join(', ');
    const flare = key === 'ibd' ? 'flare' : 'symptoms';
    const how = key === 'asthma' ? ' (NAEPP: not well controlled)' : '';

    if (adh >= 80) {
      add({
        id: `symptoms-despite-adherence-${c}`,
        severity: 'high',
        category: 'symptoms',
        title: fit(`${label} ${flare} despite ${adh}% ${roleWord(meds[0])} adherence`, `${capitalize(flare)} despite ${adh}% ${roleWord(meds[0])} adherence`),
        detail: `${medNames} was marked taken for ${adh}% of scheduled doses, yet ${evidence}${how}. The current treatment may not be controlling ${label.toLowerCase()} — consider checking technique and triggers or adjusting therapy.`,
        dates: sym?.dates,
        condition: c,
      });
    } else if (adh < 50) {
      add({
        id: `uncontrolled-low-adherence-${c}`,
        severity: 'high',
        category: 'adherence',
        title: fit(`Uncontrolled ${label.toLowerCase()} with low adherence (${adh}%)`, `Uncontrolled symptoms with low adherence (${adh}%)`),
        detail: `Only ${adh}% of scheduled ${medNames} doses were marked taken while ${evidence}${how}. Address adherence (routine, access, technique) before escalating therapy.`,
        dates: sym?.dates,
        condition: c,
      });
    }
  }

  // ── Low adherence per scheduled med ──
  // Needs ≥ 7 engaged days; when the patient stopped logging the staleness flag carries the message.
  for (const m of s.meds.scheduled) {
    if (!enoughData || ctx.measuredThrough || m.adherencePct === null || m.adherencePct >= 80) continue;
    const missed = m.daily.filter((d) => d.expected > 0 && d.taken < d.expected).map((d) => d.date);
    add({
      id: `adherence-low-${m.key}`,
      severity: m.adherencePct < 50 ? 'high' : 'medium',
      category: 'adherence',
      title: `${m.name}: ${m.dosesTaken} of ${m.dosesExpected} doses marked taken (${m.adherencePct}%)`,
      detail: `${m.name} (${m.regimen}) was marked taken for ${m.adherencePct}% of scheduled doses${m.trend && m.trend.direction !== 'flat' ? ` (${m.trend.text})` : ''}. ${m.lastTakenDate ? `Last dose recorded ${fmtShort(m.lastTakenDate)}.` : 'No dose recorded.'}`,
      dates: missed,
      condition: m.condition ?? single ?? 'general',
    });
  }

  // ── Rescue use > 2 days/week ──
  if (enoughData && s.rescue && s.rescue.perWeek > 2) {
    add({
      id: 'rescue-frequent',
      severity: 'high',
      category: 'symptoms',
      title: `Rescue inhaler used ${s.rescue.perWeek} days/week`,
      detail: `Rescue medication was used on ${s.rescue.daysUsed} of ${s.engagedDays} days (${plural(s.rescue.uses, 'use')}). Using it on more than 2 days a week suggests asthma is not well controlled.`,
      dates: s.rescue.dates,
      condition: 'asthma',
    });
  }

  // ── Abortive medication near overuse ──
  for (const m of s.meds.asNeeded) {
    if (m.role !== 'abortive' || !enoughData) continue;
    const t = abortiveOveruseThreshold(s.engagedDays);
    if (m.daysUsed < 0.7 * t) continue;
    add({
      id: `abortive-overuse-${m.key}`,
      severity: m.daysUsed >= t ? 'high' : 'medium',
      category: 'symptoms',
      title: `${m.name} used on ${m.daysUsed} of ${w.days} days`,
      detail: `Acute migraine medication was used on ${m.daysUsed} days. Use on 10 or more days a month can cause medication-overuse headache${m.daysUsed >= t ? '' : ' — this is approaching that level'}.`,
      dates: m.daily.filter((d) => d.uses > 0).map((d) => d.date),
      condition: m.condition ?? 'migraine',
    });
  }

  // ── Lung function ──
  const sp = s.spiro?.summary;
  if (sp) {
    const recentStart = addDays(w.end, -6);
    const low = sp.sessions.filter((x) => x.date >= recentStart && x.pctPersonalBest !== undefined && x.pctPersonalBest < sp.redThresholdPct);
    const fev1 = s.spiro?.fev1ChangePct;
    const pef = s.spiro?.pefChangePct;
    if (low.length) {
      const worst = low.reduce((a, b) => ((a.pctPersonalBest ?? 100) <= (b.pctPersonalBest ?? 100) ? a : b));
      add({
        id: 'pef-below-red',
        severity: 'high',
        category: 'lungFunction',
        title: `Peak flow ${worst.pctPersonalBest}% of personal best on ${fmtShort(worst.date)}`,
        detail: `${plural(low.length, 'reading')} in the last 7 days fell below ${sp.redThresholdPct}% of personal best (${worst.bestPefLpm} of ${sp.personalBestPefLpm} L/min) — red-zone lung function.`,
        dates: low.map((x) => x.date),
        condition: 'asthma',
      });
    } else if ((fev1 !== undefined && fev1 <= -10) || (pef !== undefined && pef <= -10)) {
      const parts: string[] = [];
      if (pef !== undefined && pef <= -10) parts.push(`peak flow ${sp.pefTrend?.text ?? `${round(pef)}%`}`);
      if (fev1 !== undefined && fev1 <= -10) parts.push(`FEV1 ${sp.fev1Trend?.text ?? `${round(fev1)}%`}`);
      add({
        id: 'lung-function-decline',
        severity: 'medium',
        category: 'lungFunction',
        title: `Lung function down ${Math.abs(round(Math.min(fev1 ?? 0, pef ?? 0)))}%`,
        detail: `Average home spirometry fell: ${parts.join('; ')}.`,
        dates: sp.sessions.map((x) => x.date),
        condition: 'asthma',
      });
    }
  }

  // ── Zones ──
  if (ctx.isAsthma && s.zoneDays.red > 0) {
    const dates = s.days.filter((d) => d.summary.zone === 'red').map((d) => d.summary.date);
    add({
      id: 'zone-red-days',
      severity: 'high',
      category: 'actionPlan',
      title: `${plural(dates.length, 'red-zone day')} (latest ${fmtShort(dates[dates.length - 1])})`,
      detail: `Derived zone was red on ${dates.map(fmtShort).join(', ')} based on peak flow and/or the symptom check-in.`,
      dates,
      condition: 'asthma',
    });
  }

  // ── Action plan expiry ──
  const plan = ctx.doc.asthmaTreatmentPlan;
  if (plan?.expiration && /^\d{4}-\d{2}-\d{2}$/.test(plan.expiration)) {
    const days = diffDays(plan.expiration, ctx.today);
    if (days < 0) {
      add({
        id: 'plan-expired',
        severity: 'medium',
        category: 'actionPlan',
        title: `Asthma action plan expired ${fmtShort(plan.expiration)}`,
        detail: `The written action plan expired ${plural(-days, 'day')} ago and should be renewed at this visit.`,
        condition: 'asthma',
      });
    } else if (days <= 30) {
      add({
        id: 'plan-expiring',
        severity: 'low',
        category: 'actionPlan',
        title: `Action plan expires ${fmtShort(plan.expiration)}`,
        detail: `The written action plan expires in ${plural(days, 'day')}; consider renewing it at this visit.`,
        condition: 'asthma',
      });
    }
  }

  // ── Engagement ──
  const f = s.freshness;
  const staleAdherence = (): string => {
    const measured = s.meds.scheduled.filter((m) => m.adherencePct !== null && m.dosesExpected > 0);
    if (!measured.length) return s.meds.scheduled.length ? '; adherence cannot be assessed for this period (not logging is not the same as not taking)' : '';
    const m = measured[0];
    return `; before that, ${m.name} was marked taken for ${m.adherencePct}% of scheduled doses (measured through ${fmtShort(m.measuredThrough ?? ctx.window.end)})`;
  };
  if (ctx.enrolledDays < 14) {
    add({
      id: 'new-patient',
      severity: 'low',
      category: 'engagement',
      title: `New patient — ${plural(s.effectiveDays, 'day')} of data`,
      detail: `Enrolled ${fmtShort(ctx.enrolledSince)}. Rates are computed from enrollment, and control and adherence flags wait for at least ${MIN_ENGAGED_DAYS} days of data.`,
      condition: 'general',
    });
  }
  if (f.daysSinceLastActivity !== undefined && f.daysSinceLastActivity > 7 && f.lastActivityDate) {
    add({
      id: 'no-recent-activity',
      severity: f.daysSinceLastActivity > 14 ? 'high' : 'medium',
      category: 'engagement',
      title: `No activity for ${f.daysSinceLastActivity} days`,
      detail: `Last activity was on ${fmtShort(f.lastActivityDate)}${f.lastTrackerSubmissionDate && f.lastTrackerSubmissionDate !== f.lastActivityDate ? ` (last check-in ${fmtShort(f.lastTrackerSubmissionDate)})` : ''}. Recent symptoms and doses are unknown${staleAdherence()}.`,
      dates: [f.lastActivityDate],
      condition: 'general',
    });
  } else if (f.daysSinceLastActivity === undefined && ctx.assigned.length) {
    add({
      id: 'no-recent-activity',
      severity: 'high',
      category: 'engagement',
      title: 'No activity recorded yet',
      detail: 'The patient has not submitted a check-in, dose or spirometry reading.',
      condition: 'general',
    });
  }

  // ── Discordance ──
  if (s.discordant.count >= 3 && s.discordant.count >= 0.4 * s.symptom.count) {
    add({
      id: 'discordant-days',
      severity: 'medium',
      category: 'discordance',
      title: `Felt good despite significant symptoms on ${s.discordant.count} days`,
      detail: `On ${s.discordant.count} of ${plural(s.symptom.count, 'symptom day')} the patient rated their day great or good while reporting several or significant symptoms (wheeze, shortness of breath, chest tightness) or peak flow below ${s.spiro?.summary.greenThresholdPct ?? 80}% of personal best — they may be under-recognising symptoms.`,
      dates: s.discordant.dates,
      condition: ctx.isAsthma ? 'asthma' : (single ?? 'general'),
    });
  }

  // ── Role-based ──
  const school = s.roles.get('missedSchool');
  if (school && school.yes.count >= 2) {
    add({
      id: 'missed-school',
      severity: 'medium',
      category: 'symptoms',
      title: `Missed school on ${school.yes.count} days`,
      detail: `School or work was missed on ${plural(school.yes.count, 'day')} in this period (${school.yes.dates.map(fmtShort).join(', ')}).`,
      dates: school.yes.dates,
      condition: school.condition,
    });
  }
  const blood = s.roles.get('bloodInStool');
  if (blood && blood.yes.count >= 2) {
    add({
      id: 'blood-in-stool',
      severity: 'high',
      category: 'symptoms',
      title: `Blood in stool on ${blood.yes.count} days`,
      detail: `Blood in the stool was reported on ${blood.yes.dates.map(fmtShort).join(', ')}, which may indicate active inflammation.`,
      dates: blood.yes.dates,
      condition: blood.condition,
    });
  }
  const stool = s.roles.get('stoolFrequency');
  if (stool && stool.values.length && stool.priorValues.length) {
    const cur = stool.values.reduce((a, b) => a + b, 0) / stool.values.length;
    const prev = stool.priorValues.reduce((a, b) => a + b, 0) / stool.priorValues.length;
    if (cur - prev >= 1 || (prev > 0 && cur / prev >= 1.25 && cur - prev >= 0.5)) {
      add({
        id: 'stool-frequency-rising',
        severity: 'medium',
        category: 'symptoms',
        title: `Stool frequency up to ${round(cur, 1)}/day (from ${round(prev, 1)})`,
        detail: `Average stools per day rose from ${round(prev, 1)} in the ${v} to ${round(cur, 1)}.`,
        dates: stool.concernDates,
        condition: stool.condition,
      });
    }
  }
  const sleep = s.roles.get('sleepHours');
  if (sleep && sleep.question.concernThreshold !== undefined) {
    const short = sleep.series.filter((x) => x.value !== null && x.value < sleep.question.concernThreshold!);
    if (short.length >= 3 && short.length / Math.max(1, sleep.values.length) >= 0.25) {
      add({
        id: 'sleep-short',
        severity: 'low',
        category: 'symptoms',
        title: `Under ${sleep.question.concernThreshold} h sleep on ${short.length} nights`,
        detail: `Sleep was below ${sleep.question.concernThreshold} hours on ${short.length} of ${sleep.values.length} nights reported.`,
        dates: short.map((x) => x.date),
        condition: sleep.condition,
      });
    }
  }
  const night = s.roles.get('nightWaking');
  if (enoughData && night && night.yes.count / scale > 2 && night.condition.toLowerCase() === 'asthma') {
    add({
      id: 'night-waking',
      severity: 'medium',
      category: 'symptoms',
      title: `Woke at night with symptoms on ${night.yes.count} nights`,
      detail: 'Night waking more than twice a month suggests asthma is not well controlled.',
      dates: night.yes.dates,
      condition: night.condition,
    });
  }
  const headache = s.roles.get('headache');
  if (enoughData && headache && headache.yes.count / scale >= 15) {
    add({
      id: 'headache-frequent',
      severity: 'medium',
      category: 'symptoms',
      title: `Headache on ${headache.yes.count} of ${w.days} days`,
      detail: 'Headache on 15 or more days a month is in the chronic-migraine range.',
      dates: headache.yes.dates,
      condition: headache.condition,
    });
  }

  // ── Data quality ──
  // Device quality-grade conflicts are a dataQuality note only (they occur for most patients).
  const subs = s.days.reduce((n, d) => n + d.summary.submissionCount, 0);
  const blanks = s.days.reduce((n, d) => n + d.summary.blankSubmissionCount, 0);
  if (blanks >= 5 && blanks / Math.max(1, subs) >= 0.25) {
    add({
      id: 'dq-blank-submissions',
      severity: 'low',
      category: 'dataQuality',
      title: `${blanks} of ${subs} check-ins were submitted blank`,
      detail: 'Blank submissions were excluded. Frequent blank check-ins may mean the patient finds the tracker confusing or is opening it by accident.',
      dates: s.days.filter((d) => d.summary.blankSubmissionCount > 0).map((d) => d.summary.date),
      condition: 'general',
    });
  }

  // Plan zone stored in the app is red but no recent derived data.
  if (ctx.isAsthma && parsePlanZone(plan?.status) === 'red' && s.zoneDays.red === 0 && !flags.some((x) => x.id === 'zone-red-days')) {
    add({
      id: 'plan-zone-red',
      severity: 'high',
      category: 'actionPlan',
      title: 'App shows the patient in the red zone',
      detail: `The action plan status in the app is Red${plan?.statusUpdatedAt ? ` (updated ${fmtShort(plan.statusUpdatedAt.slice(0, 10))})` : ''}.`,
      condition: 'asthma',
    });
  }

  return sortFlags(flags, w.end);
}
