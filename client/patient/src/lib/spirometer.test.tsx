// @vitest-environment jsdom
import '../test/setup';
import { describe, expect, it } from 'vitest';
import type { RawBaselineReading } from '@shared/types/raw';
import {
  BREATHING_MODES,
  COACHING_CODES,
  bestBlow,
  blowTimestamp,
  generateBlow,
  pctOfBest,
  pefLpm,
  plainCoaching,
  seededRng,
  zoneFor,
  type BreathingMode,
} from './spirometer';

const decimals = (n: number) => (String(n).split('.')[1] ?? '').length;
const AT = '2026-11-06T09:31:12.120-05:00';

function expectShape(r: RawBaselineReading) {
  expect(Object.keys(r).sort()).toEqual(['accepted', 'baselineReadingDate', 'fvcPlusResults', 'qualityReport']);
  expect(r.baselineReadingDate).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/);
  expect(typeof r.accepted).toBe('boolean');
  const f = r.fvcPlusResults;
  for (const k of ['fvc', 'fev1', 'fev1FvcRatio', 'pef'] as const) {
    expect(typeof f[k]).toBe('number');
    expect(decimals(f[k])).toBeLessThanOrEqual(6);
  }
  expect(f.fev1).toBeGreaterThanOrEqual(2.2 * 0.94 - 1e-9);
  expect(f.fev1).toBeLessThanOrEqual(3.8);
  expect(f.fvc).toBeGreaterThan(f.fev1);
  expect(f.fev1FvcRatio).toBeCloseTo((f.fev1 / f.fvc) * 100, 4);
  expect(Array.isArray(r.qualityReport?.qualityIndications)).toBe(true);
  for (const qi of r.qualityReport!.qualityIndications!) expect(typeof qi.messageInstructions).toBe('string');
}

describe('spirometer simulator', () => {
  it('produces RawBaselineReading-shaped blows with SDK-style values', () => {
    const rng = seededRng(42);
    for (let i = 0; i < 60; i++) {
      const mode = BREATHING_MODES[i % 3].value;
      const r = generateBlow({ personalBestPefLpm: 410, mode, at: AT, rng });
      expectShape(r);
      if (r.accepted) expect(r.qualityReport?.quality).toMatch(/^(Acceptable|Usable)$/);
    }
  });

  it('values mostly carry 5–6 decimals', () => {
    const r = generateBlow({ personalBestPefLpm: 410, mode: 'good', at: AT, rng: seededRng(3) });
    const d = [r.fvcPlusResults.fvc, r.fvcPlusResults.fev1, r.fvcPlusResults.pef].map(decimals);
    for (const x of d) expect(x).toBeGreaterThanOrEqual(3);
    expect(decimals(r.fvcPlusResults.fev1FvcRatio)).toBeGreaterThanOrEqual(3);
  });

  it('not-accepted blows carry programmer-style coaching and NotAcceptable quality', () => {
    const r = generateBlow({ personalBestPefLpm: 410, mode: 'good', at: AT, rng: seededRng(9), accepted: false });
    expect(r.accepted).toBe(false);
    expect(r.qualityReport?.quality).toBe('NotAcceptable');
    const codes = r.qualityReport!.qualityIndications!.map((q) => q.messageInstructions);
    expect(codes.length).toBeGreaterThan(0);
    for (const c of codes) expect(COACHING_CODES).toContain(c);
  });

  it('occasionally (not usually) rejects a blow', () => {
    const rng = seededRng(7);
    const blows = Array.from({ length: 300 }, () => generateBlow({ personalBestPefLpm: 410, mode: 'okay', at: AT, rng }));
    const rejected = blows.filter((b) => !b.accepted).length;
    expect(rejected).toBeGreaterThan(10);
    expect(rejected).toBeLessThan(100);
  });

  it('PEF is in L/s around personal best / 60 × the breathing factor', () => {
    const r = generateBlow({ personalBestPefLpm: 420, mode: 'good', at: AT, rng: seededRng(1), accepted: true });
    expect(r.fvcPlusResults.pef).toBeGreaterThan((420 / 60) * 0.85);
    expect(r.fvcPlusResults.pef).toBeLessThan(420 / 60);
  });

  it.each<[BreathingMode, string]>([
    ['good', 'green'],
    ['okay', 'yellow'],
    ['struggling', 'red'],
  ])('"%s" breathing always lands in the %s zone', (mode, zone) => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = seededRng(seed);
      const pb = 300 + (seed % 5) * 50;
      const start = new Date('2026-11-06T09:00:00');
      const session = [0, 1, 2].map((i) => generateBlow({ personalBestPefLpm: pb, mode, at: blowTimestamp(start, i, '2026-11-06'), rng }));
      const best = bestBlow(session)!;
      expect(zoneFor(pctOfBest(pefLpm(best), pb), 80, 50)).toBe(zone);
    }
  });

  it('best blow prefers accepted blows', () => {
    const rng = seededRng(5);
    const a = generateBlow({ personalBestPefLpm: 400, mode: 'okay', at: AT, rng, accepted: true });
    const b = { ...generateBlow({ personalBestPefLpm: 400, mode: 'good', at: AT, rng, accepted: false }) };
    expect(bestBlow([b, a])).toBe(a);
    expect(bestBlow([b])).toBe(b);
  });

  it('timestamps keep the demo day and a local offset', () => {
    const t = blowTimestamp(new Date('2026-11-06T09:00:00'), 2, '2026-11-07');
    expect(t.startsWith('2026-11-07T09:01:30')).toBe(true);
    expect(t).toMatch(/[+-]\d\d:\d\d$/);
  });

  it('translates coaching codes into plain English', () => {
    expect(plainCoaching('BlowOutLonger')).toMatch(/longer/);
    expect(plainCoaching('KeepGoingUntilCompletelyEmpty')).toMatch(/completely empty/);
    expect(plainCoaching('BlastOutImmediatelyWhenCompletelyFull')).toMatch(/Blast out/);
    expect(plainCoaching('SomethingNew')).toMatch(/try/i);
  });

  it('zone thresholds follow the plan', () => {
    expect(zoneFor(80)).toBe('green');
    expect(zoneFor(79)).toBe('yellow');
    expect(zoneFor(50)).toBe('yellow');
    expect(zoneFor(49)).toBe('red');
    expect(zoneFor(undefined)).toBeUndefined();
  });
});
