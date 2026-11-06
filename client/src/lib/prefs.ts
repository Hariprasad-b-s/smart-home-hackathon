/**
 * Clinician preferences: pure helpers for dashboard layouts and visit-mode visibility.
 * Layout resolution: saved layout → preset order for unknown/missing sections →
 * only sections that have data for this patient.
 */
import type {
  ClinicianPreferences,
  DashboardLayout,
  HeadlineMetric,
  HeadlineMetricId,
  PatientFacingPointKey,
  PatientSummary,
  VisitModeVisibility,
} from '@shared/types';
import { selectHeadline, type SectionId, type SpecialtyPreset } from '../config/specialties';

export const ALL_SECTIONS: SectionId[] = ['attention', 'calendar', 'timeline', 'medications', 'lungFunction', 'actionPlan', 'trackers', 'media'];

export const SECTION_LABEL: Record<SectionId, string> = {
  attention: 'What needs attention',
  calendar: 'Month at a glance',
  timeline: 'Day by day',
  medications: 'Medications',
  lungFunction: 'Lung function',
  actionPlan: 'Asthma action plan',
  trackers: 'Tracker answers',
  media: 'Photos & videos',
};

/** Default width of each section on the ≥1280px two-column grid. */
export const NATURAL_WIDTH: Record<SectionId, 'full' | 'half'> = {
  attention: 'half',
  calendar: 'half',
  timeline: 'full',
  medications: 'half',
  lungFunction: 'full',
  actionPlan: 'half',
  trackers: 'full',
  media: 'full',
};

export const POINT_KEYS: PatientFacingPointKey[] = ['medication', 'rescue', 'abortive', 'lungFunction', 'symptoms', 'school', 'checkins'];

export const POINT_LABEL: Record<PatientFacingPointKey, string> = {
  medication: 'Medicine taken',
  rescue: 'Rescue inhaler use',
  abortive: 'Headache medicine use',
  lungFunction: 'Breathing tests',
  symptoms: 'Most common symptom',
  school: 'Missed school',
  checkins: 'Check-in streak',
};

export function defaultVisitMode(): VisitModeVisibility {
  return {
    headline: true,
    dayCounts: true,
    calendar: true,
    achievements: true,
    points: Object.fromEntries(POINT_KEYS.map((k) => [k, true])) as Record<PatientFacingPointKey, boolean>,
  };
}

export function defaultPreferences(clinicianId: string): ClinicianPreferences {
  return { clinicianId, layouts: {}, visitMode: defaultVisitMode() };
}

/** Fill gaps in a possibly partial server object. */
export function normalizePreferences(p: Partial<ClinicianPreferences> | undefined, clinicianId: string): ClinicianPreferences {
  const d = defaultVisitMode();
  const vm = p?.visitMode;
  return {
    clinicianId: p?.clinicianId ?? clinicianId,
    updatedAt: p?.updatedAt,
    layouts: p?.layouts ?? {},
    visitMode: {
      headline: vm?.headline ?? d.headline,
      dayCounts: vm?.dayCounts ?? d.dayCounts,
      calendar: vm?.calendar ?? d.calendar,
      achievements: vm?.achievements ?? d.achievements,
      points: { ...d.points, ...(vm?.points ?? {}) },
    },
  };
}

export function sectionHasData(id: SectionId, summary: PatientSummary): boolean {
  const hasAsthma = summary.patient.trackers.some((t) => t.condition === 'asthma');
  switch (id) {
    case 'lungFunction':
      return !!summary.spirometry && (summary.spirometry.sessions.length > 0 || !!summary.spirometry.latest);
    case 'actionPlan':
      return !!summary.actionPlan && hasAsthma;
    case 'medications':
      return summary.medications.scheduled.length + summary.medications.asNeeded.length > 0;
    case 'trackers':
      return summary.trackers.length > 0;
    default:
      return true;
  }
}

export interface ResolvedSection {
  id: SectionId;
  visible: boolean;
  width: 'full' | 'half';
}

const isSection = (id: string): id is SectionId => (ALL_SECTIONS as string[]).includes(id);

/**
 * Saved order first (unknown ids and duplicates ignored), then preset sections the saved
 * layout doesn't mention (visible, natural width), then only sections available for the patient.
 */
export function resolveLayout(
  preset: SpecialtyPreset,
  saved: DashboardLayout | undefined,
  isAvailable: (id: SectionId) => boolean,
): ResolvedSection[] {
  const out: ResolvedSection[] = [];
  const seen = new Set<string>();
  for (const s of saved?.sections ?? []) {
    if (!isSection(s.id) || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ id: s.id, visible: s.visible !== false, width: s.width === 'full' || s.width === 'half' ? s.width : NATURAL_WIDTH[s.id] });
  }
  for (const id of preset.sections) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, visible: true, width: NATURAL_WIDTH[id] });
  }
  return out.filter((s) => isAvailable(s.id));
}

export interface ResolvedMetric {
  metric: HeadlineMetric;
  visible: boolean;
}

/** Saved headline order (only metrics this patient has), then the preset's picks appended visible. */
export function resolveHeadline(preset: SpecialtyPreset, saved: DashboardLayout | undefined, headline: HeadlineMetric[]): { items: ResolvedMetric[]; fellBack: boolean } {
  const { metrics, fellBack } = selectHeadline(preset, headline);
  const byId = new Map(headline.map((m) => [m.id, m]));
  const out: ResolvedMetric[] = [];
  const seen = new Set<HeadlineMetricId>();
  for (const h of saved?.headline ?? []) {
    const m = byId.get(h.id);
    if (!m || seen.has(h.id)) continue;
    seen.add(h.id);
    out.push({ metric: m, visible: h.visible !== false });
  }
  for (const m of metrics) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({ metric: m, visible: true });
  }
  return { items: out, fellBack: fellBack && !saved };
}

/** Turn a resolved (patient-filtered) layout back into a DashboardLayout, keeping saved
 *  entries for sections this patient doesn't have so they aren't lost for other patients. */
export function toDashboardLayout(
  sections: ResolvedSection[],
  headline: { id: HeadlineMetricId; visible: boolean }[],
  previous: DashboardLayout | undefined,
): DashboardLayout {
  const keptSections = (previous?.sections ?? []).filter((s) => !sections.some((x) => x.id === s.id));
  const keptHeadline = (previous?.headline ?? []).filter((h) => !headline.some((x) => x.id === h.id));
  return {
    sections: [...sections.map((s) => ({ id: s.id, visible: s.visible, width: s.width })), ...keptSections],
    headline: [...headline.map((h) => ({ id: h.id, visible: h.visible })), ...keptHeadline],
  };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Display widths for normal mode: a half-width section with no half-width partner next to
 * it is widened so the grid has no holes.
 */
export function packWidths(sections: ResolvedSection[]): ('full' | 'half')[] {
  const vis = sections.map((s) => s.visible);
  const out: ('full' | 'half')[] = sections.map((s) => s.width);
  let col = 0;
  for (let i = 0; i < sections.length; i++) {
    if (!vis[i]) continue;
    if (out[i] === 'full') {
      col = 0;
      continue;
    }
    if (col === 1) {
      col = 0;
      continue;
    }
    let j = i + 1;
    while (j < sections.length && !vis[j]) j++;
    if (j < sections.length && out[j] === 'half') col = 1;
    else out[i] = 'full';
  }
  return out;
}

/** Point keys this patient actually has. */
export function availablePointKeys(summary: PatientSummary): PatientFacingPointKey[] {
  return POINT_KEYS.filter((k) => summary.patientFacing.points.some((p) => p.key === k));
}

/** How many visit-mode items are switched off (counting only points this patient has). */
export function hiddenVisitItems(v: VisitModeVisibility, summary: PatientSummary): number {
  const base = [v.headline, v.dayCounts, v.calendar, v.achievements].filter((x) => !x).length;
  return base + availablePointKeys(summary).filter((k) => v.points[k] === false).length;
}
