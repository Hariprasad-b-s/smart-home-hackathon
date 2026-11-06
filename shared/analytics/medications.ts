/**
 * Medication merging, dose attribution and adherence math.
 *
 *  - Medications are merged by trimmed lower-case name (archived duplicates fold into the active row).
 *  - Doses map to a medication by id, else by name.
 *  - Daily meds expect `frequency ?? timesOfDay.length ?? 1` doses per active day.
 *  - Weekly meds expect one dose (or `frequency`) per ISO week; the expectation is attributed to the
 *    week's first active day and adherence is computed per week.
 *  - Taken doses are capped at the expected count per day (per week for weekly meds) for adherence.
 */
import type { ISODate, RawMedication, RawPatientDocument } from '../types/raw';
import type { TrackerDefinition } from '../types/tracker';
import type {
  AsNeededMedicationSummary,
  MedicationSummary,
  ScheduledMedicationSummary,
  Status,
} from '../types/summary';
import { addDays, dateRange, diffDays, isValidDate, isoWeekStart, localDateOf, maxDate, minDate, normaliseClock } from './dates';
import { adherenceStatus, makeTrend, pctOf, round, timesWord } from './humanize';

export type ScheduledRole = ScheduledMedicationSummary['role'];
export type AsNeededRole = AsNeededMedicationSummary['role'];

export interface DoseRec {
  date: ISODate;
  time: string;
  quantity: number;
  medId: string;
  /** Recorded against an archived entry although an active entry of the same drug exists. */
  viaArchived: boolean;
}

export interface MedGroup {
  key: string;
  name: string;
  icon?: string;
  sourceIds: string[];
  entries: RawMedication[];
  primary: RawMedication;
  scheduled: boolean;
  period: 'Daily' | 'Weekly' | null;
  /** Expected doses per period (scheduled meds only). */
  perPeriod: number;
  condition?: string;
  role: ScheduledRole | AsNeededRole;
  regimen: string;
  activeStart: ISODate;
  /** Undefined = still active. */
  activeEnd?: ISODate;
  doses: Map<ISODate, DoseRec[]>;
  archivedDoseCount: number;
  archivedEntryCount: number;
  /** Measurement bounds (enrollment → last engaged day); expectations outside are not counted. */
  measureStart?: ISODate;
  measureEnd?: ISODate;
}

export interface MedBuild {
  groups: MedGroup[];
  /** Human notes for MedicationSummary.notes. */
  notes: string[];
  unknownDoseCount: number;
}

const nameKey = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

const COUNTABLE = ['puff', 'tablet', 'capsule', 'spray', 'drop', 'injection', 'patch', 'inhalation', 'pill', 'dose', 'suppository', 'sachet'];

function unitFor(unit: string, q: number): string {
  const u = unit.trim();
  const lower = u.toLowerCase();
  const singular = lower.endsWith('s') ? lower.slice(0, -1) : lower;
  if (!COUNTABLE.includes(singular)) return u;
  return q === 1 ? singular : `${singular}s`;
}

function fmtQty(q: number): string {
  return String(round(q, 2));
}

export function regimenText(m: RawMedication, scheduled: boolean, period: 'Daily' | 'Weekly' | null, perPeriod: number): string {
  if (!scheduled) return 'As needed';
  const q = m.dosage?.quantity;
  const unit = m.dosage?.unit?.trim();
  let amount = '';
  if (typeof q === 'number' && q > 0) amount = unit ? `${fmtQty(q)} ${unitFor(unit, q)}` : `${fmtQty(q)} ${q === 1 ? 'dose' : 'doses'}`;
  const freq =
    period === 'Weekly'
      ? perPeriod === 1
        ? 'weekly'
        : `${timesWord(perPeriod)} weekly`
      : perPeriod === 1
        ? 'once daily'
        : `${timesWord(perPeriod)} daily`;
  if (!amount) return freq.charAt(0).toUpperCase() + freq.slice(1);
  return `${amount} ${freq}`;
}

/** Expected doses per period for a scheduled med. */
export function expectedPerPeriod(m: RawMedication): number {
  const t = m.dosage?.timing;
  const f = t?.frequency;
  if (typeof f === 'number' && f > 0) return Math.round(f);
  const n = Array.isArray(t?.timesOfDay) ? t.timesOfDay.filter(Boolean).length : 0;
  if (m.howOften === 'Daily' && n > 0) return n;
  return 1;
}

/** Condition key for a medication (tracker link first, then free-text condition match). */
export function medicationCondition(
  m: RawMedication,
  defs: Map<string, TrackerDefinition>,
  assigned: TrackerDefinition[],
): string | undefined {
  if (m.relatedTrackerId) {
    const d = defs.get(m.relatedTrackerId);
    if (d) return d.condition;
  }
  const rc = nameKey(m.relatedCondition);
  if (!rc) return undefined;
  for (const d of assigned) {
    const c = d.condition.toLowerCase();
    const l = d.conditionLabel.toLowerCase();
    if ((c && (c.includes(rc) || rc.includes(c))) || (l && (l.includes(rc) || rc.includes(l)))) return d.condition;
  }
  return undefined;
}

export function medicationRole(scheduled: boolean, condition: string | undefined): ScheduledRole | AsNeededRole {
  const c = (condition ?? '').toLowerCase();
  if (scheduled) {
    if (c === 'asthma') return 'controller';
    if (c === 'migraine') return 'preventive';
    return 'maintenance';
  }
  if (c === 'asthma') return 'rescue';
  if (c === 'migraine') return 'abortive';
  return 'asNeeded';
}

export function doseQuantity(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function buildMedGroups(
  doc: RawPatientDocument,
  defs: Map<string, TrackerDefinition>,
  assigned: TrackerDefinition[],
): MedBuild {
  const meds = (doc.medications ?? []).filter((m) => m && typeof m.name === 'string' && m.name.trim());
  const byKey = new Map<string, RawMedication[]>();
  for (const m of meds) {
    const k = nameKey(m.name);
    const list = byKey.get(k) ?? [];
    list.push(m);
    byKey.set(k, list);
  }
  const createdDay = localDateOf(doc.createdAt);
  const groups: MedGroup[] = [];
  const groupById = new Map<string, MedGroup>();
  const groupByName = new Map<string, MedGroup>();

  for (const [key, entries] of byKey) {
    entries.sort((a, b) => Number(a.archived) - Number(b.archived) || (a.index ?? 0) - (b.index ?? 0));
    const active = entries.filter((e) => !e.archived);
    const primary =
      active[0] ??
      [...entries].sort((a, b) => ((a.archivedDate ?? '') < (b.archivedDate ?? '') ? 1 : -1))[0];
    const scheduled = primary.howOften === 'Daily' || primary.howOften === 'Weekly';
    const period = scheduled ? (primary.howOften as 'Daily' | 'Weekly') : null;
    const perPeriod = scheduled ? expectedPerPeriod(primary) : 0;
    let condition: string | undefined;
    for (const e of [primary, ...entries]) {
      condition = medicationCondition(e, defs, assigned);
      if (condition) break;
    }
    const g: MedGroup = {
      key,
      name: primary.name.trim(),
      icon: primary.icon ?? entries.find((e) => e.icon)?.icon,
      sourceIds: entries.map((e) => e.id),
      entries,
      primary,
      scheduled,
      period,
      perPeriod,
      condition,
      role: medicationRole(scheduled, condition),
      regimen: regimenText(primary, scheduled, period, perPeriod),
      activeStart: createdDay ?? '1970-01-01',
      doses: new Map(),
      archivedDoseCount: 0,
      archivedEntryCount: entries.filter((e) => e.archived).length,
    };
    groups.push(g);
    for (const e of entries) groupById.set(e.id, g);
    groupByName.set(key, g);
  }

  let unknownDoseCount = 0;
  for (const log of doc.dailyLogs ?? []) {
    if (!log || !isValidDate(log.day)) continue;
    for (const a of log.medicationAdministrations ?? []) {
      if (!a) continue;
      const g = groupById.get(a.id) ?? groupByName.get(nameKey(a.name));
      if (!g) {
        unknownDoseCount++;
        continue;
      }
      const entry = g.entries.find((e) => e.id === a.id);
      const viaArchived = !!entry?.archived && g.entries.some((e) => !e.archived);
      if (viaArchived) g.archivedDoseCount++;
      const rec: DoseRec = { date: log.day, time: normaliseClock(a.time), quantity: doseQuantity(a.value), medId: a.id, viaArchived };
      const list = g.doses.get(log.day) ?? [];
      list.push(rec);
      g.doses.set(log.day, list);
    }
  }

  for (const g of groups) {
    for (const list of g.doses.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    const doseDates = [...g.doses.keys()].sort();
    const startDates = g.entries.map((e) => e.startDate).filter(isValidDate);
    const candidates: (string | undefined)[] = [...startDates, doseDates[0]];
    if (startDates.length === 0) candidates.push(createdDay);
    g.activeStart = minDate(...candidates) ?? createdDay ?? doseDates[0] ?? '1970-01-01';
    if (g.entries.every((e) => e.archived)) {
      const archived = g.entries.map((e) => e.archivedDate).filter(isValidDate);
      g.activeEnd = maxDate(...archived) ?? doseDates[doseDates.length - 1] ?? g.activeStart;
    }
  }

  const notes: string[] = [];
  for (const g of groups) {
    if (g.entries.length < 2) continue;
    if (g.archivedDoseCount > 0) {
      notes.push(
        `${g.archivedDoseCount} ${g.archivedDoseCount === 1 ? 'dose' : 'doses'} recorded against an archived '${g.name}' entry ${g.archivedDoseCount === 1 ? 'was' : 'were'} merged`,
      );
    } else {
      notes.push(`${g.entries.length} '${g.name}' entries (${g.archivedEntryCount} archived) were merged into one row`);
    }
  }
  if (unknownDoseCount > 0) {
    notes.push(`${unknownDoseCount} ${unknownDoseCount === 1 ? 'dose' : 'doses'} could not be matched to any medication and ${unknownDoseCount === 1 ? 'was' : 'were'} ignored`);
  }

  groups.sort(
    (a, b) =>
      Number(b.scheduled) - Number(a.scheduled) ||
      (a.primary.index ?? 0) - (b.primary.index ?? 0) ||
      a.key.localeCompare(b.key),
  );
  return { groups, notes, unknownDoseCount };
}

/** First day expectations can start (later of the med's start and enrollment). */
export function expectationStart(g: MedGroup): ISODate {
  return maxDate(g.activeStart, g.measureStart) ?? g.activeStart;
}

export function isActiveOn(g: MedGroup, d: ISODate): boolean {
  return (
    d >= expectationStart(g) &&
    (g.activeEnd === undefined || d <= g.activeEnd) &&
    (g.measureEnd === undefined || d <= g.measureEnd)
  );
}

/** Scheduled doses expected on day d (weekly meds: on the first active day of each ISO week). */
export function expectedOn(g: MedGroup, d: ISODate): number {
  if (!g.scheduled || !isActiveOn(g, d)) return 0;
  if (g.period === 'Weekly') return d === maxDate(isoWeekStart(d), expectationStart(g)) ? g.perPeriod : 0;
  return g.perPeriod;
}

export function takenOn(g: MedGroup, d: ISODate): number {
  return (g.doses.get(d) ?? []).reduce((s, x) => s + x.quantity, 0);
}

export interface AdherenceCalc {
  /** Raw taken (uncapped) and expected per day. */
  daily: { date: ISODate; taken: number; expected: number }[];
  cappedTaken: number;
  expected: number;
  rawTaken: number;
  /** Units = days (daily meds) or weeks (weekly meds) with something expected. */
  units: number;
  fullUnits: number;
  weekly: { weekStart: ISODate; pct: number | null }[];
  /** Per-unit results, oldest → newest, for streaks. */
  unitResults: { start: ISODate; end: ISODate; full: boolean; inProgress: boolean }[];
}

export function computeAdherence(g: MedGroup, start: ISODate, end: ISODate): AdherenceCalc {
  const days = dateRange(start, end);
  const daily = days.map((d) => ({ date: d, taken: takenOn(g, d), expected: 0 }));
  let cappedTaken = 0;
  let expected = 0;
  let units = 0;
  let fullUnits = 0;
  const unitResults: AdherenceCalc['unitResults'] = [];
  const weekAgg = new Map<ISODate, { capped: number; expected: number }>();
  for (const d of days) {
    const w = isoWeekStart(d);
    if (!weekAgg.has(w)) weekAgg.set(w, { capped: 0, expected: 0 });
  }

  if (g.period === 'Daily') {
    for (const row of daily) {
      if (!isActiveOn(g, row.date)) continue;
      row.expected = g.perPeriod;
      const capped = Math.min(row.taken, row.expected);
      cappedTaken += capped;
      expected += row.expected;
      units++;
      const full = row.taken >= row.expected;
      if (full) fullUnits++;
      unitResults.push({ start: row.date, end: row.date, full, inProgress: row.date === end });
      const w = weekAgg.get(isoWeekStart(row.date))!;
      w.capped += capped;
      w.expected += row.expected;
    }
  } else if (g.period === 'Weekly') {
    for (const row of daily) {
      if (!isActiveOn(g, row.date)) continue;
      const ws = isoWeekStart(row.date);
      const firstActive = maxDate(ws, expectationStart(g))!;
      if (row.date !== firstActive) continue;
      row.expected = g.perPeriod;
      const weekEnd = addDays(ws, 6);
      let weekTaken = 0;
      for (const d of dateRange(firstActive, weekEnd)) if (isActiveOn(g, d)) weekTaken += takenOn(g, d);
      const capped = Math.min(weekTaken, row.expected);
      cappedTaken += capped;
      expected += row.expected;
      units++;
      const full = weekTaken >= row.expected;
      if (full) fullUnits++;
      unitResults.push({ start: firstActive, end: minDate(weekEnd, end)!, full, inProgress: weekEnd > end });
      const w = weekAgg.get(ws)!;
      w.capped += capped;
      w.expected += row.expected;
    }
  }
  const rawTaken = daily.reduce((s, r) => s + r.taken, 0);
  const weekly = [...weekAgg.entries()].map(([weekStart, a]) => ({ weekStart, pct: pctOf(a.capped, a.expected) }));
  return { daily, cappedTaken, expected, rawTaken, units, fullUnits, weekly, unitResults };
}

/** Consecutive fully-adherent days ending at window end (an in-progress final day/week is not held against it). */
function streakDays(calc: AdherenceCalc, end: ISODate): number {
  const units = [...calc.unitResults];
  const last = units[units.length - 1];
  if (last && !last.full && last.inProgress) units.pop();
  if (!units.length) return 0;
  if (units[units.length - 1].end < addDays(end, -1)) return 0;
  let days = 0;
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i];
    if (!u.full) break;
    if (i < units.length - 1 && addDays(u.end, 1) !== units[i + 1].start) break;
    days += diffDays(u.end, u.start) + 1;
  }
  return days;
}

export interface MedWindow {
  start: ISODate;
  end: ISODate;
  days: number;
  prior: { start: ISODate; end: ISODate };
  versus: string;
  /** Days over which per-week rates are computed (engaged days). Defaults to `days`. */
  rateDays?: number;
  /** Patient stopped logging: adherence measured through this date. */
  measuredThrough?: ISODate;
}

export function summarizeScheduled(g: MedGroup, w: MedWindow): ScheduledMedicationSummary {
  const calc = computeAdherence(g, w.start, w.end);
  const prior = computeAdherence(g, w.prior.start, w.prior.end);
  const adherencePct = pctOf(calc.cappedTaken, calc.expected);
  const priorPct = pctOf(prior.cappedTaken, prior.expected);
  const lastTakenDate = [...g.doses.keys()].filter((d) => d <= w.end).sort().pop();
  return {
    key: g.key,
    name: g.name,
    regimen: g.regimen,
    condition: g.condition,
    icon: g.icon,
    sourceIds: g.sourceIds,
    role: g.role as ScheduledRole,
    dosesTaken: calc.cappedTaken,
    dosesExpected: calc.expected,
    adherencePct,
    fullDosePct: pctOf(calc.fullUnits, calc.units),
    status: adherenceStatus(adherencePct),
    trend: makeTrend(adherencePct, priorPct, { higherIsWorse: false, mode: 'abs', minChange: 5, unit: ' pts', versus: w.versus }),
    daily: calc.daily,
    weekly: calc.weekly,
    lastTakenDate,
    currentStreakDays: streakDays(calc, w.end),
    ...(w.measuredThrough ? { measuredThrough: w.measuredThrough } : {}),
  };
}

export interface AsNeededCalc {
  daily: { date: ISODate; uses: number }[];
  totalUses: number;
  daysUsed: number;
}

export function computeAsNeeded(g: MedGroup, start: ISODate, end: ISODate): AsNeededCalc {
  const daily = dateRange(start, end).map((d) => ({ date: d, uses: takenOn(g, d) }));
  return {
    daily,
    totalUses: daily.reduce((s, r) => s + r.uses, 0),
    daysUsed: daily.filter((r) => r.uses > 0).length,
  };
}

/** Days-of-use threshold over the window that signals abortive medication overuse risk (10 per 30 days). */
export function abortiveOveruseThreshold(windowDays: number): number {
  return (10 * windowDays) / 30;
}

export function summarizeAsNeeded(g: MedGroup, w: MedWindow): AsNeededMedicationSummary {
  const calc = computeAsNeeded(g, w.start, w.end);
  const prior = computeAsNeeded(g, w.prior.start, w.prior.end);
  const rateDays = w.rateDays ?? w.days;
  const perWeek = rateDays > 0 ? round(calc.daysUsed / (rateDays / 7), 1) : 0;
  const trend = makeTrend(calc.daysUsed, prior.daysUsed, {
    higherIsWorse: g.role === 'asNeeded' ? null : true,
    mode: 'abs',
    minChange: 1,
    unit: calc.daysUsed - prior.daysUsed === 1 || calc.daysUsed - prior.daysUsed === -1 ? ' day' : ' days',
    versus: w.versus,
  });
  let status: Status = 'neutral';
  if (rateDays === 0) status = 'unknown';
  else if (g.role === 'rescue') {
    if (perWeek > 2) status = 'concern';
    else if (calc.daysUsed > 0 && trend?.direction === 'up') status = 'watch';
    else status = 'good';
  } else if (g.role === 'abortive') {
    const t = abortiveOveruseThreshold(rateDays);
    status = calc.daysUsed >= t ? 'concern' : calc.daysUsed >= 0.7 * t ? 'watch' : 'good';
  }
  // Too few days to extrapolate a weekly rate: never escalate past "watch".
  if (rateDays > 0 && rateDays < 7 && status === 'concern') status = 'watch';
  const lastUsedDate = [...g.doses.keys()].filter((d) => d <= w.end).sort().pop();
  return {
    key: g.key,
    name: g.name,
    regimen: g.regimen,
    condition: g.condition,
    icon: g.icon,
    sourceIds: g.sourceIds,
    role: g.role as AsNeededRole,
    totalUses: calc.totalUses,
    daysUsed: calc.daysUsed,
    perWeek,
    status,
    trend,
    daily: calc.daily,
    lastUsedDate,
  };
}

export function summarizeMedications(build: MedBuild, w: MedWindow): MedicationSummary {
  const scheduled = build.groups.filter((g) => g.scheduled).map((g) => summarizeScheduled(g, w));
  const asNeeded = build.groups.filter((g) => !g.scheduled).map((g) => summarizeAsNeeded(g, w));
  const taken = scheduled.reduce((s, m) => s + m.dosesTaken, 0);
  const expected = scheduled.reduce((s, m) => s + m.dosesExpected, 0);
  return {
    scheduled,
    asNeeded,
    overallAdherencePct: scheduled.length ? pctOf(taken, expected) : null,
    notes: [...build.notes],
  };
}
