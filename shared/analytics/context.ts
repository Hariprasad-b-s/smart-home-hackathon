/**
 * Shared analysis context: definitions lookup, analysis window, activity index and the
 * pre-computed building blocks (collapsed tracker days, medication groups, spirometry).
 */
import type { ISODate, RawPatientDocument } from '../types/raw';
import type { TrackerDefinition } from '../types/tracker';
import type { AnalysisWindow, SummaryOptions } from '../types/summary';
import { collapseTrackerResponses, type CollapseResult } from './collapse';
import { addDays, diffDays, fmtRange, isValidDate, localDateOf, localTimeOf, localToday, maxDate, minDate, normaliseClock } from './dates';
import { buildMedGroups, type MedBuild } from './medications';
import { buildSpirometry, type SpirometryBuild } from './spirometry';

export interface ActivityEvent {
  date: ISODate;
  /** Sortable local "YYYY-MM-DDTHH:mm". */
  key: string;
  /** Best ISO timestamp for the event. */
  ts: string;
  kind: 'tracker' | 'dose' | 'spirometry';
}

export interface Ctx {
  doc: RawPatientDocument;
  today: ISODate;
  defs: Map<string, TrackerDefinition>;
  /** Assigned trackers that have a definition, active first, then assignment order. */
  assigned: TrackerDefinition[];
  /** Assigned tracker ids without a definition. */
  missingTrackerIds: string[];
  window: AnalysisWindow;
  /** "prior 30 days" — used in trend texts. */
  versus: string;
  /** Activity events up to the window end, oldest → newest. */
  events: ActivityEvent[];
  collapse: CollapseResult;
  meds: MedBuild;
  spiro: SpirometryBuild;
  isAsthma: boolean;
  conditions: string[];
  /** Enrollment date: earliest of record creation, tracker assignment and first activity. */
  enrolledSince: ISODate;
  /** Whole days from enrollment to today. */
  enrolledDays: number;
  /** max(window.start, enrolledSince) — rates are computed from here. */
  effStart: ISODate;
  /** Days in [effStart, window.end] (0 when enrolled after the window). */
  effectiveDays: number;
  /** Last activity up to the window end. */
  lastActivityDate?: ISODate;
  /** Set when the patient stopped logging (> 2 days before window end): measurement stops here. */
  measuredThrough?: ISODate;
  /** Last day the patient was engaged in the window (undefined = never active). */
  measuredEnd?: ISODate;
  /** Days in [effStart, measuredEnd] — the days on which adherence / symptom rates are measured. */
  engagedDays: number;
}

/** Engaged-day range [effStart, measuredEnd] (null when empty). */
export function engagedRange(ctx: Ctx): { start: ISODate; end: ISODate } | null {
  if (!ctx.measuredEnd || ctx.measuredEnd < ctx.effStart) return null;
  return { start: ctx.effStart, end: ctx.measuredEnd };
}

const OFFSET_RE = /([+-]\d{2}:\d{2}|Z)$/;

function collectEvents(doc: RawPatientDocument, collapse: CollapseResult): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  let offset = '';
  for (const day of collapse.days.values()) {
    for (const s of day.submissions) {
      const ts = s.submittedAt;
      events.push({ date: day.date, key: `${day.date}T${s.time || '00:00'}`, ts, kind: 'tracker' });
      const m = typeof ts === 'string' ? OFFSET_RE.exec(ts) : null;
      if (m && !offset) offset = m[1];
    }
  }
  for (const dev of doc.medicalDevices ?? []) {
    for (const r of dev?.baselineReadings ?? []) {
      const date = localDateOf(r?.baselineReadingDate);
      if (!date || !r.fvcPlusResults) continue;
      events.push({ date, key: `${date}T${localTimeOf(r.baselineReadingDate) || '00:00'}`, ts: r.baselineReadingDate, kind: 'spirometry' });
    }
  }
  for (const log of doc.dailyLogs ?? []) {
    if (!log || !isValidDate(log.day)) continue;
    for (const a of log.medicationAdministrations ?? []) {
      if (!a) continue;
      const t = normaliseClock(a.time) || '00:00';
      events.push({ date: log.day, key: `${log.day}T${t}`, ts: `${log.day}T${t}:00${offset}`, kind: 'dose' });
    }
  }
  events.sort((a, b) => a.key.localeCompare(b.key));
  return events;
}

export function computeWindow(
  opts: SummaryOptions,
  today: ISODate,
  firstActivity: ISODate | undefined,
): { window: AnalysisWindow; versus: string } {
  const end = isValidDate(opts.end) ? opts.end : today;
  let days: number;
  let label: string;
  let versus: string;
  if (opts.days === 'all') {
    const start = firstActivity && firstActivity <= end ? firstActivity : end;
    days = Math.max(1, diffDays(end, start) + 1);
    label = 'All time';
    versus = 'prior period';
  } else {
    const n = typeof opts.days === 'number' && Number.isFinite(opts.days) ? Math.floor(opts.days) : 30;
    days = Math.max(1, n);
    label = end === today ? (days === 1 ? 'Today' : `Last ${days} days`) : fmtRange(addDays(end, -(days - 1)), end);
    versus = days === 1 ? 'prior day' : `prior ${days} days`;
  }
  const start = addDays(end, -(days - 1));
  return {
    window: {
      start,
      end,
      days,
      label,
      prior: { start: addDays(start, -days), end: addDays(start, -1) },
    },
    versus,
  };
}

export function buildContext(doc: RawPatientDocument, trackers: TrackerDefinition[], opts: SummaryOptions = {}): Ctx {
  const today = isValidDate(opts.today) ? opts.today : localToday();
  const defs = new Map<string, TrackerDefinition>();
  for (const t of trackers ?? []) if (t && t.id) defs.set(t.id, t);

  const assignments = [...(doc.trackers ?? [])].filter(Boolean);
  const ordered = [...assignments.filter((a) => a.active), ...assignments.filter((a) => !a.active)];
  const assigned: TrackerDefinition[] = [];
  const missingTrackerIds: string[] = [];
  for (const a of ordered) {
    const d = defs.get(a.trackerId);
    if (!d) missingTrackerIds.push(a.trackerId);
    else if (!assigned.includes(d)) assigned.push(d);
  }
  // Trackers with submissions but no assignment still get analysed if we know them.
  const collapse = collapseTrackerResponses(doc, defs);
  for (const day of collapse.days.values()) {
    for (const tid of day.answers.keys()) {
      const d = defs.get(tid);
      if (d && !assigned.includes(d)) assigned.push(d);
    }
  }

  const preliminaryEnd = isValidDate(opts.end) ? opts.end : today;
  const meds = buildMedGroups(doc, defs, assigned);
  const spiro = buildSpirometry(doc, doc.asthmaTreatmentPlan, preliminaryEnd);
  const allEvents = collectEvents(doc, collapse);
  const events = allEvents.filter((e) => e.date <= preliminaryEnd);
  const { window, versus } = computeWindow(opts, today, events[0]?.date);
  const conditions: string[] = [];
  for (const d of assigned) if (!conditions.includes(d.condition)) conditions.push(d.condition);

  const firstActivity = allEvents[0]?.date;
  const enrolled = minDate(enrolledSince(doc), firstActivity) ?? window.start;
  const effStart = maxDate(window.start, enrolled)!;
  const effectiveDays = Math.max(0, diffDays(window.end, effStart) + 1);
  const lastActivityDate = events[events.length - 1]?.date;
  let measuredEnd: ISODate | undefined;
  let measuredThrough: ISODate | undefined;
  if (lastActivityDate) {
    if (diffDays(window.end, lastActivityDate) > 2) {
      measuredThrough = lastActivityDate;
      measuredEnd = lastActivityDate;
    } else measuredEnd = window.end;
  }
  const engagedDays = measuredEnd && measuredEnd >= effStart ? diffDays(measuredEnd, effStart) + 1 : 0;
  // Adherence is only measured while the patient is enrolled and using the app.
  for (const g of meds.groups) {
    g.measureStart = enrolled;
    g.measureEnd = measuredEnd ?? '0000-01-01';
  }
  return {
    doc,
    today,
    defs,
    assigned,
    missingTrackerIds,
    window,
    versus,
    events,
    collapse,
    meds,
    spiro,
    isAsthma: assigned.some((d) => d.condition.toLowerCase() === 'asthma'),
    conditions,
    enrolledSince: enrolled,
    enrolledDays: Math.max(0, diffDays(today, enrolled)),
    effStart,
    effectiveDays,
    lastActivityDate,
    measuredThrough,
    measuredEnd,
    engagedDays,
  };
}

export function enrolledSince(doc: RawPatientDocument): ISODate | undefined {
  const created = localDateOf(doc.createdAt);
  const assigned = (doc.trackers ?? []).map((t) => t?.assignedDate).filter(isValidDate);
  let m = created;
  for (const a of assigned) if (!m || a < m) m = a;
  return m;
}
