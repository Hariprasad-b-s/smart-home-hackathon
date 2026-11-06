/** Patient-local time helpers. Date math on YYYY-MM-DD strings is done in UTC (no DST bugs). */
import type { HHmm, ISODate, ISODateTime } from '@shared/types/raw';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** "+02:00" / "-04:00" for the device's current offset. */
export function offsetString(d: Date): string {
  const mins = -d.getTimezoneOffset();
  const sign = mins >= 0 ? '+' : '-';
  const a = Math.abs(mins);
  return `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function localDay(d: Date = new Date()): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Local ISO-8601 timestamp with offset, e.g. "2026-06-24T09:31:12.120-04:00".
 * `day` overrides the calendar date (the server's demo "today" may differ from the device's).
 */
export function localIso(d: Date = new Date(), day?: ISODate): ISODateTime {
  return `${day ?? localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(
    d.getMilliseconds(),
    3,
  )}${offsetString(d)}`;
}

export function hhmm(d: Date = new Date()): HHmm {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local clock time of a patient-local ISO timestamp ("…T08:12:…-04:00" → "08:12"). */
export function clockOf(iso: ISODateTime | undefined | null): HHmm | '' {
  if (!iso || iso.length < 16) return '';
  return iso.slice(11, 16);
}

export function addDays(day: ISODate, n: number): ISODate {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayShort(day: ISODate): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

export function dayLabel(day: ISODate): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function shortDate(day: ISODate): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function greeting(d: Date = new Date()): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
