import { describe, expect, it } from 'vitest';
import { parseDashboardState, patchDashboardParams } from './urlState';

describe('dashboard URL state', () => {
  it('parses all params', () => {
    const s = parseDashboardState(new URLSearchParams('days=90&view=neurology&mode=visit&day=2026-10-12'));
    expect(s).toEqual({ days: 90, view: 'neurology', mode: 'visit', day: '2026-10-12' });
  });
  it('falls back to defaults for missing or invalid values', () => {
    expect(parseDashboardState(new URLSearchParams(''))).toEqual({ days: 30, view: null, mode: 'clinic', day: null });
    const bad = parseDashboardState(new URLSearchParams('days=abc&view=cardio&mode=x&day=2026-13-45'));
    expect(bad).toEqual({ days: 30, view: null, mode: 'clinic', day: null });
    expect(parseDashboardState(new URLSearchParams('days=all')).days).toBe('all');
    expect(parseDashboardState(new URLSearchParams('days=0')).days).toBe(30);
    expect(parseDashboardState(new URLSearchParams('days=9999')).days).toBe(30);
  });
  it('patches params, removing defaults and keeping unrelated keys', () => {
    const base = new URLSearchParams('days=90&view=nursing&foo=1');
    expect(patchDashboardParams(base, { days: 30 }).toString()).toBe('view=nursing&foo=1');
    expect(patchDashboardParams(base, { day: '2026-10-01' }).get('day')).toBe('2026-10-01');
    expect(patchDashboardParams(base, { view: null }).has('view')).toBe(false);
    const visit = patchDashboardParams(base, { mode: 'visit' });
    expect(visit.get('mode')).toBe('visit');
    expect(patchDashboardParams(visit, { mode: 'clinic' }).has('mode')).toBe(false);
    expect(base.toString()).toBe('days=90&view=nursing&foo=1'); // not mutated
  });
});
