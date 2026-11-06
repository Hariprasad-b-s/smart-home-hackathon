/**
 * Date helpers. All calendar math is done on patient-local "YYYY-MM-DD" strings
 * interpreted as UTC midnight, so DST / host time zone never shifts a day.
 */
import type { ISODate } from '../types/raw';

export const DAY_MS = 86_400_000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(s: unknown): s is ISODate {
  return typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function toUtcMs(d: ISODate): number {
  return Date.parse(`${d}T00:00:00Z`);
}

export function fromUtcMs(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromUtcMs(toUtcMs(d) + n * DAY_MS);
}

/** Whole days a − b. */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUtcMs(a) - toUtcMs(b)) / DAY_MS);
}

/** Inclusive list of dates start..end (empty when end < start). */
export function dateRange(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const n = diffDays(end, start);
  for (let i = 0; i <= n; i++) out.push(addDays(start, i));
  return out;
}

/** Monday of the ISO week containing d. */
export function isoWeekStart(d: ISODate): ISODate {
  const dow = new Date(toUtcMs(d)).getUTCDay(); // 0 = Sunday
  return addDays(d, -((dow + 6) % 7));
}

/** The host's current local calendar date (only used when `today` is omitted). */
export function localToday(): ISODate {
  const n = new Date();
  return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`;
}

/** Patient-local calendar date of a local ISO timestamp ("2026-06-24T09:31:12-04:00" → "2026-06-24"). */
export function localDateOf(ts: string | null | undefined): ISODate | undefined {
  if (typeof ts !== 'string') return undefined;
  const s = ts.slice(0, 10);
  return isValidDate(s) ? s : undefined;
}

/** Patient-local "HH:mm" of a local ISO timestamp ("" when absent). */
export function localTimeOf(ts: string | null | undefined): string {
  if (typeof ts !== 'string') return '';
  const m = /T(\d{2}:\d{2})/.exec(ts);
  return m ? m[1] : '';
}

/** Normalises "8:05" / "08:05:00" to "08:05" ("" when unparseable). */
export function normaliseClock(t: unknown): string {
  if (typeof t !== 'string') return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  return m ? `${pad2(Number(m[1]))}:${m[2]}` : '';
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 3" */
export function fmtShort(d: ISODate): string {
  return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
}

/** "Nov 3, 2026" */
export function fmtLong(d: ISODate): string {
  return `${fmtShort(d)}, ${d.slice(0, 4)}`;
}

/** "Mar 1 – Mar 31, 2026" or "Dec 1, 2025 – Jan 30, 2026". */
export function fmtRange(start: ISODate, end: ISODate): string {
  if (start === end) return fmtLong(end);
  if (start.slice(0, 4) === end.slice(0, 4)) return `${fmtShort(start)} – ${fmtLong(end)}`;
  return `${fmtLong(start)} – ${fmtLong(end)}`;
}

export function ageYears(dob: ISODate, today: ISODate): number {
  if (!isValidDate(dob)) return 0;
  let age = Number(today.slice(0, 4)) - Number(dob.slice(0, 4));
  if (today.slice(5) < dob.slice(5)) age -= 1;
  return Math.max(0, age);
}

export function minDate(...ds: (ISODate | undefined | null)[]): ISODate | undefined {
  let m: ISODate | undefined;
  for (const d of ds) if (d && (m === undefined || d < m)) m = d;
  return m;
}

export function maxDate(...ds: (ISODate | undefined | null)[]): ISODate | undefined {
  let m: ISODate | undefined;
  for (const d of ds) if (d && (m === undefined || d > m)) m = d;
  return m;
}
