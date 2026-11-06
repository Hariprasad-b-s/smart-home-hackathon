/**
 * NORMALIZED CLINICIAN MODEL — CONTRACT
 *
 * Produced by shared/analytics (buildPatientSummary) from a RawPatientDocument plus the
 * TrackerDefinitions, consumed by the API and the React client. All values here are
 * already cleaned, decoded, unit-converted, rounded for display and human-labelled.
 * The UI must never need to look at raw data to render a summary.
 */
import type { ISODate, ISODateTime } from './raw';
import type { QuestionRole, QuestionType, Severity } from './tracker';

/** Traffic-light status used everywhere in the UI. */
export type Status = 'good' | 'watch' | 'concern' | 'neutral' | 'unknown';

/** Asthma action plan zone. */
export type Zone = 'green' | 'yellow' | 'red';

export type TrendDirection = 'up' | 'down' | 'flat' | 'unknown';

export interface Trend {
  direction: TrendDirection;
  /** Whether this direction is clinically better, worse, or neither. */
  meaning: 'better' | 'worse' | 'neutral';
  /** Short human text, e.g. "+3 vs prior 30 days", "−12% since Sep". */
  text: string;
}

// ───────────────────────────────── Patient header ─────────────────────────────────

export interface TrackerRef {
  id: string;
  name: string;
  condition: string;
  conditionLabel: string;
}

export interface PatientHeader {
  id: string;
  displayName: string; // "Jordan Reyes"
  initials: string; // "JR"
  ageYears: number;
  sex?: 'F' | 'M' | 'X';
  mrn: string;
  careTeam?: string;
  trackers: TrackerRef[];
  studyIds: string[];
  enrolledSince: ISODate;
  /** Days since enrollment (first activity / earliest tracker assignment) through `today`. */
  enrolledDays: number;
  heightCm?: number;
  weightKg?: number;
  /** EHR background (Synthea-seeded in the demo). Undefined when the document has none. */
  ehr?: {
    source: 'synthea' | 'manual';
    /** Active problem-list entries, human-readable, most relevant first (max 8). */
    problems: string[];
    allergies: string[];
    /** Active prescriptions on file, simplified display names (e.g. "Flovent HFA 44 mcg inhaler"). */
    medicationsOnFile: string[];
    lastClinicVisit?: ISODate;
    visitsLast12Months?: number;
  };
}

// ───────────────────────────────── Window & freshness ─────────────────────────────

export interface AnalysisWindow {
  start: ISODate; // inclusive
  end: ISODate; // inclusive
  days: number; // end - start + 1
  /** "Last 30 days" | "Last 90 days" | "All time" | "Mar 1 – Mar 31, 2026" */
  label: string;
  /** The equally-long window immediately before `start`, used for "vs prior" trends. */
  prior: { start: ISODate; end: ISODate };
}

export interface DataFreshness {
  /** Latest activity across tracker submissions, doses, and spirometry (fixes the
   *  "last day logged" mismatch in Screenshot 2). */
  lastActivityAt?: ISODateTime;
  lastActivityDate?: ISODate;
  lastTrackerSubmissionDate?: ISODate;
  lastMedicationDoseDate?: ISODate;
  lastSpirometryDate?: ISODate;
  /** Whole days between lastActivityDate and the window end (0 = active today). */
  daysSinceLastActivity?: number;
  status: Status; // good ≤2 d, watch 3–7 d, concern >7 d
  /** Days in the window with any patient activity. */
  activeDaysInWindow: number;
  /** All-time count of distinct days with any activity (the portal's "total days tracked"). */
  totalDaysTracked: number;
  /** Day the patient first had any activity. */
  firstActivityDate?: ISODate;
}

// ───────────────────────────────── Headline (30-second) metrics ────────────────────

export type HeadlineMetricId =
  | 'zone'
  | 'controllerAdherence'
  | 'symptomDays'
  | 'hardDays'
  | 'rescueUse'
  | 'abortiveUse'
  | 'lungFunction'
  | 'missedSchool'
  | 'nightWaking'
  | 'headacheDays'
  | 'painAverage'
  | 'stoolFrequency'
  | 'bloodInStool'
  | 'sleepHours'
  | 'medicationAdherence'
  | 'loggingConsistency';

export interface HeadlineMetric {
  id: HeadlineMetricId;
  label: string; // "Controller adherence"
  /** Pre-formatted primary value: "64%", "9 of 30", "Yellow", "2.1/wk". */
  value: string;
  /** Raw numeric value when meaningful (for sorting / sparklines). */
  numericValue?: number;
  /** Secondary text: "38 of 60 doses marked taken". */
  detail?: string;
  status: Status;
  trend?: Trend;
  /** Optional daily sparkline over the window (null = no data that day). */
  sparkline?: { date: ISODate; value: number | null }[];
  /** One-sentence plain-language explanation of how this was computed (tooltip). */
  method: string;
  /** Which condition this metric belongs to ("asthma", "migraine", "general"…). */
  condition: string;
}

// ───────────────────────────────── Flags ──────────────────────────────────────────

export type FlagCategory =
  | 'adherence'
  | 'symptoms'
  | 'lungFunction'
  | 'actionPlan'
  | 'engagement'
  | 'discordance' // patient says "Great" but reports wheeze / low PEF, etc.
  | 'dataQuality';

export interface ClinicalFlag {
  id: string; // stable, e.g. "adherence-low-<medId>"
  severity: 'high' | 'medium' | 'low';
  category: FlagCategory;
  /** ≤ 70 chars headline: "Controller taken on 9 of 30 days". */
  title: string;
  /** One or two sentences with the evidence. */
  detail: string;
  /** Dates the flag refers to (for highlighting on calendar/timeline). */
  dates?: ISODate[];
  condition: string;
}

// ───────────────────────────────── Per-day collapsed status ────────────────────────

export interface DayEntrySubmission {
  responseId: string;
  trackerId: string;
  /** Local "HH:mm". */
  time: string;
  /** True when the submission had no non-empty answers. */
  blank: boolean;
  /** True when this submission supplied the value(s) used for the day. */
  usedForDay: boolean;
  answers: { questionId: string; shortLabel: string; display: string }[];
  /** 'voice' when the patient spoke the check-in (answers were AI/rule-extracted, then confirmed by the patient). */
  entryMode?: 'form' | 'voice';
  transcript?: string;
  mediaIds?: string[];
}

export interface DaySummary {
  date: ISODate;
  /** Any activity at all this day (submission, dose, or spirometry). */
  hasData: boolean;
  submissionCount: number;
  blankSubmissionCount: number;
  /** Overall feeling — the LAST non-empty answer of the day. `sequence` = every non-empty answer in time order (e.g. ["Bad","Great"]). */
  feeling?: { label: string; severity?: Severity; changedDuringDay: boolean; worstLabel?: string; sequence: string[] };
  /** Union of symptoms reported across the day's submissions (human labels, "None" removed). */
  symptoms: string[];
  /** Any symptom reported, or feeling severity ≥ 2, or a symptom-role score ≥ concern threshold. */
  symptomDay: boolean;
  /** Patient-facing "hard day": feeling ≥ 2, zone yellow/red, pain ≥ threshold, missed school, or blood in stool. */
  hardDay: boolean;
  /** Derived zone for the day (see ActionPlanSummary.method). Undefined when no basis. */
  zone?: Zone;
  /** Scheduled (daily/weekly) medication doses: taken vs expected across all active scheduled meds. */
  scheduledDosesTaken: number;
  scheduledDosesExpected: number;
  /** As-needed (rescue / abortive) medication uses recorded as doses + tracker self-report (max of the two). */
  asNeededUses: number;
  /** Values of the LATEST session that day (best reliable blow of that session). The day's
   *  zone uses the WORST session of the day, so a red reading is never hidden by a good one. */
  spirometry?: {
    pefLpm: number;
    fev1L: number;
    pctPersonalBest?: number;
    acceptable: boolean;
  };
  /** Role-keyed decoded values for condition metrics (last non-empty answer of the day). */
  roleValues: Partial<Record<QuestionRole, number | boolean | string[]>>;
  /** Patient reported feeling good/great while also reporting symptoms or PEF < 80 % PB. */
  discordant: boolean;
  /** Raw-ish detail for the "day drawer". Ordered by time. */
  submissions: DayEntrySubmission[];
  doses: { time: string; medicationName: string; kind: 'scheduled' | 'asNeeded'; quantity: number }[];
}

// ───────────────────────────────── Generic per-question summaries ──────────────────

interface QuestionSummaryBase {
  questionId: string;
  trackerId: string;
  text: string;
  shortLabel: string;
  type: QuestionType;
  role?: QuestionRole;
  /** Days in window with a non-empty answer. */
  answeredDays: number;
  windowDays: number;
}

export interface CategoricalQuestionSummary extends QuestionSummaryBase {
  kind: 'categorical'; // faceScale, iconChoice, singleChoice
  distribution: { label: string; days: number; pct: number; severity?: Severity }[];
  series: { date: ISODate; label: string | null; severity?: Severity }[];
}

export interface MultiSelectQuestionSummary extends QuestionSummaryBase {
  kind: 'multi'; // checkbox
  /** Sorted by days desc. */
  items: { label: string; days: number; pct: number }[];
  /** Days where at least one non-"none" item was selected. */
  anyDays: number;
  series: { date: ISODate; items: string[] | null }[];
}

export interface NumericQuestionSummary extends QuestionSummaryBase {
  kind: 'numeric'; // number, scale1to10
  unit?: string;
  min?: number;
  max?: number;
  direction: 'higherIsWorse' | 'higherIsBetter';
  concernThreshold?: number;
  stats: { mean: number | null; min: number | null; max: number | null; last: number | null; daysAtConcern: number };
  series: { date: ISODate; value: number | null }[];
  trend?: Trend;
}

export interface BooleanQuestionSummary extends QuestionSummaryBase {
  kind: 'boolean'; // yesNo
  yesDays: number;
  noDays: number;
  /** yesDays / answeredDays × 100, rounded. */
  yesPct: number;
  series: { date: ISODate; value: boolean | null }[];
}

export interface TextQuestionSummary extends QuestionSummaryBase {
  kind: 'text'; // text, spirometry prompt
  /** Most recent non-empty answers, newest first (max 10). */
  recent: { date: ISODate; text: string }[];
}

export type QuestionSummary =
  | CategoricalQuestionSummary
  | MultiSelectQuestionSummary
  | NumericQuestionSummary
  | BooleanQuestionSummary
  | TextQuestionSummary;

export interface TrackerSummary {
  tracker: TrackerRef;
  submissions: number;
  blankSubmissions: number;
  daysWithSubmission: number;
  /** daysWithSubmission / days in window since enrollment × 100. */
  completionPct: number;
  /** Days where >1 submission was collapsed into one. */
  collapsedDays: number;
  questions: QuestionSummary[];
}

// ───────────────────────────────── Medications ────────────────────────────────────

export interface ScheduledMedicationSummary {
  /** Display key: lower-cased trimmed name (archived duplicates merged in). */
  key: string;
  name: string; // "Dulera"
  /** "2 puffs twice daily" */
  regimen: string;
  condition?: string;
  icon?: string;
  /** All raw medication ids merged into this row (active + archived duplicates). */
  sourceIds: string[];
  /** Asthma: scheduled inhaled meds are labelled controller. */
  role: 'controller' | 'preventive' | 'maintenance';
  dosesTaken: number;
  dosesExpected: number;
  /** dosesTaken (capped per day at expected) / dosesExpected × 100, rounded. Null when nothing expected. */
  adherencePct: number | null;
  /** Days with ≥ all expected doses / days expected. */
  fullDosePct: number | null;
  status: Status; // good ≥ 80 %, watch 50–79 %, concern < 50 %
  trend?: Trend;
  daily: { date: ISODate; taken: number; expected: number }[];
  /**
   * Adherence is only measured while the patient is using the app. When the patient has
   * stopped logging (no activity for > 2 days before window end) the denominator stops at
   * the last activity date and this field is set to it. Not logging ≠ not taking.
   */
  measuredThrough?: ISODate;
  /** ISO-week buckets, Monday start. */
  weekly: { weekStart: ISODate; pct: number | null }[];
  lastTakenDate?: ISODate;
  /** Longest run of consecutive fully-adherent days ending at window end. */
  currentStreakDays: number;
}

export interface AsNeededMedicationSummary {
  key: string;
  name: string; // "Albuterol", "Excedrin"
  regimen: string; // "As needed"
  condition?: string;
  icon?: string;
  sourceIds: string[];
  role: 'rescue' | 'abortive' | 'asNeeded';
  totalUses: number;
  daysUsed: number;
  /** DAYS with use per week (not uses per week), rounded to 1 dp. */
  perWeek: number;
  status: Status;
  trend?: Trend;
  daily: { date: ISODate; uses: number }[];
  lastUsedDate?: ISODate;
}

export interface MedicationSummary {
  scheduled: ScheduledMedicationSummary[];
  asNeeded: AsNeededMedicationSummary[];
  /** Weighted adherence across all scheduled meds (null when none). */
  overallAdherencePct: number | null;
  /** E.g. "2 doses recorded against an archived 'Excedrin' entry were merged". */
  notes: string[];
}

// ───────────────────────────────── Spirometry ─────────────────────────────────────

export interface SpirometryBlow {
  time: string; // "09:31"
  accepted: boolean;
  /** "Acceptable" | "Usable" | "Not acceptable" — humanized device quality grade. */
  qualityLabel: string;
  /** Humanized coaching messages, e.g. "Keep going until completely empty". */
  coaching: string[];
  fev1L: number; // 2 dp
  fvcL: number; // 2 dp
  ratioPct: number; // 0 dp
  pefLpm: number; // L/min, 0 dp
  fef2575Lps?: number; // 2 dp
}

/** One sitting at the device: consecutive blows with ≤ 30 min gaps. A day can have several. */
export interface SpirometrySession {
  date: ISODate;
  /** Local "HH:mm" of the first blow in the session. */
  time?: string;
  /** Best acceptable values (ATS: highest FEV1 / FVC / PEF from accepted blows; falls back to all blows if none accepted). */
  bestFev1L: number;
  bestFvcL: number;
  ratioPct: number;
  bestPefLpm: number;
  pctPersonalBest?: number; // PEF % of personal best, 0 dp
  zone?: Zone; // from pctPersonalBest vs plan thresholds
  acceptableBlows: number;
  totalBlows: number;
  /** False when no blow in the session was accepted (values shown as low confidence). */
  reliable: boolean;
  blows: SpirometryBlow[];
}

export interface SpirometrySummary {
  deviceName: string; // "MIR Spirobank Smart"
  personalBestPefLpm?: number;
  /** "action plan" when written on the plan, "observed" when computed from readings (max reliable PEF all-time). */
  personalBestSource?: 'action plan' | 'observed';
  greenThresholdPct: number; // default 80
  redThresholdPct: number; // default 50
  sessions: SpirometrySession[]; // window only, oldest → newest
  latest?: SpirometrySession; // most recent all-time (may be before window)
  sessionsInWindow: number;
  /** % of blows in window that were accepted. */
  qualityPct: number | null;
  fev1Trend?: Trend;
  pefTrend?: Trend;
  status: Status;
}

// ───────────────────────────────── Action plan ────────────────────────────────────

export interface ActionPlanSummary {
  /** Zone currently stored on the plan in the app. */
  currentZone?: Zone;
  currentZoneAsOf?: ISODateTime;
  expiresOn?: ISODate;
  expired: boolean;
  expiresInDays?: number;
  retestDueAt?: ISODateTime;
  /** Counts of DERIVED daily zones in window. */
  zoneDays: { green: number; yellow: number; red: number; unknown: number };
  /** How derived zones were computed (shown to clinicians). */
  method: string;
  status: Status;
}

// ───────────────────────────────── Engagement ─────────────────────────────────────

export interface EngagementSummary {
  /** Days with ≥1 non-blank tracker submission / days in window since enrollment × 100. */
  loggingPct: number;
  currentLoggingStreak: number;
  longestLoggingStreak: number;
  badges: { name: string; label: string; date: ISODate }[];
  status: Status;
}

// ───────────────────────────────── Data quality ───────────────────────────────────

export interface DataQualityNote {
  id: string;
  /** "info" = handled automatically, "warning" = clinician should know. */
  level: 'info' | 'warning';
  text: string;
}

// ───────────────────────────────── Root ───────────────────────────────────────────

export interface PatientSummary {
  /** Deterministic: `${today}T00:00:00.000Z`. */
  generatedAt: ISODateTime;
  /** The "today" the summary was computed for (patient-local). Use for overdue/expiry UI. */
  today: ISODate;
  patient: PatientHeader;
  window: AnalysisWindow;
  freshness: DataFreshness;
  /** Ordered most-important first; includes metrics for every assigned condition. */
  headline: HeadlineMetric[];
  /** Ordered high → low severity, then most recent. */
  flags: ClinicalFlag[];
  /** One entry per calendar day in the window, oldest → newest (always `window.days` long). */
  days: DaySummary[];
  trackers: TrackerSummary[];
  medications: MedicationSummary;
  spirometry?: SpirometrySummary;
  actionPlan?: ActionPlanSummary;
  engagement: EngagementSummary;
  dataQuality: DataQualityNote[];
  /** Plain-language summary sentences for visit mode ("This month you had 6 hard days…"). */
  patientFacing: {
    headline: string;
    /** Plain-language talking points, each keyed so the clinician can hide it in visit mode. */
    points: PatientFacingPoint[];
    /** goodDays + hardDays + noDataDays = days in window since enrollment (same split as the calendar). */
    goodDays: number;
    hardDays: number;
    noDataDays: number;
  };
}

/** Keys for visit-mode talking points (clinician can toggle each). */
export type PatientFacingPointKey =
  | 'medication' // scheduled medicine taken
  | 'rescue' // rescue inhaler use
  | 'abortive' // acute migraine medicine use
  | 'lungFunction' // breathing tests / peak flow
  | 'symptoms' // most common symptom
  | 'school' // missed school
  | 'checkins'; // check-in consistency

export interface PatientFacingPoint {
  key: PatientFacingPointKey;
  text: string;
}

/** Lightweight row for the patient list / triage table. */
export interface PatientListItem {
  id: string;
  displayName: string;
  initials: string;
  ageYears: number;
  mrn: string;
  trackers: TrackerRef[];
  studyIds: string[];
  lastActivityDate?: ISODate;
  daysSinceLastActivity?: number;
  freshnessStatus: Status;
  /** Derived zone of the most recent day with a zone basis, else plan zone. */
  currentZone?: Zone;
  /** Overall scheduled-med adherence over the last 30 days. */
  adherencePct30d: number | null;
  adherenceStatus: Status;
  symptomDays30d: number;
  highFlags: number;
  mediumFlags: number;
  /** Top flag title for the list view. */
  topFlag?: string;
  /** Higher = needs attention sooner. Used for default sort. */
  attentionScore: number;
}

/** Options accepted by buildPatientSummary. */
export interface SummaryOptions {
  /** Inclusive window end (patient-local). Defaults to `today`. */
  end?: ISODate;
  /** Window length in days, or 'all' for first activity → end. Default 30. */
  days?: number | 'all';
  /** "Today" for freshness computations. Defaults to the current local date. */
  today?: ISODate;
}
