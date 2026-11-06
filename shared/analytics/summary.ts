/**
 * buildPatientSummary orchestration: context → day timeline → section summaries.
 */
import type { PatientFacingPoint, PatientFacingPointKey } from '../types/summary';
import type { RawPatientDocument } from '../types/raw';
import type { TrackerDefinition } from '../types/tracker';
import type {
  ActionPlanSummary,
  DataQualityNote,
  EngagementSummary,
  PatientHeader,
  PatientSummary,
  Status,
  SummaryOptions,
  TrackerRef,
  Zone,
} from '../types/summary';
import { buildContext, type Ctx } from './context';
import { mapEhr } from './ehr';
import { ageYears, dateRange, diffDays, fmtShort, isValidDate, localDateOf } from './dates';
import { buildDays, type DayCalc } from './days';
import { buildFlags } from './flags';
import { badgeLabel, pctOf, plural } from './humanize';
import { summarizeMedications } from './medications';
import { buildHeadline, primaryScheduled } from './metrics';
import { summarizeTracker } from './questions';
import { summarizeSpirometry } from './spirometry';
import { computeStats, type WindowStats } from './stats';
import { parsePlanZone, zoneMethod, zoneStatus } from './zones';

function trackerRefs(ctx: Ctx): TrackerRef[] {
  return ctx.assigned.map((d) => ({ id: d.id, name: d.name, condition: d.condition, conditionLabel: d.conditionLabel }));
}

function buildHeader(ctx: Ctx): PatientHeader {
  const p = ctx.doc.profile ?? ({} as RawPatientDocument['profile']);
  const first = (p.firstName ?? '').trim();
  const last = (p.lastName ?? '').trim();
  const h: PatientHeader = {
    id: ctx.doc.id,
    displayName: [first, last].filter(Boolean).join(' ') || 'Unnamed patient',
    initials: ((first[0] ?? '') + (last[0] ?? '')).toUpperCase() || '?',
    ageYears: ageYears(p.dateOfBirth, ctx.today),
    mrn: p.mrn ?? '',
    trackers: trackerRefs(ctx),
    studyIds: [...(ctx.doc.studyIds ?? [])],
    enrolledSince: ctx.enrolledSince,
    enrolledDays: ctx.enrolledDays,
  };
  if (p.sex) h.sex = p.sex;
  if (p.careTeam) h.careTeam = p.careTeam;
  if (typeof p.heightCm === 'number' && Number.isFinite(p.heightCm)) h.heightCm = p.heightCm;
  if (typeof p.weightKg === 'number' && Number.isFinite(p.weightKg)) h.weightKg = p.weightKg;
  const ehr = mapEhr(p.ehr);
  if (ehr) h.ehr = ehr;
  return h;
}

function streaks(days: DayCalc[]): { current: number; longest: number } {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.logged ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // Current streak ends at the window end; today's check-in may still be pending.
  let i = days.length - 1;
  if (i >= 0 && !days[i].logged) i--;
  let current = 0;
  for (; i >= 0 && days[i].logged; i--) current++;
  return { current, longest };
}

function buildEngagement(ctx: Ctx, s: WindowStats): EngagementSummary {
  const loggingPct = pctOf(s.logged.count, s.effectiveDays) ?? 0;
  const { current, longest } = streaks(s.days);
  const badges = [...(ctx.doc.earnedTrackerBadges ?? []), ...(ctx.doc.earnedMedicationBadges ?? [])]
    .filter((b) => b && b.badgeName)
    .map((b) => ({ name: b.badgeName, label: badgeLabel(b.badgeName), date: localDateOf(b.date) ?? '' }))
    .filter((b) => b.date && b.date <= ctx.window.end)
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  let status: Status = loggingPct >= 70 ? 'good' : loggingPct >= 40 ? 'watch' : 'concern';
  if (s.effectiveDays === 0) status = 'unknown';
  else if (s.effectiveDays < 7 && status === 'concern') status = 'watch';
  return { loggingPct, currentLoggingStreak: current, longestLoggingStreak: longest, badges, status };
}

function buildActionPlan(ctx: Ctx, s: WindowStats): ActionPlanSummary | undefined {
  const plan = ctx.doc.asthmaTreatmentPlan;
  if (!ctx.isAsthma && !plan) return undefined;
  const ap: ActionPlanSummary = {
    expired: false,
    zoneDays: { ...s.zoneDays },
    method: zoneMethod(ctx.spiro.greenThresholdPct, ctx.spiro.redThresholdPct),
    status: 'unknown',
  };
  const z = parsePlanZone(plan?.status);
  if (z) ap.currentZone = z;
  if (plan?.statusUpdatedAt) ap.currentZoneAsOf = plan.statusUpdatedAt;
  if (plan?.retestTime) ap.retestDueAt = plan.retestTime;
  if (isValidDate(plan?.expiration)) {
    ap.expiresOn = plan.expiration;
    ap.expiresInDays = diffDays(plan.expiration, ctx.today);
    ap.expired = plan.expiration < ctx.today;
  }
  let latestDerived: Zone | undefined;
  for (let i = s.days.length - 1; i >= 0 && !latestDerived; i--) latestDerived = s.days[i].summary.zone;
  let status = zoneStatus(latestDerived ?? z);
  if (s.zoneDays.red > 0) status = 'concern';
  if (ap.expired && (status === 'good' || status === 'unknown')) status = 'watch';
  ap.status = status;
  return ap;
}

function buildDataQuality(ctx: Ctx, s: WindowStats): DataQualityNote[] {
  const notes: DataQualityNote[] = [];
  const w = ctx.window;
  const inWin = (d: string) => d >= w.start && d <= w.end;

  const collapsedDays = s.days.filter((d) => d.summary.submissions.filter((x) => !x.blank).length > 1).length;
  if (collapsedDays > 0) {
    notes.push({
      id: 'collapsed-days',
      level: 'info',
      text: `On ${plural(collapsedDays, 'day')} the check-in was submitted more than once; the last answer of the day is shown and symptom lists are combined.`,
    });
  }
  const blanks = s.days.reduce((n, d) => n + d.summary.blankSubmissionCount, 0);
  if (blanks > 0) {
    notes.push({ id: 'blank-submissions', level: 'info', text: `${plural(blanks, 'blank check-in')} (opened and closed without answers) ${blanks === 1 ? 'was' : 'were'} excluded.` });
  }
  for (const [i, text] of ctx.meds.notes.entries()) {
    notes.push({ id: `medication-merge-${i + 1}`, level: ctx.meds.unknownDoseCount > 0 && i === ctx.meds.notes.length - 1 ? 'warning' : 'info', text: `${text}.` });
  }
  const flagLogs = (ctx.doc.dailyLogs ?? []).filter((l) => l && inWin(l.day) && l.allMedicationsAdministered !== undefined && l.allMedicationsAdministered !== null);
  if (flagLogs.length) {
    notes.push({
      id: 'all-meds-flag-ignored',
      level: 'info',
      text: 'The legacy "all medications administered" flag is inconsistent and was ignored; adherence is computed from individual doses.',
    });
  }
  const conflicts = ctx.spiro.conflicts.filter((c) => inWin(c.date));
  if (conflicts.length) {
    const acceptedButBad = conflicts.filter((c) => c.accepted).length;
    notes.push({
      id: 'spirometry-quality-conflict',
      level: conflicts.length >= 3 ? 'warning' : 'info',
      text: `${plural(conflicts.length, 'spirometry blow')} had a device quality grade that disagreed with its acceptance flag${acceptedButBad ? ` (${acceptedButBad} accepted but graded "Not acceptable")` : ''}; the acceptance flag was used.`,
    });
  }
  if (s.spiro && s.spiro.summary.sessionsInWindow > 0) {
    notes.push({
      id: 'spirometry-by-date',
      level: 'info',
      text: 'Spirometry readings are matched to days by their own timestamp, not through the tracker\'s spirometry question (which is usually empty).',
    });
    const unreliable = s.spiro.summary.sessions.filter((x) => !x.reliable).length;
    if (unreliable) {
      notes.push({
        id: 'spirometry-unreliable',
        level: 'warning',
        text: `${plural(unreliable, 'spirometry session')} had no accepted blow; best values from all blows are shown as low confidence.`,
      });
    }
  }
  if (s.spiro?.summary.personalBestSource === 'observed') {
    notes.push({
      id: 'personal-best-observed',
      level: 'warning',
      text: `No personal best is written on the action plan; ${s.spiro.summary.personalBestPefLpm} L/min (the highest reliable reading on record) is used instead.`,
    });
  }
  let unknownQ = 0;
  for (const u of ctx.collapse.unknownQuestions.values()) for (const d of u.dates) if (inWin(d)) unknownQ += 1;
  if (unknownQ > 0) {
    notes.push({ id: 'unknown-questions', level: 'info', text: `Answers to ${plural(ctx.collapse.unknownQuestions.size, 'question')} not in the current tracker definition were ignored.` });
  }
  const unknownTrackers = [...new Set([...ctx.collapse.unknownTrackers, ...ctx.missingTrackerIds])];
  if (unknownTrackers.length) {
    notes.push({ id: 'unknown-trackers', level: 'warning', text: `Data for ${plural(unknownTrackers.length, 'tracker')} without a definition (${unknownTrackers.join(', ')}) could not be shown.` });
  }
  if (ctx.measuredThrough && s.meds.scheduled.length) {
    notes.push({
      id: 'adherence-measured-through',
      level: 'warning',
      text: `The patient has not logged anything since ${fmtShort(ctx.measuredThrough)}; adherence is measured only through that date (not logging is not the same as not taking).`,
    });
  }
  if (ctx.effectiveDays < w.days && ctx.effectiveDays > 0) {
    notes.push({
      id: 'enrolled-in-window',
      level: 'info',
      text: `Enrolled ${fmtShort(ctx.enrolledSince)}; rates use the ${plural(ctx.effectiveDays, 'day')} since enrollment, not the full ${w.days}-day window.`,
    });
  }
  const f = s.freshness;
  if (f.lastActivityDate && f.lastTrackerSubmissionDate !== f.lastActivityDate) {
    const kind = f.lastActivityDate === f.lastMedicationDoseDate ? 'a medication dose' : f.lastActivityDate === f.lastSpirometryDate ? 'a spirometry reading' : 'activity';
    notes.push({
      id: 'last-activity-mismatch',
      level: 'info',
      text: f.lastTrackerSubmissionDate
        ? `Last activity was ${kind} on ${fmtShort(f.lastActivityDate)}, but the last check-in was ${fmtShort(f.lastTrackerSubmissionDate)}.`
        : `Last activity was ${kind} on ${fmtShort(f.lastActivityDate)}; no check-in has been submitted.`,
    });
  }
  return notes;
}

function periodPhrase(ctx: Ctx): string {
  const n = ctx.window.days;
  if (ctx.window.label === 'All time') return 'since you started';
  if (ctx.window.end !== ctx.today) return `between ${fmtShort(ctx.window.start)} and ${fmtShort(ctx.window.end)}`;
  if (n >= 28 && n <= 31) return 'this month';
  if (n === 7) return 'this week';
  if (n === 1) return 'today';
  return `in the last ${n} days`;
}

function buildPatientFacing(ctx: Ctx, s: WindowStats): PatientSummary['patientFacing'] {
  // One partition of the days since enrollment, matching the calendar: hard / good / nothing recorded.
  const counted = s.days.filter((d) => d.summary.date >= ctx.effStart);
  const hardDays = counted.filter((d) => d.summary.hardDay).length;
  const goodDays = counted.filter((d) => d.summary.hasData && !d.summary.hardDay).length;
  const noDataDays = counted.filter((d) => !d.summary.hasData).length;
  const period = periodPhrase(ctx);
  const headline =
    s.logged.count === 0
      ? `You didn't check in ${period} — let's look at how things have been going.`
      : `You had ${plural(goodDays, 'good day')} and ${plural(hardDays, 'hard day')} ${period}.`;
  const points: PatientFacingPoint[] = [];
  const add = (key: PatientFacingPointKey, text: string) => points.push({ key, text });

  const med = primaryScheduled(ctx, s.meds.scheduled);
  if (med) {
    const isInhaler = /inhal/i.test(med.icon ?? '') || /puff/i.test(med.regimen);
    const thing = med.role === 'controller' ? `controller ${isInhaler ? 'inhaler' : 'medicine'}` : med.role === 'preventive' ? 'preventive medicine' : `${med.name}`;
    const expectedDays = med.daily.filter((d) => d.expected > 0);
    if (expectedDays.length > 0) {
      if (med.regimen.includes('weekly')) {
        const weeks = med.weekly.filter((x) => x.pct !== null);
        const full = weeks.filter((x) => x.pct === 100).length;
        add('medication', `You took your ${thing} in ${full} of ${plural(weeks.length, 'week')}.`);
      } else {
        const anyDays = expectedDays.filter((d) => d.taken > 0).length;
        const fullDays = expectedDays.filter((d) => d.taken >= d.expected).length;
        add(
          'medication',
          `You took your ${thing} on ${anyDays} of ${expectedDays.length} days` +
            (fullDays < anyDays ? `, and every dose on ${fullDays} of them.` : '.'),
        );
      }
    }
  }
  if (s.rescue) {
    add(
      'rescue',
      s.rescue.daysUsed === 0
        ? `You didn't need your rescue inhaler ${period}.`
        : `You used your rescue inhaler on ${plural(s.rescue.daysUsed, 'day')} (about ${s.rescue.perWeek} a week).`,
    );
  }
  for (const m of s.meds.asNeeded.filter((x) => x.role === 'abortive' && x.daysUsed > 0)) {
    add('abortive', `You took ${m.name} for a headache on ${plural(m.daysUsed, 'day')}.`);
  }
  const sp = s.spiro?.summary;
  if (sp && sp.sessions.length) {
    const best = sp.sessions.reduce((a, b) => (b.bestPefLpm > a.bestPefLpm ? b : a));
    add(
      'lungFunction',
      `You did ${plural(sp.sessions.length, 'breathing test')}; your best peak flow was ${best.bestPefLpm} L/min${best.pctPersonalBest !== undefined ? ` (${best.pctPersonalBest}% of your personal best)` : ''}.`,
    );
  }
  const counts = new Map<string, number>();
  for (const d of s.days) for (const x of d.summary.symptoms) counts.set(x, (counts.get(x) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (top) add('symptoms', `Your most common symptom was ${top[0].toLowerCase()} (${plural(top[1], 'day')}).`);
  const school = s.roles.get('missedSchool');
  if (school && school.yes.count > 0) add('school', `You missed school on ${plural(school.yes.count, 'day')}.`);
  if (s.logged.count > 0) add('checkins', `You checked in on ${s.logged.count} of ${s.effectiveDays} days — thank you!`);
  return { headline, points, goodDays, hardDays, noDataDays };
}

export function buildSummaryFromContext(ctx: Ctx): { summary: PatientSummary; stats: WindowStats } {
  const w = ctx.window;
  const all = buildDays(ctx, w.prior.start, w.end);
  const prior = all.slice(0, w.days);
  const win = all.slice(w.days);
  const medWindow = {
    start: w.start,
    end: w.end,
    days: w.days,
    prior: w.prior,
    versus: ctx.versus,
    rateDays: ctx.engagedDays,
    measuredThrough: ctx.measuredThrough,
  };
  const meds = summarizeMedications(ctx.meds, medWindow);
  const hasSpiro = ctx.spiro.hasDevice || ctx.spiro.sessions.length > 0;
  const spiro = hasSpiro ? summarizeSpirometry(ctx.spiro, medWindow) : undefined;
  const stats = computeStats(ctx, win, prior, meds, spiro);

  const windowDates = dateRange(w.start, w.end);
  const priorDates = dateRange(w.prior.start, w.prior.end);
  const summary: PatientSummary = {
    generatedAt: `${ctx.today}T00:00:00.000Z`,
    today: ctx.today,
    patient: buildHeader(ctx),
    window: w,
    freshness: stats.freshness,
    headline: buildHeadline(ctx, stats),
    flags: buildFlags(ctx, stats),
    days: win.map((d) => d.summary),
    trackers: ctx.assigned.map((def) => summarizeTracker(def, ctx.collapse, windowDates, priorDates, ctx.versus, ctx.effectiveDays)),
    medications: meds,
    engagement: buildEngagement(ctx, stats),
    dataQuality: buildDataQuality(ctx, stats),
    patientFacing: buildPatientFacing(ctx, stats),
  };
  if (spiro) summary.spirometry = spiro.summary;
  const ap = buildActionPlan(ctx, stats);
  if (ap) summary.actionPlan = ap;
  return { summary, stats };
}

export function buildSummary(doc: RawPatientDocument, trackers: TrackerDefinition[], opts?: SummaryOptions): PatientSummary {
  return buildSummaryFromContext(buildContext(doc, trackers, opts ?? {})).summary;
}

