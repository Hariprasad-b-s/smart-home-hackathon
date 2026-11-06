import { describe, expect, it } from 'vitest';
import type { VoiceParseResult } from '../../shared/types/api';
import { createStore } from '../data/store';
import { Q, TRACKER_IDS, TRACKERS } from '../data/trackers';
import { postTrackerResponse } from '../patientApp';
import { parseVoiceCheckin, voiceSchema } from './voice';
import { fakeClient, fakeEngine, fakeMessage } from './testUtils';

const store = createStore({ today: '2026-11-06' });
const tracker = (id: string) => TRACKERS.find((t) => t.id === id)!;
const patientWith = (trackerId: string) => store.listPatients().find((p) => p.trackers.some((t) => t.trackerId === trackerId && t.active))!;
const val = (r: VoiceParseResult, qid: string) => r.answers.find((a) => a.questionId === qid)!.value;

/** Every produced value must pass the real server validation (POST tracker-responses handler). */
function expectValid(trackerId: string, r: VoiceParseResult) {
  const doc = patientWith(trackerId);
  const out = postTrackerResponse(store, doc, {
    trackerId,
    entryMode: 'voice',
    responses: r.answers.map((a) => ({ questionId: a.questionId, value: a.value })),
  });
  expect(out.status, JSON.stringify(out.body)).toBe(201);
}

async function rules(trackerId: string, transcript: string) {
  const r = await parseVoiceCheckin(patientWith(trackerId), tracker(trackerId), transcript);
  expect(r.engine).toBe('rules');
  expect(r.answers.map((a) => a.questionId)).toEqual(tracker(trackerId).questions.map((q) => q.id));
  expectValid(trackerId, r);
  return r;
}

describe('voice check-in: rule engine', () => {
  it('asthma: synonyms, counts, negation and feelings', async () => {
    const r = await rules(
      TRACKER_IDS.asthma,
      "I'm feeling pretty good today. My chest feels tight and I've been coughing, but no wheezing. I didn't wake up at night. I went to school. I used my puffer twice. I think the cold air set it off.",
    );
    expect(val(r, Q.asthma.feeling)).toBe('Good');
    expect(JSON.parse(val(r, Q.asthma.symptoms)!)).toEqual(['Coughing', 'Tight Chest']);
    expect(val(r, Q.asthma.nightWaking)).toBe('false');
    expect(val(r, Q.asthma.missedSchool)).toBe('false');
    expect(val(r, Q.asthma.rescueUses)).toBe('2');
    expect(JSON.parse(val(r, Q.asthma.triggers)!)).toEqual(['Cold air']);
    expect(val(r, Q.asthma.spirometer)).toBeNull();
    expect(r.unanswered).toEqual([Q.asthma.spirometer]);
    expect(r.followUp).toBeUndefined();
    expect(r.safety).toBeUndefined();
    const symptoms = r.answers.find((a) => a.questionId === Q.asthma.symptoms)!;
    expect(symptoms.evidence).toMatch(/chest feels tight/i);
  });

  it('migraine: pain out of ten, hours, sleep and triggers', async () => {
    const r = await rules(
      TRACKER_IDS.migraine,
      'I had a migraine today, it was about a seven out of ten and lasted like three hours. I slept six hours last night. I skipped breakfast and was really stressed about my test. I still went to school. Feeling okay now.',
    );
    expect(val(r, Q.migraine.headache)).toBe('true');
    expect(val(r, Q.migraine.pain)).toBe('7');
    expect(val(r, Q.migraine.duration)).toBe('3');
    expect(r.answers.find((a) => a.questionId === Q.migraine.duration)!.confidence).toBe('medium');
    expect(val(r, Q.migraine.sleep)).toBe('6');
    expect(val(r, Q.migraine.missedSchool)).toBe('false');
    expect(JSON.parse(val(r, Q.migraine.triggers)!)).toEqual(['Stress', 'Skipped meal']);
    expect(val(r, Q.migraine.feeling)).toBe('Okay');
    expect(r.unanswered).toEqual([]);
  });

  it('migraine: hour and a half, and no headache skips dependent follow-ups', async () => {
    const a = await rules(TRACKER_IDS.migraine, 'My headache lasted an hour and a half and I got 8 hours of sleep');
    expect(val(a, Q.migraine.duration)).toBe('1.5');
    expect(val(a, Q.migraine.sleep)).toBe('8');
    const b = await rules(TRACKER_IDS.migraine, 'No headache today. I feel great.');
    expect(val(b, Q.migraine.headache)).toBe('false');
    expect(b.followUp).toMatch(/school/);
    expect(b.followUp).not.toMatch(/pain|lasted|triggered/);
  });

  it('IBD: bathroom count, blood negation, belly pain, weather feeling', async () => {
    const r = await rules(
      TRACKER_IDS.ibd,
      "I went to the bathroom four times today and there was no blood. My belly pain was like a 5. I've had some cramping and I'm really tired. I stayed home from school. Feeling partly cloudy.",
    );
    expect(val(r, Q.ibd.stools)).toBe('4');
    expect(val(r, Q.ibd.blood)).toBe('false');
    expect(val(r, Q.ibd.pain)).toBe('5');
    expect(JSON.parse(val(r, Q.ibd.symptoms)!)).toEqual(['Cramping', 'Fatigue']);
    expect(val(r, Q.ibd.missedSchool)).toBe('true');
    expect(val(r, Q.ibd.feeling)).toBe('Partly cloudy');
  });

  it('negation: "no wheezing", "didn\'t need my inhaler", "slept through the night"', async () => {
    const r = await rules(TRACKER_IDS.asthma, "No wheezing and no coughing today. I didn't need my inhaler at all and I slept through the night. Feeling great.");
    expect(val(r, Q.asthma.symptoms)).toBeNull(); // denying items is not "none of these"
    expect(val(r, Q.asthma.rescueUses)).toBe('0');
    expect(val(r, Q.asthma.nightWaking)).toBe('false');
    expect(val(r, Q.asthma.feeling)).toBe('Great');
  });

  it('none-of-these only when the patient says so (verbatim option value with stray space)', async () => {
    const r = await rules(TRACKER_IDS.asthma, 'No symptoms today, nothing triggered anything. I feel fine.');
    expect(val(r, Q.asthma.symptoms)).toBe(JSON.stringify(['None of these ']));
    expect(val(r, Q.asthma.triggers)).toBe(JSON.stringify(['None']));
    expect(val(r, Q.asthma.feeling)).toBe('Good');
  });

  it('woke up coughing, missed school, number words', async () => {
    const r = await rules(TRACKER_IDS.asthma, "I woke up coughing in the middle of the night and didn't go to school. Used my inhaler three times. Feeling bad.");
    expect(val(r, Q.asthma.nightWaking)).toBe('true');
    expect(val(r, Q.asthma.missedSchool)).toBe('true');
    expect(val(r, Q.asthma.rescueUses)).toBe('3');
    expect(val(r, Q.asthma.feeling)).toBe('Bad');
  });

  it('follow-up names up to three missing topics', async () => {
    const r = await rules(TRACKER_IDS.asthma, 'I feel okay');
    expect(val(r, Q.asthma.feeling)).toBe('Okay');
    expect(r.followUp).toBe('Thanks! Can you also tell me any symptoms you have right now, whether you woke up at night and whether you missed school?');
    expect(r.unanswered).toContain(Q.asthma.rescueUses);
  });

  it('out-of-range numbers are dropped, not guessed', async () => {
    const r = await rules(TRACKER_IDS.asthma, 'I used my inhaler 40 times');
    expect(val(r, Q.asthma.rescueUses)).toBeNull();
  });

  it('runs the safety screen on the transcript', async () => {
    const r = await rules(TRACKER_IDS.asthma, "I can't breathe and my lips are blue");
    expect(r.safety?.level).toBe('emergency');
  });
});

describe('voice check-in: Claude path (fake client)', () => {
  const asthma = tracker(TRACKER_IDS.asthma);
  const doc = patientWith(TRACKER_IDS.asthma);
  const modelJson = {
    [Q.asthma.feeling]: { value: 'Good', confidence: 'high', evidence: 'pretty good' },
    [Q.asthma.symptoms]: { value: ['Tight Chest', 'None of these '], confidence: 'medium', evidence: 'chest feels tight' },
    [Q.asthma.nightWaking]: { value: false, confidence: 'high', evidence: "didn't wake up" },
    [Q.asthma.missedSchool]: { value: null, confidence: 'low', evidence: null },
    [Q.asthma.rescueUses]: { value: 2, confidence: 'high', evidence: 'puffer twice' },
    [Q.asthma.triggers]: { value: [], confidence: 'low', evidence: null },
  };

  it('builds a strict structured-output request and encodes the result', async () => {
    const client = fakeClient(fakeMessage([{ type: 'text', text: JSON.stringify(modelJson) }]));
    const r = await parseVoiceCheckin(doc, asthma, 'pretty good, chest feels tight, puffer twice', fakeEngine(client));
    expect(r.engine).toBe('claude');
    expect(val(r, Q.asthma.feeling)).toBe('Good');
    expect(val(r, Q.asthma.symptoms)).toBe(JSON.stringify(['Tight Chest'])); // none option dropped when combined
    expect(val(r, Q.asthma.nightWaking)).toBe('false');
    expect(val(r, Q.asthma.rescueUses)).toBe('2');
    expect(val(r, Q.asthma.triggers)).toBeNull();
    expect(r.unanswered).toEqual([Q.asthma.spirometer, Q.asthma.missedSchool, Q.asthma.triggers]);
    expectValid(TRACKER_IDS.asthma, r);

    const req = client.calls[0] as unknown as Record<string, any>;
    expect(req.model).toBe('claude-opus-5-5');
    expect(req.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(req.fallbacks).toBe('default');
    expect(req.output_config.effort).toBe('medium');
    expect(req.output_config.format.type).toBe('json_schema');
    expect(req.thinking).toEqual({ type: 'adaptive' });
    expect(req.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(req.tool_choice).toBeUndefined();
    const schema = req.output_config.format.schema;
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).not.toContain(Q.asthma.spirometer);
    expect(JSON.stringify(schema.properties[Q.asthma.symptoms])).toContain('"None of these "');
  });

  it('schema: enums are verbatim, numbers carry no unsupported min/max', () => {
    const s = voiceSchema(asthma) as any;
    expect(s.properties[Q.asthma.rescueUses].properties.value).toEqual({ anyOf: [{ type: 'number' }, { type: 'null' }] });
    expect(s.properties[Q.asthma.nightWaking].properties.value).toEqual({ anyOf: [{ type: 'boolean' }, { type: 'null' }] });
    expect(s.required).toEqual(Object.keys(s.properties));
  });

  it.each([
    ['refusal', fakeMessage([], 'refusal', { stop_details: { type: 'refusal', category: null } })],
    ['max_tokens', fakeMessage([{ type: 'text', text: '{"asthma' }], 'max_tokens')],
    ['invalid JSON', fakeMessage([{ type: 'text', text: 'not json' }])],
    ['unknown option', fakeMessage([{ type: 'text', text: JSON.stringify({ ...modelJson, [Q.asthma.feeling]: { value: 'Meh', confidence: 'high', evidence: null } }) }])],
    ['network error', new Error('ECONNRESET')],
  ])('%s → rule engine', async (_label, response) => {
    const r = await parseVoiceCheckin(doc, asthma, 'I used my puffer twice', fakeEngine(fakeClient(response)));
    expect(r.engine).toBe('rules');
    expect(val(r, Q.asthma.rescueUses)).toBe('2');
  });

  it('respects the per-patient rate limit', async () => {
    const engine = fakeEngine(fakeClient());
    for (let i = 0; i < 20; i++) engine.limiter.take(doc.id);
    const r = await parseVoiceCheckin(doc, asthma, 'I feel great', engine);
    expect(r.engine).toBe('rules');
  });
});
