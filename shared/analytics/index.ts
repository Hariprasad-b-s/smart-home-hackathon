/**
 * ANALYTICS ENGINE — PUBLIC API CONTRACT (implementation owned by the analytics module).
 * Pure, deterministic functions. No I/O, no Date.now() unless `today` is omitted.
 */
import type { RawPatientDocument } from '../types/raw';
import type { TrackerDefinition } from '../types/tracker';
import type { PatientListItem, PatientSummary, SummaryOptions } from '../types/summary';
import { toCsv } from './csv';
import { buildListItem } from './list';
import { buildSummary } from './summary';

/** Full clinician summary for one patient over a window. */
export function buildPatientSummary(
  doc: RawPatientDocument,
  trackers: TrackerDefinition[],
  opts?: SummaryOptions,
): PatientSummary {
  return buildSummary(doc, trackers, opts);
}

/** Triage row for the patient list (uses a 30-day window ending `today`). */
export function buildPatientListItem(
  doc: RawPatientDocument,
  trackers: TrackerDefinition[],
  today?: string,
): PatientListItem {
  return buildListItem(doc, trackers, today);
}

/** One CSV row per day in the summary window (RFC 4180, header row, ISO dates). */
export function summaryToCsv(summary: PatientSummary): string {
  return toCsv(summary);
}

// Lower-level helpers (useful for tests and advanced consumers).
export { decodeAnswer, type Decoded } from './decode';
export { humanizeIdentifier } from './humanize';
export { computeWindow } from './context';
