/**
 * Display helpers. All date math is done on patient-local `YYYY-MM-DD` strings in UTC
 * (see docs/ARCHITECTURE.md) so DST / browser time zone never shifts a day.
 */
import type { Status, Zone } from '@shared/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function parseISODate(d: string): Date {
  return new Date(d.slice(0, 10) + 'T00:00:00Z');
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const date = parseISODate(d);
  date.setUTCDate(date.getUTCDate() + n);
  return toISODate(date);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

export function isISODate(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseISODate(s).getTime());
}

/** "Jun 24, 2026" */
export function formatDate(d?: string): string {
  if (!d) return '—';
  const date = parseISODate(d);
  if (Number.isNaN(date.getTime())) return d;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** "Jun 24" */
export function formatShortDate(d?: string): string {
  if (!d) return '—';
  const date = parseISODate(d);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** "Wed, Jun 24, 2026" */
export function formatLongDate(d: string): string {
  const date = parseISODate(d);
  return `${WEEKDAYS[date.getUTCDay()]}, ${formatDate(d)}`;
}

/** Relative age for triage lists: "today", "yesterday", "3 d ago". */
export function formatDaysAgo(days?: number): string {
  if (days === undefined || days === null) return 'never';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} d ago`;
}

/** Long form: "135 days ago". */
export function formatDaysAgoLong(days?: number): string {
  if (days === undefined || days === null) return 'no activity recorded';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** "09:31" → "9:31 AM" */
export function formatTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/** Date part of an ISO datetime with offset, without timezone conversion. */
export function datePart(isoDateTime?: string): string | undefined {
  return isoDateTime ? isoDateTime.slice(0, 10) : undefined;
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v)}%`;
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const ZONE_LABEL: Record<Zone, string> = { green: 'Green', yellow: 'Yellow', red: 'Red' };

export const STATUS_LABEL: Record<Status, string> = {
  good: 'On track',
  watch: 'Watch',
  concern: 'Concern',
  neutral: 'Info',
  unknown: 'No data',
};

export function sexLabel(sex?: 'F' | 'M' | 'X'): string | undefined {
  if (sex === 'F') return 'Female';
  if (sex === 'M') return 'Male';
  if (sex === 'X') return 'Another sex';
  return undefined;
}

/** Display a condition key as a label when no label is supplied. */
export function conditionLabel(key: string): string {
  const known: Record<string, string> = { ibd: 'IBD', general: 'General', asthma: 'Asthma', migraine: 'Migraine' };
  return known[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}
