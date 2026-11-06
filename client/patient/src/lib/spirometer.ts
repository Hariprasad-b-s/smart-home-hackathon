/**
 * Simulated MIR Spirobank Smart. Produces blows exactly as the SDK would deliver them
 * (RawBaselineReading: PEF in L/s, 5–6 decimals, programmer-style coaching messages).
 * The "how's your breathing" mode scales PEF against the personal best so demos can
 * produce green / yellow / red zones deterministically.
 */
import type { Zone } from '@shared/types/summary';
import type { RawBaselineReading } from '@shared/types/raw';
import { localIso } from './time';

export type BreathingMode = 'good' | 'okay' | 'struggling';

export const BREATHING_MODES: { value: BreathingMode; label: string }[] = [
  { value: 'good', label: 'Good' },
  { value: 'okay', label: 'Okay' },
  { value: 'struggling', label: 'Struggling' },
];

/** Share of personal best each mode aims for. Jitter is ±4 %, so zones never cross over. */
export const PEF_FACTOR: Record<BreathingMode, number> = { good: 0.94, okay: 0.66, struggling: 0.4 };

/** Used when the action plan has no personal best written on it. */
export const DEFAULT_PERSONAL_BEST_LPM = 420;

const FEV1_RANGE: Record<BreathingMode, [number, number]> = {
  good: [3.2, 3.8],
  okay: [2.6, 3.15],
  struggling: [2.2, 2.6],
};
const RATIO_RANGE: Record<BreathingMode, [number, number]> = {
  good: [0.84, 0.9],
  okay: [0.76, 0.82],
  struggling: [0.68, 0.74],
};

export const COACHING_CODES = [
  'BlowOutLonger',
  'KeepGoingUntilCompletelyEmpty',
  'BlastOutImmediatelyWhenCompletelyFull',
] as const;

const PLAIN_COACHING: Record<string, string> = {
  BlowOutLonger: 'Blow out for longer next time.',
  KeepGoingUntilCompletelyEmpty: 'Keep going until your lungs are completely empty.',
  BlastOutImmediatelyWhenCompletelyFull: 'Blast out as soon as your lungs are full, with no pause.',
  AvoidCoughing: 'Try not to cough while you blow.',
};

/** Programmer-style SDK message → plain English for a teen. */
export function plainCoaching(code: string): string {
  return PLAIN_COACHING[code] ?? "Let's try that one again.";
}

export type Rng = () => number;

/** Small deterministic PRNG (mulberry32) so tests and demos are repeatable. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rng: Rng, [lo, hi]: [number, number]) => lo + (hi - lo) * rng();
/** Round to 6 decimals, then drop the 6th sometimes so values carry 5–6 decimals like the SDK. */
const dec = (n: number, rng: Rng) => Number(n.toFixed(rng() < 0.5 ? 5 : 6));

export interface BlowOptions {
  personalBestPefLpm?: number;
  mode: BreathingMode;
  /** Timestamp of the blow (local ISO with offset). */
  at: string;
  rng?: Rng;
  /** Force an accepted / not-accepted blow (default: ~1 in 6 is not accepted). */
  accepted?: boolean;
}

export function generateBlow({ personalBestPefLpm, mode, at, rng = Math.random, accepted }: BlowOptions): RawBaselineReading {
  const pb = personalBestPefLpm && personalBestPefLpm > 0 ? personalBestPefLpm : DEFAULT_PERSONAL_BEST_LPM;
  const ok = accepted ?? rng() >= 0.17;
  const effort = ok ? 1 : 0.86;
  const jitter = 1 + (rng() * 2 - 1) * 0.04;
  const pef = (pb / 60) * PEF_FACTOR[mode] * jitter * effort;
  const fev1 = between(rng, FEV1_RANGE[mode]) * (ok ? 1 : 0.94);
  const fvc = fev1 / between(rng, RATIO_RANGE[mode]);
  const fev1R = dec(fev1, rng);
  const fvcR = dec(Math.max(fvc, fev1 + 0.05), rng);
  const codes: string[] = [];
  if (!ok) {
    const first = COACHING_CODES[Math.floor(rng() * COACHING_CODES.length)];
    codes.push(first);
    if (rng() < 0.4) {
      const second = COACHING_CODES.find((c) => c !== first && rng() < 0.6);
      if (second) codes.push(second);
    }
  }
  return {
    baselineReadingDate: at,
    accepted: ok,
    qualityReport: {
      quality: ok ? (rng() < 0.75 ? 'Acceptable' : 'Usable') : 'NotAcceptable',
      qualityIndications: codes.map((messageInstructions) => ({ messageInstructions })),
    },
    fvcPlusResults: {
      fvc: fvcR,
      fev1: fev1R,
      fev1FvcRatio: Number(((fev1R / fvcR) * 100).toFixed(5)),
      pef: dec(pef, rng),
      fef2575: dec(fev1R * between(rng, [0.9, 1.25]), rng),
      fev6: dec(Math.min(fvcR, fvcR * between(rng, [0.97, 0.995])), rng),
      fet: dec(ok ? between(rng, [6.1, 9.5]) : between(rng, [1.8, 4.2]), rng),
      pefTime: Math.round(between(rng, [70, 160])),
      extrapolatedVolume: dec(between(rng, [30, 140]), rng),
    },
  };
}

/** Timestamp for blow `i` of a session: ~45 s apart, on the server's demo "today". */
export function blowTimestamp(start: Date, i: number, day?: string): string {
  return localIso(new Date(start.getTime() + i * 45_000), day);
}

export const pefLpm = (r: RawBaselineReading) => Math.round(r.fvcPlusResults.pef * 60);

/** Best blow: highest PEF among accepted blows (all blows if none were accepted). */
export function bestBlow(readings: RawBaselineReading[]): RawBaselineReading | undefined {
  const pool = readings.some((r) => r.accepted) ? readings.filter((r) => r.accepted) : readings;
  return pool.reduce<RawBaselineReading | undefined>((best, r) => (!best || r.fvcPlusResults.pef > best.fvcPlusResults.pef ? r : best), undefined);
}

export function pctOfBest(pefL: number, personalBestPefLpm?: number): number | undefined {
  if (!personalBestPefLpm || personalBestPefLpm <= 0) return undefined;
  return Math.round((pefL / personalBestPefLpm) * 100);
}

/** Action-plan zone from % of personal best (defaults 80 / 50, like the plan). */
export function zoneFor(pct: number | undefined, greenPct = 80, redPct = 50): Zone | undefined {
  if (pct === undefined) return undefined;
  if (pct >= greenPct) return 'green';
  if (pct >= redPct) return 'yellow';
  return 'red';
}
