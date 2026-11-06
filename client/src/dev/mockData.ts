/**
 * DEV-ONLY MOCK DATA (synthetic — no real patients).
 *
 * Used by the API client only when `VITE_USE_MOCKS === 'true'` and by client tests.
 * Builds realistic, internally consistent `PatientSummary` objects with a seeded
 * generator. Each calendar day is generated from a hash of (patient, date), so changing
 * the window length shows the same history, just more or less of it.
 */
import type {
  AsNeededMedicationSummary,
  ClinicalFlag,
  DataQualityNote,
  DaySummary,
  HeadlineMetric,
  HeadlineMetricId,
  PatientListItem,
  PatientFacingPoint,
  PatientListResponse,
  PatientSummary,
  QuestionRole,
  QuestionSummary,
  ScheduledMedicationSummary,
  Severity,
  SpirometryBlow,
  SpirometrySession,
  Status,
  TrackerDefinition,
  TrackerQuestion,
  TrackerRef,
  TrackerSummary,
  Trend,
  Zone,
} from '@shared/types';

export const MOCK_TODAY = '2026-11-05';

// ───────────────────────────── date helpers (UTC on YYYY-MM-DD) ─────────────────────────────

const toDate = (d: string) => new Date(d + 'T00:00:00Z');
const iso = (d: Date) => d.toISOString().slice(0, 10);
function addDays(d: string, n: number): string {
  const x = toDate(d);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
}
const diffDays = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
const weekday = (d: string) => toDate(d).getUTCDay();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const human = (d: string) => `${MONTHS[toDate(d).getUTCMonth()]} ${toDate(d).getUTCDate()}, ${toDate(d).getUTCFullYear()}`;

// ───────────────────────────── seeded randomness ─────────────────────────────

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

// ───────────────────────────── tracker definitions ─────────────────────────────

const FEELING_OPTIONS = [
  { value: 'Great', label: 'Great', severity: 0 as Severity, icon: '😀' },
  { value: 'Good', label: 'Good', severity: 0 as Severity, icon: '🙂' },
  { value: 'Okay', label: 'Okay', severity: 1 as Severity, icon: '😐' },
  { value: 'Bad', label: 'Bad', severity: 2 as Severity, icon: '🙁' },
  { value: 'Awful', label: 'Awful', severity: 3 as Severity, icon: '😣' },
];

const ASTHMA_SYMPTOMS = ['Coughing', 'Wheezing', 'Tight chest', 'Shortness of breath', 'Activity limitations'];
const MIGRAINE_TRIGGERS = ['Poor sleep', 'Screens', 'Skipped meal', 'Stress', 'Weather change'];

export const mockTrackers: TrackerDefinition[] = [
  {
    id: 'asthma-v2',
    name: 'Asthma Tracker',
    condition: 'asthma',
    conditionLabel: 'Asthma',
    version: 2,
    questions: [
      { id: 'a_feel', order: 1, text: 'How are you feeling today?', shortLabel: 'Feeling', type: 'faceScale', role: 'overallFeeling', options: FEELING_OPTIONS },
      {
        id: 'a_sym',
        order: 2,
        text: 'Please select the following symptoms that you are currently experiencing',
        shortLabel: 'Symptoms',
        type: 'checkbox',
        role: 'symptoms',
        options: [...ASTHMA_SYMPTOMS.map((s) => ({ value: s, label: s })), { value: 'None of these', label: 'None', isNone: true }],
      },
      { id: 'a_spiro', order: 3, text: 'Please complete your spirometer reading', shortLabel: 'Spirometry', type: 'spirometry', role: 'spirometry' },
      { id: 'a_night', order: 4, text: 'Did your asthma wake you up last night?', shortLabel: 'Night waking', type: 'yesNo', role: 'nightWaking' },
      { id: 'a_school', order: 5, text: 'Did you miss school today because of your asthma?', shortLabel: 'Missed school', type: 'yesNo', role: 'missedSchool' },
      { id: 'a_rescue', order: 6, text: 'How many times did you use your rescue inhaler today?', shortLabel: 'Rescue puffs', type: 'number', role: 'rescueMedUse', min: 0, max: 12, unit: 'times', concernThreshold: 2 },
    ],
  },
  {
    id: 'migraine-v1',
    name: 'Headache Diary',
    condition: 'migraine',
    conditionLabel: 'Migraine',
    version: 1,
    questions: [
      { id: 'm_head', order: 1, text: 'Did you have a headache today?', shortLabel: 'Headache', type: 'yesNo', role: 'headache' },
      { id: 'm_pain', order: 2, text: 'How bad was the pain at its worst?', shortLabel: 'Pain', type: 'scale1to10', role: 'painSeverity', min: 1, max: 10, concernThreshold: 7 },
      { id: 'm_dur', order: 3, text: 'How many hours did it last?', shortLabel: 'Duration', type: 'number', role: 'headacheDurationHours', min: 0, max: 24, unit: 'h' },
      {
        id: 'm_trig',
        order: 4,
        text: 'Did any of these happen before it started?',
        shortLabel: 'Triggers',
        type: 'checkbox',
        role: 'triggers',
        options: [...MIGRAINE_TRIGGERS.map((s) => ({ value: s, label: s })), { value: 'None', label: 'None', isNone: true }],
      },
      { id: 'm_sleep', order: 5, text: 'How many hours did you sleep last night?', shortLabel: 'Sleep', type: 'number', role: 'sleepHours', min: 0, max: 14, unit: 'h', direction: 'higherIsBetter', concernThreshold: 7 },
    ],
  },
  {
    id: 'ibd-v1',
    name: 'IBD Check-in',
    condition: 'ibd',
    conditionLabel: 'IBD',
    version: 1,
    questions: [
      { id: 'g_feel', order: 1, text: 'How is your belly feeling today?', shortLabel: 'Feeling', type: 'faceScale', role: 'overallFeeling', options: FEELING_OPTIONS },
      { id: 'g_stool', order: 2, text: 'How many times did you poop today?', shortLabel: 'Stools', type: 'number', role: 'stoolFrequency', min: 0, max: 20, unit: '/day', concernThreshold: 4 },
      { id: 'g_blood', order: 3, text: 'Did you see any blood?', shortLabel: 'Blood', type: 'yesNo', role: 'bloodInStool' },
      { id: 'g_pain', order: 4, text: 'How bad was your belly pain?', shortLabel: 'Belly pain', type: 'scale1to10', role: 'painSeverity', min: 1, max: 10, concernThreshold: 6 },
      { id: 'g_school', order: 5, text: 'Did you miss school today?', shortLabel: 'Missed school', type: 'yesNo', role: 'missedSchool' },
      { id: 'g_note', order: 6, text: 'Anything else you want your care team to know?', shortLabel: 'Note', type: 'text', role: 'other' },
    ],
  },
];

const TRACKER_FOR: Record<string, TrackerDefinition> = Object.fromEntries(mockTrackers.map((t) => [t.condition, t]));
const ref = (t: TrackerDefinition): TrackerRef => ({ id: t.id, name: t.name, condition: t.condition, conditionLabel: t.conditionLabel });

// ───────────────────────────── patient roster ─────────────────────────────

interface MockProfile {
  id: string;
  first: string;
  last: string;
  age: number;
  sex: 'F' | 'M' | 'X';
  mrn: string;
  conditions: string[];
  studies: string[];
  base: number; // 0 (well) … 1 (unwell)
  adherence: number; // probability a scheduled dose is marked taken
  lastActiveAgo: number;
  planExpiresIn: number;
  careTeam: string;
  /** Days since enrollment (default 240). */
  enrollAgo?: number;
  heightCm?: number;
  weightKg?: number;
  ehr?: NonNullable<PatientSummary['patient']['ehr']>;
}

/** Synthea-like EHR background (synthetic). */
const EHR_JORDAN: NonNullable<PatientSummary['patient']['ehr']> = {
  source: 'synthea',
  problems: ['Childhood asthma', 'Allergic rhinitis', 'Allergy to tree pollen', 'Migraine without aura'],
  allergies: ['Tree pollen', 'Peanuts'],
  medicationsOnFile: ['Flovent HFA 44 mcg inhaler', 'Albuterol (Ventolin HFA)', 'Epinephrine auto-injector', 'Cetirizine 10 mg tablet'],
  lastClinicVisit: '2025-11-09',
  visitsLast12Months: 3,
};
const ehrAsthma = (lastVisit: string, visits: number, extra: string[] = []): NonNullable<PatientSummary['patient']['ehr']> => ({
  source: 'synthea',
  problems: ['Childhood asthma', 'Allergic rhinitis', ...extra],
  allergies: extra.includes('Allergy to tree pollen') ? ['Tree pollen'] : [],
  medicationsOnFile: ['Dulera 100/5 mcg inhaler', 'Albuterol (Ventolin HFA)', 'Cetirizine 10 mg tablet'],
  lastClinicVisit: lastVisit,
  visitsLast12Months: visits,
});
const enrollAgo = (p: MockProfile) => p.enrollAgo ?? ENROLL_DAYS_AGO;

const PROFILES: MockProfile[] = [
  { id: 'demo-jordan', first: 'Jordan', last: 'Reyes', age: 14, sex: 'F', mrn: 'DEMO-000123', conditions: ['asthma', 'migraine'], studies: ['NCT06159127'], base: 0.42, adherence: 0.58, lastActiveAgo: 0, planExpiresIn: 12, careTeam: 'Pulmonary Medicine', heightCm: 158, weightKg: 49.5, ehr: EHR_JORDAN },
  { id: 'demo-malik', first: 'Malik', last: 'Johnson', age: 13, sex: 'M', mrn: 'DEMO-000187', conditions: ['asthma'], studies: ['NCT06159127'], base: 0.6, adherence: 0.72, lastActiveAgo: 1, planExpiresIn: 140, careTeam: 'Pulmonary Medicine', heightCm: 152, weightKg: 47.1, ehr: ehrAsthma('2026-08-21', 4, ['Allergy to tree pollen']) },
  { id: 'demo-ava', first: 'Ava', last: 'Thompson', age: 16, sex: 'F', mrn: 'DEMO-000154', conditions: ['asthma'], studies: ['NCT06159127'], base: 0.4, adherence: 0.6, lastActiveAgo: 137, planExpiresIn: -20, careTeam: 'Pulmonary Medicine', heightCm: 165, weightKg: 56.0, ehr: ehrAsthma('2025-12-02', 1) },
  { id: 'demo-lily', first: 'Lily', last: 'Chen', age: 16, sex: 'F', mrn: 'DEMO-000176', conditions: ['asthma'], studies: ['NCT06159127'], base: 0.45, adherence: 0.46, lastActiveAgo: 6, planExpiresIn: 60, careTeam: 'Pulmonary Medicine', heightCm: 161, weightKg: 52.3, ehr: ehrAsthma('2026-05-14', 2, ['Allergy to tree pollen']) },
  { id: 'demo-ethan', first: 'Ethan', last: 'Brooks', age: 17, sex: 'M', mrn: 'DEMO-000203', conditions: ['ibd'], studies: ['DEMO-IBD-PILOT'], base: 0.4, adherence: 0.66, lastActiveAgo: 4, planExpiresIn: 0, careTeam: 'Gastroenterology', heightCm: 176, weightKg: 61.8, ehr: { source: 'synthea', problems: ["Crohn's disease of small intestine", 'Iron deficiency anemia'], allergies: [], medicationsOnFile: ['Mesalamine 1.2 g delayed-release tablet', 'Ferrous sulfate 325 mg tablet'], lastClinicVisit: '2026-09-30', visitsLast12Months: 5 } },
  { id: 'demo-priya', first: 'Priya', last: 'Natarajan', age: 15, sex: 'F', mrn: 'DEMO-000198', conditions: ['migraine'], studies: [], base: 0.38, adherence: 0.86, lastActiveAgo: 2, planExpiresIn: 0, careTeam: 'Neurology' },
  { id: 'demo-noah', first: 'Noah', last: 'Kim', age: 14, sex: 'M', mrn: 'DEMO-000165', conditions: ['asthma'], studies: ['NCT06159127'], base: 0.22, adherence: 0.83, lastActiveAgo: 1, planExpiresIn: 95, careTeam: 'Primary Care' },
  { id: 'demo-sofia', first: 'Sofia', last: 'Martinez', age: 12, sex: 'F', mrn: 'DEMO-000142', conditions: ['asthma'], studies: ['NCT06159127'], base: 0.12, adherence: 0.94, lastActiveAgo: 0, planExpiresIn: 200, careTeam: 'Primary Care', heightCm: 149, weightKg: 40.2, ehr: ehrAsthma('2026-10-01', 2) },
  { id: 'demo-maya', first: 'Maya', last: 'Patel', age: 13, sex: 'F', mrn: 'DEMO-000221', conditions: ['asthma'], studies: ['NCT06159127'], base: 0.35, adherence: 0.8, lastActiveAgo: 0, planExpiresIn: 330, careTeam: 'Pulmonary Medicine', enrollAgo: 9, heightCm: 155, weightKg: 44.0, ehr: ehrAsthma('2026-10-27', 2, ['Allergy to tree pollen']) },
];

const ENROLL_DAYS_AGO = 240;
const PERSONAL_BEST = 450;

// ───────────────────────────── per-day generation ─────────────────────────────

type AnswerValue = string | string[] | number | boolean;
interface RawSubmission {
  responseId: string;
  trackerId: string;
  time: string;
  blank: boolean;
  answers: Record<string, AnswerValue>;
}
interface RawDay {
  date: string;
  active: boolean;
  submissions: RawSubmission[];
  doses: DaySummary['doses'];
  spiro?: { blows: SpirometryBlow[] };
  scheduledExpected: number;
  scheduledTaken: number;
}

interface MedDef {
  key: string;
  name: string;
  regimen: string;
  condition: string;
  perDay: number;
  role: 'controller' | 'preventive' | 'maintenance';
}
interface PrnDef {
  key: string;
  name: string;
  condition: string;
  role: 'rescue' | 'abortive';
  sourceIds: string[];
}

function scheduledMeds(p: MockProfile): MedDef[] {
  const meds: MedDef[] = [];
  if (p.conditions.includes('asthma')) meds.push({ key: 'dulera', name: 'Dulera', regimen: '2 puffs twice daily', condition: 'asthma', perDay: 2, role: 'controller' });
  if (p.conditions.includes('ibd')) meds.push({ key: 'mesalamine', name: 'Mesalamine', regimen: '1.2 g twice daily', condition: 'ibd', perDay: 2, role: 'maintenance' });
  if (p.conditions.includes('migraine'))
    meds.push({ key: 'topiramate', name: 'Topiramate', regimen: '25 mg nightly', condition: 'migraine', perDay: 1, role: 'preventive' });
  return meds;
}
function prnMeds(p: MockProfile): PrnDef[] {
  const meds: PrnDef[] = [];
  if (p.conditions.includes('asthma')) meds.push({ key: 'albuterol', name: 'Albuterol', condition: 'asthma', role: 'rescue', sourceIds: ['4aec1b37-c83a-412a-a4f6-f3d8332c740f'] });
  if (p.conditions.includes('migraine'))
    meds.push({ key: 'excedrin', name: 'Excedrin', condition: 'migraine', role: 'abortive', sourceIds: ['1027ba72-fe17-432d-9904-e72a721d8c2f', 'aecc069e-60a2-413d-b596-25054e662cbb'] });
  return meds;
}

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function feelingFor(s: number): string {
  if (s < 0.22) return 'Great';
  if (s < 0.4) return 'Good';
  if (s < 0.6) return 'Okay';
  if (s < 0.8) return 'Bad';
  return 'Awful';
}

const COACHING = ['Keep going until completely empty', 'Blast out immediately when completely full', "Don't hesitate at the start", 'Avoid coughing during the blow'];

function genDay(p: MockProfile, date: string): RawDay {
  const r = rng(`${p.id}|${date}`);
  const today = MOCK_TODAY;
  const lastActive = addDays(today, -p.lastActiveAgo);
  const enrolled = addDays(today, -enrollAgo(p));
  const inRange = date >= enrolled && date <= lastActive;
  const t = diffDays(enrolled, date);
  const s = clamp(p.base + 0.22 * Math.sin(t / 4.3 + hash(p.id) % 7) + (r() - 0.5) * 0.35, 0, 1);
  const active = inRange && (date === lastActive || r() < 0.86);
  const meds = scheduledMeds(p);
  const expected = date >= enrolled ? meds.reduce((a, m) => a + m.perDay, 0) : 0;

  const day: RawDay = { date, active, submissions: [], doses: [], scheduledExpected: expected, scheduledTaken: 0 };
  if (!active) return day;

  // Scheduled doses
  for (const m of meds) {
    for (let i = 0; i < m.perDay; i++) {
      if (r() < p.adherence) {
        const time = hhmm(i === 0 ? 7 * 60 + r() * 90 : 19 * 60 + r() * 150);
        day.doses.push({ time, medicationName: m.name, kind: 'scheduled', quantity: m.role === 'controller' ? 2 : 1 });
        day.scheduledTaken += 1;
      }
    }
  }

  let symptoms: string[] = [];
  let feeling = feelingFor(s);
  // Discordant days: says Great while reporting symptoms (screenshot 2).
  const discordantPick = r() < 0.12 && s > 0.45;

  for (const cond of p.conditions) {
    const tracker = TRACKER_FOR[cond];
    if (!tracker) continue;
    const ans: Record<string, AnswerValue> = {};
    if (cond === 'asthma') {
      symptoms = s > 0.3 ? ASTHMA_SYMPTOMS.filter(() => r() < (s - 0.2) * 0.6) : [];
      ans.a_feel = discordantPick ? 'Great' : feeling;
      ans.a_sym = symptoms.length ? symptoms : ['None of these'];
      ans.a_night = r() < s * 0.35;
      ans.a_school = weekday(date) % 6 !== 0 && r() < s * 0.14;
      const rescue = symptoms.length > 0 && r() < s * 0.8 ? 1 + Math.floor(r() * 2) : 0;
      ans.a_rescue = rescue;
      for (let i = 0; i < rescue; i++) day.doses.push({ time: hhmm(9 * 60 + r() * 12 * 60), medicationName: 'Albuterol', kind: 'asNeeded', quantity: 2 });
      if (r() < 0.42) {
        const pctPB = clamp(Math.round(102 - s * 60 + (r() - 0.5) * 10), 30, 110);
        const n = 3 + Math.floor(r() * 4);
        const blows: SpirometryBlow[] = [];
        const start = 8 * 60 + r() * 60;
        for (let i = 0; i < n; i++) {
          const pef = Math.round((PERSONAL_BEST * pctPB) / 100 - r() * 25);
          const fev1 = round1((pef / 170) * 1.0 + r() * 0.15);
          const fvc = Math.round((fev1 / (0.72 + r() * 0.1)) * 100) / 100;
          const accepted = r() < 0.62;
          blows.push({
            time: hhmm(start + i * 2),
            accepted,
            qualityLabel: accepted ? 'Acceptable' : r() < 0.5 ? 'Usable' : 'Not acceptable',
            coaching: accepted ? [] : r() < 0.25 ? [COACHING[0], COACHING[1]] : [COACHING[Math.floor(r() * COACHING.length)]],
            fev1L: Math.round(fev1 * 100) / 100,
            fvcL: fvc,
            ratioPct: Math.round((fev1 / fvc) * 100),
            pefLpm: pef,
            fef2575Lps: Math.round(fev1 * 0.9 * 100) / 100,
          });
        }
        day.spiro = { blows };
      }
    } else if (cond === 'migraine') {
      const headache = r() < s * 0.62;
      ans.m_head = headache;
      if (headache) {
        ans.m_pain = clamp(Math.round(3 + s * 6 + (r() - 0.5) * 3), 1, 10);
        ans.m_dur = Math.max(1, Math.round(1 + r() * 6 * s));
        ans.m_trig = MIGRAINE_TRIGGERS.filter(() => r() < 0.28);
        if (!(ans.m_trig as string[]).length) ans.m_trig = ['None'];
        if (r() < 0.6) day.doses.push({ time: hhmm(12 * 60 + r() * 8 * 60), medicationName: 'Excedrin', kind: 'asNeeded', quantity: 1 });
      }
      ans.m_sleep = round1(clamp(9 - s * 3.5 + (r() - 0.5) * 1.5, 4, 11));
    } else if (cond === 'ibd') {
      ans.g_feel = feeling;
      ans.g_stool = clamp(Math.round(1 + s * 5 + (r() - 0.5) * 2), 0, 12);
      ans.g_blood = r() < s * 0.16;
      ans.g_pain = clamp(Math.round(2 + s * 6 + (r() - 0.5) * 2), 1, 10);
      ans.g_school = weekday(date) % 6 !== 0 && r() < s * 0.12;
      if (r() < 0.08) ans.g_note = r() < 0.5 ? 'Stomach hurt after lunch' : 'Felt tired all day';
    }

    // One "used" submission, sometimes with earlier changed answers and blank starts.
    const baseTime = 13 * 60 + r() * 7 * 60;
    const extra = r() < 0.22 ? 1 + Math.floor(r() * 3) : 0;
    const subs: RawSubmission[] = [];
    for (let i = 0; i < extra; i++) {
      const blank = r() < 0.5;
      const early: Record<string, AnswerValue> = {};
      if (!blank && cond !== 'migraine') {
        const fq = cond === 'asthma' ? 'a_feel' : 'g_feel';
        early[fq] = feelingFor(clamp(s + 0.35, 0, 1));
        if (cond === 'asthma') early.a_sym = ans.a_sym;
      } else if (!blank) {
        early.m_head = ans.m_head;
      }
      subs.push({ responseId: `${p.id}-${date}-${cond}-${i}`, trackerId: tracker.id, time: hhmm(baseTime - (extra - i) * (2 + r() * 20)), blank, answers: early });
    }
    subs.push({ responseId: `${p.id}-${date}-${cond}-final`, trackerId: tracker.id, time: hhmm(baseTime), blank: false, answers: ans });
    // Occasional trailing blank (screenshot 2: rows with time but no answers)
    if (r() < 0.12) subs.push({ responseId: `${p.id}-${date}-${cond}-tail`, trackerId: tracker.id, time: hhmm(baseTime + 3 + r() * 30), blank: true, answers: {} });
    day.submissions.push(...subs);
  }
  day.submissions.sort((a, b) => a.time.localeCompare(b.time));
  day.doses.sort((a, b) => a.time.localeCompare(b.time));
  return day;
}

// ───────────────────────────── day → DaySummary ─────────────────────────────

const QUESTION_BY_ID: Record<string, { q: TrackerQuestion; t: TrackerDefinition }> = {};
for (const t of mockTrackers) for (const q of t.questions) QUESTION_BY_ID[q.id] = { q, t };

function displayAnswer(q: TrackerQuestion, v: AnswerValue): string {
  if (Array.isArray(v)) return v.map((x) => q.options?.find((o) => o.value === x)?.label ?? x).join(', ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return q.unit && q.unit !== 'times' ? `${v} ${q.unit}`.replace(' /', '/') : String(v);
  return v;
}

function bestSession(date: string, blows: SpirometryBlow[]): SpirometrySession {
  const acc = blows.filter((b) => b.accepted);
  const pool = acc.length ? acc : blows;
  const bestFev1L = Math.max(...pool.map((b) => b.fev1L));
  const bestFvcL = Math.max(...pool.map((b) => b.fvcL));
  const bestPefLpm = Math.max(...pool.map((b) => b.pefLpm));
  const pctPersonalBest = Math.round((bestPefLpm / PERSONAL_BEST) * 100);
  const zone: Zone = pctPersonalBest >= 80 ? 'green' : pctPersonalBest >= 50 ? 'yellow' : 'red';
  return {
    date,
    bestFev1L,
    bestFvcL,
    ratioPct: Math.round((bestFev1L / bestFvcL) * 100),
    bestPefLpm,
    pctPersonalBest,
    zone,
    acceptableBlows: acc.length,
    totalBlows: blows.length,
    reliable: acc.length > 0,
    blows,
  };
}

function summarizeDay(raw: RawDay): { day: DaySummary; answers: Record<string, AnswerValue> } {
  const answers: Record<string, AnswerValue> = {};
  const lastNonBlank = new Map<string, string>();
  for (const s of raw.submissions) {
    if (!s.blank) lastNonBlank.set(s.trackerId, s.responseId);
    for (const [k, v] of Object.entries(s.answers)) answers[k] = v;
  }
  const feelingLabels = raw.submissions.flatMap((s) => {
    const f = s.answers.a_feel ?? s.answers.g_feel;
    return typeof f === 'string' ? [f] : [];
  });
  const sevOf = (l: string) => FEELING_OPTIONS.find((o) => o.label === l)?.severity ?? 0;
  const lastFeeling = feelingLabels[feelingLabels.length - 1];
  const worst = feelingLabels.reduce<string | undefined>((w, l) => (w === undefined || sevOf(l) > sevOf(w) ? l : w), undefined);

  const symptoms = ((answers.a_sym as string[] | undefined) ?? []).filter((x) => x !== 'None of these');
  const session = raw.spiro ? bestSession(raw.date, raw.spiro.blows) : undefined;
  const rescueSelf = typeof answers.a_rescue === 'number' ? answers.a_rescue : 0;
  const asNeededDoses = raw.doses.filter((d) => d.kind === 'asNeeded').length;
  const asNeededUses = Math.max(rescueSelf, asNeededDoses);
  const feelingSev = lastFeeling ? sevOf(lastFeeling) : undefined;

  let zone: Zone | undefined;
  if (session?.zone) zone = session.zone;
  else if (answers.a_feel !== undefined) zone = symptoms.length >= 2 || rescueSelf > 0 ? 'yellow' : 'green';

  const pain = typeof answers.m_pain === 'number' ? answers.m_pain : typeof answers.g_pain === 'number' ? answers.g_pain : undefined;
  const missedSchool = answers.a_school === true || answers.g_school === true;
  const blood = answers.g_blood === true;
  const symptomDay =
    symptoms.length > 0 || (feelingSev ?? 0) >= 2 || (pain ?? 0) >= 7 || answers.m_head === true || (typeof answers.g_stool === 'number' && answers.g_stool >= 4) || blood;
  const hardDay = (feelingSev ?? 0) >= 2 || zone === 'yellow' || zone === 'red' || (pain ?? 0) >= 7 || missedSchool || blood;
  const discordant = lastFeeling !== undefined && sevOf(lastFeeling) === 0 && (symptoms.length > 0 || (session?.pctPersonalBest ?? 100) < 80);

  const roleValues: Partial<Record<QuestionRole, number | boolean | string[]>> = {};
  for (const [qid, v] of Object.entries(answers)) {
    const role = QUESTION_BY_ID[qid]?.q.role;
    if (!role || role === 'overallFeeling' || role === 'other' || typeof v === 'string') continue;
    roleValues[role] = role === 'symptoms' ? symptoms : v;
  }

  const day: DaySummary = {
    date: raw.date,
    hasData: raw.active,
    submissionCount: raw.submissions.length,
    blankSubmissionCount: raw.submissions.filter((s) => s.blank).length,
    feeling: lastFeeling
      ? {
          label: lastFeeling,
          severity: sevOf(lastFeeling),
          changedDuringDay: new Set(feelingLabels).size > 1,
          worstLabel: worst !== lastFeeling ? worst : undefined,
          sequence: feelingLabels.filter((l, i) => i === 0 || feelingLabels[i - 1] !== l),
        }
      : undefined,
    symptoms,
    symptomDay: raw.active && symptomDay,
    hardDay: raw.active && hardDay,
    zone,
    scheduledDosesTaken: raw.scheduledTaken,
    scheduledDosesExpected: raw.scheduledExpected,
    asNeededUses,
    spirometry: session ? { pefLpm: session.bestPefLpm, fev1L: session.bestFev1L, pctPersonalBest: session.pctPersonalBest, acceptable: session.reliable } : undefined,
    roleValues,
    discordant,
    submissions: raw.submissions.map((s) => ({
      responseId: s.responseId,
      trackerId: s.trackerId,
      time: s.time,
      blank: s.blank,
      usedForDay: !s.blank && lastNonBlank.get(s.trackerId) === s.responseId,
      answers: Object.entries(s.answers).map(([qid, v]) => {
        const q = QUESTION_BY_ID[qid].q;
        return { questionId: qid, shortLabel: q.shortLabel, display: displayAnswer(q, v) };
      }),
    })),
    doses: raw.doses,
  };
  return { day, answers };
}

// ───────────────────────────── voice check-ins & media links ─────────────────────────────

/** Media linked to check-ins (ids match dev/mockMessaging.ts). */
const MEDIA_LINKS: Record<string, Record<number, string[]>> = { 'demo-jordan': { 3: ['m-jr-2', 'm-jr-3'] } };

function transcriptFor(answers: { shortLabel: string; display: string }[]): string {
  const get = (l: string) => answers.find((a) => a.shortLabel === l)?.display;
  const parts: string[] = [];
  const feel = get('Feeling');
  if (feel) parts.push(`Um, I'm feeling ${feel.toLowerCase()} today.`);
  const sym = get('Symptoms');
  parts.push(sym && sym !== 'None' ? `I've got some ${sym.toLowerCase()}.` : 'No symptoms really.');
  const rescue = get('Rescue puffs');
  if (rescue && rescue !== '0') parts.push(`I used my blue inhaler ${rescue === '1' ? 'once' : rescue + ' times'}.`);
  if (get('Night waking') === 'Yes') parts.push('I woke up coughing last night.');
  if (get('Missed school') === 'Yes') parts.push('I stayed home from school.');
  return parts.join(' ');
}

/** Every fourth active day (and today) the final asthma check-in was spoken; link media. */
function addVoiceAndMedia(p: MockProfile, days: DaySummary[]) {
  days.forEach((d) => {
    const ago = diffDays(d.date, MOCK_TODAY);
    const finalSub = d.submissions.find((x) => x.usedForDay && x.trackerId === 'asthma-v2');
    if (finalSub && (ago === 0 || hash(`${p.id}|voice|${d.date}`) % 4 === 0)) {
      finalSub.entryMode = 'voice';
      finalSub.transcript = transcriptFor(finalSub.answers);
    }
    const linked = MEDIA_LINKS[p.id]?.[ago];
    if (linked && finalSub) finalSub.mediaIds = linked;
  });
}

// ───────────────────────────── aggregation helpers ─────────────────────────────

function trendOf(cur: number | null, prev: number | null, higherIsWorse: boolean, fmt: (d: number) => string, priorDays: number): Trend | undefined {
  if (cur === null || prev === null) return { direction: 'unknown', meaning: 'neutral', text: 'No prior data to compare' };
  const d = cur - prev;
  if (Math.abs(d) < 0.05 * Math.max(1, Math.abs(prev))) return { direction: 'flat', meaning: 'neutral', text: `About the same as prior ${priorDays} days` };
  const direction = d > 0 ? 'up' : 'down';
  const worse = higherIsWorse ? d > 0 : d < 0;
  return { direction, meaning: worse ? 'worse' : 'better', text: `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))} vs prior ${priorDays} days` };
}

const statusBy = (v: number | null, good: (v: number) => boolean, watch: (v: number) => boolean): Status =>
  v === null ? 'unknown' : good(v) ? 'good' : watch(v) ? 'watch' : 'concern';

function weeksOf(daily: { date: string; taken: number; expected: number }[]) {
  const buckets = new Map<string, { t: number; e: number }>();
  for (const d of daily) {
    const wd = (weekday(d.date) + 6) % 7;
    const ws = addDays(d.date, -wd);
    const b = buckets.get(ws) ?? { t: 0, e: 0 };
    b.t += Math.min(d.taken, d.expected);
    b.e += d.expected;
    buckets.set(ws, b);
  }
  return [...buckets.entries()].map(([weekStart, b]) => ({ weekStart, pct: b.e ? Math.round((b.t / b.e) * 100) : null }));
}

// ───────────────────────────── summary builder ─────────────────────────────

function buildSummary(p: MockProfile, daysOpt: number | 'all'): PatientSummary {
  const end = MOCK_TODAY;
  const enrolled = addDays(end, -enrollAgo(p));
  const n = daysOpt === 'all' ? diffDays(enrolled, end) + 1 : daysOpt;
  const start = addDays(end, -(n - 1));
  const priorEnd = addDays(start, -1);
  const priorStart = addDays(priorEnd, -(n - 1));
  const range = (a: string, len: number) => Array.from({ length: len }, (_, i) => addDays(a, i));

  const rawDays = range(start, n).map((d) => genDay(p, d));
  const rawPrior = range(priorStart, n).map((d) => genDay(p, d));
  const built = rawDays.map(summarizeDay);
  const prior = rawPrior.map(summarizeDay);
  const days = built.map((b) => b.day);
  addVoiceAndMedia(p, days);
  const priorDays = prior.map((b) => b.day);
  const has = (c: string) => p.conditions.includes(c);
  const trackers = p.conditions.map((c) => TRACKER_FOR[c]).filter(Boolean);

  // Freshness: scan back from end for the most recent activity (all-time).
  let lastActivityDate: string | undefined;
  let lastSpiroRaw: RawDay | undefined;
  for (let i = 0; i <= enrollAgo(p); i++) {
    const d = addDays(end, -i);
    const rd = genDay(p, d);
    if (rd.active && !lastActivityDate) lastActivityDate = d;
    if (rd.spiro && !lastSpiroRaw) lastSpiroRaw = rd;
    if (lastActivityDate && (lastSpiroRaw || !has('asthma'))) break;
  }
  const daysSince = lastActivityDate ? diffDays(lastActivityDate, end) : undefined;
  const activeDaysInWindow = days.filter((d) => d.hasData).length;
  const freshness: PatientSummary['freshness'] = {
    lastActivityAt: lastActivityDate ? `${lastActivityDate}T20:21:00.000-05:00` : undefined,
    lastActivityDate,
    lastTrackerSubmissionDate: lastActivityDate,
    lastMedicationDoseDate: lastActivityDate,
    lastSpirometryDate: lastSpiroRaw?.date,
    daysSinceLastActivity: daysSince,
    status: daysSince === undefined ? 'unknown' : daysSince <= 2 ? 'good' : daysSince <= 7 ? 'watch' : 'concern',
    activeDaysInWindow,
    totalDaysTracked: Math.max(1, Math.round((enrollAgo(p) - p.lastActiveAgo) * 0.86)),
    firstActivityDate: enrolled,
  };

  // Medications
  const medsDef = scheduledMeds(p);
  const scheduled: ScheduledMedicationSummary[] = medsDef.map((m) => {
    const share = (rd: RawDay) => {
      const total = medsDef.reduce((a, x) => a + x.perDay, 0) || 1;
      return { taken: Math.round((rd.scheduledTaken * m.perDay) / total), expected: m.perDay };
    };
    const measuredThrough = lastActivityDate && p.lastActiveAgo > 2 ? lastActivityDate : undefined;
    const daily = rawDays.map((rd) => {
      const x = share(rd);
      return { date: rd.date, taken: x.taken, expected: measuredThrough && rd.date > measuredThrough ? 0 : rd.scheduledExpected ? x.expected : 0 };
    });
    const priorDaily = rawPrior.map((rd) => share(rd));
    const taken = daily.reduce((a, d) => a + Math.min(d.taken, d.expected), 0);
    const expected = daily.reduce((a, d) => a + d.expected, 0);
    const pctV = expected ? Math.round((taken / expected) * 100) : null;
    const pTaken = priorDaily.reduce((a, d) => a + Math.min(d.taken, d.expected), 0);
    const pExp = priorDaily.reduce((a, d) => a + d.expected, 0);
    const pPct = pExp ? Math.round((pTaken / pExp) * 100) : null;
    let streak = 0;
    for (let i = daily.length - 1; i >= 0 && daily[i].expected > 0 && daily[i].taken >= daily[i].expected; i--) streak++;
    const lastTaken = [...daily].reverse().find((d) => d.taken > 0)?.date;
    return {
      key: m.key,
      name: m.name,
      regimen: m.regimen,
      condition: m.condition,
      icon: m.role === 'controller' ? 'inhaler' : 'pill',
      sourceIds: [`${m.key}-0001-4b2c-9d1e-${hash(p.id).toString(16)}`],
      role: m.role,
      dosesTaken: taken,
      dosesExpected: expected,
      adherencePct: pctV,
      fullDosePct: expected ? Math.round((daily.filter((d) => d.expected > 0 && d.taken >= d.expected).length / daily.filter((d) => d.expected > 0).length) * 100) : null,
      status: statusBy(pctV, (v) => v >= 80, (v) => v >= 50),
      trend: trendOf(pctV, pPct, false, (d) => `${Math.round(d)} pts`, n),
      daily,
      measuredThrough,
      weekly: weeksOf(daily),
      lastTakenDate: lastTaken,
      currentStreakDays: streak,
    };
  });

  const asNeeded: AsNeededMedicationSummary[] = prnMeds(p).map((m) => {
    const count = (rd: RawDay) => rd.doses.filter((d) => d.medicationName === m.name).length;
    const daily = rawDays.map((rd) => ({ date: rd.date, uses: count(rd) }));
    const totalUses = daily.reduce((a, d) => a + d.uses, 0);
    const priorUses = rawPrior.reduce((a, rd) => a + count(rd), 0);
    const daysUsed = daily.filter((d) => d.uses > 0).length;
    const perWeek = round1(totalUses / (n / 7));
    return {
      key: m.key,
      name: m.name,
      regimen: 'As needed',
      condition: m.condition,
      icon: m.role === 'rescue' ? 'inhaler' : 'pill',
      sourceIds: m.sourceIds,
      role: m.role,
      totalUses,
      daysUsed,
      perWeek,
      status: perWeek <= 2 ? 'good' : perWeek <= 4 ? 'watch' : 'concern',
      trend: trendOf(totalUses, priorUses, true, (d) => `${Math.round(d)} uses`, n),
      daily,
      lastUsedDate: [...daily].reverse().find((d) => d.uses > 0)?.date,
    };
  });

  const overallTaken = scheduled.reduce((a, m) => a + m.dosesTaken, 0);
  const overallExpected = scheduled.reduce((a, m) => a + m.dosesExpected, 0);
  const medNotes: string[] = [];
  if (has('migraine')) medNotes.push("Doses recorded against an archived 'Excedrin' entry were merged with the active one.");
  medNotes.push('Doses are the patient’s own report of marking a dose taken, not verified administration.');

  // Spirometry
  let spirometry: PatientSummary['spirometry'];
  if (has('asthma')) {
    const sessions = rawDays.filter((rd) => rd.spiro).map((rd) => bestSession(rd.date, rd.spiro!.blows));
    const priorSessions = rawPrior.filter((rd) => rd.spiro).map((rd) => bestSession(rd.date, rd.spiro!.blows));
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const blowsAll = sessions.flatMap((s) => s.blows);
    const pefNow = mean(sessions.map((s) => s.bestPefLpm));
    const pefPrev = mean(priorSessions.map((s) => s.bestPefLpm));
    const fevNow = mean(sessions.map((s) => s.bestFev1L));
    const fevPrev = mean(priorSessions.map((s) => s.bestFev1L));
    const pctNow = mean(sessions.map((s) => s.pctPersonalBest ?? 0));
    spirometry = {
      deviceName: 'MIR Spirobank Smart',
      personalBestPefLpm: PERSONAL_BEST,
      personalBestSource: 'action plan',
      greenThresholdPct: 80,
      redThresholdPct: 50,
      sessions,
      latest: lastSpiroRaw ? bestSession(lastSpiroRaw.date, lastSpiroRaw.spiro!.blows) : undefined,
      sessionsInWindow: sessions.length,
      qualityPct: blowsAll.length ? Math.round((blowsAll.filter((b) => b.accepted).length / blowsAll.length) * 100) : null,
      pefTrend: trendOf(pefNow, pefPrev, false, (d) => `${Math.round(d)} L/min`, n),
      fev1Trend: trendOf(fevNow, fevPrev, false, (d) => `${d.toFixed(2)} L`, n),
      status: statusBy(pctNow, (v) => v >= 80, (v) => v >= 50),
    };
  }

  // Action plan
  let actionPlan: PatientSummary['actionPlan'];
  if (has('asthma')) {
    const zoneDays = { green: 0, yellow: 0, red: 0, unknown: 0 };
    for (const d of days) zoneDays[d.zone ?? 'unknown'] += 1;
    const lastZoneDay = [...days].reverse().find((d) => d.zone);
    const expiresOn = addDays(end, p.planExpiresIn);
    const expired = p.planExpiresIn < 0;
    actionPlan = {
      currentZone: lastZoneDay?.zone,
      currentZoneAsOf: lastZoneDay ? `${lastZoneDay.date}T19:02:00.000-05:00` : undefined,
      expiresOn,
      expired,
      expiresInDays: p.planExpiresIn,
      retestDueAt: `${addDays(end, 3)}T09:00:00.000-05:00`,
      zoneDays,
      method:
        'Each day’s zone uses that day’s best peak flow vs personal best (≥80% green, 50–79% yellow, <50% red). On days without a reading: yellow if 2+ asthma symptoms or any rescue use, otherwise green.',
      status: expired || zoneDays.red > 0 ? 'concern' : p.planExpiresIn <= 30 || zoneDays.yellow > n / 4 ? 'watch' : 'good',
    };
  }

  // Tracker summaries (generic by question type)
  const trackerSummaries: TrackerSummary[] = trackers.map((t) => {
    const subs = rawDays.flatMap((rd) => rd.submissions.filter((s) => s.trackerId === t.id));
    const daysWith = rawDays.filter((rd) => rd.submissions.some((s) => s.trackerId === t.id && !s.blank));
    const collapsed = rawDays.filter((rd) => rd.submissions.filter((s) => s.trackerId === t.id).length > 1).length;
    const questions: QuestionSummary[] = t.questions.map((q) => questionSummary(t, q, built, n));
    return {
      tracker: ref(t),
      submissions: subs.length,
      blankSubmissions: subs.filter((s) => s.blank).length,
      daysWithSubmission: daysWith.length,
      completionPct: Math.round((daysWith.length / n) * 100),
      collapsedDays: collapsed,
      questions,
    };
  });

  // Engagement
  const logged = days.map((d) => d.submissions.some((s) => !s.blank));
  let cur = 0;
  for (let i = logged.length - 1; i >= 0 && logged[i]; i--) cur++;
  let longest = 0;
  let run = 0;
  for (const l of logged) {
    run = l ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const loggingPct = Math.round((logged.filter(Boolean).length / n) * 100);
  const engagement: PatientSummary['engagement'] = {
    loggingPct,
    currentLoggingStreak: cur,
    longestLoggingStreak: longest,
    badges:
      p.lastActiveAgo > 30
        ? [{ name: 'TrackerBadge5', label: '5-day logging streak', date: addDays(end, -p.lastActiveAgo - 20) }]
        : [
            { name: 'TrackerBadge10', label: '10-day logging streak', date: addDays(end, -9) },
            { name: 'MedBadge7', label: 'A full week of controller doses', date: addDays(end, -16) },
            { name: 'TrackerBadge5', label: '5-day logging streak', date: addDays(end, -41) },
          ],
    status: statusBy(loggingPct, (v) => v >= 70, (v) => v >= 40),
  };

  // Headline metrics
  const headline = buildHeadline(p, days, priorDays, n, scheduled, asNeeded, spirometry, actionPlan, engagement);

  // Flags
  const flags = buildFlags(p, days, scheduled, spirometry, actionPlan, freshness, trackerSummaries);

  // Data quality
  const blankTotal = trackerSummaries.reduce((a, t) => a + t.blankSubmissions, 0);
  const collapsedTotal = trackerSummaries.reduce((a, t) => a + t.collapsedDays, 0);
  const dataQuality: DataQualityNote[] = [];
  if (collapsedTotal)
    dataQuality.push({ id: 'collapsed', level: 'info', text: `${collapsedTotal} days had more than one submission; the last non-empty answer of each day is used.` });
  if (blankTotal) dataQuality.push({ id: 'blank', level: 'info', text: `${blankTotal} submissions had no answers (started and closed). They are shown in the day view but not counted.` });
  dataQuality.push({ id: 'legacy-flag', level: 'info', text: 'The legacy “All medications administered” field is ignored; adherence is computed from recorded doses.' });
  if (spirometry) {
    const unreliable = spirometry.sessions.filter((s) => !s.reliable).length;
    if (unreliable)
      dataQuality.push({ id: 'spiro-unreliable', level: 'warning', text: `${unreliable} spirometry sessions had no acceptable blow; their values are shown as low confidence.` });
  }
  if (has('migraine')) dataQuality.push({ id: 'dup-med', level: 'info', text: "'Excedrin' appears twice in the medication list (one archived); doses from both are merged." });

  // Patient-facing
  const hardDays = days.filter((d) => d.hardDay).length;
  const noDataDays = days.filter((d) => !d.hasData && d.date >= enrolled).length;
  const goodDays = days.filter((d) => d.date >= enrolled).length - hardDays - noDataDays;
  const points: PatientFacingPoint[] = [];
  const main = scheduled.find((m) => m.adherencePct !== null);
  if (main) {
    const streak = main.currentStreakDays >= 2 ? ` You’re on a ${main.currentStreakDays}-day streak of taking every dose. Keep it going!` : '';
    points.push({ key: 'medication', text: `You marked ${main.name} as taken on ${main.daily.filter((d) => d.taken > 0).length} of ${main.daily.filter((d) => d.expected > 0).length} days.${streak}` });
  }
  const rescue = asNeeded.find((m) => m.role === 'rescue');
  if (rescue) points.push({ key: 'rescue', text: `You used your rescue inhaler on ${rescue.daysUsed} ${rescue.daysUsed === 1 ? 'day' : 'days'}.` });
  const abortive = asNeeded.find((m) => m.role === 'abortive');
  if (abortive) points.push({ key: 'abortive', text: `You took ${abortive.name} for a headache on ${abortive.daysUsed} ${abortive.daysUsed === 1 ? 'day' : 'days'}.` });
  if (spirometry && spirometry.sessions.length) {
    const good = spirometry.sessions.filter((x) => (x.pctPersonalBest ?? 0) >= 80).length;
    points.push({ key: 'lungFunction', text: `You did ${spirometry.sessions.length} breathing tests. ${good} of them were in your green zone.` });
  }
  const symptomCounts = new Map<string, number>();
  for (const d of days) for (const x of d.symptoms) symptomCounts.set(x, (symptomCounts.get(x) ?? 0) + 1);
  const topSymptom = [...symptomCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topSymptom) points.push({ key: 'symptoms', text: `${topSymptom[0]} was the symptom you noticed most, on ${topSymptom[1]} days.` });
  else if (has('migraine')) points.push({ key: 'symptoms', text: `You had a headache on ${days.filter((d) => d.roleValues.headache === true).length} days.` });
  else if (has('ibd')) points.push({ key: 'symptoms', text: `You noticed blood on ${days.filter((d) => d.roleValues.bloodInStool === true).length} days.` });
  const missed = days.filter((d) => d.roleValues.missedSchool === true).length;
  if (has('asthma') || has('ibd')) points.push({ key: 'school', text: missed ? `You missed school on ${missed} ${missed === 1 ? 'day' : 'days'}.` : 'You didn’t miss any school. Great job!' });
  if (engagement.longestLoggingStreak >= 3) points.push({ key: 'checkins', text: `Your longest check-in streak was ${engagement.longestLoggingStreak} days in a row.` });
  const periodWord = n <= 31 ? 'This month' : daysOpt === 'all' ? 'Since you started' : `In the last ${n} days`;

  return {
    generatedAt: `${end}T00:00:00.000Z`,
    today: end,
    patient: {
      id: p.id,
      displayName: `${p.first} ${p.last}`,
      initials: `${p.first[0]}${p.last[0]}`,
      ageYears: p.age,
      sex: p.sex,
      mrn: p.mrn,
      careTeam: p.careTeam,
      trackers: trackers.map(ref),
      studyIds: p.studies,
      enrolledSince: enrolled,
      enrolledDays: diffDays(enrolled, end),
      heightCm: p.heightCm,
      weightKg: p.weightKg,
      ehr: p.ehr,
    },
    window: { start, end, days: n, label: daysOpt === 'all' ? 'All time' : `Last ${n} days`, prior: { start: priorStart, end: priorEnd } },
    freshness,
    headline,
    flags,
    days,
    trackers: trackerSummaries,
    medications: { scheduled, asNeeded, overallAdherencePct: overallExpected ? Math.round((overallTaken / overallExpected) * 100) : null, notes: medNotes },
    spirometry,
    actionPlan,
    engagement,
    dataQuality,
    patientFacing: {
      headline:
        activeDaysInWindow === 0
          ? 'We don’t have any check-ins from this period yet.'
          : `${periodWord} you had ${goodDays} good ${goodDays === 1 ? 'day' : 'days'} and ${hardDays} hard ${hardDays === 1 ? 'day' : 'days'}.`,
      points,
      goodDays,
      hardDays,
      noDataDays,
    },
  };
}

function questionSummary(t: TrackerDefinition, q: TrackerQuestion, built: { day: DaySummary; answers: Record<string, AnswerValue> }[], n: number): QuestionSummary {
  const base = { questionId: q.id, trackerId: t.id, text: q.text, shortLabel: q.shortLabel, type: q.type, role: q.role, windowDays: n };
  const vals = built.map((b) => ({ date: b.day.date, v: b.answers[q.id] }));
  const answered = vals.filter((x) => x.v !== undefined && !(Array.isArray(x.v) && x.v.length === 0));
  switch (q.type) {
    case 'faceScale':
    case 'iconChoice':
    case 'singleChoice': {
      const opts = q.options ?? [];
      return {
        ...base,
        kind: 'categorical',
        answeredDays: answered.length,
        distribution: opts.map((o) => {
          const c = answered.filter((x) => x.v === o.value).length;
          return { label: o.label, days: c, pct: answered.length ? Math.round((c / answered.length) * 100) : 0, severity: o.severity };
        }),
        series: vals.map((x) => {
          const o = opts.find((op) => op.value === x.v);
          return { date: x.date, label: o?.label ?? null, severity: o?.severity };
        }),
      };
    }
    case 'checkbox': {
      const noneVals = new Set((q.options ?? []).filter((o) => o.isNone).map((o) => o.value));
      const labels = (q.options ?? []).filter((o) => !o.isNone);
      const items = labels
        .map((o) => {
          const c = answered.filter((x) => (x.v as string[]).includes(o.value)).length;
          return { label: o.label, days: c, pct: answered.length ? Math.round((c / answered.length) * 100) : 0 };
        })
        .sort((a, b) => b.days - a.days);
      return {
        ...base,
        kind: 'multi',
        answeredDays: answered.length,
        items,
        anyDays: answered.filter((x) => (x.v as string[]).some((v) => !noneVals.has(v))).length,
        series: vals.map((x) => ({ date: x.date, items: x.v === undefined ? null : (x.v as string[]).filter((v) => !noneVals.has(v)) })),
      };
    }
    case 'number':
    case 'scale1to10': {
      const nums = answered.map((x) => x.v as number);
      const direction = q.direction ?? 'higherIsWorse';
      const thr = q.concernThreshold;
      const mean = nums.length ? round1(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
      return {
        ...base,
        kind: 'numeric',
        answeredDays: answered.length,
        unit: q.unit,
        min: q.min,
        max: q.max,
        direction,
        concernThreshold: thr,
        stats: {
          mean,
          min: nums.length ? Math.min(...nums) : null,
          max: nums.length ? Math.max(...nums) : null,
          last: nums.length ? nums[nums.length - 1] : null,
          daysAtConcern: thr === undefined ? 0 : nums.filter((v) => (direction === 'higherIsWorse' ? v >= thr : v < thr)).length,
        },
        series: vals.map((x) => ({ date: x.date, value: typeof x.v === 'number' ? x.v : null })),
      };
    }
    case 'yesNo': {
      const yes = answered.filter((x) => x.v === true).length;
      return {
        ...base,
        kind: 'boolean',
        answeredDays: answered.length,
        yesDays: yes,
        noDays: answered.length - yes,
        yesPct: answered.length ? Math.round((yes / answered.length) * 100) : 0,
        series: vals.map((x) => ({ date: x.date, value: typeof x.v === 'boolean' ? x.v : null })),
      };
    }
    default:
      return {
        ...base,
        kind: 'text',
        answeredDays: answered.length,
        recent: answered
          .filter((x) => typeof x.v === 'string' && x.v.trim())
          .reverse()
          .slice(0, 10)
          .map((x) => ({ date: x.date, text: x.v as string })),
      };
  }
}

function buildHeadline(
  p: MockProfile,
  days: DaySummary[],
  priorDays: DaySummary[],
  n: number,
  scheduled: ScheduledMedicationSummary[],
  asNeeded: AsNeededMedicationSummary[],
  spirometry: PatientSummary['spirometry'],
  actionPlan: PatientSummary['actionPlan'],
  engagement: PatientSummary['engagement'],
): HeadlineMetric[] {
  const has = (c: string) => p.conditions.includes(c);
  const out: HeadlineMetric[] = [];
  const count = (ds: DaySummary[], f: (d: DaySummary) => boolean) => ds.filter(f).length;
  const spark = (f: (d: DaySummary) => number | null) => days.map((d) => ({ date: d.date, value: d.hasData ? f(d) : null }));
  const countMetric = (
    id: HeadlineMetricId,
    label: string,
    condition: string,
    f: (d: DaySummary) => boolean,
    method: string,
    thresholds: [number, number],
    unitWord = 'days',
  ) => {
    const cur = count(days, f);
    const prev = count(priorDays, f);
    const rate = cur / n;
    out.push({
      id,
      label,
      value: `${cur} of ${n}`,
      numericValue: cur,
      detail: `${unitWord} in ${n <= 31 ? 'the last ' + n + ' days' : 'this window'}`,
      status: rate <= thresholds[0] ? 'good' : rate <= thresholds[1] ? 'watch' : 'concern',
      trend: trendOf(cur, prev, true, (d) => `${Math.round(d)}`, n),
      sparkline: spark((d) => (f(d) ? 1 : 0)),
      method,
      condition,
    });
  };

  if (has('asthma') && actionPlan) {
    const z = actionPlan.currentZone;
    out.push({
      id: 'zone',
      label: 'Action plan zone',
      value: z ? z.charAt(0).toUpperCase() + z.slice(1) : 'Unknown',
      detail: `${actionPlan.zoneDays.yellow} yellow and ${actionPlan.zoneDays.red} red days in window`,
      status: z === 'green' ? 'good' : z === 'yellow' ? 'watch' : z === 'red' ? 'concern' : 'unknown',
      sparkline: spark((d) => (d.zone === 'green' ? 0 : d.zone === 'yellow' ? 1 : d.zone === 'red' ? 2 : null)),
      method: 'Most recent day with a derived zone (peak flow vs personal best, or symptoms and rescue use on days without a reading).',
      condition: 'asthma',
    });
  }
  const adherenceMetric = (id: HeadlineMetricId, label: string, meds: ScheduledMedicationSummary[], condition: string) => {
    if (!meds.length) return;
    const taken = meds.reduce((a, m) => a + m.dosesTaken, 0);
    const expected = meds.reduce((a, m) => a + m.dosesExpected, 0);
    const pctV = expected ? Math.round((taken / expected) * 100) : null;
    const through = meds.find((m) => m.measuredThrough)?.measuredThrough;
    out.push({
      id,
      label,
      value: pctV === null ? 'No data' : `${pctV}%`,
      numericValue: pctV ?? undefined,
      detail:
        pctV === null
          ? 'No days with app activity to measure'
          : `${taken} of ${expected} ${meds.map((m) => m.name).join(' + ')} doses marked taken${through ? `, measured through ${human(through)}` : ''}`,
      status: statusBy(pctV, (v) => v >= 80, (v) => v >= 50),
      trend: meds.length === 1 ? meds[0].trend : undefined,
      sparkline: days.map((d) => {
        const e = meds.reduce((a, m) => a + (m.daily.find((x) => x.date === d.date)?.expected ?? 0), 0);
        const t = meds.reduce((a, m) => {
          const x = m.daily.find((y) => y.date === d.date);
          return a + (x ? Math.min(x.taken, x.expected) : 0);
        }, 0);
        return { date: d.date, value: e ? Math.round((t / e) * 100) : null };
      }),
      method: 'Doses marked taken (capped at the scheduled number each day) divided by doses scheduled, counting only days up to the last app activity.',
      condition,
    });
  };
  const controllers = scheduled.filter((m) => m.role === 'controller');
  const others = scheduled.filter((m) => m.role !== 'controller');
  adherenceMetric('controllerAdherence', 'Controller adherence', controllers, 'asthma');
  adherenceMetric('medicationAdherence', others.length === 1 && others[0].role === 'maintenance' ? 'Maintenance adherence' : others.length === 1 ? 'Preventive adherence' : 'Medication adherence', others, others[0]?.condition ?? 'general');
  if (has('asthma') || has('ibd'))
    countMetric('symptomDays', 'Symptom days', has('asthma') ? 'asthma' : 'ibd', (d) => d.symptomDay, 'Days with any symptom reported, feeling Bad or worse, or a symptom score at the concern level.', [0.15, 0.35]);
  for (const m of asNeeded) {
    const id: HeadlineMetricId = m.role === 'rescue' ? 'rescueUse' : 'abortiveUse';
    if (out.some((x) => x.id === id)) continue;
    out.push({
      id,
      label: m.role === 'rescue' ? 'Rescue inhaler use' : 'Abortive med use',
      value: `${m.perWeek}/wk`,
      numericValue: m.perWeek,
      detail: `${m.totalUses} uses on ${m.daysUsed} days (${m.name})`,
      status: m.status,
      trend: m.trend,
      sparkline: m.daily.map((d) => ({ date: d.date, value: d.uses })),
      method: 'Recorded as-needed doses or self-reported uses, whichever is higher each day, averaged per week.',
      condition: m.condition ?? 'general',
    });
  }
  if (spirometry && spirometry.sessions.length) {
    const avg = Math.round(spirometry.sessions.reduce((a, s) => a + (s.pctPersonalBest ?? 0), 0) / spirometry.sessions.length);
    out.push({
      id: 'lungFunction',
      label: 'Peak flow',
      value: `${avg}%`,
      numericValue: avg,
      detail: `Average of personal best across ${spirometry.sessions.length} sessions`,
      status: spirometry.status,
      trend: spirometry.pefTrend,
      sparkline: days.map((d) => ({ date: d.date, value: d.spirometry?.pctPersonalBest ?? null })),
      method: 'Best peak flow of each session (acceptable blows preferred) as a percentage of the personal best on the action plan.',
      condition: 'asthma',
    });
  }
  countMetric('hardDays', 'Hard days', 'general', (d) => d.hardDay, 'Days with feeling Bad or worse, a yellow/red zone, high pain, missed school, or blood in stool.', [0.15, 0.35]);
  if (has('asthma')) countMetric('nightWaking', 'Night waking', 'asthma', (d) => d.roleValues.nightWaking === true, 'Days the patient answered Yes to waking at night from asthma.', [0.1, 0.2], 'nights');
  if (has('asthma') || has('ibd'))
    countMetric('missedSchool', 'Missed school', 'general', (d) => d.roleValues.missedSchool === true, 'Days the patient answered Yes to missing school.', [0.02, 0.1]);
  if (has('migraine')) {
    countMetric('headacheDays', 'Headache days', 'migraine', (d) => d.roleValues.headache === true, 'Days the patient answered Yes to having a headache.', [0.13, 0.27]);
  }
  if (has('migraine')) {
    const sl = days.map((d) => d.roleValues.sleepHours).filter((v): v is number => typeof v === 'number');
    const psl = priorDays.map((d) => d.roleValues.sleepHours).filter((v): v is number => typeof v === 'number');
    const avg = sl.length ? round1(sl.reduce((a, b) => a + b, 0) / sl.length) : null;
    const pavg = psl.length ? round1(psl.reduce((a, b) => a + b, 0) / psl.length) : null;
    out.push({
      id: 'sleepHours',
      label: 'Sleep',
      value: avg === null ? 'No data' : `${avg} h`,
      numericValue: avg ?? undefined,
      detail: `${sl.filter((v) => v < 7).length} of ${sl.length} nights under 7 hours`,
      status: statusBy(avg, (v) => v >= 8, (v) => v >= 7),
      trend: trendOf(avg, pavg, false, (d) => `${d.toFixed(1)} h`, n),
      sparkline: days.map((d) => ({ date: d.date, value: typeof d.roleValues.sleepHours === 'number' ? d.roleValues.sleepHours : null })),
      method: 'Mean of the hours-slept answer on days it was given.',
      condition: 'migraine',
    });
  }
  if (has('migraine') || has('ibd')) {
    const pains = days.map((d) => d.roleValues.painSeverity).filter((v): v is number => typeof v === 'number');
    const prevPains = priorDays.map((d) => d.roleValues.painSeverity).filter((v): v is number => typeof v === 'number');
    const avg = pains.length ? round1(pains.reduce((a, b) => a + b, 0) / pains.length) : null;
    const pavg = prevPains.length ? round1(prevPains.reduce((a, b) => a + b, 0) / prevPains.length) : null;
    out.push({
      id: 'painAverage',
      label: 'Average pain',
      value: avg === null ? '—' : `${avg}/10`,
      numericValue: avg ?? undefined,
      detail: `${pains.length} days rated, ${pains.filter((v) => v >= 7).length} at 7 or above`,
      status: statusBy(avg, (v) => v < 4, (v) => v < 6.5),
      trend: trendOf(avg, pavg, true, (d) => d.toFixed(1), n),
      sparkline: days.map((d) => ({ date: d.date, value: typeof d.roleValues.painSeverity === 'number' ? d.roleValues.painSeverity : null })),
      method: 'Mean of the daily 1–10 pain rating on days it was answered.',
      condition: has('migraine') ? 'migraine' : 'ibd',
    });
  }
  if (has('ibd')) {
    const st = days.map((d) => d.roleValues.stoolFrequency).filter((v): v is number => typeof v === 'number');
    const avg = st.length ? round1(st.reduce((a, b) => a + b, 0) / st.length) : null;
    out.push({
      id: 'stoolFrequency',
      label: 'Stool frequency',
      value: avg === null ? '—' : `${avg}/day`,
      numericValue: avg ?? undefined,
      detail: `${st.filter((v) => v >= 4).length} days with 4 or more`,
      status: statusBy(avg, (v) => v < 3, (v) => v < 4.5),
      sparkline: days.map((d) => ({ date: d.date, value: typeof d.roleValues.stoolFrequency === 'number' ? d.roleValues.stoolFrequency : null })),
      method: 'Mean of the daily stool count on days it was answered.',
      condition: 'ibd',
    });
    countMetric('bloodInStool', 'Blood in stool', 'ibd', (d) => d.roleValues.bloodInStool === true, 'Days the patient answered Yes to seeing blood.', [0, 0.07]);
  }
  out.push({
    id: 'loggingConsistency',
    label: 'Logging',
    value: `${engagement.loggingPct}%`,
    numericValue: engagement.loggingPct,
    detail: `Current streak ${engagement.currentLoggingStreak} days, longest ${engagement.longestLoggingStreak}`,
    status: engagement.status,
    sparkline: days.map((d) => ({ date: d.date, value: d.submissions.some((s) => !s.blank) ? 1 : 0 })),
    method: 'Days with at least one non-empty tracker submission divided by days in the window.',
    condition: 'general',
  });
  return out;
}

function buildFlags(
  p: MockProfile,
  days: DaySummary[],
  scheduled: ScheduledMedicationSummary[],
  spirometry: PatientSummary['spirometry'],
  actionPlan: PatientSummary['actionPlan'],
  freshness: PatientSummary['freshness'],
  trackers: TrackerSummary[],
): ClinicalFlag[] {
  const flags: ClinicalFlag[] = [];
  const n = days.length;
  if ((freshness.daysSinceLastActivity ?? 0) > 7)
    flags.push({
      id: 'engagement-stale',
      severity: 'high',
      category: 'engagement',
      title: `No app activity for ${freshness.daysSinceLastActivity} days`,
      detail: `Last check-in, dose or reading was on ${human(freshness.lastActivityDate!)}. Consider a call before the visit.`,
      condition: 'general',
    });
  for (const m of scheduled) {
    if (m.adherencePct === null || m.adherencePct >= 80) continue;
    const full = m.daily.filter((d) => d.taken >= d.expected).length;
    flags.push({
      id: `adherence-low-${m.key}`,
      severity: m.adherencePct < 50 || (m.role === 'controller' && m.adherencePct < 65) ? 'high' : 'medium',
      category: 'adherence',
      title: `${m.name} taken fully on ${full} of ${n} days`,
      detail: `${m.adherencePct}% of scheduled doses marked taken. Before changing treatment, check whether it is being taken.`,
      dates: m.daily.filter((d) => d.taken < d.expected).map((d) => d.date),
      condition: m.condition ?? 'general',
    });
  }
  if (spirometry) {
    const red = spirometry.sessions.filter((s) => s.zone === 'red');
    const low = spirometry.sessions.filter((s) => (s.pctPersonalBest ?? 100) < 80);
    if (red.length)
      flags.push({
        id: 'lung-red',
        severity: 'high',
        category: 'lungFunction',
        title: `Peak flow under 50% of personal best on ${red.length} ${red.length === 1 ? 'day' : 'days'}`,
        detail: `Lowest ${Math.min(...red.map((s) => s.pctPersonalBest ?? 0))}% of ${spirometry.personalBestPefLpm} L/min.`,
        dates: red.map((s) => s.date),
        condition: 'asthma',
      });
    else if (low.length >= 2)
      flags.push({
        id: 'lung-low',
        severity: 'medium',
        category: 'lungFunction',
        title: `Peak flow below 80% on ${low.length} of ${spirometry.sessions.length} sessions`,
        detail: 'Readings in the yellow zone of the action plan. Check technique and controller use.',
        dates: low.map((s) => s.date),
        condition: 'asthma',
      });
  }
  const disc = days.filter((d) => d.discordant);
  if (disc.length)
    flags.push({
      id: 'discordance',
      severity: 'medium',
      category: 'discordance',
      title: `Said “Great” or “Good” while reporting symptoms on ${disc.length} days`,
      detail: 'Feeling answers may understate symptoms. Compare with peak flow and rescue use on these days.',
      dates: disc.map((d) => d.date),
      condition: 'asthma',
    });
  const sym = days.filter((d) => d.symptomDay && d.symptoms.length);
  if (sym.length >= n * 0.3)
    flags.push({
      id: 'symptoms-frequent',
      severity: 'medium',
      category: 'symptoms',
      title: `Asthma symptoms on ${sym.length} of ${n} days`,
      detail: 'More than twice a week suggests asthma is not well controlled.',
      dates: sym.map((d) => d.date),
      condition: 'asthma',
    });
  const head = days.filter((d) => d.roleValues.headache === true);
  if (p.conditions.includes('migraine') && head.length >= Math.max(4, n * 0.2))
    flags.push({
      id: 'migraine-frequency',
      severity: 'medium',
      category: 'symptoms',
      title: `Headache on ${head.length} of ${n} days`,
      detail: 'Frequent headaches; consider reviewing preventive treatment and abortive use.',
      dates: head.map((d) => d.date),
      condition: 'migraine',
    });
  const blood = days.filter((d) => d.roleValues.bloodInStool === true);
  if (blood.length)
    flags.push({
      id: 'ibd-blood',
      severity: blood.length >= 3 ? 'high' : 'medium',
      category: 'symptoms',
      title: `Blood in stool reported on ${blood.length} ${blood.length === 1 ? 'day' : 'days'}`,
      detail: 'Patient-reported; review with stool frequency and pain trend.',
      dates: blood.map((d) => d.date),
      condition: 'ibd',
    });
  if (actionPlan && (actionPlan.expired || (actionPlan.expiresInDays ?? 999) <= 30))
    flags.push({
      id: 'plan-expiry',
      severity: actionPlan.expired ? 'high' : 'medium',
      category: 'actionPlan',
      title: actionPlan.expired ? 'Asthma action plan has expired' : `Action plan expires in ${actionPlan.expiresInDays} days`,
      detail: `Plan on file ${actionPlan.expired ? 'expired' : 'expires'} on ${human(actionPlan.expiresOn!)}. Update it at this visit.`,
      condition: 'asthma',
    });
  const blank = trackers.reduce((a, t) => a + t.blankSubmissions, 0);
  if (blank >= 3)
    flags.push({
      id: 'dq-blank',
      severity: 'low',
      category: 'dataQuality',
      title: `${blank} empty tracker submissions`,
      detail: 'Started and closed without answers; not counted in any metric.',
      dates: days.filter((d) => d.blankSubmissionCount > 0).map((d) => d.date),
      condition: 'general',
    });
  const rank = { high: 0, medium: 1, low: 2 };
  return flags.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ───────────────────────────── exports ─────────────────────────────

const cache = new Map<string, PatientSummary>();

/** Mock summary for a known demo patient id, or undefined (→ 404). */
export function getMockSummary(id: string, days: number | 'all' = 30): PatientSummary | undefined {
  const p = PROFILES.find((x) => x.id === id);
  if (!p) return undefined;
  const key = `${id}|${days}`;
  if (!cache.has(key)) cache.set(key, buildSummary(p, days));
  return cache.get(key);
}

function listItem(p: MockProfile): PatientListItem {
  const s = getMockSummary(p.id, 30)!;
  const zoneDay = [...s.days].reverse().find((d) => d.zone);
  const high = s.flags.filter((f) => f.severity === 'high').length;
  const medium = s.flags.filter((f) => f.severity === 'medium').length;
  const adh = s.medications.overallAdherencePct;
  const adhStatus = statusBy(adh, (v) => v >= 80, (v) => v >= 50);
  const zone = zoneDay?.zone ?? s.actionPlan?.currentZone;
  const symptomDays30d = s.days.filter((d) => d.symptomDay).length;
  const score =
    high * 25 +
    medium * 8 +
    (s.freshness.status === 'concern' ? 20 : s.freshness.status === 'watch' ? 8 : 0) +
    (zone === 'red' ? 20 : zone === 'yellow' ? 8 : 0) +
    (adhStatus === 'concern' ? 15 : adhStatus === 'watch' ? 6 : 0) +
    symptomDays30d * 0.5;
  return {
    id: p.id,
    displayName: s.patient.displayName,
    initials: s.patient.initials,
    ageYears: p.age,
    mrn: p.mrn,
    trackers: s.patient.trackers,
    studyIds: p.studies,
    lastActivityDate: s.freshness.lastActivityDate,
    daysSinceLastActivity: s.freshness.daysSinceLastActivity,
    freshnessStatus: s.freshness.status,
    currentZone: zone,
    adherencePct30d: adh,
    adherenceStatus: adhStatus,
    symptomDays30d,
    highFlags: high,
    mediumFlags: medium,
    topFlag: s.flags[0]?.title,
    attentionScore: Math.round(score),
  };
}

export const mockPatientList: PatientListResponse = {
  today: MOCK_TODAY,
  patients: PROFILES.map(listItem),
};

/** The primary demo patient (asthma + migraine, 30-day window). */
export const mockSummary: PatientSummary = getMockSummary('demo-jordan', 30)!;
