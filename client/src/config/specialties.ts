/**
 * SPECIALTY PRESETS — the same PatientSummary, arranged for different readers.
 *
 * A preset picks which headline metrics show (and in what order), which dashboard
 * sections render (and in what order), the timeline rows, the default calendar colouring,
 * and which conditions to emphasise when filtering medication / tracker cards.
 * Metrics or sections with no data simply don't render.
 */
import type { HeadlineMetric, HeadlineMetricId, PatientSummary } from '@shared/types';
import type { CalendarColorBy, TimelineRow } from '../components/charts/types';

export type SpecialtyId = 'all' | 'pulmonology' | 'primaryCare' | 'nursing' | 'neurology' | 'gastroenterology';

export type SectionId =
  | 'attention'
  | 'calendar'
  | 'timeline'
  | 'medications'
  | 'lungFunction'
  | 'actionPlan'
  | 'trackers'
  | 'media';

export interface SpecialtyPreset {
  id: SpecialtyId;
  label: string;
  description: string;
  /** Ordered headline metric ids. `null` = every metric, in the summary's own order. */
  headline: HeadlineMetricId[] | null;
  sections: SectionId[];
  timelineRows: TimelineRow[];
  calendarColorBy: CalendarColorBy;
  /** Conditions whose tracker / medication cards are emphasised. `null` = all conditions. */
  conditions: string[] | null;
}

export const SPECIALTIES: Record<SpecialtyId, SpecialtyPreset> = {
  all: {
    id: 'all',
    label: 'Overview',
    description: 'Everything the app collected, most important first.',
    headline: null,
    sections: ['attention', 'calendar', 'medications', 'timeline', 'lungFunction', 'actionPlan', 'media', 'trackers'],
    timelineRows: ['feeling', 'symptoms', 'scheduledDoses', 'asNeeded', 'peakFlow', 'zone'],
    calendarColorBy: 'zone',
    conditions: null,
  },
  pulmonology: {
    id: 'pulmonology',
    label: 'Pulmonology',
    description: 'Lung function, zones and controller use first.',
    headline: ['zone', 'lungFunction', 'controllerAdherence', 'rescueUse', 'symptomDays', 'nightWaking'],
    sections: ['lungFunction', 'attention', 'timeline', 'calendar', 'medications', 'actionPlan', 'media', 'trackers'],
    timelineRows: ['peakFlow', 'zone', 'symptoms', 'scheduledDoses', 'asNeeded', 'feeling'],
    calendarColorBy: 'zone',
    conditions: ['asthma'],
  },
  primaryCare: {
    id: 'primaryCare',
    label: 'Primary care',
    description: 'How each condition is going, at a glance.',
    headline: ['hardDays', 'symptomDays', 'controllerAdherence', 'medicationAdherence', 'zone', 'headacheDays', 'missedSchool', 'loggingConsistency'],
    sections: ['attention', 'media', 'calendar', 'medications', 'actionPlan', 'timeline', 'trackers', 'lungFunction'],
    timelineRows: ['feeling', 'symptoms', 'scheduledDoses', 'asNeeded'],
    calendarColorBy: 'hardDay',
    conditions: null,
  },
  nursing: {
    id: 'nursing',
    label: 'Nursing',
    description: 'Adherence, logging habits and plan upkeep for follow-up calls.',
    headline: ['controllerAdherence', 'medicationAdherence', 'loggingConsistency', 'zone', 'rescueUse', 'abortiveUse', 'symptomDays'],
    sections: ['attention', 'media', 'medications', 'actionPlan', 'calendar', 'trackers', 'timeline', 'lungFunction'],
    timelineRows: ['scheduledDoses', 'asNeeded', 'feeling', 'symptoms'],
    calendarColorBy: 'adherence',
    conditions: null,
  },
  neurology: {
    id: 'neurology',
    label: 'Neurology',
    description: 'Headache burden, pain and abortive medication use.',
    headline: ['headacheDays', 'painAverage', 'abortiveUse', 'medicationAdherence', 'sleepHours', 'missedSchool', 'hardDays', 'loggingConsistency'],
    sections: ['attention', 'calendar', 'timeline', 'trackers', 'media', 'medications'],
    timelineRows: ['feeling', 'symptoms', 'asNeeded', 'scheduledDoses'],
    calendarColorBy: 'symptomDay',
    conditions: ['migraine', 'headache', 'epilepsy'],
  },
  gastroenterology: {
    id: 'gastroenterology',
    label: 'Gastroenterology',
    description: 'Stool pattern, bleeding, pain and maintenance therapy.',
    headline: ['stoolFrequency', 'bloodInStool', 'painAverage', 'medicationAdherence', 'missedSchool', 'hardDays'],
    sections: ['attention', 'media', 'calendar', 'timeline', 'trackers', 'medications'],
    timelineRows: ['feeling', 'symptoms', 'scheduledDoses', 'asNeeded'],
    calendarColorBy: 'symptomDay',
    conditions: ['ibd', 'crohns', 'colitis', 'gi'],
  },
};

export const SPECIALTY_ORDER: SpecialtyId[] = ['all', 'pulmonology', 'primaryCare', 'nursing', 'neurology', 'gastroenterology'];

export function isSpecialtyId(v: string | null | undefined): v is SpecialtyId {
  return !!v && Object.prototype.hasOwnProperty.call(SPECIALTIES, v);
}

const CONDITION_TO_SPECIALTY: Record<string, SpecialtyId> = {
  asthma: 'pulmonology',
  copd: 'pulmonology',
  cf: 'pulmonology',
  migraine: 'neurology',
  headache: 'neurology',
  epilepsy: 'neurology',
  ibd: 'gastroenterology',
  crohns: 'gastroenterology',
  colitis: 'gastroenterology',
};

/** Distinct, lower-cased condition keys (ignores "general"). */
export function patientConditions(conditions: string[]): string[] {
  return [...new Set(conditions.map((c) => c.toLowerCase()))].filter((c) => c !== 'general');
}

/**
 * Default preset when the URL has no `view`: a single specialty condition maps to that
 * specialty; several conditions (or none) → Overview.
 */
export function inferSpecialty(conditions: string[]): SpecialtyId {
  const distinct = patientConditions(conditions);
  if (distinct.length !== 1) return 'all';
  return CONDITION_TO_SPECIALTY[distinct[0]] ?? 'all';
}

/** Explicit URL choice wins, then the signed-in clinician's default view, then inference from conditions. */
export function resolveSpecialty(viewParam: string | null | undefined, conditions: string[], clinicianDefault?: string | null): SpecialtyPreset {
  if (isSpecialtyId(viewParam)) return SPECIALTIES[viewParam];
  if (isSpecialtyId(clinicianDefault)) return SPECIALTIES[clinicianDefault];
  return SPECIALTIES[inferSpecialty(conditions)];
}

/**
 * Headline metrics for a preset. Missing metrics don't render. If the preset matches
 * nothing the patient has (e.g. Neurology for an asthma-only patient) fall back to the
 * summary's own top metrics so the strip is never empty.
 */
export function selectHeadline(
  preset: SpecialtyPreset,
  headline: HeadlineMetric[],
  max = 8,
): { metrics: HeadlineMetric[]; fellBack: boolean } {
  if (!preset.headline) return { metrics: headline.slice(0, max), fellBack: false };
  const byId = new Map(headline.map((m) => [m.id, m]));
  const picked = preset.headline.map((id) => byId.get(id)).filter((m): m is HeadlineMetric => !!m);
  if (picked.length === 0) return { metrics: headline.slice(0, Math.min(max, 6)), fellBack: headline.length > 0 };
  return { metrics: picked.slice(0, max), fellBack: false };
}

/**
 * Should a card for `condition` be shown under this preset? Cards without a condition
 * (or "general") always show. If the patient has none of the preset's conditions, show all.
 */
export function makeConditionFilter(preset: SpecialtyPreset, patientConds: string[]) {
  const emphasis = preset.conditions;
  const relevant = emphasis ? patientConds.some((c) => emphasis.includes(c.toLowerCase())) : false;
  return (condition?: string): boolean => {
    if (!emphasis || !relevant) return true;
    if (!condition || condition === 'general') return true;
    return emphasis.includes(condition.toLowerCase());
  };
}

/** Sections in preset order, keeping only those with data. */
export function visibleSections(preset: SpecialtyPreset, summary: PatientSummary): SectionId[] {
  const hasAsthma = summary.patient.trackers.some((t) => t.condition === 'asthma');
  return preset.sections.filter((s) => {
    switch (s) {
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
  });
}

/** Timeline rows the data can actually fill. */
export function visibleTimelineRows(preset: SpecialtyPreset, summary: PatientSummary): TimelineRow[] {
  return preset.timelineRows.filter((r) => {
    if (r === 'peakFlow') return !!summary.spirometry && summary.spirometry.sessions.length > 0;
    if (r === 'zone') return summary.days.some((d) => d.zone);
    if (r === 'scheduledDoses') return summary.medications.scheduled.length > 0;
    if (r === 'asNeeded') return summary.medications.asNeeded.length > 0;
    return true;
  });
}
