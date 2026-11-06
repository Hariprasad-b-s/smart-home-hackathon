/**
 * Voice check-in extraction: transcript → one answer per tracker question, encoded exactly like
 * CreateTrackerResponseRequest values. Nothing is saved; the patient reviews and submits.
 *
 * Claude path: structured outputs (`output_config.format` json_schema generated from the
 * TrackerDefinition) at effort "medium". Any failure (no credentials, network, refusal,
 * max_tokens, invalid output, rate limit) falls back to the rule engine (engine: 'rules').
 */
import type { SafetyNotice, VoiceParsedAnswer, VoiceParseResult } from '../../shared/types/api';
import type { RawPatientDocument } from '../../shared/types/raw';
import type { TrackerDefinition, TrackerQuestion } from '../../shared/types/tracker';
import { callClaude, responseText, type AiEngine, type BetaCreateParams } from './engine';
import { safetyScreen } from './safety';
import { truncate } from './text';
import { ruleExtract } from './voiceRules';

const CONFIDENCE = ['high', 'medium', 'low'] as const;
const CHOICE_TYPES = new Set(['faceScale', 'iconChoice', 'singleChoice']);

/** Questions a voice transcript can answer (the spirometer prompt is filled by the device). */
const extractable = (q: TrackerQuestion) => q.type !== 'spirometry';
const ordered = (t: TrackerDefinition) => [...t.questions].sort((a, b) => a.order - b.order);

// ───────────────────────────────── Prompt & schema ─────────────────────────────────

/** Stable system prompt (cached). Tracker specifics and the transcript go in the user turn. */
export const VOICE_SYSTEM_PROMPT = `You extract answers for a daily health check-in from what a teenager said out loud in the SMART@Home app. The transcript comes from browser speech-to-text, so expect missing punctuation, filler words and small recognition errors. This is a demo on synthetic data.

Rules:
- Extract ONLY what the patient explicitly said. If a question was not addressed, its value is null. Never guess, infer from typical patterns, or fill in a "normal" answer.
- Never diagnose, interpret, or give advice. You only fill in the form.
- Choice questions: use one of the listed option values exactly as written (including any trailing spaces), or null.
- Checkbox questions: list every option the patient said applies. Use a "none" option only when the patient says they have none of them (for example "no symptoms today"). Saying one item is absent ("no wheezing") is not the same as "none of these"; just leave that item out. Use null when the topic did not come up.
- Yes/no questions: true or false only when the patient said so ("I didn't wake up at night" = false), otherwise null.
- Number and scale questions: a number inside the stated range, otherwise null. Convert number words ("twice" = 2, "seven out of ten" = 7, "an hour and a half" = 1.5).
- Map everyday words to the options: "my chest feels tight" means Tight Chest; "out of breath" or "hard to breathe" means shortness of breath; "puffer", "inhaler" or "albuterol" means the rescue inhaler for asthma unless the patient names a daily controller; "pooped" or "went to the bathroom" counts bowel movements; feeling words map to the closest face or weather option ("pretty good" = Good, "awful" = Awful).
- Negation matters: "no wheezing", "didn't wake up", "didn't need my inhaler" (0 uses).
- confidence: "high" when the patient said it directly, "medium" for a clear synonym or a hedged number ("about 6 hours"), "low" when it is only loosely implied. Use "low" with a null value.
- evidence: a short exact quote (under 15 words) from the transcript that supports the value, or null when the value is null.`;

function valueSchema(q: TrackerQuestion): Record<string, unknown> {
  const values = (q.options ?? []).map((o) => o.value);
  if (CHOICE_TYPES.has(q.type)) return { anyOf: [{ type: 'string', enum: values }, { type: 'null' }] };
  if (q.type === 'checkbox') return { anyOf: [{ type: 'array', items: { type: 'string', enum: values } }, { type: 'null' }] };
  if (q.type === 'yesNo') return { anyOf: [{ type: 'boolean' }, { type: 'null' }] };
  if (q.type === 'number' || q.type === 'scale1to10') return { anyOf: [{ type: 'number' }, { type: 'null' }] };
  return { anyOf: [{ type: 'string' }, { type: 'null' }] };
}

/** JSON schema for structured outputs: one property per extractable question. */
export function voiceSchema(tracker: TrackerDefinition): Record<string, unknown> {
  const qs = ordered(tracker).filter(extractable);
  const properties: Record<string, unknown> = {};
  for (const q of qs) {
    properties[q.id] = {
      type: 'object',
      description: q.text,
      properties: {
        value: valueSchema(q),
        confidence: { type: 'string', enum: [...CONFIDENCE] },
        evidence: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      required: ['value', 'confidence', 'evidence'],
      additionalProperties: false,
    };
  }
  return { type: 'object', properties, required: qs.map((q) => q.id), additionalProperties: false };
}

function describeQuestion(q: TrackerQuestion): string {
  const lines = [`- ${q.id} (${q.type}${q.role ? `, ${q.role}` : ''}): ${q.text}`];
  if (q.options?.length) {
    lines.push(
      `  options: ${q.options.map((o) => `${JSON.stringify(o.value)}${o.label.trim() !== o.value.trim() ? ` (${o.label})` : ''}${o.isNone ? ' [none option]' : ''}`).join(', ')}`,
    );
  }
  if (q.min !== undefined || q.max !== undefined) lines.push(`  range: ${q.min ?? '-'} to ${q.max ?? '-'}${q.unit ? ` ${q.unit}` : ''}`);
  return lines.join('\n');
}

function userPrompt(tracker: TrackerDefinition, transcript: string): string {
  return [
    `Tracker: ${tracker.name} (${tracker.conditionLabel})`,
    'Questions:',
    ...ordered(tracker).filter(extractable).map(describeQuestion),
    '',
    'Transcript:',
    `<transcript>\n${transcript}\n</transcript>`,
  ].join('\n');
}

// ───────────────────────────────── Encoding / validation ─────────────────────────────────

/**
 * Validate one model value and encode it as the raw string format. Returns null for
 * "not mentioned" and throws on a value that breaks the schema (→ whole result falls back).
 */
export function encodeValue(q: TrackerQuestion, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const options = q.options ?? [];
  const optionFor = (s: string) => options.find((o) => o.value === s) ?? options.find((o) => o.value.trim() === s.trim());
  if (CHOICE_TYPES.has(q.type)) {
    if (typeof v !== 'string') throw new Error(`${q.id}: expected string`);
    const o = optionFor(v);
    if (!o) throw new Error(`${q.id}: unknown option ${v}`);
    return o.value;
  }
  if (q.type === 'checkbox') {
    if (!Array.isArray(v)) throw new Error(`${q.id}: expected array`);
    const picked: string[] = [];
    for (const item of v) {
      if (typeof item !== 'string') throw new Error(`${q.id}: expected strings`);
      const o = optionFor(item);
      if (!o) throw new Error(`${q.id}: unknown option ${item}`);
      if (!picked.includes(o.value)) picked.push(o.value);
    }
    const noneValues = options.filter((o) => o.isNone).map((o) => o.value);
    const real = picked.filter((x) => !noneValues.includes(x));
    const final = real.length ? real : picked;
    return final.length ? JSON.stringify(final) : null;
  }
  if (q.type === 'yesNo') {
    if (typeof v !== 'boolean') throw new Error(`${q.id}: expected boolean`);
    return v ? 'true' : 'false';
  }
  if (q.type === 'number' || q.type === 'scale1to10') {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${q.id}: expected number`);
    if ((q.min !== undefined && v < q.min) || (q.max !== undefined && v > q.max)) return null; // out of range → not trusted
    const n = q.type === 'scale1to10' ? Math.round(v) : Math.round(v * 100) / 100;
    return String(n);
  }
  if (q.type === 'text') {
    if (typeof v !== 'string') throw new Error(`${q.id}: expected string`);
    return v.trim() ? truncate(v, 2000) : null;
  }
  return null;
}

/** Turn the structured output into answers (throws on invalid shape). */
export function answersFromModel(tracker: TrackerDefinition, json: unknown): VoiceParsedAnswer[] {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error('output is not an object');
  const obj = json as Record<string, unknown>;
  return ordered(tracker).map((q) => {
    if (!extractable(q)) return { questionId: q.id, value: null, confidence: 'low' };
    const item = obj[q.id];
    if (typeof item !== 'object' || item === null) throw new Error(`missing ${q.id}`);
    const { value, confidence, evidence } = item as { value?: unknown; confidence?: unknown; evidence?: unknown };
    const encoded = encodeValue(q, value);
    if (encoded === null) return { questionId: q.id, value: null, confidence: 'low' };
    const conf = CONFIDENCE.includes(confidence as (typeof CONFIDENCE)[number]) ? (confidence as VoiceParsedAnswer['confidence']) : 'medium';
    const out: VoiceParsedAnswer = { questionId: q.id, value: encoded, confidence: conf };
    if (typeof evidence === 'string' && evidence.trim()) out.evidence = truncate(evidence, 160);
    return out;
  });
}

// ───────────────────────────────── Follow-up ─────────────────────────────────

const TOPIC_BY_ROLE: Partial<Record<NonNullable<TrackerQuestion['role']>, string>> = {
  overallFeeling: 'how you’re feeling overall',
  symptoms: 'any symptoms you have right now',
  nightWaking: 'whether you woke up at night',
  missedSchool: 'whether you missed school',
  rescueMedUse: 'how many times you used your rescue inhaler',
  triggers: 'what might have triggered it',
  headache: 'whether you had a headache',
  painSeverity: 'how bad the pain was from 1 to 10',
  symptomSeverity: 'how bad it was from 1 to 10',
  headacheDurationHours: 'how many hours the headache lasted',
  sleepHours: 'how many hours you slept',
  stoolFrequency: 'how many bowel movements you had',
  bloodInStool: 'whether you saw any blood',
  activityLimitation: 'whether it stopped you doing things',
};

const HEADACHE_DEPENDENT = new Set(['painSeverity', 'headacheDurationHours', 'triggers']);

function joinTopics(topics: string[]): string {
  if (topics.length <= 1) return topics[0] ?? '';
  return `${topics.slice(0, -1).join(', ')} and ${topics[topics.length - 1]}`;
}

/** Friendly follow-up naming up to 3 missing topics (undefined when nothing important is missing). */
export function followUpFor(tracker: TrackerDefinition, answers: VoiceParsedAnswer[]): string | undefined {
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  const noHeadache = ordered(tracker).some((q) => q.role === 'headache' && byId.get(q.id)?.value === 'false');
  const missing = ordered(tracker).filter((q) => {
    if (!extractable(q) || q.type === 'text') return false;
    if (byId.get(q.id)?.value != null) return false;
    if (noHeadache && q.role && HEADACHE_DEPENDENT.has(q.role)) return false;
    return true;
  });
  if (!missing.length) return undefined;
  const topics = missing.slice(0, 3).map((q) => (q.role && TOPIC_BY_ROLE[q.role]) || q.shortLabel.toLowerCase());
  return `Thanks! Can you also tell me ${joinTopics(topics)}?`;
}

// ───────────────────────────────── Entry point ─────────────────────────────────

function assemble(tracker: TrackerDefinition, answers: VoiceParsedAnswer[], engine: 'claude' | 'rules', safety?: SafetyNotice): VoiceParseResult {
  const result: VoiceParseResult = {
    trackerId: tracker.id,
    answers,
    unanswered: answers.filter((a) => a.value === null).map((a) => a.questionId),
    engine,
  };
  const followUp = followUpFor(tracker, answers);
  if (followUp) result.followUp = followUp;
  if (safety) result.safety = safety;
  return result;
}

export function voiceRequest(engine: AiEngine, tracker: TrackerDefinition, transcript: string): BetaCreateParams {
  return {
    model: engine.model,
    max_tokens: 4096,
    system: [{ type: 'text', text: VOICE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: voiceSchema(tracker) } },
    messages: [{ role: 'user', content: userPrompt(tracker, transcript) }],
  };
}

/** Parse a spoken check-in. Never throws for model problems; falls back to the rule engine. */
export async function parseVoiceCheckin(
  doc: RawPatientDocument,
  tracker: TrackerDefinition,
  transcript: string,
  engine?: AiEngine,
): Promise<VoiceParseResult> {
  const safety = safetyScreen(transcript); // deterministic, before any model call
  if (engine?.client) {
    const out = await callClaude(engine, doc.id, voiceRequest(engine, tracker, transcript), 'voice');
    if (out.ok) {
      try {
        return assemble(tracker, answersFromModel(tracker, JSON.parse(responseText(out.message))), 'claude', safety);
      } catch (err) {
        console.warn(`[ai:voice] Invalid structured output (${(err as Error).message}); using rules.`);
      }
    }
  }
  return assemble(tracker, ruleExtract(tracker, transcript), 'rules', safety);
}
