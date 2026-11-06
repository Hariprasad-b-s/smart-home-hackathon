/**
 * Decoding of raw tracker answers. Raw `value`s are ALWAYS strings (or null) and must be
 * interpreted with the question type from the TrackerDefinition.
 */
import type { QuestionOption, Severity, TrackerQuestion } from '../types/tracker';

export type Decoded =
  | { kind: 'boolean'; value: boolean }
  | { kind: 'number'; value: number }
  /** `known` = matched one of the question's options. */
  | { kind: 'choice'; label: string; severity?: Severity; known: boolean }
  /** Human labels, "none"-style options removed. `items` may be [] when only "None" was ticked. */
  | { kind: 'multi'; items: string[]; noneSelected: boolean }
  | { kind: 'text'; text: string };

const TRUE_WORDS = new Set(['true', 'yes', '1', 'y']);
const FALSE_WORDS = new Set(['false', 'no', '0', 'n']);

export function isEmptyRaw(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  return s === '' || s === '[]' || s.toLowerCase() === 'null';
}

export function parseYesNo(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim().toLowerCase();
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  return undefined;
}

export function parseNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function matchOption(q: TrackerQuestion, raw: string): QuestionOption | undefined {
  const key = norm(raw);
  const opts = q.options ?? [];
  return opts.find((o) => norm(o.value) === key) ?? opts.find((o) => norm(o.label) === key);
}

function parseList(raw: string): string[] {
  const s = raw.trim();
  if (s.startsWith('[') || s.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.filter((x) => x !== null && x !== undefined).map((x) => String(x));
      if (typeof parsed === 'string') return [parsed];
    } catch {
      /* fall through to comma split */
    }
  }
  return s
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((x) => x.replace(/^\s*"|"\s*$/g, ''));
}

/** Decodes one raw answer. Returns null for empty / undecodable answers. */
export function decodeAnswer(q: TrackerQuestion, raw: string | null | undefined): Decoded | null {
  if (isEmptyRaw(raw)) return null;
  const s = String(raw).trim();
  switch (q.type) {
    case 'yesNo': {
      const b = parseYesNo(s);
      return b === undefined ? null : { kind: 'boolean', value: b };
    }
    case 'number':
    case 'scale1to10': {
      const n = parseNumber(s);
      return n === undefined ? null : { kind: 'number', value: n };
    }
    case 'faceScale':
    case 'iconChoice':
    case 'singleChoice': {
      const o = matchOption(q, s);
      if (o) return { kind: 'choice', label: o.label, severity: o.severity, known: true };
      return { kind: 'choice', label: s, known: false };
    }
    case 'checkbox': {
      const parts = parseList(s)
        .map((x) => x.trim())
        .filter((x) => x !== '');
      if (parts.length === 0) return null;
      const items: string[] = [];
      let noneSelected = false;
      for (const p of parts) {
        const o = matchOption(q, p);
        if (o?.isNone) {
          noneSelected = true;
          continue;
        }
        const label = o ? o.label : p;
        if (!items.includes(label)) items.push(label);
      }
      return { kind: 'multi', items, noneSelected };
    }
    case 'spirometry': {
      // The app stores the linked blow's raw timestamp here; show it as a clock time.
      const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(s);
      return { kind: 'text', text: m ? `Reading taken at ${m[1]}:${m[2]}` : s };
    }
    case 'text':
    default:
      return { kind: 'text', text: s };
  }
}

/** Short display text for the day drawer. */
export function displayDecoded(d: Decoded): string {
  switch (d.kind) {
    case 'boolean':
      return d.value ? 'Yes' : 'No';
    case 'number':
      return String(d.value);
    case 'choice':
      return d.label;
    case 'multi':
      return d.items.length ? d.items.join(', ') : 'None';
    case 'text':
      return d.text;
  }
}
