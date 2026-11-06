/** Triage row for the patient list. */
import type { RawPatientDocument } from '../types/raw';
import type { TrackerDefinition } from '../types/tracker';
import type { PatientListItem } from '../types/summary';
import { buildContext } from './context';
import { recentZone } from './metrics';
import { buildSummaryFromContext } from './summary';
import { adherenceStatus } from './humanize';

export function buildListItem(doc: RawPatientDocument, trackers: TrackerDefinition[], today?: string): PatientListItem {
  const ctx = buildContext(doc, trackers, { today, days: 30 });
  const { summary: s, stats } = buildSummaryFromContext(ctx);
  const high = s.flags.filter((f) => f.severity === 'high').length;
  const medium = s.flags.filter((f) => f.severity === 'medium').length;
  // Same rule as the dashboard's zone headline, so list and dashboard never disagree.
  const cz = ctx.isAsthma ? recentZone(ctx, stats.days) : { zone: undefined };
  const adherence = s.medications.overallAdherencePct;
  const adhStatus = adherenceStatus(adherence);

  // The brief's key question — "not working" vs "not being taken" — outranks everything else.
  const keyPair = s.flags.filter(
    (f) => f.id.startsWith('symptoms-despite-adherence-') || f.id.startsWith('uncontrolled-low-adherence-'),
  ).length;
  let score = high * 10 + medium * 4 + keyPair * 15;
  if (cz.zone === 'red') score += 8;
  else if (cz.zone === 'yellow') score += 3;
  if (adhStatus === 'concern') score += 5;
  else if (adhStatus === 'watch') score += 2;
  const fs = s.freshness.status;
  if (fs === 'concern') score += 6;
  else if (fs === 'watch') score += 2;
  else if (fs === 'unknown') score += 4;

  const item: PatientListItem = {
    id: s.patient.id,
    displayName: s.patient.displayName,
    initials: s.patient.initials,
    ageYears: s.patient.ageYears,
    mrn: s.patient.mrn,
    trackers: s.patient.trackers,
    studyIds: s.patient.studyIds,
    freshnessStatus: fs,
    adherencePct30d: adherence,
    adherenceStatus: adhStatus,
    symptomDays30d: stats.symptom.count,
    highFlags: high,
    mediumFlags: medium,
    attentionScore: score,
  };
  if (s.freshness.lastActivityDate) item.lastActivityDate = s.freshness.lastActivityDate;
  if (s.freshness.daysSinceLastActivity !== undefined) item.daysSinceLastActivity = s.freshness.daysSinceLastActivity;
  if (cz.zone) item.currentZone = cz.zone;
  if (s.flags[0]) item.topFlag = s.flags[0].title;
  return item;
}
