import type { PatientListItem } from '@shared/types';

export type TriageSort = 'attention' | 'name' | 'lastActivity' | 'adherence' | 'symptoms';

export interface TriageFilter {
  query: string;
  condition: string; // '' = all
  sort: TriageSort;
}

/** Patients a clinician should look at first. */
export function needsAttention(p: PatientListItem): boolean {
  return p.highFlags > 0 || p.freshnessStatus === 'concern' || p.currentZone === 'red';
}

export function conditionOptions(patients: PatientListItem[]): { value: string; label: string }[] {
  const map = new Map<string, string>();
  for (const p of patients) for (const t of p.trackers) map.set(t.condition, t.conditionLabel);
  return [...map.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

const byNullLast = (a: number | null | undefined, b: number | null | undefined, dir: 1 | -1) => {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  return (a! - b!) * dir;
};

export function filterAndSortPatients(patients: PatientListItem[], f: TriageFilter): PatientListItem[] {
  const q = f.query.trim().toLowerCase();
  const rows = patients.filter((p) => {
    if (f.condition && !p.trackers.some((t) => t.condition === f.condition)) return false;
    if (!q) return true;
    return (
      p.displayName.toLowerCase().includes(q) ||
      p.mrn.toLowerCase().includes(q) ||
      p.trackers.some((t) => t.conditionLabel.toLowerCase().includes(q)) ||
      p.studyIds.some((s) => s.toLowerCase().includes(q))
    );
  });
  const cmp: Record<TriageSort, (a: PatientListItem, b: PatientListItem) => number> = {
    attention: (a, b) => b.attentionScore - a.attentionScore || a.displayName.localeCompare(b.displayName),
    name: (a, b) => a.displayName.localeCompare(b.displayName),
    // Most stale first: those are the ones to chase.
    lastActivity: (a, b) => byNullLast(a.daysSinceLastActivity, b.daysSinceLastActivity, -1),
    // Lowest adherence first.
    adherence: (a, b) => byNullLast(a.adherencePct30d, b.adherencePct30d, 1),
    symptoms: (a, b) => b.symptomDays30d - a.symptomDays30d,
  };
  return [...rows].sort(cmp[f.sort]);
}
