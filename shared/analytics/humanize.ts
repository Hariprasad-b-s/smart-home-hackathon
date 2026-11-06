/** Text / number formatting helpers shared by the analytics modules. */
import type { Status, Trend } from '../types/summary';

/**
 * "KeepGoingUntilCompletelyEmpty" → "Keep going until completely empty",
 * "NotAcceptable" → "Not acceptable", "PEF_too_low" → "PEF too low".
 */
export function humanizeIdentifier(s: string | null | undefined): string {
  if (typeof s !== 'string') return '';
  const spaced = s
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return '';
  const words = spaced.split(' ').map((w, i) => {
    const isAcronym = w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w);
    if (isAcronym) return w;
    const lower = w.toLowerCase();
    return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  });
  return words.join(' ');
}

export function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Percentage a/b rounded to 0 dp, null when b is 0. */
export function pctOf(a: number, b: number): number | null {
  return b > 0 ? round((a / b) * 100) : null;
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

/** "+4", "−12" (true minus sign), "0". */
export function signed(n: number, dp = 0): string {
  const r = round(n, dp);
  if (r > 0) return `+${r}`;
  if (r < 0) return `−${Math.abs(r)}`;
  return '0';
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** 1 → "once", 2 → "twice", 3 → "three times", n → "n times". */
export function timesWord(n: number): string {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  if (n === 3) return 'three times';
  if (n === 4) return 'four times';
  return `${n} times`;
}

export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** good ≥ 80, watch 50–79, concern < 50, unknown when null. */
export function adherenceStatus(pct: number | null): Status {
  if (pct === null) return 'unknown';
  if (pct >= 80) return 'good';
  if (pct >= 50) return 'watch';
  return 'concern';
}

export interface TrendOptions {
  /** true = higher is worse, false = higher is better, null = neither. */
  higherIsWorse: boolean | null;
  /** 'abs' compares differences, 'pct' compares relative change (%). */
  mode: 'abs' | 'pct';
  /** Minimum |change| (absolute units, or % for mode 'pct') to count as up/down. */
  minChange: number;
  /** Comparison text, e.g. "prior 30 days". */
  versus: string;
  unit?: string;
  dp?: number;
}

/** Builds a Trend comparing `current` to `previous`. Undefined when either is missing. */
export function makeTrend(
  current: number | null | undefined,
  previous: number | null | undefined,
  o: TrendOptions,
): Trend | undefined {
  if (current === null || current === undefined || previous === null || previous === undefined) return undefined;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return undefined;
  let change: number;
  if (o.mode === 'pct') {
    if (previous === 0) return undefined;
    change = ((current - previous) / Math.abs(previous)) * 100;
  } else {
    change = current - previous;
  }
  const unit = o.mode === 'pct' ? '%' : (o.unit ?? '');
  const dp = o.mode === 'pct' ? 0 : (o.dp ?? 0);
  if (Math.abs(change) < o.minChange || round(change, dp) === 0) {
    return { direction: 'flat', meaning: 'neutral', text: `No change vs ${o.versus}` };
  }
  const direction = change > 0 ? 'up' : 'down';
  let meaning: Trend['meaning'] = 'neutral';
  if (o.higherIsWorse !== null) {
    const worse = direction === 'up' ? o.higherIsWorse : !o.higherIsWorse;
    meaning = worse ? 'worse' : 'better';
  }
  return { direction, meaning, text: `${signed(change, dp)}${unit} vs ${o.versus}` };
}

const BADGE_PATTERNS: [RegExp, (n: string) => string][] = [
  [/^TrackerBadge(\d+)$/i, (n) => `${n} check-ins`],
  [/^TrackerStreak(\d+)$/i, (n) => `${n}-day check-in streak`],
  [/^MedicationStreak(\d+)$/i, (n) => `${n}-day medication streak`],
  [/^MedicationBadge(\d+)$/i, (n) => `${n} doses logged`],
];

export function badgeLabel(name: string): string {
  for (const [re, f] of BADGE_PATTERNS) {
    const m = re.exec(name.trim());
    if (m) return f(m[1]);
  }
  return humanizeIdentifier(name.replace(/(\D)(\d)/, '$1 $2'));
}
