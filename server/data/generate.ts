/**
 * Deterministic SYNTHETIC patient generator for the SMART@Home clinician view demo.
 *
 * - Own seeded PRNG (mulberry32): same `{ today, seed }` ⇒ byte-identical output.
 * - Dates are generated RELATIVE to `today` so the default 30-day window always has data,
 *   except patient #1 (the "example account" replica of the brief's screenshots), whose
 *   dates are fixed and intentionally stale.
 * - Output deliberately mimics the messiness of the real Cosmos documents (see
 *   shared/types/raw.ts): repeated / blank submissions, mixed yes-no spellings, string
 *   dose values, archived duplicate medications, conflicting spirometer quality flags…
 *
 * CLI: `tsx server/data/generate.ts --write` writes server/data/generated/*.json
 * (today = env DEMO_TODAY or the real local date). Importing this module has no side effects.
 *
 * ALL NAMES, IDS AND VALUES ARE FICTIONAL.
 */
import { mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  RawAsthmaTreatmentPlan,
  RawBadge,
  RawBaselineReading,
  RawDailyLog,
  RawEhrContext,
  RawHowOften,
  RawMedicalDevice,
  RawMedication,
  RawPatientDocument,
  RawQuestionResponse,
  RawReminder,
  RawTrackerAssignment,
  RawTrackerResponse,
} from '../../shared/types/raw';
import { toAppMedication, type AppMedSpec } from './synthea/appMeds';
import { SYNTHEA, type SyntheaSeed } from './synthea/seeds';
import { Q, TRACKERS, TRACKER_IDS } from './trackers';

export const DEFAULT_SEED = 20260624;
export const PATIENT_COUNT = 10;

// ───────────────────────────────── PRNG ─────────────────────────────────

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  /** Inclusive integer range. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  normal(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  sample<T>(arr: readonly T[], k: number): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, Math.max(0, Math.min(k, copy.length)));
  }
  /** RFC 4122 v4-shaped UUID drawn from this stream. */
  uuid(): string {
    const b: number[] = [];
    for (let i = 0; i < 16; i++) b.push(Math.floor(this.next() * 256));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
}

function patientSeed(seed: number, index: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (index + 1) * 0x85ebca6b, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// ───────────────────────────────── Dates ─────────────────────────────────

const DAY_MS = 86_400_000;
const utcMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number): string =>
  new Date(utcMs(d) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (later: string, earlier: string) => Math.round((utcMs(later) - utcMs(earlier)) / DAY_MS);
const dayOfWeek = (d: string) => new Date(utcMs(d)).getUTCDay();
const isSchoolDay = (d: string) => {
  const w = dayOfWeek(d);
  const m = +d.slice(5, 7);
  return w >= 1 && w <= 5 && m !== 7; // crude: no school in July
};
/** US Eastern-ish offset: EDT Mar–Oct, EST otherwise (good enough for synthetic data). */
export const offsetFor = (d: string) => {
  const m = +d.slice(5, 7);
  return m >= 3 && m <= 10 ? '-04:00' : '-05:00';
};
const pad2 = (n: number) => String(n).padStart(2, '0');
const hhmm = (min: number) => {
  const m = Math.max(0, Math.min(1439, Math.round(min)));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
};
/** Local ISO timestamp with offset, e.g. 2026-06-24T09:31:12.120-04:00 */
export function localTs(day: string, minutes: number, sec: number, ms: number): string {
  return `${day}T${hhmm(minutes)}:${pad2(sec)}.${String(ms).padStart(3, '0')}${offsetFor(day)}`;
}
const toUtcIso = (ts: string) => new Date(ts).toISOString();
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const parseHm = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3, 5);

/** Events after this local time are not generated for "today" (the day is not over yet). */
const TODAY_CUTOFF_MIN = 11 * 60;

export function localDateString(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// ───────────────────────────────── Builder ─────────────────────────────────

type YesNoStyle = 'tf' | 'yn' | 'mixed';
type MedRef = Pick<RawMedication, 'id' | 'name'>;

class PatientBuilder {
  private readonly logs = new Map<string, RawDailyLog>();
  constructor(
    readonly rng: Rng,
    readonly today: string,
    private readonly yesNoStyle: YesNoStyle,
  ) {}

  private log(day: string): RawDailyLog {
    let l = this.logs.get(day);
    if (!l) {
      l = { day };
      this.logs.set(day, l);
    }
    return l;
  }

  allowed(day: string, minutes: number): boolean {
    return day !== this.today || minutes <= TODAY_CUTOFF_MIN;
  }

  ts(day: string, minutes: number): string {
    return localTs(day, minutes, this.rng.int(0, 59), this.rng.int(0, 999));
  }

  doseValue(): number | string | null {
    const r = this.rng.float();
    if (r < 0.07) return '1';
    if (r < 0.08) return null;
    return 1;
  }

  /** Record a dose; returns false when suppressed (later today). */
  dose(day: string, med: MedRef, minutes: number, value?: number | string | null): boolean {
    if (!this.allowed(day, minutes)) return false;
    const l = this.log(day);
    (l.medicationAdministrations ??= []).push({
      id: med.id,
      time: hhmm(minutes),
      name: med.name,
      value: value === undefined ? this.doseValue() : value,
    });
    return true;
  }

  /** Record a tracker submission. `responses` undefined ⇒ field omitted (opened and closed). */
  submit(day: string, trackerId: string, minutes: number, responses: RawQuestionResponse[] | undefined, exactTs?: string): string | undefined {
    if (!exactTs && !this.allowed(day, minutes)) return undefined;
    const submittedAt = exactTs ?? this.ts(day, minutes);
    const l = this.log(day);
    const r: RawTrackerResponse = { id: this.rng.uuid(), trackerId, submittedAt };
    if (responses !== undefined) r.responses = responses;
    (l.trackerResponses ??= []).push(r);
    return submittedAt;
  }

  /** "true"/"false" or "Yes"/"No" depending on patient style (both spellings occur). */
  yn(b: boolean): string {
    const style = this.yesNoStyle === 'mixed' ? (this.rng.chance(0.5) ? 'tf' : 'yn') : this.rng.chance(0.08) ? (this.yesNoStyle === 'tf' ? 'yn' : 'tf') : this.yesNoStyle;
    return style === 'tf' ? String(b) : b ? 'Yes' : 'No';
  }

  blankResponses(questionIds: string[]): RawQuestionResponse[] | undefined {
    const r = this.rng.float();
    if (r < 0.4) return [];
    if (r < 0.6) return undefined;
    if (r < 0.85) return questionIds.map((questionId) => ({ questionId, value: '' }));
    return questionIds.map((questionId) => ({ questionId, value: this.rng.chance(0.5) ? null : '' }));
  }

  /** Raw daily logs sorted ascending with an inconsistent allMedicationsAdministered flag. */
  build(): RawDailyLog[] {
    const days = [...this.logs.keys()].sort();
    return days.map((d) => {
      const l = this.logs.get(d)!;
      const r = this.rng.float();
      const out: RawDailyLog = { day: d };
      if (l.medicationAdministrations?.length) {
        if (r < 0.3) out.allMedicationsAdministered = true;
        else if (r < 0.72) out.allMedicationsAdministered = false;
        else if (r < 0.85) out.allMedicationsAdministered = null;
      } else if (r < 0.3) {
        out.allMedicationsAdministered = false;
      }
      if (l.trackerResponses) out.trackerResponses = l.trackerResponses;
      if (l.medicationAdministrations) out.medicationAdministrations = l.medicationAdministrations;
      return out;
    });
  }
}

// ───────────────────────────────── Medications ─────────────────────────────────

interface MedSpec {
  name: string;
  icon?: string;
  howOften: RawHowOften;
  quantity?: number;
  unit?: string;
  periodUnit?: 'Daily' | 'Weekly';
  frequency?: number;
  timesOfDay?: string[];
  relatedCondition?: string | null;
  relatedTrackerId?: string | null;
  archived?: boolean;
  index: number;
  startDate?: string | null;
  archivedDate?: string | null;
}

function makeMed(rng: Rng, s: MedSpec): RawMedication {
  const m: RawMedication = {
    id: rng.uuid(),
    name: s.name,
    howOften: s.howOften,
    archived: s.archived ?? false,
    index: s.index,
  };
  if (s.icon) m.icon = s.icon;
  if (s.quantity !== undefined || s.periodUnit) {
    m.dosage = {
      quantity: s.quantity ?? null,
      unit: s.unit ?? null,
      timing: s.periodUnit
        ? { periodUnit: s.periodUnit, frequency: s.frequency ?? null, timesOfDay: s.timesOfDay ?? null }
        : null,
    };
  } else if (rng.chance(0.5)) {
    m.dosage = null;
  }
  if (s.relatedCondition !== undefined) m.relatedCondition = s.relatedCondition;
  if (s.relatedTrackerId !== undefined) m.relatedTrackerId = s.relatedTrackerId;
  if (s.startDate !== undefined) m.startDate = s.startDate;
  if (s.archivedDate !== undefined) m.archivedDate = s.archivedDate;
  return m;
}

function makeReminders(rng: Rng, meds: RawMedication[], trackerIds: string[]): RawReminder[] {
  const out: RawReminder[] = [];
  for (const m of meds) {
    if (m.archived) continue;
    for (const t of m.dosage?.timing?.timesOfDay ?? []) {
      const r: RawReminder = { id: rng.uuid(), kind: 'medication', targetId: m.id, time: t, enabled: rng.chance(0.88) };
      if (m.howOften === 'Weekly') r.daysOfWeek = [5];
      out.push(r);
    }
  }
  for (const t of trackerIds) {
    const r: RawReminder = { id: rng.uuid(), kind: 'tracker', targetId: t, time: rng.pick(['18:30', '19:00', '19:30', '20:00']), enabled: true };
    if (rng.chance(0.4)) r.daysOfWeek = [0, 1, 2, 3, 4, 5, 6];
    else if (rng.chance(0.3)) r.daysOfWeek = [];
    out.push(r);
  }
  return out;
}

// ───────────────────────────────── Spirometry ─────────────────────────────────

interface LungBase {
  /** True personal-best peak flow, L/min. */
  pbLpm: number;
  /** FEV1 / FVC when well, litres. */
  fev1: number;
  fvc: number;
}

const COACHING = [
  'KeepGoingUntilCompletelyEmpty',
  'BlowOutLonger',
  'BlastOutImmediatelyWhenCompletelyFull',
  'BlowOutFaster',
  'DontHesitate',
  'AvoidCoughing',
];

/** Round to 5 or 6 decimals, like the device does. */
const dec = (rng: Rng, x: number) => Number(x.toFixed(rng.chance(0.5) ? 5 : 6));

function spiroSession(b: PatientBuilder, day: string, startMin: number, pctPB: number, base: LungBase): RawBaselineReading[] {
  const rng = b.rng;
  const pct = clamp(pctPB, 30, 110) / 100;
  const n = rng.int(3, 6);
  const out: RawBaselineReading[] = [];
  let sec = rng.int(0, 40);
  let minute = startMin;
  for (let i = 0; i < n; i++) {
    if (!b.allowed(day, minute)) break;
    const good = rng.chance(0.68);
    const effort = good ? 1 : rng.range(0.62, 0.85);
    const pefLps = (base.pbLpm / 60) * pct * effort * (1 + rng.normal(0, 0.03));
    const fev1 = base.fev1 * (1 - (1 - pct) * 0.85) * (good ? 1 : rng.range(0.78, 0.93)) * (1 + rng.normal(0, 0.02));
    let fvc = base.fvc * (1 - (1 - pct) * 0.3) * (good ? 1 : rng.range(0.8, 0.95)) * (1 + rng.normal(0, 0.02));
    if (fvc <= fev1) fvc = fev1 * rng.range(1.04, 1.12);
    const ratio = (fev1 / fvc) * 100;
    const accepted = good ? rng.chance(0.82) : rng.chance(0.2);
    let quality: string | null;
    const q = rng.float();
    if (accepted) quality = q < 0.5 ? 'Acceptable' : q < 0.75 ? 'Usable' : 'NotAcceptable';
    else quality = q < 0.78 ? 'NotAcceptable' : q < 0.93 ? 'Usable' : 'Acceptable';
    const msgs: string[] = good
      ? rng.chance(0.25)
        ? [rng.pick(COACHING)]
        : []
      : rng.sample(COACHING, rng.chance(0.3) ? 2 : 1);
    const reading: RawBaselineReading = {
      baselineReadingDate: localTs(day, minute, sec % 60, rng.int(0, 999)),
      accepted,
      fvcPlusResults: {
        fvc: dec(rng, fvc),
        fev1: dec(rng, fev1),
        fev1FvcRatio: dec(rng, ratio),
        pef: dec(rng, pefLps),
        fef2575: dec(rng, fev1 * Math.pow(ratio / 100, 2) * 1.3),
        fev6: rng.chance(0.85) ? dec(rng, fvc * rng.range(0.975, 0.995)) : null,
        fet: dec(rng, good ? rng.range(6, 10.5) : rng.range(1.8, 5.5)),
        pefTime: dec(rng, rng.range(good ? 45 : 90, good ? 140 : 260)),
        extrapolatedVolume: dec(rng, rng.range(40, good ? 140 : 260)),
      },
    };
    const qrRoll = rng.float();
    if (qrRoll < 0.03) {
      reading.qualityReport = null;
    } else if (qrRoll > 0.06) {
      reading.qualityReport = {
        quality,
        qualityIndications: msgs.length ? msgs.map((messageInstructions) => ({ messageInstructions })) : rng.chance(0.5) ? [] : null,
      };
    }
    out.push(reading);
    sec += rng.int(25, 95);
    minute += Math.floor(sec / 60);
    sec %= 60;
  }
  return out;
}

function makeDevice(rng: Rng, readings: RawBaselineReading[]): RawMedicalDevice {
  const serial = `Z1${rng.int(10000, 99999)}`;
  const sorted = [...readings].sort((a, b) => Date.parse(a.baselineReadingDate) - Date.parse(b.baselineReadingDate));
  return {
    protocol: 9,
    address: rng.uuid().toUpperCase(),
    bootId: 'SM',
    serialNumber: serial,
    deviceType: 0,
    atsStandard: 0,
    name: 'Spirobank',
    advertisementName: `SM-009-${serial}`,
    baselineReadingDate: sorted.length ? sorted[sorted.length - 1].baselineReadingDate : null,
    baselineReadings: sorted,
  };
}

function zoneFor(pct: number): 'Green' | 'Yellow' | 'Red' {
  return pct >= 80 ? 'Green' : pct >= 50 ? 'Yellow' : 'Red';
}

function makePlan(
  rng: Rng,
  o: { lastPct?: number; lastTs?: string; expiration: string; pbLpm?: number | null; retest?: boolean },
): RawAsthmaTreatmentPlan {
  const plan: RawAsthmaTreatmentPlan = {
    status: o.lastPct === undefined ? 'Green' : zoneFor(o.lastPct),
    statusUpdatedAt: o.lastTs ? toUtcIso(o.lastTs) : null,
    expiration: o.expiration,
    retestTime: o.retest && o.lastTs ? new Date(Date.parse(o.lastTs) + 20 * 60_000).toISOString() : null,
  };
  if (o.pbLpm != null) plan.personalBestPeakFlow = o.pbLpm;
  else if (o.pbLpm === null) plan.personalBestPeakFlow = null;
  if (rng.chance(0.6)) {
    plan.greenThresholdPct = 80;
    plan.redThresholdPct = 50;
  }
  return plan;
}

// ───────────────────────────────── Badges ─────────────────────────────────

function trackerBadges(logs: RawDailyLog[]): RawBadge[] {
  const out: RawBadge[] = [];
  const milestones = new Set([5, 10, 25, 50, 100]);
  let count = 0;
  for (const l of logs) {
    const subs = (l.trackerResponses ?? []).filter((r) => r.responses && r.responses.some((x) => x.value));
    if (!subs.length) continue;
    count++;
    if (milestones.has(count)) {
      out.push({ badgeName: `TrackerBadge${count}`, date: new Date(Date.parse(subs[0].submittedAt) + 1_237).toISOString() });
    }
  }
  return out;
}

function medicationBadges(logs: RawDailyLog[], medIds: string[], perDay: number): RawBadge[] {
  const out: RawBadge[] = [];
  const milestones = [7, 14, 30, 60];
  const earned = new Set<number>();
  let streak = 0;
  let prev: string | undefined;
  for (const l of logs) {
    const doses = (l.medicationAdministrations ?? []).filter((d) => medIds.includes(d.id));
    const full = doses.length >= perDay;
    if (full && prev && daysBetween(l.day, prev) === 1) streak++;
    else streak = full ? 1 : 0;
    prev = full ? l.day : undefined;
    if (full && milestones.includes(streak) && !earned.has(streak)) {
      earned.add(streak);
      const last = doses[doses.length - 1];
      out.push({
        badgeName: `MedicationStreak${streak}`,
        date: toUtcIso(localTs(l.day, parseHm(last.time), 2, 314)),
      });
    }
  }
  return out;
}

// ───────────────────────────────── Shared answer helpers ─────────────────────────────────

const ASTHMA_QIDS = Object.values(Q.asthma) as string[];
const MIGRAINE_QIDS = Object.values(Q.migraine) as string[];
const IBD_QIDS = Object.values(Q.ibd) as string[];

function feelingFromSev(rng: Rng, sev: number): string {
  const x = sev + rng.normal(0, 0.08);
  if (x < 0.15) return 'Great';
  if (x < 0.3) return 'Good';
  if (x < 0.48) return 'Okay';
  if (x < 0.72) return 'Bad';
  return 'Awful';
}

function asthmaSymptoms(rng: Rng, sev: number): string[] {
  const s: string[] = [];
  if (rng.chance(sev * 0.9 + 0.03)) s.push('Coughing');
  if (rng.chance(sev * 0.8)) s.push('Wheezing');
  if (rng.chance(sev * 0.6)) s.push('Tight Chest');
  if (rng.chance(sev * 0.7 - 0.05)) s.push('Shortness Of Breath');
  if (rng.chance(sev * 0.6 - 0.1)) s.push('Activity limitations');
  return s;
}

/** Checkbox "none" answer with the real-world whitespace / spelling variations. */
function noneAnswer(rng: Rng, noneValue: string): string {
  const r = rng.float();
  if (r < 0.75) return JSON.stringify([noneValue]);
  if (r < 0.9) return JSON.stringify([noneValue.trim()]);
  return '[]';
}

/** Randomly blank out some answers (but never the protected ones). */
function sprinkleBlanks(rng: Rng, rs: RawQuestionResponse[], protect: Set<string>, p = 0.06): RawQuestionResponse[] {
  const out: RawQuestionResponse[] = [];
  for (const r of rs) {
    if (!protect.has(r.questionId) && rng.chance(p)) {
      const k = rng.float();
      if (k < 0.4) continue; // missing entirely
      out.push({ questionId: r.questionId, value: k < 0.75 ? '' : null });
    } else out.push(r);
  }
  return out;
}

/**
 * Submit one day's tracker entry, possibly as several submissions within minutes:
 * blank opens, partial drafts and changed answers, with the "final" answer last
 * (and sometimes an extra blank re-open afterwards, as in Screenshot 2).
 */
function submitDay(
  b: PatientBuilder,
  day: string,
  trackerId: string,
  qids: string[],
  final: RawQuestionResponse[],
  draft: () => RawQuestionResponse[],
  multiProb: number,
  baseMin?: number,
): string | undefined {
  const rng = b.rng;
  let t = baseMin ?? (day === b.today ? rng.int(7 * 60, 10 * 60 + 20) : rng.chance(0.72) ? rng.int(16 * 60 + 30, 21 * 60 + 45) : rng.int(6 * 60 + 45, 12 * 60));
  if (rng.chance(multiProb)) {
    const drafts = rng.int(1, 3);
    for (let i = 0; i < drafts; i++) {
      const k = rng.float();
      const rs = k < 0.4 ? b.blankResponses(qids) : k < 0.75 ? draft() : final.slice(0, 2);
      b.submit(day, trackerId, t, rs);
      t += rng.int(1, 25);
    }
  }
  const ts = b.submit(day, trackerId, t, final);
  if (rng.chance(0.12)) b.submit(day, trackerId, t + rng.int(0, 9), b.blankResponses(qids));
  return ts;
}

// ───────────────────────────────── Asthma simulation ─────────────────────────────────

interface AsthmaDay {
  /** Latent severity 0 (well) … 1 (very unwell). */
  sev: number;
  pct?: number;
  feeling?: string;
  symptoms?: string[];
  forceSpiro?: boolean;
  forceLog?: boolean;
  noLog?: boolean;
  /** No activity at all this day. */
  skip?: boolean;
  missedSchool?: boolean;
  nightWaking?: boolean;
  rescueProb?: number;
}

interface AsthmaSim {
  start: string;
  end: string;
  day: (daysAgo: number, date: string) => AsthmaDay;
  adherence: (daysAgo: number) => number;
  logProb: (daysAgo: number) => number;
  blankDayProb?: (daysAgo: number) => number;
  multiProb: number;
  spiroGap: [number, number];
  base: LungBase;
  controller: (daysAgo: number) => MedRef;
  controllerTimes: number[];
  rescue: MedRef;
  /** Probability of a "spirometry check-in" the patient opens without blowing. */
  spiroAnswerProb?: number;
}

interface AsthmaResult {
  readings: RawBaselineReading[];
  lastPct?: number;
  lastSpiroTs?: string;
}

function simulateAsthma(b: PatientBuilder, p: AsthmaSim): AsthmaResult {
  const rng = b.rng;
  const readings: RawBaselineReading[] = [];
  let nextSpiro = p.start;
  let lastPct: number | undefined;
  let lastSpiroTs: string | undefined;
  for (let date = p.start; date <= p.end; date = addDays(date, 1)) {
    const daysAgo = daysBetween(b.today, date);
    const ds = p.day(daysAgo, date);
    if (ds.skip) continue;
    const sev = clamp(ds.sev + rng.normal(0, 0.05), 0, 1);

    // Controller doses (twice daily) with jitter.
    const adh = p.adherence(daysAgo);
    for (const t of p.controllerTimes) {
      if (rng.chance(adh)) b.dose(date, p.controller(daysAgo), t + rng.normal(0, 30));
    }

    // Rescue inhaler.
    const rp = ds.rescueProb ?? clamp(sev * 1.3 - 0.12, 0, 0.95);
    let rescueCount = 0;
    if (rng.chance(rp)) {
      const n = 1 + (rng.chance(sev * 0.7) ? 1 : 0) + (rng.chance(sev * 0.35) ? 1 : 0);
      const times = Array.from({ length: n }, () => rng.int(7 * 60, 22 * 60)).sort((a, c) => a - c);
      for (const t of times) if (b.dose(date, p.rescue, t)) rescueCount++;
    }

    // Spirometry session.
    let sessionTs: string | undefined;
    if (date >= nextSpiro || ds.forceSpiro) {
      const pct = ds.pct ?? 100 - sev * 55 + rng.normal(0, 4);
      const start = date === b.today ? rng.int(7 * 60, 9 * 60) : rng.chance(0.6) ? rng.int(16 * 60, 20 * 60 + 30) : rng.int(6 * 60 + 40, 9 * 60);
      const blows = spiroSession(b, date, start, pct, p.base);
      if (blows.length) {
        readings.push(...blows);
        nextSpiro = addDays(date, rng.int(p.spiroGap[0], p.spiroGap[1]));
        lastPct = pct;
        lastSpiroTs = blows[blows.length - 1].baselineReadingDate;
        sessionTs = blows[rng.int(0, blows.length - 1)].baselineReadingDate;
      }
    }

    // Tracker.
    const logs = ds.forceLog || (!ds.noLog && rng.chance(p.logProb(daysAgo)));
    if (!logs) continue;
    if (!ds.forceLog && p.blankDayProb && rng.chance(p.blankDayProb(daysAgo))) {
      const t = rng.int(17 * 60, 21 * 60);
      b.submit(date, TRACKER_IDS.asthma, t, b.blankResponses(ASTHMA_QIDS));
      if (rng.chance(0.4)) b.submit(date, TRACKER_IDS.asthma, t + rng.int(1, 6), b.blankResponses(ASTHMA_QIDS));
      continue;
    }
    const symptoms = ds.symptoms ?? asthmaSymptoms(rng, sev);
    const feeling = ds.feeling ?? feelingFromSev(rng, sev);
    const nightWaking = ds.nightWaking ?? (sev > 0.45 && rng.chance(sev * 0.8));
    const missed = ds.missedSchool ?? false;
    const triggers = symptoms.length
      ? JSON.stringify(rng.sample(['Exercise', 'Cold air', 'Pollen', 'Smoke', 'Pets', 'Illness/cold'], rng.int(1, 2)))
      : rng.chance(0.5)
        ? '["None"]'
        : '';
    const spiroAnswer = sessionTs && rng.chance(p.spiroAnswerProb ?? 0.3) ? sessionTs : '';
    const final: RawQuestionResponse[] = [
      { questionId: Q.asthma.spirometer, value: spiroAnswer },
      { questionId: Q.asthma.feeling, value: feeling },
      { questionId: Q.asthma.symptoms, value: symptoms.length ? JSON.stringify(symptoms) : noneAnswer(rng, 'None of these ') },
      { questionId: Q.asthma.nightWaking, value: b.yn(nightWaking) },
      { questionId: Q.asthma.missedSchool, value: b.yn(missed) },
      { questionId: Q.asthma.rescueUses, value: String(rescueCount) },
      { questionId: Q.asthma.triggers, value: triggers },
    ];
    const protect = new Set<string>([Q.asthma.spirometer]);
    if (ds.feeling || ds.symptoms) protect.add(Q.asthma.feeling).add(Q.asthma.symptoms);
    if (missed) protect.add(Q.asthma.missedSchool);
    if (nightWaking) protect.add(Q.asthma.nightWaking);
    if (rescueCount) protect.add(Q.asthma.rescueUses);
    const draft = () => [
      { questionId: Q.asthma.spirometer, value: '' },
      { questionId: Q.asthma.feeling, value: feelingFromSev(rng, clamp(sev + rng.pick([-0.4, 0.4]), 0, 1)) },
      { questionId: Q.asthma.symptoms, value: symptoms.length ? JSON.stringify(symptoms) : noneAnswer(rng, 'None of these ') },
    ];
    submitDay(b, date, TRACKER_IDS.asthma, ASTHMA_QIDS, sprinkleBlanks(rng, final, protect), draft, p.multiProb);
  }
  return { readings, lastPct, lastSpiroTs };
}

// ───────────────────────────────── Migraine simulation ─────────────────────────────────

interface MigraineSim {
  start: string;
  end: string;
  headachesPerMonth: [number, number];
  abortiveDaysPerMonth: [number, number];
  abortive: MedRef;
  preventive?: { med: MedRef; times: number[]; adherence: number };
  missedSchoolLast30: number;
  painRange: [number, number];
  logProb: number;
  multiProb: number;
}

function simulateMigraine(b: PatientBuilder, p: MigraineSim): void {
  const rng = b.rng;
  const headache = new Set<string>();
  const abortive = new Set<string>();
  const missed = new Set<string>();
  // Plan in 30-day blocks ending today so every "last 30 days" window has the intended counts.
  for (let blockEnd = b.today; blockEnd >= p.start; blockEnd = addDays(blockEnd, -30)) {
    const days: string[] = [];
    for (let i = 0; i < 30; i++) {
      const d = addDays(blockEnd, -i);
      if (d >= p.start && d <= p.end && d !== b.today) days.push(d);
    }
    const hd = rng.sample(days, rng.int(p.headachesPerMonth[0], p.headachesPerMonth[1]));
    hd.forEach((d) => headache.add(d));
    const treated = hd.filter(() => rng.chance(0.92));
    const nonHd = days.filter((d) => !headache.has(d));
    const target = rng.int(p.abortiveDaysPerMonth[0], p.abortiveDaysPerMonth[1]);
    const extra = rng.sample(nonHd, Math.max(0, target - treated.length));
    [...treated, ...extra].forEach((d) => abortive.add(d));
    if (blockEnd === b.today && p.missedSchoolLast30 > 0) {
      rng.sample(hd.filter(isSchoolDay), p.missedSchoolLast30).forEach((d) => missed.add(d));
    }
  }

  for (let date = p.start; date <= p.end; date = addDays(date, 1)) {
    const daysAgo = daysBetween(b.today, date);
    const isHd = headache.has(date);
    if (p.preventive) {
      for (const t of p.preventive.times) if (rng.chance(p.preventive.adherence)) b.dose(date, p.preventive.med, t + rng.normal(0, 25));
    }
    const onset = rng.int(9 * 60, 18 * 60);
    if (abortive.has(date)) {
      b.dose(date, p.abortive, onset + rng.int(10, 70));
      if (rng.chance(0.2)) b.dose(date, p.abortive, onset + rng.int(150, 260));
    }
    const forced = isHd || missed.has(date) || daysAgo === 1;
    if (!forced && !rng.chance(p.logProb)) continue;
    if (isHd && !missed.has(date) && rng.chance(0.06)) continue; // headache day the patient never logged
    const pain = rng.int(p.painRange[0], p.painRange[1]);
    const sleep = isHd ? rng.pick([4.5, 5, 5.5, 6, 6, 6.5]) : rng.pick([7, 7.5, 8, 8, 8.5, 9, 9.5]);
    const feeling = isHd ? (pain >= 8 ? 'Awful' : pain >= 6 ? 'Bad' : 'Okay') : rng.pick(['Great', 'Good', 'Good', 'Okay']);
    const final: RawQuestionResponse[] = isHd
      ? [
          { questionId: Q.migraine.headache, value: b.yn(true) },
          { questionId: Q.migraine.pain, value: String(pain) },
          { questionId: Q.migraine.duration, value: String(rng.pick([2, 3, 4, 5, 6, 8, 10, 12, 1.5, 2.5])) },
          { questionId: Q.migraine.missedSchool, value: b.yn(missed.has(date)) },
          {
            questionId: Q.migraine.triggers,
            value: JSON.stringify(rng.sample(['Stress', 'Poor sleep', 'Skipped meal', 'Screen time', 'Bright light', 'Weather change', 'Dehydration'], rng.int(1, 3))),
          },
          { questionId: Q.migraine.sleep, value: String(sleep) },
          { questionId: Q.migraine.feeling, value: feeling },
        ]
      : [
          { questionId: Q.migraine.headache, value: b.yn(false) },
          ...(rng.chance(0.5) ? [{ questionId: Q.migraine.pain, value: '' }] : []),
          ...(rng.chance(0.3) ? [{ questionId: Q.migraine.duration, value: rng.chance(0.5) ? '0' : '' }] : []),
          { questionId: Q.migraine.missedSchool, value: b.yn(false) },
          ...(rng.chance(0.4) ? [{ questionId: Q.migraine.triggers, value: noneAnswer(rng, 'None of these') }] : []),
          { questionId: Q.migraine.sleep, value: String(sleep) },
          { questionId: Q.migraine.feeling, value: feeling },
        ];
    const protect = new Set<string>([Q.migraine.headache]);
    if (isHd) protect.add(Q.migraine.pain).add(Q.migraine.missedSchool);
    const draft = () => [
      { questionId: Q.migraine.headache, value: b.yn(isHd) },
      { questionId: Q.migraine.pain, value: isHd ? String(clamp(pain + rng.pick([-2, -1, 1, 2]), 1, 10)) : '' },
    ];
    const base = isHd && date !== b.today ? clamp(onset + rng.int(120, 600), 0, 23 * 60) : undefined;
    submitDay(b, date, TRACKER_IDS.migraine, MIGRAINE_QIDS, sprinkleBlanks(rng, final, protect, 0.05), draft, p.multiProb, base);
  }
}

// ───────────────────────────────── IBD simulation ─────────────────────────────────

interface IbdSim {
  start: string;
  end: string;
  flareDays: number;
  maintenance: { med: MedRef; times: number[]; adherence: number };
  weekly: { med: MedRef; adherence: number };
  logProb: number;
  multiProb: number;
}

function simulateIbd(b: PatientBuilder, p: IbdSim): void {
  const rng = b.rng;
  const flare: string[] = [];
  for (let i = 1; i <= p.flareDays; i++) flare.push(addDays(b.today, -i));
  const flareSet = new Set(flare);
  const blood = new Set(rng.sample(flare.slice(0, p.flareDays - 2), 4));
  const missed = new Set(rng.sample(flare.filter(isSchoolDay).slice(0, 7), 2));
  for (let date = p.start; date <= p.end; date = addDays(date, 1)) {
    const daysAgo = daysBetween(b.today, date);
    const inFlare = flareSet.has(date) || (date === b.today && p.flareDays > 0);
    for (const t of p.maintenance.times) {
      if (rng.chance(p.maintenance.adherence * (inFlare ? 0.95 : 1))) b.dose(date, p.maintenance.med, t + rng.normal(0, 35));
    }
    const w = dayOfWeek(date);
    if (w === 5 && rng.chance(p.weekly.adherence)) b.dose(date, p.weekly.med, rng.int(17 * 60, 20 * 60));
    else if (w === 6 && rng.chance(0.3)) b.dose(date, p.weekly.med, rng.int(10 * 60, 13 * 60)); // late weekly dose
    const forced = inFlare || daysAgo === 1;
    if (!forced && !rng.chance(p.logProb)) continue;
    // Small mid-history wobble so the chart is not flat.
    const wobble = daysAgo > 40 && daysAgo < 47 ? 1 : 0;
    const stools = inFlare ? rng.int(5, 8) : clamp(Math.round(rng.normal(2.5, 0.6)) + wobble, 2, 5);
    const pain = inFlare ? rng.int(6, 8) : clamp(rng.int(1, 3) + wobble, 1, 5);
    const symptoms = inFlare
      ? rng.sample(['Cramping', 'Urgency', 'Nausea', 'Fatigue', 'Joint pain'], rng.int(2, 4))
      : rng.chance(0.25)
        ? rng.sample(['Fatigue', 'Cramping', 'Joint pain'], 1)
        : [];
    const feeling = inFlare ? (pain >= 8 ? 'Stormy' : rng.pick(['Cloudy', 'Stormy', 'Cloudy'])) : rng.pick(['Sunny', 'Sunny', 'Partly cloudy']);
    const final: RawQuestionResponse[] = [
      { questionId: Q.ibd.stools, value: String(stools) },
      { questionId: Q.ibd.blood, value: b.yn(blood.has(date)) },
      { questionId: Q.ibd.pain, value: String(pain) },
      { questionId: Q.ibd.symptoms, value: symptoms.length ? JSON.stringify(symptoms) : noneAnswer(rng, 'None of these') },
      { questionId: Q.ibd.missedSchool, value: b.yn(missed.has(date)) },
      { questionId: Q.ibd.feeling, value: feeling },
    ];
    const protect = new Set<string>([Q.ibd.stools]);
    if (inFlare) protect.add(Q.ibd.blood).add(Q.ibd.pain).add(Q.ibd.missedSchool);
    const draft = () => [
      { questionId: Q.ibd.stools, value: String(Math.max(0, stools - rng.int(1, 2))) },
      { questionId: Q.ibd.blood, value: '' },
    ];
    submitDay(b, date, TRACKER_IDS.ibd, IBD_QIDS, sprinkleBlanks(rng, final, protect, 0.05), draft, p.multiProb);
  }
}

// ───────────────────────────────── Patient shell ─────────────────────────────────

interface ShellSpec {
  index: number;
  /** Fallbacks used only when no Synthea seed is given (patient #1). */
  first?: string;
  last?: string;
  sex?: 'F' | 'M' | 'X';
  age?: number;
  heightCm?: number;
  careTeam?: string;
  trackers: RawTrackerAssignment[];
  studyIds?: string[];
  createdAt: string;
}

/** Days to shift Synthea dates so they stay relative to `today` (ages are preserved). */
const syntheaShift = (today: string) => daysBetween(today, SYNTHEA.referenceDate);
const shiftDate = (d: string | null | undefined, delta: number) => (d ? addDays(d, delta) : d);

function ehrFromSeed(
  seed: SyntheaSeed,
  today: string,
  extra?: { problems?: RawEhrContext['problems']; meds?: RawEhrContext['medicationsOnFile'] },
): RawEhrContext {
  const delta = syntheaShift(today);
  return {
    source: 'synthea',
    sourcePatientId: seed.id,
    problems: [
      ...(extra?.problems ?? []),
      ...seed.problems.map((p) => ({ ...p, onsetDate: shiftDate(p.onsetDate, delta) ?? undefined })),
    ],
    medicationsOnFile: [...(extra?.meds ?? []), ...seed.meds.map((m) => ({ ...m }))],
    allergies: [...seed.allergies],
    lastClinicVisit: shiftDate(seed.lastClinicVisit, delta) ?? null,
    visitsLast12Months: seed.visitsLast12Months ?? 0,
  };
}

function shell(rng: Rng, today: string, s: ShellSpec, seed?: SyntheaSeed, ehr?: RawEhrContext): RawPatientDocument {
  const id = rng.uuid();
  const y = +today.slice(0, 4) - (s.age ?? 15);
  const fallbackDob = addDays(`${y}-${today.slice(5, 7)}-01`, -rng.int(20, 330));
  const doc: RawPatientDocument = {
    id,
    patientId: id,
    profile: {
      firstName: seed?.firstName ?? s.first ?? 'Demo',
      lastName: seed?.lastName ?? s.last ?? 'Patient',
      dateOfBirth: seed ? addDays(seed.birthDate, syntheaShift(today)) : fallbackDob,
      sex: seed?.sex ?? s.sex,
      mrn: `DEMO-${String(s.index).padStart(4, '0')}`,
    },
    trackers: s.trackers,
    dailyLogs: [],
    medications: [],
    createdAt: s.createdAt,
  };
  const height = seed?.heightCm ?? s.heightCm;
  if (height) doc.profile.heightCm = height;
  if (seed?.weightKg) doc.profile.weightKg = seed.weightKg;
  if (s.careTeam) doc.profile.careTeam = s.careTeam;
  if (seed?.city) doc.profile.city = seed.city;
  if (seed?.state) doc.profile.state = seed.state;
  if (seed?.postalCode) doc.profile.postalCode = seed.postalCode;
  if (seed) doc.profile.ehr = ehr ?? ehrFromSeed(seed, today);
  if (s.studyIds) doc.studyIds = s.studyIds;
  return doc;
}

function lastActivityTs(doc: RawPatientDocument): string | undefined {
  let best: string | undefined;
  let bestMs = -Infinity;
  const consider = (ts: string) => {
    const ms = Date.parse(ts);
    if (ms > bestMs) {
      bestMs = ms;
      best = ts;
    }
  };
  for (const l of doc.dailyLogs) {
    for (const r of l.trackerResponses ?? []) consider(r.submittedAt);
    for (const m of l.medicationAdministrations ?? []) consider(localTs(l.day, parseHm(m.time), 0, 0));
  }
  for (const d of doc.medicalDevices ?? []) for (const r of d.baselineReadings) consider(r.baselineReadingDate);
  return best;
}

function finish(doc: RawPatientDocument, b: PatientBuilder, extras?: { scheduledMedIds?: string[]; perDay?: number }): RawPatientDocument {
  doc.dailyLogs = b.build();
  const tb = trackerBadges(doc.dailyLogs);
  if (tb.length) doc.earnedTrackerBadges = tb;
  if (extras?.scheduledMedIds) {
    const mb = medicationBadges(doc.dailyLogs, extras.scheduledMedIds, extras.perDay ?? 1);
    if (mb.length) doc.earnedMedicationBadges = mb;
  }
  const last = lastActivityTs(doc);
  if (last) doc.updatedAt = toUtcIso(last);
  return doc;
}

const ASTHMA_TEAM = 'Pulmonary Medicine – Adolescent Asthma Clinic';
const NEURO_TEAM = 'Neurology – Pediatric Headache Center';
const GI_TEAM = 'Gastroenterology – Schubert-Martin IBD Center';
const STUDY = ['NCT06159127'];

// ───────────────────────────────── Synthea seeds → asthma meds & lungs ─────────────────────────────────

interface SeedAsthmaRx {
  controller: AppMedSpec;
  rescue: AppMedSpec;
}

/** The seed's controller + rescue prescriptions mapped to app meds (active preferred). */
export function seedAsthmaRx(seed: SyntheaSeed): SeedAsthmaRx | null {
  const ordered = [...seed.meds.filter((m) => m.status === 'active'), ...seed.meds.filter((m) => m.status !== 'active')];
  const mapped = ordered.map((m) => toAppMedication(m.display, m.rxnorm)).filter((x): x is AppMedSpec => !!x);
  const controller = mapped.find((m) => m.role === 'controller');
  const rescue = mapped.find((m) => m.role === 'rescue');
  return controller && rescue ? { controller, rescue } : null;
}

function medFromSpec(rng: Rng, spec: AppMedSpec, extra: Partial<MedSpec> & { index: number }): RawMedication {
  return makeMed(rng, {
    name: spec.name,
    icon: spec.icon,
    howOften: spec.howOften,
    quantity: spec.quantity,
    unit: spec.unit,
    periodUnit: spec.frequency ? 'Daily' : undefined,
    frequency: spec.frequency,
    timesOfDay: spec.timesOfDay,
    relatedCondition: 'Asthma',
    ...extra,
  });
}

interface AsthmaMeds {
  controller: RawMedication;
  rescue: RawMedication;
}

function asthmaMeds(rng: Rng, seed: SyntheaSeed, startDate: string): AsthmaMeds {
  const rx = seedAsthmaRx(seed)!;
  const controller = medFromSpec(rng, rx.controller, { relatedTrackerId: TRACKER_IDS.asthma, index: 0, startDate });
  const rescue = medFromSpec(rng, rx.rescue, {
    relatedTrackerId: rng.chance(0.5) ? TRACKER_IDS.asthma : null,
    index: 1,
    startDate: rng.chance(0.6) ? startDate : undefined,
  });
  return { controller, rescue };
}

/**
 * Lung function scaled to the seed's height. Personal-best PEF ≈ 5.3 × height(cm) − 460 L/min
 * (adolescent approximation); FEV1 from a simple height regression, FEV1/FVC ≈ 0.855.
 */
function lungFromHeight(heightCm: number | undefined): LungBase {
  const h = heightCm ?? 160;
  const pbLpm = clamp(Math.round(5.3 * h - 460), 230, 540);
  const fev1 = clamp(0.0445 * h - 3.85, 2.2, 3.9);
  return { pbLpm, fev1: Number(fev1.toFixed(2)), fvc: Number((fev1 / 0.855).toFixed(2)) };
}
const planPb = (base: LungBase) => Math.round(base.pbLpm / 10) * 10;

// ───────────────────────────────── Patients ─────────────────────────────────

/** #1 — replica of the brief's "example account" (Screenshots 1 & 2). Fixed historical dates. */
function examplePatient(rng: Rng, today: string): RawPatientDocument {
  const doc = shell(rng, today, {
    index: 1,
    first: 'Casey',
    last: 'Example',
    sex: 'X',
    age: 15,
    careTeam: 'SMART@Home demo team',
    trackers: [
      { trackerId: TRACKER_IDS.asthma, assignedDate: '2025-02-10', active: true },
      { trackerId: TRACKER_IDS.migraine, assignedDate: '2025-03-20', active: true },
    ],
    createdAt: '2025-02-10T15:02:11.481Z',
  });
  const dulera: RawMedication = {
    id: '4aec1b37-c83a-412a-a4f6-f3d8332c740f',
    name: 'Dulera 200',
    icon: 'Capsule',
    howOften: 'Daily',
    dosage: { quantity: 1, unit: null, timing: { periodUnit: 'Daily', frequency: 1, timesOfDay: null } },
    relatedCondition: 'Asthma',
    relatedTrackerId: TRACKER_IDS.asthma,
    archived: false,
    index: 2,
  };
  const excedrinOld: RawMedication = {
    id: '1027ba72-fe17-432d-9904-e72a721d8c2f',
    name: 'Excedrin',
    icon: 'Capsule',
    howOften: 'As Needed',
    relatedCondition: null,
    archived: true,
    index: 0,
    archivedDate: '2025-06-02',
  };
  const excedrin: RawMedication = {
    id: 'aecc069e-60a2-413d-b596-25054e662cbb',
    name: 'Excedrin',
    icon: 'Capsule',
    howOften: 'As Needed',
    relatedCondition: 'Migraine',
    relatedTrackerId: TRACKER_IDS.migraine,
    archived: false,
    index: 1,
  };
  doc.medications = [dulera, excedrinOld, excedrin];

  const logs = new Map<string, RawDailyLog>();
  const log = (day: string, flag: boolean): RawDailyLog => {
    let l = logs.get(day);
    if (!l) logs.set(day, (l = { day, allMedicationsAdministered: flag }));
    return l;
  };
  const dose = (day: string, flag: boolean, med: RawMedication, time: string) =>
    (log(day, flag).medicationAdministrations ??= []).push({ id: med.id, time, name: med.name, value: 1 });

  // Screenshot 1 — medication administrations (order as shown).
  dose('2025-03-28', true, excedrinOld, '20:21');
  dose('2025-03-28', true, excedrinOld, '19:21');
  dose('2025-03-28', true, excedrinOld, '20:21');
  dose('2026-03-11', false, dulera, '12:47');
  dose('2026-05-05', false, excedrin, '19:51');
  dose('2026-05-05', false, dulera, '19:51');
  dose('2026-06-24', false, dulera, '09:31');
  dose('2026-06-24', false, excedrin, '09:31');

  // Screenshot 2 — asthma tracker submissions. 12-h clock → minutes.
  const sub = (day: string, clock: string, feeling?: string, symptoms?: string[], blankKind: 'empty' | 'omit' | 'blankValues' = 'empty') => {
    const [hm, ampm] = clock.split(' ');
    let h = +hm.slice(0, 2) % 12;
    if (ampm === 'PM') h += 12;
    const minutes = h * 60 + +hm.slice(3, 5);
    const submittedAt = localTs(day, minutes, rng.int(0, 59), rng.int(0, 999));
    let responses: RawQuestionResponse[] | undefined;
    if (feeling || symptoms) {
      responses = [{ questionId: Q.asthma.spirometer, value: '' }];
      if (feeling) responses.push({ questionId: Q.asthma.feeling, value: feeling });
      if (symptoms) responses.push({ questionId: Q.asthma.symptoms, value: JSON.stringify(symptoms) });
    } else if (blankKind === 'empty') responses = [];
    else if (blankKind === 'blankValues')
      responses = [
        { questionId: Q.asthma.spirometer, value: '' },
        { questionId: Q.asthma.feeling, value: '' },
        { questionId: Q.asthma.symptoms, value: null },
      ];
    let l = logs.get(day);
    if (!l) logs.set(day, (l = { day }));
    const r: RawTrackerResponse = { id: rng.uuid(), trackerId: TRACKER_IDS.asthma, submittedAt };
    if (responses !== undefined) r.responses = responses;
    (l.trackerResponses ??= []).push(r);
  };

  // 11 earlier tracker days (below the visible part of the grid) → 18 total days tracked.
  sub('2025-02-14', '04:12 PM', 'Good', ['None of these ']);
  sub('2025-02-17', '07:48 PM', 'Okay', ['Coughing']);
  sub('2025-02-20', '08:05 PM', 'Great', ['None of these ']);
  sub('2025-02-24', '06:31 PM', 'Bad', ['Coughing', 'Wheezing']);
  sub('2025-02-24', '06:33 PM');
  sub('2025-02-27', '09:14 PM', 'Okay', ['Coughing', 'Tight Chest']);
  sub('2025-03-03', '05:22 PM', 'Good', ['None of these ']);
  sub('2025-03-07', '04:57 PM', undefined, undefined, 'blankValues');
  sub('2025-03-07', '05:01 PM', 'Great', []);
  sub('2025-03-12', '07:10 PM', 'Okay', ['Wheezing']);
  sub('2025-03-18', '08:44 PM', 'Good', ['None of these ']);
  sub('2025-03-24', '03:38 PM', 'Bad', ['Wheezing', 'Shortness Of Breath']);
  sub('2025-03-28', '06:59 PM', 'Okay', ['Coughing']);
  // Visible rows of Screenshot 2 (oldest → newest).
  sub('2025-04-03', '09:35 AM', 'Bad', ['Wheezing']);
  sub('2025-04-28', '01:29 PM', 'Great', ['Wheezing', 'Shortness Of Breath']);
  sub('2025-04-28', '01:50 PM', 'Bad', ['Wheezing', 'Shortness Of Breath']);
  sub('2025-04-28', '01:51 PM');
  sub('2025-04-28', '01:53 PM', undefined, undefined, 'omit');
  sub('2025-04-28', '01:54 PM', 'Great', ['Coughing', 'Wheezing']);
  sub('2025-04-28', '01:55 PM', 'Great', ['Coughing', 'Wheezing']);
  sub('2025-04-28', '02:25 PM');
  sub('2025-06-25', '01:21 PM', 'Bad', ['Tight Chest', 'Activity limitations']);
  sub('2025-06-25', '01:23 PM');
  sub('2025-06-25', '01:31 PM', undefined, undefined, 'blankValues');
  sub('2025-06-25', '02:31 PM');
  sub('2025-06-27', '11:11 AM', 'Bad', ['Wheezing', 'Tight Chest']);
  sub('2026-02-27', '08:39 AM', 'Great');
  sub('2026-03-11', '12:48 PM', 'Great', ['None of these ']);
  sub('2026-05-05', '01:44 PM', 'Great', ['Coughing', 'Tight Chest']);
  sub('2026-05-05', '01:52 PM');
  sub('2026-05-05', '01:52 PM', undefined, undefined, 'omit');

  // A couple of migraine check-ins on Excedrin days.
  const mig = (day: string, minutes: number, rs: RawQuestionResponse[]) =>
    (logs.get(day)!.trackerResponses ??= []).push({ id: rng.uuid(), trackerId: TRACKER_IDS.migraine, submittedAt: localTs(day, minutes, rng.int(0, 59), rng.int(0, 999)), responses: rs });
  mig('2025-03-28', 19 * 60 + 5, [
    { questionId: Q.migraine.headache, value: 'Yes' },
    { questionId: Q.migraine.pain, value: '7' },
    { questionId: Q.migraine.duration, value: '3' },
    { questionId: Q.migraine.missedSchool, value: 'No' },
    { questionId: Q.migraine.triggers, value: '["Stress","Screen time"]' },
    { questionId: Q.migraine.sleep, value: '6' },
    { questionId: Q.migraine.feeling, value: 'Bad' },
  ]);
  mig('2026-05-05', 19 * 60 + 47, [
    { questionId: Q.migraine.headache, value: 'true' },
    { questionId: Q.migraine.pain, value: '5' },
    { questionId: Q.migraine.duration, value: '' },
    { questionId: Q.migraine.missedSchool, value: 'false' },
    { questionId: Q.migraine.feeling, value: 'Okay' },
  ]);

  doc.dailyLogs = [...logs.values()].sort((a, c) => (a.day < c.day ? -1 : 1));
  for (const l of doc.dailyLogs) l.trackerResponses?.sort((a, c) => Date.parse(a.submittedAt) - Date.parse(c.submittedAt));

  // Screenshot 1 — the paired spirometer and its six blows on 2026-06-24.
  const blow = (time: string, accepted: boolean, v: [number, number, number, number, number, number], msgs: string[]): RawBaselineReading => ({
    baselineReadingDate: `2026-06-24T${time}-04:00`,
    accepted,
    qualityReport: { quality: 'NotAcceptable', qualityIndications: msgs.map((messageInstructions) => ({ messageInstructions })) },
    fvcPlusResults: {
      fev1: v[0],
      fvc: v[1],
      fev1FvcRatio: Number(((v[0] / v[1]) * 100).toFixed(5)),
      pef: v[2],
      fef2575: v[3],
      fev6: 5.376757,
      fet: 9.544466,
      pefTime: v[4],
      extrapolatedVolume: v[5],
    },
  });
  const K = 'KeepGoingUntilCompletelyEmpty';
  const readings = [
    blow('09:22:05.118', false, [2.000187, 5.390214, 2.230461, 1.370825, 23.36432, 100.2463], [K]),
    blow('09:23:12.540', true, [1.190042, 5.450391, 1.550218, 0.760493, 16.23978, 101.3622], [K]),
    blow('09:24:31.902', false, [1.720516, 5.480127, 2.150374, 0.890261, 22.52614, 101.9202], ['BlowOutLonger', 'BlastOutImmediatelyWhenCompletelyFull']),
    blow('09:25:44.077', true, [1.820233, 5.560482, 2.600159, 0.980317, 27.24091, 103.4081], [K]),
    blow('09:27:02.661', false, [4.580126, 4.930275, 9.780443, 6.860172, 102.4678, 91.69095], [K]),
    blow('09:28:15.402', true, [4.530388, 4.960117, 10.860221, 6.590046, 113.7832, 92.24891], [K]),
  ];
  doc.medicalDevices = [
    {
      protocol: 9,
      address: 'AAF17BF4-FB64-B5AB-D7C6-27344E9A81FA',
      bootId: 'SM',
      serialNumber: 'Z125775',
      deviceType: 0,
      atsStandard: 0,
      name: 'Spirobank',
      advertisementName: 'SM-009-Z125775',
      baselineReadingDate: '2026-06-24T09:28:15.402-04:00',
      baselineReadings: readings,
    },
  ];
  doc.asthmaTreatmentPlan = {
    status: 'Green',
    statusUpdatedAt: '2026-06-24T13:29:01.220Z',
    expiration: '2026-09-30',
    retestTime: null,
  };
  doc.earnedTrackerBadges = [
    { badgeName: 'TrackerBadge10', date: '2026-03-11T16:48:59.546Z' },
    { badgeName: 'TrackerBadge5', date: '2025-05-01T00:16:23.561Z' },
  ];
  doc.reminders = [{ id: rng.uuid(), kind: 'tracker', targetId: TRACKER_IDS.asthma, time: '13:30', enabled: false }];
  doc.updatedAt = '2026-06-24T13:31:44.010Z';
  return doc;
}

/** Common setup for relative-dated asthma patients. */
function asthmaPatient(
  rng: Rng,
  today: string,
  spec: Omit<ShellSpec, 'trackers' | 'createdAt'> & { historyDays: number; seed: SyntheaSeed; yesNo: YesNoStyle },
) {
  const start = addDays(today, -spec.historyDays);
  const doc = shell(rng, today, {
    ...spec,
    trackers: [{ trackerId: TRACKER_IDS.asthma, assignedDate: start, active: true }],
    createdAt: toUtcIso(localTs(start, rng.int(9 * 60, 16 * 60), rng.int(0, 59), rng.int(0, 999))),
  }, spec.seed);
  const meds = asthmaMeds(rng, spec.seed, start);
  doc.medications = [meds.controller, meds.rescue];
  const b = new PatientBuilder(rng, today, spec.yesNo);
  const base = lungFromHeight(doc.profile.heightCm);
  return { doc, meds, b, start, base };
}

/** #2 — well-controlled asthma. */
function wellControlled(rng: Rng, today: string, seed?: SyntheaSeed): RawPatientDocument {
  const { doc, meds, b, start, base } = asthmaPatient(rng, today, {
    index: 2, careTeam: ASTHMA_TEAM, studyIds: STUDY,
    historyDays: 120, seed: seed!, yesNo: 'tf',
  });
  const res = simulateAsthma(b, {
    start, end: today, base,
    day: (a) => ({ sev: a > 70 && a < 76 ? 0.3 : 0.05, pct: a > 70 && a < 76 ? undefined : 95 + rng.normal(0, 3), forceLog: a === 1 }),
    adherence: () => 0.95,
    logProb: () => 0.88,
    multiProb: 0.15,
    spiroGap: [1, 3],
    controller: () => meds.controller,
    controllerTimes: [7 * 60 + 30, 20 * 60],
    rescue: meds.rescue,
  });
  doc.medicalDevices = [makeDevice(rng, res.readings)];
  doc.asthmaTreatmentPlan = makePlan(rng, { lastPct: res.lastPct, lastTs: res.lastSpiroTs, expiration: addDays(today, 190), pbLpm: planPb(base) });
  doc.reminders = makeReminders(rng, doc.medications, [TRACKER_IDS.asthma]);
  return finish(doc, b, { scheduledMedIds: [meds.controller.id], perDay: 2 });
}

/** #3 — not taking the controller: falling adherence, rising rescue use, yellow/red days. */
function notTakingController(rng: Rng, today: string, seed?: SyntheaSeed): RawPatientDocument {
  const { doc, meds, b, start, base } = asthmaPatient(rng, today, {
    index: 3, careTeam: ASTHMA_TEAM, studyIds: STUDY,
    historyDays: 120, seed: seed!, yesNo: 'yn',
  });
  let red1 = 3;
  while (!isSchoolDay(addDays(today, -red1))) red1++;
  const red2 = red1 + 6;
  const res = simulateAsthma(b, {
    start, end: today, base,
    day: (a) => {
      if (a === red1 || a === red2)
        return { sev: 0.85, pct: 44 + rng.range(0, 4), forceSpiro: true, forceLog: true, nightWaking: true, missedSchool: a === red1, rescueProb: 1 };
      if (a < 14) return { sev: 0.5, pct: rng.range(60, 75), forceLog: a === 1, rescueProb: 0.62 + (14 - a) * 0.01 };
      if (a < 30) return { sev: 0.35, pct: rng.range(72, 88), rescueProb: 0.45 };
      return { sev: 0.2 };
    },
    adherence: (a) => (a < 30 ? 0.46 - ((30 - a) / 30) * 0.14 : a < 60 ? 0.55 : 0.62),
    logProb: (a) => (a < 30 ? 0.82 : 0.7),
    multiProb: 0.3,
    spiroGap: [1, 4],
    controller: () => meds.controller,
    controllerTimes: [7 * 60, 21 * 60],
    rescue: meds.rescue,
  });
  doc.medicalDevices = [makeDevice(rng, res.readings)];
  doc.asthmaTreatmentPlan = makePlan(rng, { lastPct: res.lastPct, lastTs: res.lastSpiroTs, expiration: addDays(today, 95), pbLpm: planPb(base), retest: true });
  doc.reminders = makeReminders(rng, doc.medications, [TRACKER_IDS.asthma]);
  return finish(doc, b, { scheduledMedIds: [meds.controller.id], perDay: 2 });
}

/** #4 — taking the controller but it is not working: rising symptoms, falling FEV1. */
function notWorking(rng: Rng, today: string, seed?: SyntheaSeed): RawPatientDocument {
  const { doc, meds, b, start, base } = asthmaPatient(rng, today, {
    index: 4, careTeam: ASTHMA_TEAM, studyIds: STUDY,
    historyDays: 120, seed: seed!, yesNo: 'tf',
  });
  const ramp = (a: number) => (a < 21 ? (21 - a) / 21 : 0);
  const res = simulateAsthma(b, {
    start, end: today, base,
    day: (a) => ({ sev: 0.08 + ramp(a) * 0.5, pct: 97 - ramp(a) * 19 + rng.normal(0, 2.5), forceLog: a === 1, forceSpiro: a < 21 && a % 2 === 0 }),
    adherence: () => 0.92,
    logProb: () => 0.86,
    multiProb: 0.2,
    spiroGap: [2, 3],
    controller: () => meds.controller,
    controllerTimes: [7 * 60 + 15, 20 * 60 + 30],
    rescue: meds.rescue,
  });
  doc.medicalDevices = [makeDevice(rng, res.readings)];
  doc.asthmaTreatmentPlan = makePlan(rng, { lastPct: res.lastPct, lastTs: res.lastSpiroTs, expiration: addDays(today, 13), pbLpm: planPb(base) });
  doc.reminders = makeReminders(rng, doc.medications, [TRACKER_IDS.asthma]);
  return finish(doc, b, { scheduledMedIds: [meds.controller.id], perDay: 2 });
}

/** #5 — discordant reporter: says "Great" while reporting wheeze / SOB with PEF ~70 %. */
function discordant(rng: Rng, today: string, seed?: SyntheaSeed): RawPatientDocument {
  const { doc, meds, b, start, base } = asthmaPatient(rng, today, {
    index: 5, careTeam: ASTHMA_TEAM, studyIds: STUDY,
    historyDays: 120, seed: seed!, yesNo: 'mixed',
  });
  const res = simulateAsthma(b, {
    start, end: today, base,
    day: (a) => {
      if (rng.chance(0.35))
        return {
          sev: 0.5,
          pct: 70 + rng.normal(0, 3.5),
          feeling: rng.chance(0.78) ? 'Great' : 'Good',
          symptoms: rng.chance(0.6) ? ['Wheezing', 'Shortness Of Breath'] : rng.chance(0.5) ? ['Coughing', 'Wheezing'] : ['Shortness Of Breath'],
          forceSpiro: rng.chance(0.75),
          forceLog: a < 60 || rng.chance(0.5),
          nightWaking: rng.chance(0.25),
        };
      return { sev: 0.14, pct: 88 + rng.normal(0, 4), forceLog: a === 1 };
    },
    adherence: () => 0.7,
    logProb: () => 0.75,
    multiProb: 0.25,
    spiroGap: [2, 4],
    controller: () => meds.controller,
    controllerTimes: [7 * 60, 19 * 60 + 30],
    rescue: meds.rescue,
  });
  doc.medicalDevices = [makeDevice(rng, res.readings)];
  doc.asthmaTreatmentPlan = makePlan(rng, { lastPct: res.lastPct, lastTs: res.lastSpiroTs, expiration: addDays(today, 140), pbLpm: planPb(base) });
  doc.reminders = makeReminders(rng, doc.medications, [TRACKER_IDS.asthma]);
  return finish(doc, b, { scheduledMedIds: [meds.controller.id], perDay: 2 });
}

/** #6 — disengaged: good data until ~3 weeks ago, many blank entries before stopping, plan expired. */
function disengaged(rng: Rng, today: string, seed?: SyntheaSeed): RawPatientDocument {
  const { doc, meds, b, start, base } = asthmaPatient(rng, today, {
    index: 6, careTeam: ASTHMA_TEAM, studyIds: STUDY,
    historyDays: 120, seed: seed!, yesNo: 'yn',
  });
  const stop = 21;
  const res = simulateAsthma(b, {
    start, end: addDays(today, -stop), base,
    day: () => ({ sev: 0.12 }),
    adherence: (a) => (a > 50 ? 0.86 : 0.55),
    logProb: (a) => (a > 45 ? 0.85 : 0.65),
    blankDayProb: (a) => (a <= 45 ? 0.55 : 0.05),
    multiProb: 0.2,
    spiroGap: [2, 4],
    controller: () => meds.controller,
    controllerTimes: [7 * 60 + 30, 21 * 60],
    rescue: meds.rescue,
  });
  doc.medicalDevices = [makeDevice(rng, res.readings)];
  doc.asthmaTreatmentPlan = makePlan(rng, { lastPct: res.lastPct, lastTs: res.lastSpiroTs, expiration: addDays(today, -35), pbLpm: planPb(base) });
  doc.reminders = makeReminders(rng, doc.medications, [TRACKER_IDS.asthma]);
  return finish(doc, b, { scheduledMedIds: [meds.controller.id], perDay: 2 });
}

/** #7 — migraine only: frequent headaches, triptan overuse risk, preventive ~75 %. */
function migraineOnly(rng: Rng, today: string, seed?: SyntheaSeed): RawPatientDocument {
  const start = addDays(today, -120);
  const doc = shell(rng, today, {
    index: 7, careTeam: NEURO_TEAM,
    trackers: [{ trackerId: TRACKER_IDS.migraine, assignedDate: start, active: true }],
    createdAt: toUtcIso(localTs(start, 14 * 60 + 12, 7, 220)),
  }, seed, seed && ehrFromSeed(seed, today, {
    problems: [{ display: 'Migraine without aura', snomed: '56097005', onsetDate: addDays(today, -430), active: true }],
    meds: [
      { display: 'Topiramate 25 MG Oral Tablet', status: 'active' },
      { display: 'rizatriptan 10 MG Oral Tablet', status: 'active' },
    ],
  }));
  const topiramate = makeMed(rng, {
    name: 'Topiramate 25 mg', icon: 'Tablet', howOften: 'Daily', quantity: 1, unit: 'tablet', periodUnit: 'Daily', frequency: 2,
    timesOfDay: ['08:00', '20:30'], relatedCondition: 'Migraine', relatedTrackerId: TRACKER_IDS.migraine, index: 0, startDate: start,
  });
  const riza = makeMed(rng, {
    name: 'Rizatriptan 10 mg', icon: 'Tablet', howOften: 'As Needed', quantity: 1, unit: 'tablet', relatedCondition: 'Migraine', index: 1,
  });
  const ibu = makeMed(rng, { name: 'Ibuprofen', icon: 'Capsule', howOften: 'As Needed', relatedCondition: 'Migraine', archived: true, index: 2, archivedDate: addDays(start, 10) });
  doc.medications = [topiramate, riza, ibu];
  const b = new PatientBuilder(rng, today, 'yn');
  simulateMigraine(b, {
    start, end: today, headachesPerMonth: [8, 10], abortiveDaysPerMonth: [10, 12], abortive: riza,
    preventive: { med: topiramate, times: [8 * 60, 20 * 60 + 30], adherence: 0.75 },
    missedSchoolLast30: 2, painRange: [4, 9], logProb: 0.82, multiProb: 0.2,
  });
  doc.reminders = makeReminders(rng, doc.medications, [TRACKER_IDS.migraine]);
  return finish(doc, b, { scheduledMedIds: [topiramate.id], perDay: 2 });
}

/** #8 — IBD (Crohn's) with a flare in the last 10 days. */
function ibdPatient(rng: Rng, today: string, seed?: SyntheaSeed): RawPatientDocument {
  const start = addDays(today, -120);
  const doc = shell(rng, today, {
    index: 8, careTeam: GI_TEAM,
    trackers: [{ trackerId: TRACKER_IDS.ibd, assignedDate: start, active: true }],
    createdAt: toUtcIso(localTs(start, 10 * 60 + 41, 33, 905)),
  }, seed, seed && ehrFromSeed(seed, today, {
    problems: [{ display: "Crohn's disease of small intestine", onsetDate: addDays(today, -610), active: true }],
    meds: [
      { display: 'mesalamine 400 MG Delayed Release Oral Tablet', status: 'active' },
      { display: 'methotrexate 25 MG/ML Injectable Solution', status: 'active' },
    ],
  }));
  const mesalamine = makeMed(rng, {
    name: 'Mesalamine 400 mg', icon: 'Tablet', howOften: 'Daily', quantity: 2, unit: 'tablets', periodUnit: 'Daily', frequency: 2,
    timesOfDay: ['08:00', '19:00'], relatedCondition: "Crohn's disease", relatedTrackerId: TRACKER_IDS.ibd, index: 0, startDate: start,
  });
  const mtx = makeMed(rng, {
    name: 'Methotrexate', icon: 'Injection', howOften: 'Weekly', quantity: 15, unit: 'mg', periodUnit: 'Weekly', frequency: 1,
    timesOfDay: ['18:00'], relatedCondition: "Crohn's disease", relatedTrackerId: TRACKER_IDS.ibd, index: 1, startDate: start,
  });
  doc.medications = [mesalamine, mtx];
  const b = new PatientBuilder(rng, today, 'tf');
  simulateIbd(b, {
    start, end: today, flareDays: 10,
    maintenance: { med: mesalamine, times: [8 * 60, 19 * 60], adherence: 0.85 },
    weekly: { med: mtx, adherence: 0.85 },
    logProb: 0.8, multiProb: 0.15,
  });
  doc.reminders = makeReminders(rng, doc.medications, [TRACKER_IDS.ibd]);
  return finish(doc, b, { scheduledMedIds: [mesalamine.id], perDay: 2 });
}

/** #9 — asthma + migraine, moderate everything, many submissions/day, archived duplicate controller. */
function comboPatient(rng: Rng, today: string, seed?: SyntheaSeed): RawPatientDocument {
  const start = addDays(today, -120);
  const switchAgo = 70;
  const doc = shell(rng, today, {
    index: 9, careTeam: 'Primary Care – Adolescent Medicine',
    trackers: [
      { trackerId: TRACKER_IDS.asthma, assignedDate: start, active: true },
      { trackerId: TRACKER_IDS.migraine, assignedDate: addDays(start, 9), active: true },
    ],
    createdAt: toUtcIso(localTs(start, 11 * 60 + 3, 41, 18)),
  }, seed);
  const rx = seedAsthmaRx(seed!)!;
  // Same controller entered twice: the archived copy keeps receiving doses after the switch.
  const oldCtrl = medFromSpec(rng, rx.controller, {
    relatedTrackerId: TRACKER_IDS.asthma, archived: true, index: 0, startDate: start, archivedDate: addDays(today, -switchAgo),
  });
  const newCtrl = medFromSpec(rng, rx.controller, { relatedTrackerId: TRACKER_IDS.asthma, index: 1, startDate: addDays(today, -switchAgo) });
  const rescue = medFromSpec(rng, rx.rescue, { index: 2 });
  const base = lungFromHeight(doc.profile.heightCm);
  const ibu = makeMed(rng, { name: 'Ibuprofen 400 mg', icon: 'Tablet', howOften: 'As Needed', quantity: 1, unit: 'tablet', relatedCondition: 'Migraine', relatedTrackerId: TRACKER_IDS.migraine, index: 3 });
  doc.medications = [oldCtrl, newCtrl, rescue, ibu];
  const b = new PatientBuilder(rng, today, 'mixed');
  const res = simulateAsthma(b, {
    start, end: today, base,
    day: (a) => ({ sev: 0.27 + 0.1 * Math.sin(a / 9), forceLog: a === 1 }),
    adherence: () => 0.74,
    logProb: () => 0.8,
    multiProb: 0.6,
    spiroGap: [1, 4],
    // Doses keep landing on the archived duplicate for a while after the switch (stale app cache).
    controller: (a) => (a > switchAgo || (a > switchAgo - 25 && rng.chance(0.4)) ? oldCtrl : newCtrl),
    controllerTimes: [7 * 60 + 30, 20 * 60],
    rescue,
  });
  simulateMigraine(b, {
    start: addDays(start, 9), end: today, headachesPerMonth: [4, 6], abortiveDaysPerMonth: [4, 6], abortive: ibu,
    missedSchoolLast30: 1, painRange: [3, 7], logProb: 0.7, multiProb: 0.5,
  });
  doc.medicalDevices = [makeDevice(rng, res.readings)];
  doc.asthmaTreatmentPlan = makePlan(rng, { lastPct: res.lastPct, lastTs: res.lastSpiroTs, expiration: addDays(today, 60), pbLpm: planPb(base) });
  doc.reminders = makeReminders(rng, doc.medications, [TRACKER_IDS.asthma, TRACKER_IDS.migraine]);
  return finish(doc, b, { scheduledMedIds: [oldCtrl.id, newCtrl.id], perDay: 2 });
}

/** #10 — new patient: enrolled 5 days ago, 4 days of data, no personal best on plan. */
function newPatient(rng: Rng, today: string, seed?: SyntheaSeed): RawPatientDocument {
  const { doc, meds, b, start, base } = asthmaPatient(rng, today, {
    index: 10, careTeam: ASTHMA_TEAM, studyIds: STUDY,
    historyDays: 5, seed: seed!, yesNo: 'tf',
  });
  const res = simulateAsthma(b, {
    start: addDays(start, 1), end: today, base,
    day: (a) => (a === 2 ? { sev: 0, skip: true } : { sev: 0.15, forceLog: a !== 0, forceSpiro: a === 4 || a === 1 }),
    adherence: () => 0.9,
    logProb: () => 0.9,
    multiProb: 0.3,
    spiroGap: [3, 3],
    controller: () => meds.controller,
    controllerTimes: [7 * 60 + 45, 19 * 60 + 45],
    rescue: meds.rescue,
    spiroAnswerProb: 0.6,
  });
  doc.medicalDevices = [makeDevice(rng, res.readings)];
  doc.asthmaTreatmentPlan = makePlan(rng, { lastPct: res.lastPct, lastTs: res.lastSpiroTs, expiration: addDays(today, 360), pbLpm: null });
  doc.reminders = makeReminders(rng, doc.medications, [TRACKER_IDS.asthma]);
  return finish(doc, b);
}

type Story = (rng: Rng, today: string, seed?: SyntheaSeed) => RawPatientDocument;

const STORIES: Story[] = [
  examplePatient,
  wellControlled,
  notTakingController,
  notWorking,
  discordant,
  disengaged,
  migraineOnly,
  ibdPatient,
  comboPatient,
  newPatient,
];

type SeedNeed = (s: SyntheaSeed, rx: SeedAsthmaRx | null) => boolean;
const isFlovent = (rx: SeedAsthmaRx | null) => !!rx && rx.controller.name.startsWith('Flovent');
const isNebCtrl = (rx: SeedAsthmaRx | null) => !!rx && rx.controller.icon === 'Liquid';
const isMdiRescue = (rx: SeedAsthmaRx | null) => !!rx && rx.rescue.icon === 'Inhaler';

/**
 * Which Synthea seed each story uses, as [story index, requirement, fallback requirement].
 * Listed most-constrained first so narrow needs are met before generic ones.
 */
const SEED_NEEDS: [number, SeedNeed, SeedNeed][] = [
  [4, (s, rx) => s.asthma && isNebCtrl(rx) && isMdiRescue(rx), (s, rx) => s.asthma && !!rx], // #5 discordant
  [1, (s, rx) => s.asthma && isFlovent(rx) && isMdiRescue(rx), (s, rx) => s.asthma && !!rx], // #2 well controlled
  [9, (s, rx) => s.asthma && isNebCtrl(rx) && !isMdiRescue(rx), (s, rx) => s.asthma && !!rx], // #10 new
  [2, (s, rx) => s.asthma && isFlovent(rx), (s, rx) => s.asthma && !!rx], // #3 not taking
  [3, (s, rx) => s.asthma && !!rx && !isMdiRescue(rx), (s, rx) => s.asthma && !!rx], // #4 not working
  [5, (s, rx) => s.asthma && !!rx, (s, rx) => s.asthma && !!rx], // #6 disengaged
  [8, (s, rx) => s.asthma && !!rx, (s, rx) => s.asthma && !!rx], // #9 combo
  [6, (s) => !s.asthma && s.sex === 'F', (s) => !s.asthma], // #7 migraine
  [7, (s) => !s.asthma && s.sex === 'M', (s) => !s.asthma], // #8 IBD
];

const ageOn = (dob: string, today: string) => {
  const years = +today.slice(0, 4) - +dob.slice(0, 4);
  return today.slice(5) >= dob.slice(5) ? years : years - 1;
};

/** Deterministically assign Synthea seeds to stories (independent of `today`: ages are shift-invariant). */
export function assignSeeds(seed: number, today: string): Map<number, SyntheaSeed> {
  const rng = new Rng(patientSeed(seed, 1000));
  const delta = syntheaShift(today);
  const pool = rng.sample(
    SYNTHEA.seeds.filter((s) => {
      const age = ageOn(addDays(s.birthDate, delta), today);
      return age >= 12 && age <= 18;
    }),
    SYNTHEA.seeds.length,
  );
  const used = new Set<string>();
  const out = new Map<number, SyntheaSeed>();
  for (const [story, need, fallback] of SEED_NEEDS) {
    const free = pool.filter((s) => !used.has(s.id));
    const pick = free.find((s) => need(s, seedAsthmaRx(s))) ?? free.find((s) => fallback(s, seedAsthmaRx(s)));
    if (!pick) throw new Error(`No Synthea seed available for story #${story + 1}; re-run server/data/synthea/import.ts`);
    used.add(pick.id);
    out.set(story, pick);
  }
  return out;
}

/** Generate the 10 demo patients. Pure and deterministic for a given `{ today, seed }`. */
export function generatePatients(opts: { today: string; seed?: number }): RawPatientDocument[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.today) || Number.isNaN(utcMs(opts.today))) {
    throw new Error(`generatePatients: invalid today "${opts.today}" (expected YYYY-MM-DD)`);
  }
  const seed = opts.seed ?? DEFAULT_SEED;
  const seeds = assignSeeds(seed, opts.today);
  return STORIES.map((story, i) => story(new Rng(patientSeed(seed, i)), opts.today, seeds.get(i)));
}

/** File name used by the CLI: `<lastname>-<id8>.json`. */
export function patientFileName(doc: RawPatientDocument): string {
  const last = doc.profile.lastName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${last}-${doc.id.slice(0, 8)}.json`;
}

// ───────────────────────────────── CLI ─────────────────────────────────

function isMain(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain() && process.argv.includes('--write')) {
  const envToday = process.env.DEMO_TODAY;
  const today = envToday && /^\d{4}-\d{2}-\d{2}$/.test(envToday) ? envToday : localDateString();
  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'generated');
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (f.endsWith('.json')) rmSync(path.join(outDir, f));
  const docs = generatePatients({ today });
  for (const d of docs) writeFileSync(path.join(outDir, patientFileName(d)), JSON.stringify(d, null, 2) + '\n');
  writeFileSync(path.join(outDir, 'trackers.json'), JSON.stringify(TRACKERS, null, 2) + '\n');
  console.log(`Wrote ${docs.length} patients + trackers.json to ${outDir} (today=${today})`);
}
