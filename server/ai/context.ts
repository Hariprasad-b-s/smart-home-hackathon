/**
 * Compact patient context for the chat helper, built from buildPatientSummary (14 days) plus the
 * patient-app home payload (action-plan steps, medication list). Synthetic data only.
 */
import { buildPatientSummary } from '../../shared/analytics';
import type { RawPatientDocument } from '../../shared/types/raw';
import type { Zone } from '../../shared/types/summary';
import type { TrackerDefinition } from '../../shared/types/tracker';
import { buildPatientAppHome } from '../patientApp';

export interface ChatContext {
  patientId: string;
  firstName: string;
  ageYears?: number;
  conditions: string[];
  today: string;
  zone?: Zone;
  /** Action-plan steps for today's zone (asthma). */
  planSteps: string[];
  /** All zones' steps (so the helper can answer "what do I do in the yellow zone"). */
  allPlanSteps?: Record<Zone, string[]>;
  scheduledMeds: { name: string; regimen: string }[];
  asNeededMeds: { name: string; regimen: string }[];
  adherence14dPct?: number | null;
  peakFlow?: { date: string; pefLpm: number; pctPersonalBest?: number; personalBestPefLpm?: number; zone?: Zone };
  /** Symptoms reported in the last 7 days with day counts, most frequent first. */
  recentSymptoms: { label: string; days: number }[];
  flags: string[];
  lastCheckIn?: string;
}

export function buildChatContext(doc: RawPatientDocument, trackers: TrackerDefinition[], today: string): ChatContext {
  const ctx: ChatContext = {
    patientId: doc.id,
    firstName: doc.profile.firstName,
    conditions: [],
    today,
    planSteps: [],
    scheduledMeds: [],
    asNeededMeds: [],
    recentSymptoms: [],
    flags: [],
  };
  try {
    const s = buildPatientSummary(doc, trackers, { today, days: 14 });
    ctx.ageYears = s.patient.ageYears;
    ctx.conditions = s.patient.trackers.map((t) => t.conditionLabel);
    ctx.adherence14dPct = s.medications.overallAdherencePct;
    const latest = s.spirometry?.latest;
    if (latest) {
      ctx.peakFlow = { date: latest.date, pefLpm: latest.bestPefLpm };
      if (latest.pctPersonalBest !== undefined) ctx.peakFlow.pctPersonalBest = latest.pctPersonalBest;
      if (s.spirometry?.personalBestPefLpm !== undefined) ctx.peakFlow.personalBestPefLpm = s.spirometry.personalBestPefLpm;
      if (latest.zone) ctx.peakFlow.zone = latest.zone;
    }
    const counts = new Map<string, number>();
    for (const d of s.days.slice(-7)) for (const sym of d.symptoms) counts.set(sym, (counts.get(sym) ?? 0) + 1);
    ctx.recentSymptoms = [...counts].map(([label, days]) => ({ label, days })).sort((a, b) => b.days - a.days).slice(0, 6);
    ctx.flags = s.flags.slice(0, 4).map((f) => f.title);
    if (s.freshness.lastTrackerSubmissionDate) ctx.lastCheckIn = s.freshness.lastTrackerSubmissionDate;
  } catch (err) {
    console.warn(`[ai:context] Summary unavailable: ${(err as Error).message}`);
  }
  try {
    const home = buildPatientAppHome(doc, trackers, today);
    ctx.ageYears ??= home.patient.ageYears;
    if (!ctx.conditions.length) ctx.conditions = home.patient.conditions.map((c) => c.conditionLabel);
    for (const m of home.medications) (m.kind === 'scheduled' ? ctx.scheduledMeds : ctx.asNeededMeds).push({ name: m.name, regimen: m.regimen });
    if (home.actionPlan) {
      ctx.allPlanSteps = home.actionPlan.steps;
      if (home.actionPlan.zone) {
        ctx.zone = home.actionPlan.zone;
        ctx.planSteps = home.actionPlan.steps[home.actionPlan.zone] ?? [];
      }
    }
  } catch (err) {
    console.warn(`[ai:context] Home payload unavailable: ${(err as Error).message}`);
  }
  return ctx;
}

const cap = (z: string) => z.charAt(0).toUpperCase() + z.slice(1);

/** Plain-text rendering for the model (volatile; placed after the cached system prompt). */
export function contextText(c: ChatContext): string {
  const lines = [
    `First name: ${c.firstName}`,
    c.ageYears !== undefined ? `Age: ${c.ageYears}` : '',
    `Conditions: ${c.conditions.join(', ') || 'none listed'}`,
    `Today: ${c.today}`,
    c.zone ? `Today's action-plan zone: ${cap(c.zone)}` : c.allPlanSteps ? "Today's action-plan zone: not known yet" : '',
    c.zone && c.planSteps.length ? `Plan steps for ${cap(c.zone)} zone: ${c.planSteps.map((s, i) => `(${i + 1}) ${s}`).join(' ')}` : '',
    c.allPlanSteps
      ? `All plan steps: ${(['green', 'yellow', 'red'] as const).map((z) => `${cap(z)}: ${c.allPlanSteps![z].join(' ')}`).join(' | ')}`
      : '',
    `Scheduled medicines: ${c.scheduledMeds.map((m) => `${m.name} (${m.regimen})`).join('; ') || 'none'}`,
    `As-needed medicines: ${c.asNeededMeds.map((m) => `${m.name} (${m.regimen})`).join('; ') || 'none'}`,
    c.adherence14dPct != null ? `Scheduled doses marked taken, last 14 days: ${c.adherence14dPct}%` : '',
    c.peakFlow
      ? `Latest peak flow: ${c.peakFlow.pefLpm} L/min on ${c.peakFlow.date}${c.peakFlow.pctPersonalBest !== undefined ? ` (${c.peakFlow.pctPersonalBest}% of personal best${c.peakFlow.personalBestPefLpm ? ` ${c.peakFlow.personalBestPefLpm} L/min` : ''})` : ''}`
      : '',
    `Symptoms in the last 7 days: ${c.recentSymptoms.map((s) => `${s.label} (${s.days} d)`).join(', ') || 'none reported'}`,
    c.flags.length ? `Care-team flags: ${c.flags.join('; ')}` : '',
    c.lastCheckIn ? `Last check-in: ${c.lastCheckIn}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/** One-line clinician summary used by rule-based escalations. */
export function clinicianContextLine(c: ChatContext): string {
  const bits = [
    `${c.firstName}${c.ageYears !== undefined ? `, ${c.ageYears}` : ''}${c.conditions.length ? ` (${c.conditions.join(', ')})` : ''}`,
    c.zone ? `zone today ${cap(c.zone)}` : '',
    c.adherence14dPct != null ? `14-day adherence ${c.adherence14dPct}%` : '',
    c.peakFlow ? `latest PEF ${c.peakFlow.pefLpm} L/min${c.peakFlow.pctPersonalBest !== undefined ? ` (${c.peakFlow.pctPersonalBest}% PB)` : ''} on ${c.peakFlow.date}` : '',
    c.recentSymptoms.length ? `recent symptoms: ${c.recentSymptoms.map((s) => s.label).join(', ')}` : '',
  ];
  return bits.filter(Boolean).join('; ') + '.';
}
