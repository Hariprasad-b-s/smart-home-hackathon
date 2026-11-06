/**
 * Shared helpers for the charts module: UTC-safe date math on YYYY-MM-DD strings,
 * human date formatting ("Mar 4"), band scales, nice ticks, and token lookups.
 * Colors are always returned as `var(--token)` strings — never hex.
 */
import type { Severity } from '@shared/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function toUTC(d: string): Date {
  return new Date(d + 'T00:00:00Z');
}

export function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const t = toUTC(d);
  t.setUTCDate(t.getUTCDate() + n);
  return isoOf(t);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

/** Inclusive list of dates from start to end. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const n = daysBetween(start, end);
  for (let i = 0; i <= n; i++) out.push(addDays(start, i));
  return out;
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayMon0(d: string): number {
  return (toUTC(d).getUTCDay() + 6) % 7;
}

/** "Mar 4" */
export function fmtDay(d: string): string {
  const t = toUTC(d);
  return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`;
}

/** "Wed, Mar 4" */
export function fmtDayLong(d: string): string {
  const t = toUTC(d);
  return `${WEEKDAYS_SHORT[weekdayMon0(d)]}, ${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`;
}

/** "March 2026" */
export function fmtMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

export function dayOfMonth(d: string): number {
  return Number(d.slice(8, 10));
}

export function fmtNumber(n: number, dp = 0): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Evenly-banded x scale over `n` days across `width` px. */
export function bandScale(n: number, width: number, x0 = 0) {
  const band = n > 0 ? width / n : width;
  return {
    band,
    /** left edge of band i */
    left: (i: number) => x0 + i * band,
    /** centre of band i */
    center: (i: number) => x0 + (i + 0.5) * band,
    /** band index under pixel x (clamped) */
    indexAt: (px: number) => clamp(Math.floor((px - x0) / band), 0, Math.max(0, n - 1)),
  };
}

/** Pick date-axis tick indices so labels stay ≥ minGap px apart; prefers Mondays / month starts. */
export function dateTicks(dates: string[], band: number, minGap = 52): number[] {
  const n = dates.length;
  if (n === 0) return [];
  const every = Math.max(1, Math.ceil(minGap / Math.max(band, 0.0001)));
  if (every === 1) return dates.map((_, i) => i);
  const ticks: number[] = [];
  // Snap to weekly cadence when the step is ≤ 7 days and ≥ 4, otherwise plain stride.
  if (every <= 7) {
    const step = every <= 2 ? every : 7;
    const firstMon = dates.findIndex((d) => weekdayMon0(d) === 0);
    const start = step === 7 && firstMon >= 0 ? firstMon : 0;
    for (let i = start; i < n; i += step) ticks.push(i);
  } else {
    const step = Math.ceil(every / 7) * 7;
    const firstMon = Math.max(0, dates.findIndex((d) => weekdayMon0(d) === 0));
    for (let i = firstMon; i < n; i += step) ticks.push(i);
  }
  return ticks;
}

/** Round "nice" tick values covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!isFinite(lo) || !isFinite(hi)) return [];
  if (hi === lo) hi = lo + 1;
  const span = hi - lo;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.ceil(lo / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

export function niceStep(lo: number, hi: number, count = 4): number {
  const t = niceTicks(lo, hi, count);
  return t.length > 1 ? t[1] - t[0] : 1;
}

export const SEVERITY_VAR: Record<Severity, string> = {
  0: 'var(--sev-0)',
  1: 'var(--sev-1)',
  2: 'var(--sev-2)',
  3: 'var(--sev-3)',
};

export const SEVERITY_WORD: Record<Severity, string> = {
  0: 'none',
  1: 'mild',
  2: 'moderate',
  3: 'severe',
};

export const ZONE_VAR = {
  green: 'var(--zone-green)',
  yellow: 'var(--zone-yellow)',
  red: 'var(--zone-red)',
} as const;

export const ZONE_SOFT_VAR = {
  green: 'var(--zone-green-soft)',
  yellow: 'var(--zone-yellow-soft)',
  red: 'var(--zone-red-soft)',
} as const;

/** Categorical series in fixed order (never cycled past 6 — callers fold the tail). */
export const SERIES_VARS = [
  'var(--chart-s1)',
  'var(--chart-s2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
];

export const STATUS_VAR = {
  good: 'var(--good)',
  watch: 'var(--watch)',
  concern: 'var(--concern)',
  neutral: 'var(--neutral)',
  unknown: 'var(--unknown)',
} as const;

/** `color-mix` tint of a token toward the surface — keeps one hue, lighter step. */
export function tint(colorVar: string, pct: number): string {
  return `color-mix(in srgb, ${colorVar} ${pct}%, var(--surface))`;
}

/** SVG path for a bar with rounded top corners (data end) and square baseline. */
export function roundedTopBar(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0 || w <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return [
    `M${x},${y + h}`,
    `V${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `H${x + w - rr}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `V${y + h}`,
    'Z',
  ].join(' ');
}

/** Group as-needed doses by medication name: "Albuterol ×2". */
export function asNeededText(
  doses: { medicationName: string; kind: 'scheduled' | 'asNeeded'; quantity: number }[],
  totalUses: number,
): string | null {
  if (totalUses <= 0) return null;
  const byName = new Map<string, number>();
  for (const d of doses) {
    if (d.kind !== 'asNeeded') continue;
    byName.set(d.medicationName, (byName.get(d.medicationName) ?? 0) + Math.max(1, d.quantity));
  }
  if (byName.size === 0) return `as-needed medicine ×${totalUses}`;
  return [...byName.entries()].map(([name, n]) => `${name} ×${n}`).join(', ');
}
