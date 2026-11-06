/**
 * Patient data-entry app: write handlers (validated, appended in the real messy raw format)
 * and the home-screen payload. See shared/types/api.ts → "Patient app".
 */
import { randomInt, randomUUID } from 'node:crypto';
import { buildPatientSummary } from '../shared/analytics';
import type {
  CreateMedicationDoseRequest,
  CreateSpirometrySessionRequest,
  CreateTrackerResponseRequest,
  PatientAppHome,
  PatientAppMedication,
  WriteResult,
} from '../shared/types/api';
import type {
  RawBadge,
  RawBaselineReading,
  RawFvcPlusResults,
  RawMedicalDevice,
  RawMedication,
  RawMedicationAdministration,
  RawPatientDocument,
  RawPlanZone,
  RawQuestionResponse,
  RawTrackerResponse,
} from '../shared/types/raw';
import type { PatientSummary, Zone } from '../shared/types/summary';
import type { TrackerDefinition, TrackerQuestion } from '../shared/types/tracker';
import { addDays, localTs } from './data/generate';
import type { RuntimeEntryBody } from './data/runtime';
import type { Store } from './data/store';

// ───────────────────────────────── Helpers ─────────────────────────────────

export type HandlerResult = { status: number; body: unknown };
const bad = (error: string): HandlerResult => ({ status: 400, body: { error } });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isValidDate = (d: string) => ISO_DATE.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const isLocalIso = (s: unknown): s is string => typeof s === 'string' && LOCAL_ISO.test(s) && !Number.isNaN(Date.parse(s)) && isValidDate(s.slice(0, 10));
const pad2 = (n: number) => String(n).padStart(2, '0');
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const nameKey = (name: string) => name.trim().toLowerCase();
const isBlank = (r: RawTrackerResponse) => !(r.responses ?? []).some((x) => x.value != null && String(x.value).trim() !== '');
const capitalize = (z: Zone) => (z.charAt(0).toUpperCase() + z.slice(1)) as RawPlanZone;

/** Server "now" expressed as a patient-local timestamp on the demo `today`. */
export function localNow(store: Store): { hm: string; ts: string; utc: string } {
  const d = store.now();
  const minutes = d.getHours() * 60 + d.getMinutes();
  const ts = localTs(store.today, minutes, d.getSeconds(), d.getMilliseconds());
  return { hm: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`, ts, utc: new Date(ts).toISOString() };
}

function trackerDefs(doc: RawPatientDocument, trackers: TrackerDefinition[]): TrackerDefinition[] {
  return doc.trackers
    .filter((t) => t.active)
    .map((t) => trackers.find((d) => d.id === t.trackerId))
    .filter((d): d is TrackerDefinition => !!d);
}

const isAsthmaPatient = (doc: RawPatientDocument, trackers: TrackerDefinition[]) =>
  trackerDefs(doc, trackers).some((t) => t.condition === 'asthma');

export function badgeLabelFor(name: string): string {
  let m = name.match(/^TrackerBadge(\d+)$/);
  if (m) return `${m[1]} check-ins`;
  m = name.match(/^TrackerStreak(\d+)$/);
  if (m) return `${m[1]}-day check-in streak`;
  m = name.match(/^MedicationStreak(\d+)$/);
  if (m) return `${m[1]}-day medicine streak`;
  return name.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
}

/** Days with at least one non-blank tracker submission. */
function checkInDays(doc: RawPatientDocument): Set<string> {
  return new Set(doc.dailyLogs.filter((l) => (l.trackerResponses ?? []).some((r) => !isBlank(r))).map((l) => l.day));
}

function streakEndingAt(days: Set<string>, day: string): number {
  let n = 0;
  for (let d = day; days.has(d); d = addDays(d, -1)) n++;
  return n;
}

function longestStreak(days: Set<string>): number {
  let best = 0;
  for (const d of days) if (!days.has(addDays(d, -1))) best = Math.max(best, streakEndingAt(days, lastOfRun(days, d)));
  return best;
}
function lastOfRun(days: Set<string>, d: string): string {
  while (days.has(addDays(d, 1))) d = addDays(d, 1);
  return d;
}

/** Active (non-archived) medications grouped by name, with archived duplicates' ids merged. */
function medGroups(doc: RawPatientDocument): { med: RawMedication; ids: string[] }[] {
  const active = doc.medications.filter((m) => !m.archived).sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const out: { med: RawMedication; ids: string[] }[] = [];
  for (const m of active) {
    const k = nameKey(m.name);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ med: m, ids: doc.medications.filter((x) => nameKey(x.name) === k).map((x) => x.id) });
  }
  return out;
}

const DEFAULT_TIMES: Record<number, string[]> = {
  1: ['08:00'],
  2: ['08:00', '20:00'],
  3: ['08:00', '14:00', '20:00'],
  4: ['08:00', '12:00', '16:00', '20:00'],
};

function scheduledTimes(m: RawMedication): string[] {
  const t = m.dosage?.timing;
  if (t?.timesOfDay?.length) return [...t.timesOfDay];
  const f = Math.max(1, Math.round(t?.frequency ?? 1));
  return DEFAULT_TIMES[f] ?? Array.from({ length: f }, (_, i) => `${pad2(8 + Math.floor((12 * i) / Math.max(1, f - 1)))}:00`);
}

function weeklyDueOn(doc: RawPatientDocument, ids: string[], m: RawMedication, day: string): boolean {
  const days = new Set((doc.reminders ?? []).filter((r) => r.kind === 'medication' && ids.includes(r.targetId)).flatMap((r) => r.daysOfWeek ?? []));
  if (days.size) return days.has(dow(day));
  return m.startDate ? dow(m.startDate) === dow(day) : false;
}

function regimen(m: RawMedication): string {
  if (m.howOften === 'As Needed') return 'As needed';
  const q = m.dosage?.quantity;
  const unit = m.dosage?.unit ?? (q === 1 ? 'dose' : 'doses');
  const f = m.dosage?.timing?.frequency ?? m.dosage?.timing?.timesOfDay?.length ?? 1;
  const freq =
    m.howOften === 'Weekly' ? (f === 1 ? 'once weekly' : `${f} times weekly`) : f === 1 ? 'once daily' : f === 2 ? 'twice daily' : `${f} times daily`;
  return q ? `${q} ${unit} ${freq}` : freq.charAt(0).toUpperCase() + freq.slice(1);
}

function takenTimes(doc: RawPatientDocument, ids: string[], day: string): string[] {
  const log = doc.dailyLogs.find((l) => l.day === day);
  return (log?.medicationAdministrations ?? []).filter((a) => ids.includes(a.id)).map((a) => a.time).sort();
}

function appMedication(doc: RawPatientDocument, g: { med: RawMedication; ids: string[] }, today: string): PatientAppMedication {
  const m = g.med;
  const asNeeded = m.howOften === 'As Needed';
  const due = asNeeded ? false : m.howOften === 'Weekly' ? weeklyDueOn(doc, g.ids, m, today) : true;
  const times = due ? scheduledTimes(m) : [];
  const taken = takenTimes(doc, g.ids, today);
  const out: PatientAppMedication = {
    id: m.id,
    name: m.name,
    howOften: m.howOften,
    regimen: regimen(m),
    kind: asNeeded ? 'asNeeded' : 'scheduled',
    timesOfDay: times,
    dosesDueToday: times.length,
    dosesTakenToday: taken.length,
    takenTimesToday: taken,
  };
  if (m.icon) out.icon = m.icon;
  if (m.relatedCondition) out.condition = m.relatedCondition;
  return out;
}

/** True when every active scheduled daily medication has all its doses on `day`. */
function allDailyDosesTaken(doc: RawPatientDocument, day: string): boolean {
  const daily = medGroups(doc).filter((g) => g.med.howOften === 'Daily');
  if (!daily.length) return false;
  return daily.every((g) => takenTimes(doc, g.ids, day).length >= scheduledTimes(g.med).length);
}

function medStreakEndingAt(doc: RawPatientDocument, day: string): number {
  let n = 0;
  for (let d = day; allDailyDosesTaken(doc, d); d = addDays(d, -1)) n++;
  return n;
}

const hasBadgeSince = (badges: RawBadge[] | undefined, name: string, sinceDay: string) =>
  (badges ?? []).some((b) => b.badgeName === name && b.date.slice(0, 10) >= sinceDay);

// ───────────────────────────────── After-write effects ─────────────────────────────────

interface Effects {
  zoneToday?: Zone;
  newBadge?: { name: string; label: string };
  summary?: PatientSummary;
}

/** Recompute today's derived zone (asthma), persist it on the plan, and record new badges. */
function afterWrite(store: Store, doc: RawPatientDocument, badges: { list: 'tracker' | 'medication'; name: string }[]): Effects {
  const now = localNow(store);
  const entries: RuntimeEntryBody[] = badges.map((b) => ({ kind: 'badge', list: b.list, data: { badgeName: b.name, date: now.utc } }));
  const fx: Effects = {};
  if (badges.length) fx.newBadge = { name: badges[0].name, label: badgeLabelFor(badges[0].name) };
  if (isAsthmaPatient(doc, store.trackers)) {
    fx.summary = buildPatientSummary(doc, store.trackers, { today: store.today, days: 1 });
    const zone = fx.summary.days[0]?.zone;
    if (zone) {
      fx.zoneToday = zone;
      entries.push({ kind: 'planStatus', status: capitalize(zone), statusUpdatedAt: now.ts });
    }
  }
  if (entries.length) store.record(doc, entries);
  return fx;
}

function zoneSentence(z?: Zone): string {
  if (z === 'yellow') return ' Today you are in the Yellow zone. Follow the yellow steps in your action plan.';
  if (z === 'red') return ' Today you are in the Red zone. Follow the red steps in your action plan now and tell an adult.';
  return '';
}
const badgeSentence = (b?: { label: string }) => (b ? ` New badge unlocked: ${b.label}!` : '');

function result<T>(created: T, message: string, fx: Effects): HandlerResult {
  const body: WriteResult<T> = { ok: true, created, message };
  if (fx.zoneToday) body.zoneToday = fx.zoneToday;
  if (fx.newBadge) body.newBadge = fx.newBadge;
  return { status: 201, body };
}

// ───────────────────────────────── Tracker responses ─────────────────────────────────

function validateAnswer(q: TrackerQuestion, value: string): string | null {
  const v = value.trim();
  if (v === '') return null;
  const options = (q.options ?? []).map((o) => o.value.trim());
  switch (q.type) {
    case 'yesNo':
      return /^(true|false|yes|no)$/i.test(v) ? null : `"${q.id}" expects "true" or "false"`;
    case 'number':
    case 'scale1to10': {
      const n = Number(v);
      if (!Number.isFinite(n)) return `"${q.id}" expects a number`;
      if (q.min !== undefined && n < q.min) return `"${q.id}" must be at least ${q.min}`;
      if (q.max !== undefined && n > q.max) return `"${q.id}" must be at most ${q.max}`;
      return null;
    }
    case 'faceScale':
    case 'iconChoice':
    case 'singleChoice':
      return options.includes(v) ? null : `"${q.id}" must be one of: ${options.join(', ')}`;
    case 'checkbox': {
      let arr: unknown;
      try {
        arr = JSON.parse(value);
      } catch {
        return `"${q.id}" expects a JSON array string`;
      }
      if (!Array.isArray(arr)) return `"${q.id}" expects a JSON array string`;
      for (const item of arr) {
        if (typeof item !== 'string' || !options.includes(item.trim())) return `"${q.id}" has an unknown option ${JSON.stringify(item)}`;
      }
      return null;
    }
    case 'spirometry':
      return Number.isNaN(Date.parse(v)) ? `"${q.id}" expects "" or a reading timestamp` : null;
    case 'text':
      return value.length > 2000 ? `"${q.id}" is too long` : null;
  }
}

export function postTrackerResponse(store: Store, doc: RawPatientDocument, body: unknown): HandlerResult {
  if (!isObj(body)) return bad('Body must be a JSON object.');
  const req = body as Partial<CreateTrackerResponseRequest>;
  if (typeof req.trackerId !== 'string') return bad('"trackerId" is required.');
  const assigned = doc.trackers.find((t) => t.trackerId === req.trackerId && t.active);
  const def = store.trackers.find((t) => t.id === req.trackerId);
  if (!assigned || !def) return bad(`Tracker "${req.trackerId}" is not assigned to this patient.`);
  if (!Array.isArray(req.responses)) return bad('"responses" must be an array.');
  if (req.responses.length > 100) return bad('Too many responses.');
  const seen = new Set<string>();
  const responses: RawQuestionResponse[] = [];
  for (const r of req.responses as unknown[]) {
    if (!isObj(r) || typeof r.questionId !== 'string') return bad('Each response needs a "questionId".');
    const q = def.questions.find((x) => x.id === r.questionId);
    if (!q) return bad(`Question "${r.questionId}" does not exist in tracker "${def.id}".`);
    if (seen.has(q.id)) return bad(`Question "${q.id}" is answered twice.`);
    seen.add(q.id);
    if (r.value !== null && typeof r.value !== 'string') return bad(`"${q.id}" value must be a string or null.`);
    if (typeof r.value === 'string') {
      const err = validateAnswer(q, r.value);
      if (err) return bad(err);
    }
    responses.push({ questionId: q.id, value: r.value as string | null });
  }
  let submittedAt: string;
  if (req.submittedAt !== undefined) {
    if (!isLocalIso(req.submittedAt)) return bad('"submittedAt" must be a local ISO timestamp with offset.');
    submittedAt = req.submittedAt;
  } else submittedAt = localNow(store).ts;
  const day = submittedAt.slice(0, 10);
  if (day > store.today) return bad('"submittedAt" cannot be after today.');

  // Voice check-ins (fields not yet in CreateTrackerResponseRequest; read from the body).
  const extra = body as { entryMode?: unknown; transcript?: unknown; mediaIds?: unknown };
  if (extra.entryMode !== undefined && extra.entryMode !== 'form' && extra.entryMode !== 'voice') return bad('"entryMode" must be "form" or "voice".');
  let transcript: string | undefined;
  if (extra.transcript !== undefined && extra.transcript !== null) {
    if (typeof extra.transcript !== 'string') return bad('"transcript" must be a string.');
    transcript = extra.transcript.trim();
    if (transcript.length > 4000) return bad('"transcript" must be at most 4000 characters.');
  }
  let mediaIds: string[] | undefined;
  if (extra.mediaIds !== undefined) {
    if (!Array.isArray(extra.mediaIds) || extra.mediaIds.some((x) => typeof x !== 'string')) return bad('"mediaIds" must be an array of strings.');
    if (extra.mediaIds.length > 10) return bad('At most 10 photos/videos per check-in.');
    for (const id of extra.mediaIds as string[]) {
      const m = store.media.get(id);
      if (!m || m.patientId !== doc.id) return bad(`Media "${id}" does not exist for this patient.`);
    }
    mediaIds = [...new Set(extra.mediaIds as string[])];
  }

  const before = checkInDays(doc);
  const created: RawTrackerResponse = { id: randomUUID(), trackerId: def.id, submittedAt, responses };
  if (extra.entryMode) created.entryMode = extra.entryMode as 'form' | 'voice';
  if (transcript) created.transcript = transcript;
  if (mediaIds?.length) created.mediaIds = mediaIds;
  store.record(doc, [{ kind: 'trackerResponse', day, data: created }]);

  const blank = isBlank(created);
  const badges: { list: 'tracker'; name: string }[] = [];
  const after = checkInDays(doc);
  const streak = streakEndingAt(after, day);
  if (!blank && !before.has(day)) {
    const n = after.size;
    if ([5, 10, 25, 50].includes(n) && !(doc.earnedTrackerBadges ?? []).some((b) => b.badgeName === `TrackerBadge${n}`)) badges.push({ list: 'tracker', name: `TrackerBadge${n}` });
    if (streak === 7 && !hasBadgeSince(doc.earnedTrackerBadges, 'TrackerStreak7', addDays(day, -6))) badges.push({ list: 'tracker', name: 'TrackerStreak7' });
  }
  const fx = afterWrite(store, doc, badges);
  const message = blank
    ? 'Saved. You can finish your check-in anytime today.'
    : (streak >= 2 ? `Check-in saved — ${streak} days in a row!` : 'Check-in saved — thanks for checking in!') + badgeSentence(fx.newBadge) + zoneSentence(fx.zoneToday);
  return result(created, message, fx);
}

// ───────────────────────────────── Medication doses ─────────────────────────────────

export function postMedicationDose(store: Store, doc: RawPatientDocument, body: unknown): HandlerResult {
  if (!isObj(body)) return bad('Body must be a JSON object.');
  const req = body as Partial<CreateMedicationDoseRequest>;
  if (typeof req.medicationId !== 'string') return bad('"medicationId" is required.');
  const med = doc.medications.find((m) => m.id === req.medicationId);
  if (!med) return bad(`Medication "${req.medicationId}" is not on this patient's list.`);
  if (med.archived) return bad(`Medication "${med.name}" is archived.`);
  const now = localNow(store);
  const day = req.day ?? store.today;
  if (typeof day !== 'string' || !isValidDate(day)) return bad('"day" must be YYYY-MM-DD.');
  if (day > store.today) return bad('"day" cannot be after today.');
  const time = req.time ?? now.hm;
  if (typeof time !== 'string' || !HHMM.test(time)) return bad('"time" must be HH:mm.');
  const quantity = req.quantity ?? 1;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > 20) return bad('"quantity" must be a number between 0 and 20.');

  const completeBefore = allDailyDosesTaken(doc, day);
  const created: RawMedicationAdministration = { id: med.id, time, name: med.name, value: quantity };
  store.record(doc, [{ kind: 'medicationAdministration', day, data: created }]);

  const badges: { list: 'medication'; name: string }[] = [];
  const completeNow = allDailyDosesTaken(doc, day);
  if (med.howOften === 'Daily' && completeNow && !completeBefore && medStreakEndingAt(doc, day) === 7 && !hasBadgeSince(doc.earnedMedicationBadges, 'MedicationStreak7', addDays(day, -6))) {
    badges.push({ list: 'medication', name: 'MedicationStreak7' });
  }
  const fx = afterWrite(store, doc, badges);
  let message: string;
  if (med.howOften === 'As Needed') {
    message = `${med.name} logged.` + (/asthma/i.test(med.relatedCondition ?? '') ? ' If you need it again soon, check your action plan.' : ' Hope you feel better soon.');
  } else if (med.howOften === 'Daily' && completeNow && !completeBefore) {
    message = `${med.name} taken — that's all your doses for today. Nice work!`;
  } else {
    message = `${med.name} marked as taken.`;
  }
  message += badgeSentence(fx.newBadge) + zoneSentence(fx.zoneToday);
  return result(created, message, fx);
}

// ───────────────────────────────── Spirometry ─────────────────────────────────

const REQUIRED_FVC: (keyof RawFvcPlusResults)[] = ['fvc', 'fev1', 'fev1FvcRatio', 'pef'];
const OPTIONAL_FVC: (keyof RawFvcPlusResults)[] = ['fef2575', 'fev6', 'fet', 'pefTime', 'extrapolatedVolume'];

function sanitizeReading(r: unknown, i: number, today: string): RawBaselineReading | string {
  if (!isObj(r)) return `readings[${i}] must be an object.`;
  if (!isLocalIso(r.baselineReadingDate)) return `readings[${i}].baselineReadingDate must be a local ISO timestamp with offset.`;
  if (r.baselineReadingDate.slice(0, 10) > today) return `readings[${i}] is dated after today.`;
  if (r.accepted !== undefined && typeof r.accepted !== 'boolean') return `readings[${i}].accepted must be a boolean.`;
  const f = r.fvcPlusResults;
  if (!isObj(f)) return `readings[${i}].fvcPlusResults is required.`;
  const out = {} as RawFvcPlusResults;
  for (const k of REQUIRED_FVC) {
    const v = f[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return `readings[${i}].fvcPlusResults.${k} must be a non-negative number.`;
    (out as unknown as Record<string, number>)[k] = v;
  }
  if (out.pef > 20) return `readings[${i}].fvcPlusResults.pef must be in L/s (got ${out.pef}).`;
  for (const k of OPTIONAL_FVC) {
    const v = f[k];
    if (v === undefined) continue;
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) return `readings[${i}].fvcPlusResults.${k} must be a number or null.`;
    (out as unknown as Record<string, number | null>)[k] = v as number | null;
  }
  const reading: RawBaselineReading = { baselineReadingDate: r.baselineReadingDate, accepted: r.accepted ?? false, fvcPlusResults: out };
  const qr = r.qualityReport;
  if (qr === null) reading.qualityReport = null;
  else if (isObj(qr)) {
    const quality = typeof qr.quality === 'string' ? qr.quality : null;
    const qi = Array.isArray(qr.qualityIndications)
      ? qr.qualityIndications.filter((x): x is { messageInstructions: string } => isObj(x) && typeof x.messageInstructions === 'string').map((x) => ({ messageInstructions: x.messageInstructions }))
      : null;
    reading.qualityReport = { quality, qualityIndications: qi };
  }
  return reading;
}

export function postSpirometrySession(store: Store, doc: RawPatientDocument, body: unknown): HandlerResult {
  if (!isObj(body)) return bad('Body must be a JSON object.');
  const req = body as Partial<CreateSpirometrySessionRequest>;
  if (!Array.isArray(req.readings) || req.readings.length === 0) return bad('"readings" must be a non-empty array.');
  if (req.readings.length > 20) return bad('Too many readings in one session (max 20).');
  const readings: RawBaselineReading[] = [];
  for (let i = 0; i < req.readings.length; i++) {
    const r = sanitizeReading(req.readings[i], i, store.today);
    if (typeof r === 'string') return bad(r);
    readings.push(r);
  }
  const entries: RuntimeEntryBody[] = [];
  if (!doc.medicalDevices?.length) {
    const serial = `Z1${randomInt(10000, 100000)}`;
    const device: RawMedicalDevice = {
      protocol: 9,
      address: randomUUID().toUpperCase(),
      bootId: 'SM',
      serialNumber: serial,
      deviceType: 0,
      atsStandard: 0,
      name: 'Spirobank',
      advertisementName: `SM-009-${serial}`,
      baselineReadingDate: null,
      baselineReadings: [],
    };
    entries.push({ kind: 'device', data: device });
  }
  entries.push({ kind: 'spirometry', data: readings });
  store.record(doc, entries);

  const fx = afterWrite(store, doc, []);
  const day = readings.map((r) => r.baselineReadingDate.slice(0, 10)).sort().at(-1)!;
  const summary = day === store.today ? (fx.summary ?? buildPatientSummary(doc, store.trackers, { today: store.today, days: 1 })) : undefined;
  const sp = summary?.days[0]?.spirometry;
  const message = sp
    ? `Reading saved — best peak flow ${sp.pefLpm} L/min${sp.pctPersonalBest !== undefined ? ` (${sp.pctPersonalBest}% of your best)` : ''}. Great effort!`
    : `Saved ${readings.length} blow${readings.length === 1 ? '' : 's'}. Great effort!`;
  return result(readings, message + zoneSentence(fx.zoneToday), fx);
}

// ───────────────────────────────── Home ─────────────────────────────────

const ACTION_STEPS: Record<Zone, string[]> = {
  green: [
    'Keep taking your controller medicine every day, exactly as prescribed — even when you feel fine.',
    'Take your rescue inhaler before exercise only if your plan says to.',
  ],
  yellow: [
    'Use your rescue inhaler the way your action plan says.',
    'Keep taking your controller medicine.',
    'Tell a parent or caregiver how you are feeling.',
    'Check your symptoms or peak flow again in 20–30 minutes.',
  ],
  red: [
    'Use your rescue inhaler now.',
    'Get medical help now — tell an adult and call your care team.',
    "Call 911 if you are struggling to breathe, can't talk or walk well, or your lips or fingernails turn blue.",
  ],
};

export function buildPatientAppHome(doc: RawPatientDocument, trackers: TrackerDefinition[], today: string): PatientAppHome {
  const summary = buildPatientSummary(doc, trackers, { today, days: 14 });
  const todayLog = doc.dailyLogs.find((l) => l.day === today);
  const defs = trackerDefs(doc, trackers);

  const trackerRows = defs.map((definition) => {
    const all = doc.dailyLogs.flatMap((l) => (l.trackerResponses ?? []).filter((r) => r.trackerId === definition.id));
    const last = all.reduce<RawTrackerResponse | undefined>((m, r) => (!m || Date.parse(r.submittedAt) > Date.parse(m.submittedAt) ? r : m), undefined);
    const row: PatientAppHome['trackers'][number] = {
      definition,
      submittedToday: (todayLog?.trackerResponses ?? []).filter((r) => r.trackerId === definition.id && !isBlank(r)).length,
    };
    if (last) row.lastSubmittedAt = last.submittedAt;
    return row;
  });

  const days = checkInDays(doc);
  const currentStreak = streakEndingAt(days, days.has(today) ? today : addDays(today, -1));
  const badges = [...(doc.earnedTrackerBadges ?? []), ...(doc.earnedMedicationBadges ?? [])]
    .map((b) => ({ name: b.badgeName, label: badgeLabelFor(b.badgeName), date: b.date.slice(0, 10) }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));

  const home: PatientAppHome = {
    today,
    patient: {
      id: doc.id,
      firstName: doc.profile.firstName,
      displayName: summary.patient.displayName,
      initials: summary.patient.initials,
      ageYears: summary.patient.ageYears,
      conditions: summary.patient.trackers,
    },
    trackers: trackerRows,
    medications: medGroups(doc).map((g) => appMedication(doc, g, today)),
    engagement: { currentStreak, longestStreak: longestStreak(days), badges },
    last14Days: summary.days.map((d) => ({ date: d.date, status: !d.hasData ? 'none' : d.hardDay ? 'hard' : 'good' })),
  };

  if (defs.some((t) => t.condition === 'asthma')) {
    const plan = doc.asthmaTreatmentPlan ?? {};
    const planZone = typeof plan.status === 'string' ? (plan.status.trim().toLowerCase() as Zone) : undefined;
    const zone = summary.days.at(-1)?.zone ?? (planZone && planZone in ACTION_STEPS ? planZone : undefined);
    home.actionPlan = {
      greenThresholdPct: plan.greenThresholdPct ?? summary.spirometry?.greenThresholdPct ?? 80,
      redThresholdPct: plan.redThresholdPct ?? summary.spirometry?.redThresholdPct ?? 50,
      expired: summary.actionPlan?.expired ?? (!!plan.expiration && plan.expiration < today),
      steps: ACTION_STEPS,
    };
    if (zone) home.actionPlan.zone = zone;
    if (plan.statusUpdatedAt) home.actionPlan.asOf = plan.statusUpdatedAt;
    const pb = summary.spirometry?.personalBestPefLpm ?? plan.personalBestPeakFlow ?? undefined;
    if (pb) home.actionPlan.personalBestPefLpm = pb;
  }

  const device = doc.medicalDevices?.[0];
  if (device || home.actionPlan) {
    home.spirometer = { deviceName: 'MIR Spirobank Smart', serialNumber: device?.serialNumber ?? '' };
    const latest = summary.spirometry?.latest;
    if (latest) {
      home.spirometer.latest = { date: latest.date, pefLpm: latest.bestPefLpm, fev1L: latest.bestFev1L };
      if (latest.pctPersonalBest !== undefined) home.spirometer.latest.pctPersonalBest = latest.pctPersonalBest;
      if (latest.zone) home.spirometer.latest.zone = latest.zone;
    }
  }
  return home;
}
