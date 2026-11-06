/**
 * RAW STORAGE SCHEMA — CONTRACT (do not change without updating all modules)
 *
 * Mirrors the per-patient nested JSON document stored in Azure Cosmos DB (Mongo API),
 * as described in the SMART@Home hackathon brief §3 and Screenshot 1.
 *
 * The raw data is deliberately messy and every consumer must be defensive:
 *  - A tracker can be submitted many times per day, at irregular times.
 *  - Many fields are optional and often empty ("" / null / missing).
 *  - Tracker answer `value` is ALWAYS a string (number, JSON list, device ref…) and
 *    must be decoded according to the question type in the TrackerDefinition.
 *  - Question wording lives in the TrackerDefinition, not here.
 *  - Medication doses point at medications by long random UUIDs; the same drug can
 *    appear twice (one archived, one active).
 *
 * Timestamps:
 *  - `day` fields are the patient-local calendar date "YYYY-MM-DD".
 *  - Patient-generated timestamps (submittedAt, baselineReadingDate) are ISO-8601 with
 *    the patient's local UTC offset, e.g. "2026-06-24T09:31:12.120-04:00". The local
 *    calendar date is therefore always `ts.slice(0, 10)`.
 *  - Server-generated timestamps (badges, createdAt) are UTC ISO with "Z".
 */

export type ISODate = string; // "YYYY-MM-DD" (patient-local calendar date)
export type ISODateTime = string; // ISO-8601 with offset or Z
export type HHmm = string; // "20:21" (patient-local clock time)
export type UUID = string;

/** One patient = one document. */
export interface RawPatientDocument {
  id: UUID;
  /** Partition key in Cosmos. Same as id. */
  patientId: UUID;
  profile: RawPatientProfile;
  /** Trackers assigned to this patient (definitions live in TrackerDefinition). */
  trackers: RawTrackerAssignment[];
  /** Research studies the patient is enrolled in, e.g. "NCT06159127". */
  studyIds?: string[];
  dailyLogs: RawDailyLog[];
  medications: RawMedication[];
  reminders?: RawReminder[];
  medicalDevices?: RawMedicalDevice[];
  asthmaTreatmentPlan?: RawAsthmaTreatmentPlan | null;
  earnedMedicationBadges?: RawBadge[];
  earnedTrackerBadges?: RawBadge[];
  createdAt: ISODateTime;
  updatedAt?: ISODateTime;
}

export interface RawPatientProfile {
  firstName: string;
  lastName: string;
  dateOfBirth: ISODate;
  sex?: 'F' | 'M' | 'X';
  /** Synthetic MRN — never a real one. Format "DEMO-000123". */
  mrn: string;
  heightCm?: number;
  /** Free-text name of the responsible clinician / clinic. */
  careTeam?: string;
  weightKg?: number;
  city?: string;
  state?: string;
  postalCode?: string;
  /**
   * EHR background for this patient (problem list, prescriptions on file, allergies, last
   * clinic visit). In this demo it is seeded from Synthea-generated FHIR records; in
   * production it would come from Epic. Read-only context — SMART@Home never writes it.
   */
  ehr?: RawEhrContext | null;
}

export interface RawEhrContext {
  source: 'synthea' | 'manual';
  /** Synthea Patient.id, for traceability back to the generated FHIR bundle. */
  sourcePatientId?: string;
  problems: { display: string; snomed?: string; onsetDate?: ISODate; active: boolean }[];
  medicationsOnFile: { display: string; rxnorm?: string; status: 'active' | 'stopped' | string }[];
  allergies: string[];
  lastClinicVisit?: ISODate | null;
  /** Clinic encounters in the last 12 months. */
  visitsLast12Months?: number;
}

export interface RawTrackerAssignment {
  trackerId: string;
  assignedDate: ISODate;
  active: boolean;
}

/** One entry per calendar day that has ANY activity. Days with no activity are absent. */
export interface RawDailyLog {
  day: ISODate;
  /**
   * Ambiguous legacy flag. Observed TRUE for some years and FALSE for others even when
   * doses are recorded (Screenshot 1). Consumers must NOT rely on it.
   */
  allMedicationsAdministered?: boolean | null;
  trackerResponses?: RawTrackerResponse[];
  medicationAdministrations?: RawMedicationAdministration[];
}

/** One submission of one tracker. Several may exist on the same day. */
export interface RawTrackerResponse {
  id: UUID;
  trackerId: string;
  /** Local timestamp with offset. */
  submittedAt: ISODateTime;
  /** May be empty (patient opened and closed the tracker) or contain blank values. */
  responses?: RawQuestionResponse[];
  /** How the patient entered it. Missing = 'form' (all historical data). */
  entryMode?: 'form' | 'voice';
  /** Voice check-ins: what the patient said (speech-to-text), kept as evidence for the clinician. */
  transcript?: string | null;
  /** Photos/videos attached to this check-in (MediaItem ids). */
  mediaIds?: string[];
}

export interface RawQuestionResponse {
  questionId: string;
  /**
   * ALWAYS text (or null/""):
   *  yesNo        -> "true" | "false" | "Yes" | "No"   (both spellings occur)
   *  number       -> "3" | "2.5"
   *  scale1to10   -> "7"
   *  faceScale    -> option value, e.g. "Great"
   *  iconChoice   -> option value
   *  singleChoice -> option value
   *  checkbox     -> JSON array string, e.g. '["Coughing","Tight Chest"]'
   *                  (option values may carry stray whitespace, e.g. "None of these ")
   *  spirometry   -> "" (usually) or the baselineReadingDate of the linked blow
   *  text         -> free text
   */
  value: string | null;
}

/** A dose the patient marked as taken (self-report, not verified). */
export interface RawMedicationAdministration {
  /** UUID of the RawMedication this dose belongs to (may be an archived medication). */
  id: UUID;
  /** Local clock time the dose was marked taken. */
  time: HHmm;
  /** Denormalized medication name at time of recording. */
  name: string;
  /** Quantity taken. Usually 1 (number) but older records hold a string "1". */
  value: number | string | null;
}

export type RawHowOften = 'Daily' | 'As Needed' | 'Weekly';

export interface RawMedication {
  id: UUID;
  name: string;
  /** Display icon in the patient app: "Capsule" | "Inhaler" | "Tablet" | "Liquid" | "Injection". */
  icon?: string;
  howOften: RawHowOften;
  dosage?: {
    /** e.g. 2 (puffs), 1 (tablet) */
    quantity?: number | null;
    /** e.g. "puffs", "tablet", "mg" */
    unit?: string | null;
    timing?: {
      /** "Daily" | "Weekly" — the period the frequency applies to. */
      periodUnit?: 'Daily' | 'Weekly' | null;
      /** Times per period, e.g. 2 = twice daily. */
      frequency?: number | null;
      /** Scheduled reminder times, e.g. ["08:00","20:00"]. */
      timesOfDay?: HHmm[] | null;
    } | null;
  } | null;
  /** Free text condition label set by care team: "Asthma", "Migraine", "Crohn's disease"… */
  relatedCondition?: string | null;
  /** Tracker this medication is attached to, when known. */
  relatedTrackerId?: string | null;
  archived: boolean;
  /** Display order in the app. */
  index: number;
  startDate?: ISODate | null;
  archivedDate?: ISODate | null;
}

export interface RawReminder {
  id: UUID;
  kind: 'medication' | 'tracker';
  targetId: string;
  time: HHmm;
  /** 0 = Sunday … 6 = Saturday. Empty/missing = every day. */
  daysOfWeek?: number[];
  enabled: boolean;
}

/** A paired home spirometer (MIR Spirobank Smart). */
export interface RawMedicalDevice {
  protocol: number;
  /** Bluetooth address / UUID. Meaningless to clinicians. */
  address: string;
  bootId: string;
  serialNumber: string;
  deviceType: number;
  atsStandard: number;
  /** "Spirobank" */
  name: string;
  advertisementName: string;
  baselineReadingDate?: ISODateTime | null;
  /** Individual blows. Several blows make one session (same local day). */
  baselineReadings: RawBaselineReading[];
}

export interface RawBaselineReading {
  /** Local timestamp with offset of this blow. */
  baselineReadingDate: ISODateTime;
  /** Device acceptance flag for this blow. Can disagree with qualityReport.quality. */
  accepted: boolean;
  qualityReport?: {
    /** "Acceptable" | "Usable" | "NotAcceptable" — often "NotAcceptable" even when accepted=true. */
    quality?: string | null;
    /** Coaching messages in programmer form. One blow may have 0..n messages. */
    qualityIndications?: { messageInstructions: string }[] | null;
  } | null;
  /** Values come with 5–6 decimal places. */
  fvcPlusResults: RawFvcPlusResults;
}

export interface RawFvcPlusResults {
  /** Forced vital capacity, litres. */
  fvc: number;
  /** Forced expiratory volume in 1 s, litres. */
  fev1: number;
  /** FEV1/FVC × 100 (percent). */
  fev1FvcRatio: number;
  /** Peak expiratory flow, LITRES PER SECOND (clinicians use L/min = ×60). */
  pef: number;
  /** Forced expiratory flow 25–75 %, L/s. */
  fef2575?: number | null;
  /** FEV in 6 s, litres. */
  fev6?: number | null;
  /** Forced expiratory time, seconds. */
  fet?: number | null;
  /** Time to peak flow, ms. */
  pefTime?: number | null;
  /** Back-extrapolated volume, mL. */
  extrapolatedVolume?: number | null;
}

export type RawPlanZone = 'Green' | 'Yellow' | 'Red';

/** Only the CURRENT plan state is stored — there is no zone history. */
export interface RawAsthmaTreatmentPlan {
  status?: RawPlanZone | null;
  /** When `status` was last computed. */
  statusUpdatedAt?: ISODateTime | null;
  /** Date the written plan expires and must be renewed by the clinician. */
  expiration?: ISODate | null;
  /** When the app will ask the patient to retest (e.g. after rescue medication). */
  retestTime?: ISODateTime | null;
  /** Personal best peak flow written on the plan, L/min. Often missing. */
  personalBestPeakFlow?: number | null;
  /** Plan thresholds as % of personal best. Defaults 80 / 50 when missing. */
  greenThresholdPct?: number | null;
  redThresholdPct?: number | null;
}

export interface RawBadge {
  /** e.g. "TrackerBadge10", "MedicationStreak7" */
  badgeName: string;
  /** UTC ISO. */
  date: ISODateTime;
}
