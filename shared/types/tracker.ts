/**
 * TRACKER DEFINITIONS — CONTRACT
 *
 * A tracker is the set of questions (plus meds, reminders, devices) for one condition.
 * Question wording lives here, NOT in the patient document.
 *
 * Design addition proposed by this project: each question may carry an optional
 * `role` — a semantic tag the care team picks in the no-code tracker builder. Roles let
 * the clinician view compute condition-agnostic headline metrics ("symptom days",
 * "hard days", "missed school") for ANY tracker, while every question — tagged or not —
 * still gets a generic widget chosen by its `type`.
 */

export type QuestionType =
  | 'yesNo'
  | 'number'
  | 'faceScale'
  | 'iconChoice'
  | 'checkbox'
  | 'singleChoice'
  | 'scale1to10'
  | 'spirometry'
  | 'text';

export type QuestionRole =
  | 'overallFeeling' // faceScale / singleChoice: "How are you feeling today?"
  | 'symptoms' // checkbox list of current symptoms
  | 'symptomSeverity' // scale1to10 / number, higher is worse
  | 'spirometry' // prompt to blow into the device (value usually empty)
  | 'missedSchool' // yesNo: missed school / work today
  | 'nightWaking' // yesNo or number: woke at night due to symptoms
  | 'activityLimitation' // yesNo
  | 'rescueMedUse' // number: times rescue/abortive med used today (self-report in tracker)
  | 'painSeverity' // scale1to10, higher is worse
  | 'headache' // yesNo: had a headache today
  | 'headacheDurationHours' // number
  | 'stoolFrequency' // number per day
  | 'bloodInStool' // yesNo
  | 'triggers' // checkbox list of triggers
  | 'sleepHours' // number
  | 'other';

/** 0 = best/none, 1 = mild, 2 = moderate, 3 = severe. */
export type Severity = 0 | 1 | 2 | 3;

export interface QuestionOption {
  /** Exactly what is stored in RawQuestionResponse.value (may contain stray whitespace). */
  value: string;
  /** Human label for clinicians. */
  label: string;
  /** Clinical severity of choosing this option. Undefined = not severity-ordered. */
  severity?: Severity;
  /** True for "None of these" style options in a checkbox list. */
  isNone?: boolean;
  /** Emoji / icon hint for face scales and icon choices. */
  icon?: string;
}

export interface TrackerQuestion {
  id: string;
  /** Full question wording as shown to the patient. */
  text: string;
  /** Short clinician-facing label (≤ 24 chars), e.g. "Feeling", "Symptoms". */
  shortLabel: string;
  type: QuestionType;
  role?: QuestionRole;
  options?: QuestionOption[];
  min?: number;
  max?: number;
  unit?: string;
  /** For numeric/scale questions: which direction is clinically worse. Default 'higherIsWorse'. */
  direction?: 'higherIsWorse' | 'higherIsBetter';
  /** For numeric/scale questions: value at/above (or below for higherIsBetter) which a day is concerning. */
  concernThreshold?: number;
  /** Display order. */
  order: number;
}

export interface TrackerDefinition {
  id: string;
  name: string;
  /** Lower-case condition key: "asthma" | "migraine" | "ibd" | … */
  condition: string;
  /** Human condition label: "Asthma". */
  conditionLabel: string;
  version: number;
  questions: TrackerQuestion[];
}
