/**
 * DEV-ONLY mock API. Loaded (via dynamic import in api.ts) only when
 * import.meta.env.VITE_USE_MOCKS === 'true'. Two synthetic patients: an asthma patient with a
 * Spirobank and action plan, and a migraine patient. State lives in memory for the session.
 */
import type {
  CreateMedicationDoseRequest,
  CreateSpirometrySessionRequest,
  CreateTrackerResponseRequest,
  PatientAppHome,
  PatientListResponse,
  WriteResult,
} from '@shared/types/api';
import type { RawPatientDocument } from '@shared/types/raw';
import type { PatientListItem, Zone } from '@shared/types/summary';
import type { QuestionOption, TrackerDefinition } from '@shared/types/tracker';
import type { HttpMethod } from '../api';
import { ApiError } from '../lib/errors';
import { bestBlow, pctOfBest, pefLpm, zoneFor } from '../lib/spirometer';
import { addDays, hhmm, localDay, localIso } from '../lib/time';
import {
  MOCK_AI_STATUS,
  MOCK_CLINICIANS,
  mockConversationRoute,
  mockDeleteMedia,
  mockListConversations,
  mockListMedia,
  mockParseVoice,
  mockStartConversation,
} from './mockAi';

export { mockSubscribe, mockUpload } from './mockAi';

const FACES: QuestionOption[] = [
  { value: 'Great', label: 'Great', severity: 0, icon: '😀' },
  { value: 'Good', label: 'Good', severity: 0, icon: '🙂' },
  { value: 'Okay', label: 'Okay', severity: 1, icon: '😐' },
  { value: 'Bad', label: 'Bad', severity: 2, icon: '🙁' },
  { value: 'Awful', label: 'Awful', severity: 3, icon: '😫' },
];

export const MOCK_ASTHMA_TRACKER: TrackerDefinition = {
  id: 'asthma-v3',
  name: 'Asthma Education Draft Tracker',
  condition: 'asthma',
  conditionLabel: 'Asthma',
  version: 3,
  questions: [
    { id: 'asthma-spirometer', text: 'Please complete your spirometer reading', shortLabel: 'Spirometer', type: 'spirometry', role: 'spirometry', order: 1 },
    { id: 'asthma-feeling', text: 'How are you feeling today?', shortLabel: 'Feeling', type: 'faceScale', role: 'overallFeeling', options: FACES, order: 2 },
    {
      id: 'asthma-symptoms',
      text: 'Please select the following symptoms that you are currently experiencing',
      shortLabel: 'Symptoms',
      type: 'checkbox',
      role: 'symptoms',
      options: [
        { value: 'Coughing', label: 'Coughing', severity: 1 },
        { value: 'Wheezing', label: 'Wheezing', severity: 2 },
        { value: 'Tight Chest', label: 'Tight chest', severity: 2 },
        { value: 'Shortness Of Breath', label: 'Shortness of breath', severity: 2 },
        { value: 'Activity limitations', label: 'Activity limitations', severity: 2 },
        { value: 'None of these ', label: 'None of these', severity: 0, isNone: true },
      ],
      order: 3,
    },
    { id: 'asthma-night-waking', text: 'Did you wake up at night because of asthma?', shortLabel: 'Night waking', type: 'yesNo', role: 'nightWaking', order: 4 },
    { id: 'asthma-missed-school', text: 'Did you miss school today because of asthma?', shortLabel: 'Missed school', type: 'yesNo', role: 'missedSchool', order: 5 },
    {
      id: 'asthma-rescue-uses',
      text: 'How many times did you use your rescue inhaler today?',
      shortLabel: 'Rescue inhaler uses',
      type: 'number',
      role: 'rescueMedUse',
      min: 0,
      max: 12,
      unit: 'times',
      order: 6,
    },
    {
      id: 'asthma-triggers',
      text: 'What may have triggered your symptoms?',
      shortLabel: 'Triggers',
      type: 'checkbox',
      role: 'triggers',
      options: [
        { value: 'Exercise', label: 'Exercise' },
        { value: 'Cold air', label: 'Cold air' },
        { value: 'Pollen', label: 'Pollen' },
        { value: 'Smoke', label: 'Smoke' },
        { value: 'Pets', label: 'Pets' },
        { value: 'None', label: 'None', isNone: true },
      ],
      order: 7,
    },
    { id: 'asthma-notes', text: 'Anything else you want your care team to know?', shortLabel: 'Notes', type: 'text', role: 'other', order: 8 },
  ],
};

export const MOCK_MIGRAINE_TRACKER: TrackerDefinition = {
  id: 'migraine-v2',
  name: 'Headache & Migraine Tracker',
  condition: 'migraine',
  conditionLabel: 'Migraine',
  version: 2,
  questions: [
    { id: 'migraine-headache', text: 'Did you have a headache today?', shortLabel: 'Headache', type: 'yesNo', role: 'headache', order: 1 },
    {
      id: 'migraine-pain',
      text: 'How bad was your headache at its worst? (1 = barely noticeable, 10 = worst ever)',
      shortLabel: 'Pain (1–10)',
      type: 'scale1to10',
      role: 'painSeverity',
      min: 1,
      max: 10,
      order: 2,
    },
    { id: 'migraine-duration', text: 'How many hours did your headache last?', shortLabel: 'Duration', type: 'number', role: 'headacheDurationHours', min: 0, max: 24, unit: 'hours', order: 3 },
    {
      id: 'migraine-where',
      text: 'Where was the pain?',
      shortLabel: 'Where',
      type: 'singleChoice',
      role: 'other',
      options: [
        { value: 'Front', label: 'Front of my head' },
        { value: 'One side', label: 'One side' },
        { value: 'Both sides', label: 'Both sides' },
        { value: 'Back', label: 'Back of my head' },
      ],
      order: 4,
    },
    {
      id: 'migraine-triggers',
      text: 'What may have triggered your headache?',
      shortLabel: 'Triggers',
      type: 'checkbox',
      role: 'triggers',
      options: [
        { value: 'Stress', label: 'Stress' },
        { value: 'Poor sleep', label: 'Poor sleep' },
        { value: 'Skipped meal', label: 'Skipped meal' },
        { value: 'Screen time', label: 'Screen time' },
        { value: 'Bright light', label: 'Bright light' },
        { value: 'None of these', label: 'None of these', isNone: true },
      ],
      order: 5,
    },
    { id: 'migraine-sleep', text: 'How many hours did you sleep last night?', shortLabel: 'Sleep', type: 'number', role: 'sleepHours', min: 0, max: 14, unit: 'hours', order: 6 },
    {
      id: 'migraine-feeling',
      text: 'Pick the weather that matches how you feel today',
      shortLabel: 'Feeling',
      type: 'iconChoice',
      role: 'overallFeeling',
      options: [
        { value: 'Sunny', label: 'Feeling great', severity: 0, icon: '☀️' },
        { value: 'Partly cloudy', label: 'Mostly OK', severity: 1, icon: '⛅' },
        { value: 'Cloudy', label: 'Not great', severity: 2, icon: '☁️' },
        { value: 'Stormy', label: 'Really bad', severity: 3, icon: '⛈️' },
      ],
      order: 7,
    },
  ],
};

const STEPS: Record<Zone, string[]> = {
  green: [
    'Take your controller medicine every day, even when you feel fine.',
    'Use your rescue inhaler before exercise if your plan says to.',
  ],
  yellow: [
    'Use your rescue inhaler the way your plan says.',
    'Check your breathing again in 20 minutes.',
    'Take it easy and stay away from your triggers today.',
    'Tell a parent or another adult how you feel.',
  ],
  red: ['Use your rescue inhaler right away.', 'Tell an adult now.', 'Call your care team. Call 911 if it is hard to walk or talk.'],
};

const BADGE_LABELS: Record<string, string> = {
  TrackerBadge1: 'First check-in',
  TrackerBadge7: '7 check-ins in a row',
  TrackerBadge10: '10 check-ins',
  MedicationStreak3: '3 days of medicines',
  MedicationStreak7: '7 days of medicines',
  SpirometryFirst: 'First breathing test',
};

interface MockPatient {
  home: PatientAppHome;
  /** day → medicationId → times (past days, for the raw document) */
  doses: Record<string, Record<string, string[]>>;
}

function strip(today: string, pattern: string): PatientAppHome['last14Days'] {
  return Array.from({ length: 14 }, (_, i) => ({
    date: addDays(today, i - 13),
    status: pattern[i] === 'g' ? 'good' : pattern[i] === 'h' ? 'hard' : 'none',
  }));
}

function pastDoses(today: string, plan: Record<string, string[][]>): MockPatient['doses'] {
  const out: MockPatient['doses'] = {};
  for (const [medId, days] of Object.entries(plan)) {
    days.forEach((times, i) => {
      if (!times.length) return;
      ((out[addDays(today, -(days.length - i))] ??= {})[medId] = times);
    });
  }
  return out;
}

function createState(): Record<string, MockPatient> {
  const today = localDay();
  const badge = (name: string, daysAgo: number) => ({ name, label: BADGE_LABELS[name] ?? name, date: addDays(today, -daysAgo) });
  const jordan: PatientAppHome = {
    today,
    patient: {
      id: 'demo-jordan',
      firstName: 'Jordan',
      displayName: 'Jordan Reyes',
      initials: 'JR',
      ageYears: 14,
      conditions: [{ id: 'asthma-v3', name: MOCK_ASTHMA_TRACKER.name, condition: 'asthma', conditionLabel: 'Asthma' }],
    },
    trackers: [{ definition: MOCK_ASTHMA_TRACKER, submittedToday: 0 }],
    medications: [
      {
        id: 'med-flovent',
        name: 'Flovent HFA 44 mcg',
        icon: 'Inhaler',
        howOften: 'Daily',
        regimen: '2 puffs twice daily',
        condition: 'Asthma',
        kind: 'scheduled',
        timesOfDay: ['08:00', '20:00'],
        dosesDueToday: 2,
        dosesTakenToday: 1,
        takenTimesToday: ['08:12'],
      },
      {
        id: 'med-montelukast',
        name: 'Montelukast 5 mg',
        icon: 'Tablet',
        howOften: 'Daily',
        regimen: '1 tablet at bedtime',
        condition: 'Asthma',
        kind: 'scheduled',
        timesOfDay: ['21:00'],
        dosesDueToday: 1,
        dosesTakenToday: 0,
        takenTimesToday: [],
      },
      {
        id: 'med-albuterol',
        name: 'Albuterol HFA',
        icon: 'Inhaler',
        howOften: 'As Needed',
        regimen: '2 puffs as needed',
        condition: 'Asthma',
        kind: 'asNeeded',
        timesOfDay: [],
        dosesDueToday: 0,
        dosesTakenToday: 0,
        takenTimesToday: [],
      },
    ],
    actionPlan: {
      zone: 'green',
      asOf: localIso(new Date(Date.now() - 86_400_000), addDays(today, -1)),
      personalBestPefLpm: 410,
      greenThresholdPct: 80,
      redThresholdPct: 50,
      expired: false,
      steps: STEPS,
    },
    spirometer: {
      deviceName: 'MIR Spirobank Smart',
      serialNumber: 'Z125775',
      latest: { date: addDays(today, -1), pefLpm: 372, fev1L: 3.12, pctPersonalBest: 91, zone: 'green' },
    },
    engagement: {
      currentStreak: 6,
      longestStreak: 12,
      badges: [badge('TrackerBadge1', 40), badge('MedicationStreak3', 31), badge('TrackerBadge10', 20), badge('SpirometryFirst', 38), badge('MedicationStreak7', 2)],
    },
    last14Days: strip(today, 'gghnhgnggghggn'),
  };
  const maya: PatientAppHome = {
    today,
    patient: {
      id: 'demo-maya',
      firstName: 'Maya',
      displayName: 'Maya Chen',
      initials: 'MC',
      ageYears: 16,
      conditions: [{ id: 'migraine-v2', name: MOCK_MIGRAINE_TRACKER.name, condition: 'migraine', conditionLabel: 'Migraine' }],
    },
    trackers: [{ definition: MOCK_MIGRAINE_TRACKER, submittedToday: 1, lastSubmittedAt: localIso(new Date(new Date().setHours(7, 41, 5, 300)), today) }],
    medications: [
      {
        id: 'med-riboflavin',
        name: 'Riboflavin 400 mg',
        icon: 'Capsule',
        howOften: 'Daily',
        regimen: '1 capsule every morning',
        condition: 'Migraine',
        kind: 'scheduled',
        timesOfDay: ['07:30'],
        dosesDueToday: 1,
        dosesTakenToday: 0,
        takenTimesToday: [],
      },
      {
        id: 'med-ibuprofen',
        name: 'Ibuprofen 400 mg',
        icon: 'Tablet',
        howOften: 'As Needed',
        regimen: '1 tablet when a headache starts',
        condition: 'Migraine',
        kind: 'asNeeded',
        timesOfDay: [],
        dosesDueToday: 0,
        dosesTakenToday: 0,
        takenTimesToday: [],
      },
    ],
    engagement: { currentStreak: 2, longestStreak: 9, badges: [badge('TrackerBadge1', 25), badge('MedicationStreak3', 10)] },
    last14Days: strip(today, 'gghgnnhggghngg'),
  };
  return {
    [jordan.patient.id]: {
      home: jordan,
      doses: pastDoses(today, {
        'med-flovent': [['08:05', '20:30'], ['08:20'], ['07:58', '20:12'], ['08:40', '21:02'], [], ['08:01', '19:55']],
        'med-montelukast': [['21:10'], ['21:30'], [], ['20:58'], ['21:05'], ['21:20']],
        'med-albuterol': [[], ['16:40'], [], [], ['07:15', '17:30'], []],
      }),
    },
    [maya.patient.id]: {
      home: maya,
      doses: pastDoses(today, {
        'med-riboflavin': [['07:35'], ['07:31'], [], ['07:50'], ['07:29'], ['08:10']],
        'med-ibuprofen': [['14:00'], [], [], ['10:30'], [], []],
      }),
    },
  };
}

let state: Record<string, MockPatient> | null = null;
const db = () => (state ??= createState());

/** Test helper. */
export function resetMockState() {
  state = null;
}

/** Test helper: a fresh home payload ('demo-jordan' asthma, 'demo-maya' migraine). */
export function mockHomeFor(id: 'demo-jordan' | 'demo-maya'): PatientAppHome {
  return createState()[id].home;
}

/** Test helper: the patient list response. */
export function mockPatientList(): PatientListResponse {
  return { today: localDay(), patients: Object.values(createState()).map(listItem) };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function listItem({ home }: MockPatient): PatientListItem {
  return {
    id: home.patient.id,
    displayName: home.patient.displayName,
    initials: home.patient.initials,
    ageYears: home.patient.ageYears,
    mrn: home.patient.id === 'demo-jordan' ? 'DEMO-000101' : 'DEMO-000102',
    trackers: home.patient.conditions,
    studyIds: [],
    lastActivityDate: home.today,
    daysSinceLastActivity: 0,
    freshnessStatus: 'good',
    currentZone: home.actionPlan?.zone,
    adherencePct30d: 82,
    adherenceStatus: 'good',
    symptomDays30d: 4,
    highFlags: 0,
    mediumFlags: 1,
    attentionScore: 10,
  };
}

function rawDoc(p: MockPatient): RawPatientDocument {
  const h = p.home;
  const days = new Set([...Object.keys(p.doses), h.today]);
  return {
    id: h.patient.id,
    patientId: h.patient.id,
    profile: { firstName: h.patient.firstName, lastName: h.patient.displayName.split(' ').slice(1).join(' '), dateOfBirth: '2012-01-01', mrn: listItem(p).mrn },
    trackers: h.trackers.map((t) => ({ trackerId: t.definition.id, assignedDate: addDays(h.today, -60), active: true })),
    dailyLogs: [...days].sort().map((day) => ({
      day,
      medicationAdministrations: h.medications.flatMap((m) =>
        (day === h.today ? m.takenTimesToday : (p.doses[day]?.[m.id] ?? [])).map((time) => ({ id: m.id, time, name: m.name, value: 1 })),
      ),
    })),
    medications: h.medications.map((m, index) => ({ id: m.id, name: m.name, icon: m.icon, howOften: m.howOften, archived: false, index })),
    createdAt: `${addDays(h.today, -60)}T12:00:00.000Z`,
  };
}

function bumpStreak(h: PatientAppHome, good: boolean): WriteResult<never>['newBadge'] {
  const todayCell = h.last14Days[h.last14Days.length - 1];
  const first = todayCell.status === 'none';
  todayCell.status = good ? 'good' : 'hard';
  if (!first) return undefined;
  const e = h.engagement;
  e.currentStreak += 1;
  e.longestStreak = Math.max(e.longestStreak, e.currentStreak);
  if (e.currentStreak === 7) {
    const b = { name: 'TrackerBadge7', label: BADGE_LABELS.TrackerBadge7, date: h.today };
    e.badges.push(b);
    return { name: b.name, label: b.label };
  }
  return undefined;
}

export async function mockRequest<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
  await delay(method === 'GET' ? 350 : 500);
  if (method === 'GET' && path === '/api/patients') {
    const res: PatientListResponse = { today: localDay(), patients: Object.values(db()).map(listItem) };
    return res as T;
  }
  if (method === 'GET' && path === '/api/ai/status') return MOCK_AI_STATUS as T;
  if (method === 'GET' && path === '/api/clinicians') return MOCK_CLINICIANS as T;
  const cm = path.match(/^\/api\/conversations\/(.+)$/);
  if (cm) return mockConversationRoute(method, cm[1], body) as T;
  const m = path.match(/^\/api\/patients\/([^/]+)\/(.+)$/);
  const p = m ? db()[decodeURIComponent(m[1])] : undefined;
  if (!m || !p) throw new ApiError('Patient not found', 404);
  const h = p.home;
  const route = `${method} ${m[2]}`;

  switch (route) {
    case 'GET app/home':
      return structuredClone(h) as T;
    case 'GET raw':
      return rawDoc(p) as T;
    case 'POST tracker-responses': {
      const b = body as CreateTrackerResponseRequest;
      const t = h.trackers.find((x) => x.definition.id === b?.trackerId);
      if (!t || !Array.isArray(b.responses)) throw new ApiError('Unknown tracker or missing responses', 400);
      console.info('[mock] tracker response', b);
      t.submittedToday += 1;
      t.lastSubmittedAt = b.submittedAt ?? localIso(new Date(), h.today);
      const feelingQ = t.definition.questions.find((q) => q.role === 'overallFeeling');
      const feeling = b.responses.find((r) => r.questionId === feelingQ?.id)?.value;
      const sev = feelingQ?.options?.find((o) => o.value === feeling)?.severity ?? 0;
      const newBadge = bumpStreak(h, sev < 2);
      const n = h.engagement.currentStreak;
      const res: WriteResult<unknown> = {
        ok: true,
        created: { id: crypto.randomUUID?.() ?? String(Date.now()), trackerId: b.trackerId, submittedAt: t.lastSubmittedAt, responses: b.responses },
        message: n > 1 ? `Check-in saved — ${n} days in a row!` : 'Check-in saved. Nice start!',
        newBadge,
        zoneToday: h.actionPlan?.zone,
      };
      return res as T;
    }
    case 'POST medication-administrations': {
      const b = body as CreateMedicationDoseRequest;
      const med = h.medications.find((x) => x.id === b?.medicationId);
      if (!med) throw new ApiError('Unknown medication', 400);
      const time = b.time ?? hhmm();
      med.dosesTakenToday += 1;
      med.takenTimesToday.push(time);
      const allDone = med.kind === 'scheduled' && med.dosesTakenToday >= med.dosesDueToday;
      const res: WriteResult<unknown> = {
        ok: true,
        created: { id: med.id, time, name: med.name, value: b.quantity ?? 1 },
        message: med.kind === 'asNeeded' ? `Saved: ${med.name} at ${time}.` : allDone ? `${med.name} is done for today. Nice!` : `${med.name} marked as taken.`,
      };
      return res as T;
    }
    case 'POST spirometry-sessions': {
      const b = body as CreateSpirometrySessionRequest;
      if (!Array.isArray(b?.readings) || b.readings.length === 0) throw new ApiError('No readings', 400);
      const best = bestBlow(b.readings)!;
      const lpm = pefLpm(best);
      const plan = h.actionPlan;
      const pct = pctOfBest(lpm, plan?.personalBestPefLpm);
      const zone = zoneFor(pct, plan?.greenThresholdPct, plan?.redThresholdPct);
      if (plan) {
        plan.zone = zone;
        plan.asOf = best.baselineReadingDate;
      }
      if (h.spirometer) h.spirometer.latest = { date: h.today, pefLpm: lpm, fev1L: Number(best.fvcPlusResults.fev1.toFixed(2)), pctPersonalBest: pct, zone };
      const res: WriteResult<unknown> = { ok: true, created: b.readings, zoneToday: zone, message: 'Breathing test saved. Great effort!' };
      return res as T;
    }
    case 'POST voice-checkin/parse': {
      const b = body as { trackerId?: string; transcript?: string };
      const t = h.trackers.find((x) => x.definition.id === b?.trackerId);
      if (!t || !b.transcript?.trim()) throw new ApiError('trackerId and transcript are required', 400);
      return mockParseVoice(t.definition, b.transcript) as T;
    }
    case 'GET media':
      return mockListMedia(h.patient.id) as T;
    case 'GET conversations':
      return mockListConversations(h.patient.id) as T;
    case 'POST conversations': {
      const b = body as { text?: string; mediaIds?: string[] };
      return mockStartConversation(h.patient.id, h.patient.displayName, b?.text ?? '', b?.mediaIds) as T;
    }
    default:
      if (method === 'DELETE' && m[2].startsWith('media/')) return mockDeleteMedia(h.patient.id, decodeURIComponent(m[2].slice(6))) as T;
      throw new ApiError(`Mock has no route for ${route}`, 404);
  }
}
