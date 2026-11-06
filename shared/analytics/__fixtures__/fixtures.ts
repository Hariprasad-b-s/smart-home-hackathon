/**
 * Tiny hand-built fixtures for analytics tests (synthetic data only).
 */
import type {
  RawBaselineReading,
  RawMedication,
  RawPatientDocument,
  RawQuestionResponse,
} from '../../types/raw';
import type { TrackerDefinition } from '../../types/tracker';
import { addDays, dateRange } from '../dates';

export const TODAY = '2026-06-30';
export const WIN_START = '2026-06-01';
export const PRIOR_START = '2026-05-02';

export const asthmaTracker: TrackerDefinition = {
  id: 'asthma-v1',
  name: 'Asthma check-in',
  condition: 'asthma',
  conditionLabel: 'Asthma',
  version: 1,
  questions: [
    {
      id: 'q-feel',
      text: 'How are you feeling today?',
      shortLabel: 'Feeling',
      type: 'faceScale',
      role: 'overallFeeling',
      order: 1,
      options: [
        { value: 'Great', label: 'Great', severity: 0 },
        { value: 'Good', label: 'Good', severity: 1 },
        { value: 'Okay', label: 'Okay', severity: 1 },
        { value: 'Bad', label: 'Bad', severity: 2 },
        { value: 'Awful', label: 'Awful', severity: 3 },
      ],
    },
    {
      id: 'q-sym',
      text: 'Which symptoms do you have?',
      shortLabel: 'Symptoms',
      type: 'checkbox',
      role: 'symptoms',
      order: 2,
      options: [
        { value: 'Coughing', label: 'Coughing' },
        { value: 'Wheezing', label: 'Wheezing' },
        { value: 'Tight Chest', label: 'Tight chest' },
        { value: 'None of these ', label: 'None of these', isNone: true },
      ],
    },
    { id: 'q-night', text: 'Did you wake up at night?', shortLabel: 'Night waking', type: 'yesNo', role: 'nightWaking', order: 3 },
    { id: 'q-rescue', text: 'Rescue puffs today?', shortLabel: 'Rescue uses', type: 'number', role: 'rescueMedUse', order: 4, min: 0 },
    { id: 'q-school', text: 'Did you miss school?', shortLabel: 'Missed school', type: 'yesNo', role: 'missedSchool', order: 5 },
    { id: 'q-spiro', text: 'Blow into your spirometer', shortLabel: 'Spirometry', type: 'spirometry', role: 'spirometry', order: 6 },
    { id: 'q-notes', text: 'Anything else?', shortLabel: 'Notes', type: 'text', order: 7 },
  ],
};

export const migraineTracker: TrackerDefinition = {
  id: 'migraine-v1',
  name: 'Headache diary',
  condition: 'migraine',
  conditionLabel: 'Migraine',
  version: 1,
  questions: [
    { id: 'm-head', text: 'Did you have a headache?', shortLabel: 'Headache', type: 'yesNo', role: 'headache', order: 1 },
    {
      id: 'm-pain',
      text: 'How bad was the pain?',
      shortLabel: 'Pain',
      type: 'scale1to10',
      role: 'painSeverity',
      order: 2,
      min: 1,
      max: 10,
      concernThreshold: 7,
    },
    { id: 'm-sleep', text: 'Hours of sleep', shortLabel: 'Sleep', type: 'number', role: 'sleepHours', order: 3, direction: 'higherIsBetter', concernThreshold: 7 },
  ],
};

export function emptyDoc(overrides: Partial<RawPatientDocument> = {}): RawPatientDocument {
  return {
    id: 'p-1',
    patientId: 'p-1',
    profile: { firstName: 'Jordan', lastName: 'Reyes', dateOfBirth: '2012-09-15', sex: 'F', mrn: 'DEMO-000001' },
    trackers: [{ trackerId: 'asthma-v1', assignedDate: '2026-01-10', active: true }],
    dailyLogs: [],
    medications: [],
    createdAt: '2026-01-10T15:00:00Z',
    ...overrides,
  };
}

let seq = 0;
function log(doc: RawPatientDocument, day: string) {
  let l = doc.dailyLogs.find((x) => x.day === day);
  if (!l) {
    l = { day, trackerResponses: [], medicationAdministrations: [] };
    doc.dailyLogs.push(l);
  }
  return l;
}

/** Adds one tracker submission at local `time` on `day`. */
export function submit(
  doc: RawPatientDocument,
  day: string,
  time: string,
  answers: Record<string, string | null>,
  trackerId = 'asthma-v1',
): string {
  const id = `r-${++seq}`;
  const responses: RawQuestionResponse[] = Object.entries(answers).map(([questionId, value]) => ({ questionId, value }));
  log(doc, day).trackerResponses!.push({ id, trackerId, submittedAt: `${day}T${time}:00.000-04:00`, responses });
  return id;
}

export function dose(doc: RawPatientDocument, day: string, med: RawMedication, time = '08:00', value: number | string | null = 1) {
  log(doc, day).medicationAdministrations!.push({ id: med.id, time, name: med.name, value });
}

export function med(overrides: Partial<RawMedication> & Pick<RawMedication, 'id' | 'name' | 'howOften'>): RawMedication {
  return { archived: false, index: 0, ...overrides };
}

export const dulera = () =>
  med({
    id: 'med-dulera-7f3a',
    name: 'Dulera',
    howOften: 'Daily',
    icon: 'Inhaler',
    dosage: { quantity: 2, unit: 'puffs', timing: { periodUnit: 'Daily', frequency: 2, timesOfDay: ['08:00', '20:00'] } },
    relatedCondition: 'Asthma',
    startDate: '2026-03-01',
  });

export const albuterol = () =>
  med({ id: 'med-albuterol-91c2', name: 'Albuterol', howOften: 'As Needed', icon: 'Inhaler', relatedTrackerId: 'asthma-v1', index: 1 });

export function reading(
  ts: string,
  r: { fev1: number; fvc: number; pef: number; accepted: boolean; quality?: string; coaching?: string[] },
): RawBaselineReading {
  return {
    baselineReadingDate: ts,
    accepted: r.accepted,
    qualityReport: {
      quality: r.quality ?? (r.accepted ? 'Acceptable' : 'NotAcceptable'),
      qualityIndications: (r.coaching ?? []).map((m) => ({ messageInstructions: m })),
    },
    fvcPlusResults: { fvc: r.fvc, fev1: r.fev1, fev1FvcRatio: (r.fev1 / r.fvc) * 100, pef: r.pef },
  };
}

export function spirometer(readings: RawBaselineReading[]) {
  return {
    protocol: 1,
    address: 'AA:BB:CC:DD:EE:FF',
    bootId: 'boot',
    serialNumber: 'SN-1',
    deviceType: 1,
    atsStandard: 1,
    name: 'Spirobank',
    advertisementName: 'SB-1',
    baselineReadings: readings,
  };
}

/** Days of the default 30-day window (Jun 1 – Jun 30, 2026). */
export const windowDays = () => dateRange(WIN_START, TODAY);
export const priorDays = () => dateRange(PRIOR_START, addDays(WIN_START, -1));

/**
 * Scenario A — "symptoms despite good adherence": controller taken twice daily every day,
 * yet coughing / feeling bad on 12 of 30 days.
 */
export function adherentButSymptomatic(): RawPatientDocument {
  const d = dulera();
  const doc = emptyDoc({ medications: [d, albuterol()] });
  for (const day of [...priorDays(), ...windowDays()]) {
    dose(doc, day, d, '08:00');
    dose(doc, day, d, '20:00');
  }
  windowDays().forEach((day, i) => {
    const sym = i % 5 < 2; // 12 of 30 days
    submit(doc, day, '19:00', { 'q-feel': sym ? 'Bad' : 'Great', 'q-sym': sym ? '["Coughing"]' : '["None of these "]', 'q-night': 'No' });
  });
  priorDays().forEach((day, i) => {
    submit(doc, day, '19:00', { 'q-feel': 'Great', 'q-sym': i % 10 === 0 ? '["Coughing"]' : '["None of these "]', 'q-night': 'false' });
  });
  return doc;
}

/**
 * Scenario B — "uncontrolled with low adherence": controller taken once on 10 days only,
 * rescue inhaler on 12 days, symptoms most days.
 */
export function nonAdherentUncontrolled(): RawPatientDocument {
  const d = dulera();
  const a = albuterol();
  const doc = emptyDoc({ medications: [d, a] });
  windowDays().forEach((day, i) => {
    if (i % 3 === 0) dose(doc, day, d, '08:00');
    if (i % 5 < 2) dose(doc, day, a, '14:00', 2);
    submit(doc, day, '20:00', {
      'q-feel': i % 2 === 0 ? 'Bad' : 'Okay',
      'q-sym': i % 2 === 0 ? '["Wheezing","Tight Chest"]' : '["Coughing"]',
      'q-night': i % 4 === 0 ? 'Yes' : 'No',
    });
  });
  return doc;
}
