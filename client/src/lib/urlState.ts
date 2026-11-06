/**
 * Dashboard URL state: `?days=30|90|180|all&view=<specialty>&mode=visit&day=YYYY-MM-DD`.
 * Everything a clinician might want to share or go "back" to lives in the URL.
 */
import { isSpecialtyId, type SpecialtyId } from '../config/specialties';
import { isISODate } from './format';

export type WindowDays = number | 'all';

export interface DashboardUrlState {
  days: WindowDays;
  /** Explicit specialty from the URL; null = infer from conditions. */
  view: SpecialtyId | null;
  mode: 'clinic' | 'visit';
  day: string | null;
}

export const DEFAULT_DAYS = 30;
export const WINDOW_OPTIONS: { value: WindowDays; label: string }[] = [
  { value: 14, label: '14 d' },
  { value: 30, label: '30 d' },
  { value: 90, label: '90 d' },
  { value: 180, label: '180 d' },
  { value: 'all', label: 'All' },
];

export function parseDays(raw: string | null): WindowDays {
  if (raw === 'all') return 'all';
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 1 && n <= 730) return n;
  }
  return DEFAULT_DAYS;
}

export function parseDashboardState(params: URLSearchParams): DashboardUrlState {
  const view = params.get('view');
  const day = params.get('day');
  return {
    days: parseDays(params.get('days')),
    view: isSpecialtyId(view) ? view : null,
    mode: params.get('mode') === 'visit' ? 'visit' : 'clinic',
    day: isISODate(day) ? day : null,
  };
}

/** Returns new params with `patch` applied; null/default values are removed to keep URLs short. */
export function patchDashboardParams(
  params: URLSearchParams,
  patch: Partial<{ days: WindowDays; view: SpecialtyId | null; mode: 'clinic' | 'visit'; day: string | null }>,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if ('days' in patch) {
    if (patch.days === undefined || patch.days === DEFAULT_DAYS) next.delete('days');
    else next.set('days', String(patch.days));
  }
  if ('view' in patch) {
    if (!patch.view) next.delete('view');
    else next.set('view', patch.view);
  }
  if ('mode' in patch) {
    if (patch.mode === 'visit') next.set('mode', 'visit');
    else next.delete('mode');
  }
  if ('day' in patch) {
    if (!patch.day) next.delete('day');
    else next.set('day', patch.day);
  }
  return next;
}
