/**
 * SYNTHETIC chart fixtures (no real patient data). Fabricates plausible PatientSummary-shaped
 * slices — DaySummary[], medication summaries, spirometry, per-question summaries and zone
 * counts — so the charts can be built and tested before the analytics engine lands.
 * Deterministic: a seeded PRNG drives every value.
 */
import type {
  ActionPlanSummary,
  AsNeededMedicationSummary,
  BooleanQuestionSummary,
  CategoricalQuestionSummary,
  DayEntrySubmission,
  DaySummary,
  MultiSelectQuestionSummary,
  NumericQuestionSummary,
  QuestionRole,
  QuestionSummary,
  ScheduledMedicationSummary,
  Severity,
  SpirometryBlow,
  SpirometrySession,
  SpirometrySummary,
  Status,
  TextQuestionSummary,
  Zone,
} from '@shared/types';
import { addDays, dateRange, weekdayMon0 } from '../chartUtils';

export interface ChartFixture {
  label: string;
  window: { start: string; end: string; days: number };
  days: DaySummary[];
  scheduled: ScheduledMedicationSummary[];
  asNeeded: AsNeededMedicationSummary[];
  spirometry?: SpirometrySummary;
  questions: QuestionSummary[];
  zoneDays?: ActionPlanSummary['zoneDays'];
}

export interface FixtureOptions {
  days?: number;
  /** Inclusive window end. */
  end?: string;
  density?: 'rich' | 'sparse';
  seed?: number;
}

const DEFAULT_END = '2026-11-05';

// ───────────────────────── PRNG ─────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const pad = (n: number) => String(n).padStart(2, '0');

// ───────────────────────── question meta ─────────────────────────

interface QMeta {
  id: string;
  trackerId: string;
  text: string;
  shortLabel: string;
  type: QuestionSummary['type'];
  role?: QuestionRole;
  kind: QuestionSummary['kind'];
  options?: { label: string; severity?: Severity; isNone?: boolean }[];
  unit?: string;
  min?: number;
  max?: number;
  direction?: 'higherIsWorse' | 'higherIsBetter';
  concernThreshold?: number;
}

type Answer = string | string[] | number | boolean | null;

function displayOf(a: Answer): string {
  if (a == null) return '';
  if (Array.isArray(a)) return a.length ? a.join(', ') : 'None of these';
  if (typeof a === 'boolean') return a ? 'Yes' : 'No';
  return String(a);
}

function base(q: QMeta, answered: number, windowDays: number) {
  return {
    questionId: q.id,
    trackerId: q.trackerId,
    text: q.text,
    shortLabel: q.shortLabel,
    type: q.type,
    role: q.role,
    answeredDays: answered,
    windowDays,
  };
}

function buildQuestionSummary(q: QMeta, dates: string[], answers: Answer[]): QuestionSummary {
  const answered = answers.filter((a) => a != null && !(typeof a === 'string' && a.trim() === '')).length;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  switch (q.kind) {
    case 'categorical': {
      const sevOf = new Map((q.options ?? []).map((o) => [o.label, o.severity]));
      const counts = new Map<string, number>();
      for (const a of answers) if (typeof a === 'string') counts.set(a, (counts.get(a) ?? 0) + 1);
      const distribution = (q.options ?? [])
        .map((o) => ({ label: o.label, days: counts.get(o.label) ?? 0, pct: pct(counts.get(o.label) ?? 0, answered), severity: o.severity }))
        .filter((d) => d.days > 0);
      const out: CategoricalQuestionSummary = {
        ...base(q, answered, dates.length),
        kind: 'categorical',
        distribution,
        series: dates.map((date, i) => {
          const a = answers[i];
          return typeof a === 'string' ? { date, label: a, severity: sevOf.get(a) } : { date, label: null };
        }),
      };
      return out;
    }
    case 'multi': {
      const counts = new Map<string, number>();
      let anyDays = 0;
      for (const a of answers) {
        if (!Array.isArray(a)) continue;
        if (a.length) anyDays += 1;
        for (const it of a) counts.set(it, (counts.get(it) ?? 0) + 1);
      }
      const out: MultiSelectQuestionSummary = {
        ...base(q, answered, dates.length),
        kind: 'multi',
        items: [...counts.entries()]
          .map(([label, days]) => ({ label, days, pct: pct(days, answered) }))
          .sort((a, b) => b.days - a.days || a.label.localeCompare(b.label)),
        anyDays,
        series: dates.map((date, i) => ({ date, items: Array.isArray(answers[i]) ? (answers[i] as string[]) : null })),
      };
      return out;
    }
    case 'numeric': {
      const vals = answers.filter((a): a is number => typeof a === 'number');
      const higherIsWorse = (q.direction ?? 'higherIsWorse') === 'higherIsWorse';
      const atConcern =
        q.concernThreshold == null
          ? 0
          : vals.filter((v) => (higherIsWorse ? v >= q.concernThreshold! : v <= q.concernThreshold!)).length;
      const last = [...answers].reverse().find((a): a is number => typeof a === 'number');
      const half = Math.floor(vals.length / 2);
      const m1 = half ? vals.slice(0, half).reduce((a, b) => a + b, 0) / half : 0;
      const m2 = vals.length - half ? vals.slice(half).reduce((a, b) => a + b, 0) / (vals.length - half) : 0;
      const delta = r1(m2 - m1);
      const out: NumericQuestionSummary = {
        ...base(q, answered, dates.length),
        kind: 'numeric',
        unit: q.unit,
        min: q.min,
        max: q.max,
        direction: q.direction ?? 'higherIsWorse',
        concernThreshold: q.concernThreshold,
        stats: {
          mean: vals.length ? r1(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
          min: vals.length ? Math.min(...vals) : null,
          max: vals.length ? Math.max(...vals) : null,
          last: last ?? null,
          daysAtConcern: atConcern,
        },
        series: dates.map((date, i) => ({ date, value: typeof answers[i] === 'number' ? (answers[i] as number) : null })),
        trend:
          vals.length >= 4
            ? {
                direction: Math.abs(delta) < 0.3 ? 'flat' : delta > 0 ? 'up' : 'down',
                meaning:
                  Math.abs(delta) < 0.3 ? 'neutral' : (delta > 0) === higherIsWorse ? 'worse' : 'better',
                text: `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta)} vs first half of period`,
              }
            : undefined,
      };
      return out;
    }
    case 'boolean': {
      const yes = answers.filter((a) => a === true).length;
      const no = answers.filter((a) => a === false).length;
      const out: BooleanQuestionSummary = {
        ...base(q, answered, dates.length),
        kind: 'boolean',
        yesDays: yes,
        noDays: no,
        yesPct: pct(yes, yes + no),
        series: dates.map((date, i) => ({ date, value: typeof answers[i] === 'boolean' ? (answers[i] as boolean) : null })),
      };
      return out;
    }
    case 'text': {
      const recent: { date: string; text: string }[] = [];
      for (let i = dates.length - 1; i >= 0 && recent.length < 10; i--) {
        const a = answers[i];
        if (typeof a === 'string' && a.trim()) recent.push({ date: dates[i], text: a });
      }
      const out: TextQuestionSummary = { ...base(q, answered, dates.length), kind: 'text', recent };
      return out;
    }
  }
}

// ───────────────────────── medication / spirometry builders ─────────────────────────

function statusFromPct(p: number | null): Status {
  if (p == null) return 'unknown';
  return p >= 80 ? 'good' : p >= 50 ? 'watch' : 'concern';
}

function buildScheduled(
  meta: { key: string; name: string; regimen: string; condition: string; role: ScheduledMedicationSummary['role'] },
  daily: { date: string; taken: number; expected: number }[],
): ScheduledMedicationSummary {
  const expected = daily.reduce((a, d) => a + d.expected, 0);
  const taken = daily.reduce((a, d) => a + Math.min(d.taken, d.expected), 0);
  const expDays = daily.filter((d) => d.expected > 0);
  const fullDays = expDays.filter((d) => d.taken >= d.expected).length;
  const adherencePct = expected ? Math.round((taken / expected) * 100) : null;
  const weeks = new Map<string, { t: number; e: number }>();
  for (const d of daily) {
    const ws = addDays(d.date, -weekdayMon0(d.date));
    const w = weeks.get(ws) ?? { t: 0, e: 0 };
    w.t += Math.min(d.taken, d.expected);
    w.e += d.expected;
    weeks.set(ws, w);
  }
  let streak = 0;
  for (let i = daily.length - 1; i >= 0; i--) {
    const d = daily[i];
    if (d.expected === 0) continue;
    if (d.taken >= d.expected) streak += 1;
    else break;
  }
  const lastTaken = [...daily].reverse().find((d) => d.taken > 0);
  return {
    ...meta,
    sourceIds: [`med-${meta.key}`],
    dosesTaken: taken,
    dosesExpected: expected,
    adherencePct,
    fullDosePct: expDays.length ? Math.round((fullDays / expDays.length) * 100) : null,
    status: statusFromPct(adherencePct),
    daily,
    weekly: [...weeks.entries()].map(([weekStart, w]) => ({
      weekStart,
      pct: w.e ? Math.round((w.t / w.e) * 100) : null,
    })),
    lastTakenDate: lastTaken?.date,
    currentStreakDays: streak,
  };
}

function buildAsNeeded(
  meta: { key: string; name: string; condition: string; role: AsNeededMedicationSummary['role'] },
  daily: { date: string; uses: number }[],
): AsNeededMedicationSummary {
  const totalUses = daily.reduce((a, d) => a + d.uses, 0);
  const daysUsed = daily.filter((d) => d.uses > 0).length;
  const perWeek = daily.length ? r1((daysUsed / daily.length) * 7) : 0;
  const last = [...daily].reverse().find((d) => d.uses > 0);
  return {
    ...meta,
    regimen: 'As needed',
    sourceIds: [`med-${meta.key}`],
    totalUses,
    daysUsed,
    perWeek,
    status: perWeek > 2 ? 'concern' : perWeek > 1 ? 'watch' : 'good',
    daily,
    lastUsedDate: last?.date,
  };
}

const COACHING = [
  'Blast out faster',
  'Keep going until completely empty',
  'Do not cough',
  'Take a deeper breath before blowing',
];

function buildSession(rng: () => number, date: string, pct: number, pb: number, badSessionP: number): SpirometrySession {
  const total = 3 + Math.floor(rng() * 3);
  const blows: SpirometryBlow[] = [];
  const badSession = rng() < badSessionP;
  for (let b = 0; b < total; b++) {
    const accepted = !badSession && rng() < 0.75;
    const jitter = 1 - rng() * 0.12;
    const pef = Math.round(((pb * pct) / 100) * jitter);
    const fev1 = r2(3.1 * (pct / 100) * jitter);
    const fvc = r2(fev1 / (0.72 + rng() * 0.12));
    blows.push({
      time: `${pad(7 + Math.floor(rng() * 2))}:${pad(Math.floor(rng() * 60))}`,
      accepted,
      qualityLabel: accepted ? (rng() < 0.7 ? 'Acceptable' : 'Usable') : 'Not acceptable',
      coaching: accepted ? [] : [COACHING[Math.floor(rng() * COACHING.length)]],
      fev1L: fev1,
      fvcL: fvc,
      ratioPct: Math.round((fev1 / fvc) * 100),
      pefLpm: pef,
      fef2575Lps: r2(fev1 * 0.9),
    });
  }
  const acc = blows.filter((b) => b.accepted);
  const pool = acc.length ? acc : blows;
  const bestFev1L = Math.max(...pool.map((b) => b.fev1L));
  const bestFvcL = Math.max(...pool.map((b) => b.fvcL));
  const bestPefLpm = Math.max(...pool.map((b) => b.pefLpm));
  const pctPB = Math.round((bestPefLpm / pb) * 100);
  return {
    date,
    bestFev1L,
    bestFvcL,
    ratioPct: Math.round((bestFev1L / bestFvcL) * 100),
    bestPefLpm,
    pctPersonalBest: pctPB,
    zone: pctPB >= 80 ? 'green' : pctPB >= 50 ? 'yellow' : 'red',
    acceptableBlows: acc.length,
    totalBlows: total,
    reliable: acc.length > 0,
    blows,
  };
}

// ───────────────────────── asthma ─────────────────────────

const ASTHMA_TRACKER = 'trk-asthma';
const FEELING_OPTS: { label: string; severity: Severity }[] = [
  { label: 'Great', severity: 0 },
  { label: 'Okay', severity: 1 },
  { label: 'Bad', severity: 2 },
  { label: 'Terrible', severity: 3 },
];
const ASTHMA_SYMPTOMS = ['Coughing', 'Wheezing', 'Tight chest', 'Shortness of breath', 'Activity limitations'];
const ASTHMA_Q: QMeta[] = [
  { id: 'q-feel', trackerId: ASTHMA_TRACKER, text: 'How are you feeling today?', shortLabel: 'Feeling', type: 'faceScale', role: 'overallFeeling', kind: 'categorical', options: FEELING_OPTS },
  { id: 'q-sym', trackerId: ASTHMA_TRACKER, text: 'Please select the following symptoms that you are currently experiencing', shortLabel: 'Symptoms', type: 'checkbox', role: 'symptoms', kind: 'multi' },
  { id: 'q-school', trackerId: ASTHMA_TRACKER, text: 'Did you miss school today because of your asthma?', shortLabel: 'Missed school', type: 'yesNo', role: 'missedSchool', kind: 'boolean' },
  { id: 'q-night', trackerId: ASTHMA_TRACKER, text: 'Did your asthma wake you up last night?', shortLabel: 'Night waking', type: 'yesNo', role: 'nightWaking', kind: 'boolean' },
  { id: 'q-rescue', trackerId: ASTHMA_TRACKER, text: 'How many times did you use your rescue inhaler today?', shortLabel: 'Rescue uses (self)', type: 'number', role: 'rescueMedUse', kind: 'numeric', unit: 'times', min: 0, max: 10, direction: 'higherIsWorse', concernThreshold: 2 },
  { id: 'q-notes', trackerId: ASTHMA_TRACKER, text: 'Anything else you want your care team to know?', shortLabel: 'Notes', type: 'text', kind: 'text' },
];
const NOTES = [
  'Ran out of my inhaler at school',
  'Cat at grandma’s house again',
  'Felt fine after soccer',
  'Cold weather made it worse',
  'Forgot my morning dose',
  'Better after using spacer',
  'Allergies acting up',
];

export function makeAsthmaFixture(opts: FixtureOptions = {}): ChartFixture {
  const n = opts.days ?? 30;
  const end = opts.end ?? DEFAULT_END;
  const density = opts.density ?? 'rich';
  const rng = mulberry32(opts.seed ?? 7);
  const start = addDays(end, -(n - 1));
  const dates = dateRange(start, end);
  const pLog = density === 'rich' ? 0.78 : 0.32;
  const pDose = density === 'rich' ? 0.68 : 0.4;
  const pSpiro = density === 'rich' ? 0.45 : 0.12;
  const PB = 420;

  const answers: Record<string, Answer[]> = Object.fromEntries(ASTHMA_Q.map((q) => [q.id, [] as Answer[]]));
  const days: DaySummary[] = [];
  const sessions: SpirometrySession[] = [];
  const dulera: { date: string; taken: number; expected: number }[] = [];
  const albuterol: { date: string; uses: number }[] = [];

  let burden = 0.25;
  dates.forEach((date, i) => {
    burden = clamp(burden * 0.84 + 0.02 + (rng() - 0.5) * 0.12 + (rng() < 0.08 ? 0.45 : 0), 0, 1);
    const logs = rng() < pLog;
    // Dose behaviour: twice daily, worse on weekends.
    const weekend = weekdayMon0(date) >= 5;
    const takeP = (pDose - (weekend ? 0.2 : 0)) * (logs ? 1 : 0.45);
    const taken = (rng() < takeP ? 1 : 0) + (rng() < takeP - 0.1 ? 1 : 0);
    dulera.push({ date, taken, expected: 2 });
    const uses = burden > 0.42 ? 1 + (burden > 0.6 ? 1 : 0) + (burden > 0.78 && rng() < 0.5 ? 1 : 0) : 0;
    const usesRecorded = logs || rng() < 0.5 ? uses : 0;
    albuterol.push({ date, uses: usesRecorded });

    let session: SpirometrySession | undefined;
    if (rng() < pSpiro) {
      const pct = clamp(Math.round(102 - burden * 60 + (rng() - 0.5) * 12), 35, 112);
      session = buildSession(rng, date, pct, PB, density === 'rich' ? 0.2 : 0.3);
      sessions.push(session);
    }

    let sev: Severity | undefined;
    let symptoms: string[] = [];
    let school: boolean | null = null;
    let night: boolean | null = null;
    let note: string | null = null;
    const submissions: DayEntrySubmission[] = [];
    if (logs) {
      sev = (burden < 0.22 ? 0 : burden < 0.38 ? 1 : burden < 0.6 ? 2 : 3) as Severity;
      if (sev >= 2 && rng() < 0.2) sev = 0; // discordance: says "Great" on a bad day
      if (burden > 0.3) {
        const k = clamp(Math.round(burden * 4 + (rng() - 0.5)), 1, 4);
        symptoms = [...ASTHMA_SYMPTOMS].sort(() => rng() - 0.5).slice(0, k);
      }
      school = weekdayMon0(date) < 5 ? burden > 0.72 && rng() < 0.6 : null;
      night = burden > 0.5 ? rng() < 0.6 : rng() < 0.05;
      note = rng() < 0.12 ? NOTES[Math.floor(rng() * NOTES.length)] : null;
      const subCount = rng() < 0.2 ? 2 + Math.floor(rng() * 2) : 1;
      for (let s = 0; s < subCount; s++) {
        const blank = s < subCount - 1 && rng() < 0.4;
        submissions.push({
          responseId: `resp-${date}-${s}`,
          trackerId: ASTHMA_TRACKER,
          time: `${pad(15 + s)}:${pad(Math.floor(rng() * 60))}`,
          blank,
          usedForDay: s === subCount - 1,
          answers: blank
            ? []
            : [
                { questionId: 'q-feel', shortLabel: 'Feeling', display: FEELING_OPTS[sev].label },
                { questionId: 'q-sym', shortLabel: 'Symptoms', display: displayOf(symptoms) },
                ...(school != null ? [{ questionId: 'q-school', shortLabel: 'Missed school', display: displayOf(school) }] : []),
              ],
        });
      }
    }
    answers['q-feel'].push(sev != null ? FEELING_OPTS[sev].label : null);
    answers['q-sym'].push(logs ? symptoms : null);
    answers['q-school'].push(school);
    answers['q-night'].push(night);
    answers['q-rescue'].push(logs ? uses : null);
    answers['q-notes'].push(note);

    const pct = session?.pctPersonalBest;
    let zone: Zone | undefined;
    if (pct != null) zone = pct >= 80 ? 'green' : pct >= 50 ? 'yellow' : 'red';
    if (logs) {
      const symZone: Zone = sev === 3 || symptoms.length >= 4 ? 'red' : symptoms.length > 0 || (sev ?? 0) >= 2 ? 'yellow' : 'green';
      const rank = { green: 0, yellow: 1, red: 2 } as const;
      zone = zone && rank[zone] > rank[symZone] ? zone : symZone;
    }
    const doses: DaySummary['doses'] = [];
    if (taken >= 1) doses.push({ time: '07:45', medicationName: 'Dulera', kind: 'scheduled', quantity: 2 });
    if (taken >= 2) doses.push({ time: '20:15', medicationName: 'Dulera', kind: 'scheduled', quantity: 2 });
    for (let u = 0; u < usesRecorded; u++)
      doses.push({ time: `${pad(10 + u * 3)}:20`, medicationName: 'Albuterol', kind: 'asNeeded', quantity: 1 });

    const hasData = logs || taken > 0 || usesRecorded > 0 || !!session;
    const symptomDay = symptoms.length > 0 || (sev ?? 0) >= 2;
    const hardDay = (sev ?? 0) >= 2 || zone === 'yellow' || zone === 'red' || school === true;
    days.push({
      date,
      hasData,
      submissionCount: submissions.length,
      blankSubmissionCount: submissions.filter((x) => x.blank).length,
      feeling:
        sev != null
          ? {
              label: FEELING_OPTS[sev].label,
              severity: sev,
              changedDuringDay: submissions.length > 1 && i % 3 === 0,
              worstLabel: submissions.length > 1 && i % 3 === 0 ? 'Bad' : undefined,
              sequence:
                submissions.length > 1 && i % 3 === 0 && FEELING_OPTS[sev].label !== 'Bad'
                  ? ['Bad', FEELING_OPTS[sev].label]
                  : [FEELING_OPTS[sev].label],
            }
          : undefined,
      symptoms,
      symptomDay,
      hardDay,
      zone: hasData ? zone : undefined,
      scheduledDosesTaken: taken,
      scheduledDosesExpected: 2,
      asNeededUses: usesRecorded,
      spirometry: session
        ? {
            pefLpm: session.bestPefLpm,
            fev1L: session.bestFev1L,
            pctPersonalBest: session.pctPersonalBest,
            acceptable: session.reliable,
          }
        : undefined,
      roleValues: logs
        ? {
            overallFeeling: sev,
            symptoms,
            ...(school != null ? { missedSchool: school } : {}),
            nightWaking: night ?? undefined,
            rescueMedUse: uses,
          }
        : {},
      discordant: logs && sev === 0 && (symptoms.length > 0 || (pct != null && pct < 80)),
      submissions,
      doses,
    });
  });

  const reliableSessions = sessions.filter((x) => x.reliable);
  const allBlows = sessions.flatMap((x) => x.blows);
  const spirometry: SpirometrySummary = {
    deviceName: 'MIR Spirobank Smart',
    personalBestPefLpm: PB,
    personalBestSource: 'action plan',
    greenThresholdPct: 80,
    redThresholdPct: 50,
    sessions,
    latest: sessions[sessions.length - 1],
    sessionsInWindow: sessions.length,
    qualityPct: allBlows.length ? Math.round((allBlows.filter((b) => b.accepted).length / allBlows.length) * 100) : null,
    pefTrend: { direction: 'down', meaning: 'worse', text: '−6% vs prior period' },
    status: reliableSessions.length ? 'watch' : 'unknown',
  };

  const zoneDays = { green: 0, yellow: 0, red: 0, unknown: 0 };
  for (const d of days) zoneDays[d.zone ?? 'unknown'] += 1;

  return {
    label: `Asthma · ${n} days · ${density}`,
    window: { start, end, days: n },
    days,
    scheduled: [
      buildScheduled({ key: 'dulera', name: 'Dulera', regimen: '2 puffs twice daily', condition: 'asthma', role: 'controller' }, dulera),
    ],
    asNeeded: [buildAsNeeded({ key: 'albuterol', name: 'Albuterol', condition: 'asthma', role: 'rescue' }, albuterol)],
    spirometry,
    questions: ASTHMA_Q.map((q) => buildQuestionSummary(q, dates, answers[q.id])),
    zoneDays,
  };
}

// ───────────────────────── migraine (non-asthma tracker) ─────────────────────────

const MIG_TRACKER = 'trk-migraine';
const AURA_OPTS = [{ label: 'No aura' }, { label: 'Visual' }, { label: 'Tingling' }, { label: 'Speech changes' }];
const TRIGGERS = ['Poor sleep', 'Stress', 'Screen time', 'Skipped meal', 'Weather', 'Bright light', 'Dehydration', 'Caffeine', 'Noise'];
const MIGRAINE_Q: QMeta[] = [
  { id: 'm-pain', trackerId: MIG_TRACKER, text: 'How bad is your head pain right now, from 1 (barely) to 10 (worst ever)?', shortLabel: 'Pain (1–10)', type: 'scale1to10', role: 'painSeverity', kind: 'numeric', min: 1, max: 10, direction: 'higherIsWorse', concernThreshold: 7 },
  { id: 'm-head', trackerId: MIG_TRACKER, text: 'Did you have a headache today?', shortLabel: 'Headache', type: 'yesNo', role: 'headache', kind: 'boolean' },
  { id: 'm-aura', trackerId: MIG_TRACKER, text: 'Did you notice any warning signs before the headache?', shortLabel: 'Aura', type: 'singleChoice', kind: 'categorical', options: AURA_OPTS },
  { id: 'm-trig', trackerId: MIG_TRACKER, text: 'What do you think triggered it?', shortLabel: 'Triggers', type: 'checkbox', role: 'triggers', kind: 'multi' },
  { id: 'm-sleep', trackerId: MIG_TRACKER, text: 'How many hours did you sleep last night?', shortLabel: 'Sleep', type: 'number', role: 'sleepHours', kind: 'numeric', unit: 'h', min: 0, max: 12, direction: 'higherIsBetter', concernThreshold: 6 },
  { id: 'm-notes', trackerId: MIG_TRACKER, text: 'Notes for your care team', shortLabel: 'Notes', type: 'text', kind: 'text' },
];

export function makeMigraineFixture(opts: FixtureOptions = {}): ChartFixture {
  const n = opts.days ?? 30;
  const end = opts.end ?? DEFAULT_END;
  const rng = mulberry32(opts.seed ?? 21);
  const start = addDays(end, -(n - 1));
  const dates = dateRange(start, end);
  const answers: Record<string, Answer[]> = Object.fromEntries(MIGRAINE_Q.map((q) => [q.id, [] as Answer[]]));
  const days: DaySummary[] = [];
  const topa: { date: string; taken: number; expected: number }[] = [];
  const excedrin: { date: string; uses: number }[] = [];

  dates.forEach((date) => {
    const logs = rng() < 0.75;
    const headache = rng() < 0.3;
    const pain = headache ? clamp(Math.round(4 + rng() * 6), 1, 10) : null;
    const taken = rng() < 0.85 ? 1 : 0;
    topa.push({ date, taken, expected: 1 });
    const uses = headache && rng() < 0.7 ? (pain! >= 8 ? 2 : 1) : 0;
    excedrin.push({ date, uses });
    const sleep = r1(clamp(7.2 + (rng() - 0.6) * 4, 3.5, 10));
    const aura = headache ? AURA_OPTS[Math.floor(rng() * (rng() < 0.6 ? 1 : 4))].label : null;
    const trig = headache ? [...TRIGGERS].sort(() => rng() - 0.5).slice(0, 1 + Math.floor(rng() * 3)) : [];
    const school = logs && headache && weekdayMon0(date) < 5 && (pain ?? 0) >= 8 ? rng() < 0.5 : false;
    answers['m-pain'].push(logs && pain != null ? pain : null);
    answers['m-head'].push(logs ? headache : null);
    answers['m-aura'].push(logs ? aura : null);
    answers['m-trig'].push(logs && headache ? trig : null);
    answers['m-sleep'].push(logs ? sleep : null);
    answers['m-notes'].push(logs && headache && rng() < 0.25 ? 'Light sensitivity, lay down in a dark room' : null);
    const doses: DaySummary['doses'] = [];
    if (taken) doses.push({ time: '21:00', medicationName: 'Topiramate', kind: 'scheduled', quantity: 1 });
    for (let u = 0; u < uses; u++) doses.push({ time: `${pad(13 + u * 4)}:05`, medicationName: 'Excedrin', kind: 'asNeeded', quantity: 1 });
    const hasData = logs || taken > 0 || uses > 0;
    days.push({
      date,
      hasData,
      submissionCount: logs ? 1 : 0,
      blankSubmissionCount: 0,
      symptoms: logs && headache ? ['Headache', ...(aura && aura !== 'No aura' ? [`Aura (${aura.toLowerCase()})`] : [])] : [],
      symptomDay: logs && headache,
      hardDay: logs && ((pain ?? 0) >= 7 || school),
      scheduledDosesTaken: taken,
      scheduledDosesExpected: 1,
      asNeededUses: uses,
      roleValues: logs ? { headache, ...(pain != null ? { painSeverity: pain } : {}), sleepHours: sleep, triggers: trig } : {},
      discordant: false,
      submissions: logs
        ? [
            {
              responseId: `m-${date}`,
              trackerId: MIG_TRACKER,
              time: '19:30',
              blank: false,
              usedForDay: true,
              answers: [{ questionId: 'm-head', shortLabel: 'Headache', display: headache ? 'Yes' : 'No' }],
            },
          ]
        : [],
      doses,
    });
  });

  return {
    label: `Migraine · ${n} days`,
    window: { start, end, days: n },
    days,
    scheduled: [
      buildScheduled({ key: 'topiramate', name: 'Topiramate', regimen: '25 mg nightly', condition: 'migraine', role: 'preventive' }, topa),
    ],
    asNeeded: [buildAsNeeded({ key: 'excedrin', name: 'Excedrin', condition: 'migraine', role: 'abortive' }, excedrin)],
    questions: MIGRAINE_Q.map((q) => buildQuestionSummary(q, dates, answers[q.id])),
  };
}

// ───────────────────────── empty ─────────────────────────

/** A window where the patient recorded nothing (all days hasData=false). */
export function makeEmptyFixture(opts: FixtureOptions = {}): ChartFixture {
  const n = opts.days ?? 30;
  const end = opts.end ?? DEFAULT_END;
  const start = addDays(end, -(n - 1));
  const dates = dateRange(start, end);
  const days: DaySummary[] = dates.map((date) => ({
    date,
    hasData: false,
    submissionCount: 0,
    blankSubmissionCount: 0,
    symptoms: [],
    symptomDay: false,
    hardDay: false,
    scheduledDosesTaken: 0,
    scheduledDosesExpected: 2,
    asNeededUses: 0,
    roleValues: {},
    discordant: false,
    submissions: [],
    doses: [],
  }));
  const empty = Array<Answer>(n).fill(null);
  return {
    label: `No entries · ${n} days`,
    window: { start, end, days: n },
    days,
    scheduled: [
      buildScheduled(
        { key: 'dulera', name: 'Dulera', regimen: '2 puffs twice daily', condition: 'asthma', role: 'controller' },
        dates.map((date) => ({ date, taken: 0, expected: 2 })),
      ),
    ],
    asNeeded: [buildAsNeeded({ key: 'albuterol', name: 'Albuterol', condition: 'asthma', role: 'rescue' }, dates.map((date) => ({ date, uses: 0 })))],
    spirometry: {
      deviceName: 'MIR Spirobank Smart',
      personalBestPefLpm: 420,
      personalBestSource: 'action plan',
      greenThresholdPct: 80,
      redThresholdPct: 50,
      sessions: [],
      sessionsInWindow: 0,
      qualityPct: null,
      status: 'unknown',
    },
    questions: ASTHMA_Q.map((q) => buildQuestionSummary(q, dates, empty)),
    zoneDays: { green: 0, yellow: 0, red: 0, unknown: n },
  };
}
