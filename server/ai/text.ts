/** Small text helpers shared by the safety screen, voice rules and chat rules. */

/**
 * Lower-case, unify quotes, DROP apostrophes ("can't" → "cant") and turn other punctuation into
 * spaces, so patterns are punctuation-tolerant. "7/10" keeps its slash; decimals keep their dot.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/'/g, '')
    .replace(/(\d)\.(\d)/g, '$1\u0000$2')
    .replace(/(\d)\s*\/\s*(\d)/g, '$1\u0001$2')
    .replace(/[^a-z0-9\u0000\u0001\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\u0000/g, '.')
    .replace(/\u0001/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, none: 0, no: 0, one: 1, a: 1, an: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20,
};
export const NUMBER_WORD_RE = '(?:\\d+(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';

/** "7" | "seven" | "2.5" → number (undefined if not a number word). */
export function wordToNumber(w: string): number | undefined {
  if (/^\d+(\.\d+)?$/.test(w)) return Number(w);
  return NUMBER_WORDS[w];
}

/** Hedge words lower confidence: "about 6 hours", "like three times". */
export const HEDGE_RE = /\b(about|around|like|maybe|probably|roughly|almost|nearly|kinda|kind of|i think|or so|ish)\b/;

/** Negators (apostrophes already removed by normalize). */
export const NEGATOR_RE = /\b(no|not|never|without|didnt|did not|dont|do not|doesnt|does not|havent|have not|hasnt|wasnt|was not|werent|isnt|arent|wont|nor|neither|none|zero|cant|cannot|couldnt|nothing)\b/;

/**
 * Split normalized text into clauses. Negation scope ends at a clause boundary, so
 * "no wheezing but my chest feels tight" and "no wheezing and my chest is tight" keep the
 * tight chest positive, while "no wheezing or coughing" negates both.
 */
export function clauses(norm: string): string[] {
  return norm
    .split(/\b(?:but|however|although|though|except|and|also|plus|then|so|because|cause|cuz|since|while)\b/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Sentences of the ORIGINAL text (for evidence quotes). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when a negator appears in the clause before `index` (scope = rest of the clause). */
export function negatedAt(clause: string, index: number): boolean {
  const before = clause.slice(0, index).replace(/\b(cant|couldnt|wont|cannot) stop\b/g, 'keep');
  return NEGATOR_RE.test(before);
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function truncate(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

/** First 6 words of a message, as a fallback conversation topic. */
export function firstWords(text: string, n = 6): string {
  const words = text.trim().replace(/\s+/g, ' ').split(' ').slice(0, n).join(' ');
  return truncate(words.replace(/[.,;:!?]+$/, ''), 60) || 'Chat';
}
