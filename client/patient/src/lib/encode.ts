/**
 * Answer encoding, exactly like the real app stores it (see CreateTrackerResponseRequest):
 *  yesNo "true"/"false" · number/scale as decimal strings · choice types = option.value verbatim
 *  (stray whitespace kept, e.g. "None of these ") · checkbox = JSON.stringify(option values[])
 *  · spirometry = baselineReadingDate of the linked blow · text = free text. Skipped = null.
 */
import type { CreateTrackerResponseRequest } from '@shared/types/api';
import type { ISODateTime, RawQuestionResponse } from '@shared/types/raw';
import type { QuestionOption, TrackerDefinition, TrackerQuestion } from '@shared/types/tracker';

/** In-progress answer as held by the UI. `undefined`/`null` = skipped / not answered. */
export type AnswerValue = boolean | number | string | string[] | null | undefined;
export type Answers = Record<string, AnswerValue>;

export function sortedQuestions(t: TrackerDefinition): TrackerQuestion[] {
  return [...t.questions].sort((a, b) => a.order - b.order);
}

export function encodeAnswer(q: TrackerQuestion, v: AnswerValue): string | null {
  if (v === undefined || v === null) return null;
  switch (q.type) {
    case 'yesNo':
      return typeof v === 'boolean' ? (v ? 'true' : 'false') : null;
    case 'number':
    case 'scale1to10': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      return Number.isFinite(n) ? String(n) : null;
    }
    case 'faceScale':
    case 'iconChoice':
    case 'singleChoice': {
      if (typeof v !== 'string') return null;
      // Return the option's value verbatim (never a trimmed/relabelled copy).
      const opt = q.options?.find((o) => o.value === v);
      return opt ? opt.value : v === '' ? null : v;
    }
    case 'checkbox': {
      if (!Array.isArray(v) || v.length === 0) return null;
      const order = q.options?.map((o) => o.value) ?? [];
      const values = [...v].sort((a, b) => rank(order, a) - rank(order, b));
      return JSON.stringify(values);
    }
    case 'spirometry':
      return typeof v === 'string' && v !== '' ? v : null;
    case 'text': {
      if (typeof v !== 'string') return null;
      const t = v.trim();
      return t === '' ? null : t;
    }
    default:
      return null;
  }
}

const rank = (order: string[], v: string) => {
  const i = order.indexOf(v);
  return i < 0 ? order.length : i;
};

/**
 * Toggle a checkbox option. Picking an `isNone` option ("None of these") clears the others;
 * picking any other option clears the `isNone` one.
 */
export function toggleCheckbox(options: QuestionOption[], current: string[], value: string): string[] {
  const opt = options.find((o) => o.value === value);
  if (current.includes(value)) return current.filter((v) => v !== value);
  if (opt?.isNone) return [value];
  const noneValues = new Set(options.filter((o) => o.isNone).map((o) => o.value));
  return [...current.filter((v) => !noneValues.has(v)), value];
}

export function isAnswered(q: TrackerQuestion, v: AnswerValue): boolean {
  return encodeAnswer(q, v) !== null;
}

export function numberError(q: TrackerQuestion, v: AnswerValue): string | null {
  if (q.type !== 'number' || typeof v !== 'number') return null;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (q.min !== undefined && v < q.min) return `Pick a number from ${q.min}${q.max !== undefined ? ` to ${q.max}` : ' up'}.`;
  if (q.max !== undefined && v > q.max) return `Pick a number${q.min !== undefined ? ` from ${q.min}` : ''} up to ${q.max}.`;
  return null;
}

export interface CheckInExtras {
  entryMode?: 'form' | 'voice';
  transcript?: string;
  mediaIds?: string[];
}

export function buildCheckInRequest(
  tracker: TrackerDefinition,
  answers: Answers,
  submittedAt?: ISODateTime,
  extras: CheckInExtras = {},
): CreateTrackerResponseRequest {
  const responses: RawQuestionResponse[] = sortedQuestions(tracker).map((q) => ({
    questionId: q.id,
    value: numberError(q, answers[q.id]) ? null : encodeAnswer(q, answers[q.id]),
  }));
  const body: CreateTrackerResponseRequest = { trackerId: tracker.id, responses };
  if (submittedAt) body.submittedAt = submittedAt;
  if (extras.entryMode) body.entryMode = extras.entryMode;
  if (extras.transcript?.trim()) body.transcript = extras.transcript.trim().slice(0, 4000);
  if (extras.mediaIds?.length) body.mediaIds = extras.mediaIds.slice(0, 10);
  return body;
}

/** Match a stored/extracted string to an option value (exact first, then trimmed + case-insensitive). */
function matchOption(q: TrackerQuestion, v: string): string | undefined {
  const opts = q.options ?? [];
  const exact = opts.find((o) => o.value === v);
  if (exact) return exact.value;
  const key = v.trim().toLowerCase();
  return opts.find((o) => o.value.trim().toLowerCase() === key || o.label.trim().toLowerCase() === key)?.value;
}

/**
 * Inverse of encodeAnswer: turn an encoded value (e.g. from voice parsing) back into the UI's
 * AnswerValue. Unknown or malformed values decode to undefined (= unanswered).
 */
export function decodeAnswer(q: TrackerQuestion, enc: string | null | undefined): AnswerValue {
  if (enc === null || enc === undefined || enc === '') return undefined;
  switch (q.type) {
    case 'yesNo': {
      const k = enc.trim().toLowerCase();
      if (k === 'true' || k === 'yes') return true;
      if (k === 'false' || k === 'no') return false;
      return undefined;
    }
    case 'number':
    case 'scale1to10': {
      const n = Number(enc);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'faceScale':
    case 'iconChoice':
    case 'singleChoice':
      return matchOption(q, enc);
    case 'checkbox': {
      let arr: unknown;
      try {
        arr = JSON.parse(enc);
      } catch {
        arr = [enc];
      }
      if (!Array.isArray(arr)) return undefined;
      const vals = arr.filter((x): x is string => typeof x === 'string').map((x) => matchOption(q, x)).filter((x): x is string => !!x);
      const unique = [...new Set(vals)];
      return unique.length ? unique : undefined;
    }
    case 'spirometry':
    case 'text':
      return enc;
    default:
      return undefined;
  }
}

/** Human display of an answer for the review step. */
export function displayAnswer(q: TrackerQuestion, v: AnswerValue): string {
  const enc = encodeAnswer(q, v);
  if (enc === null) return 'Skipped';
  const label = (val: string) => {
    const o = q.options?.find((x) => x.value === val);
    return o ? `${o.icon ? `${o.icon} ` : ''}${o.label}` : val.trim();
  };
  switch (q.type) {
    case 'yesNo':
      return enc === 'true' ? 'Yes' : 'No';
    case 'number':
      return `${enc}${q.unit ? ` ${q.unit}` : ''}`;
    case 'scale1to10':
      return `${enc} out of 10`;
    case 'checkbox':
      return (JSON.parse(enc) as string[]).map(label).join(', ');
    case 'faceScale':
    case 'iconChoice':
    case 'singleChoice':
      return label(enc);
    case 'spirometry':
      return 'Breathing test linked';
    default:
      return enc;
  }
}
