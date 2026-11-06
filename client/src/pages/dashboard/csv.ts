import type { PatientSummary } from '@shared/types';

const esc = (v: unknown) => {
  const t = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/**
 * Client-side per-day CSV, used only in offline mock mode (the real export comes from
 * GET /api/patients/:id/export.csv).
 */
export function summaryDaysToCsv(summary: PatientSummary): string {
  const header = ['date', 'has_data', 'zone', 'feeling', 'symptoms', 'symptom_day', 'hard_day', 'scheduled_taken', 'scheduled_expected', 'as_needed_uses', 'pef_lpm', 'fev1_l', 'pef_pct_personal_best', 'submissions', 'blank_submissions'];
  const rows = summary.days.map((d) =>
    [
      d.date,
      d.hasData,
      d.zone ?? '',
      d.feeling?.label ?? '',
      d.symptoms.join('; '),
      d.symptomDay,
      d.hardDay,
      d.scheduledDosesTaken,
      d.scheduledDosesExpected,
      d.asNeededUses,
      d.spirometry?.pefLpm ?? '',
      d.spirometry?.fev1L ?? '',
      d.spirometry?.pctPersonalBest ?? '',
      d.submissionCount,
      d.blankSubmissionCount,
    ]
      .map(esc)
      .join(','),
  );
  return [header.join(','), ...rows].join('\r\n') + '\r\n';
}
