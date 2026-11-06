/**
 * CSV export: one row per window day (RFC 4180: CRLF line breaks, quoted when needed).
 * pef_lpm / pct_personal_best / fev1_l are the day's LATEST spirometry session; `zone` uses the worst session.
 */
import type { QuestionRole } from '../types/tracker';
import type { DaySummary, PatientSummary } from '../types/summary';

const ROLE_ORDER: QuestionRole[] = [
  'overallFeeling',
  'symptoms',
  'symptomSeverity',
  'spirometry',
  'missedSchool',
  'nightWaking',
  'activityLimitation',
  'rescueMedUse',
  'painSeverity',
  'headache',
  'headacheDurationHours',
  'stoolFrequency',
  'bloodInStool',
  'triggers',
  'sleepHours',
  'other',
];

const BASE_COLUMNS = [
  'date',
  'has_data',
  'submissions',
  'blank_submissions',
  'feeling',
  'symptoms',
  'symptom_day',
  'hard_day',
  'zone',
  'scheduled_taken',
  'scheduled_expected',
  'as_needed_uses',
  'pef_lpm',
  'pct_personal_best',
  'fev1_l',
];

export function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join(';') : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function snake(role: string): string {
  return role.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export function toCsv(summary: PatientSummary): string {
  const roles = ROLE_ORDER.filter((r) => summary.days.some((d) => d.roleValues[r] !== undefined));
  const header = [...BASE_COLUMNS, ...roles.map((r) => `role_${snake(r)}`)];
  const rows = summary.days.map((d: DaySummary) => [
    d.date,
    d.hasData,
    d.submissionCount,
    d.blankSubmissionCount,
    d.feeling?.label,
    d.symptoms,
    d.symptomDay,
    d.hardDay,
    d.zone,
    d.scheduledDosesTaken,
    d.scheduledDosesExpected,
    d.asNeededUses,
    d.spirometry?.pefLpm,
    d.spirometry?.pctPersonalBest,
    d.spirometry?.fev1L,
    ...roles.map((r) => d.roleValues[r]),
  ]);
  return [header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
