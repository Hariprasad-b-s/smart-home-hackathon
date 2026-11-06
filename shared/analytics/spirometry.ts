/**
 * Home spirometry: blows → daily sessions → best values, % personal best, zone and trends.
 *  - A session = all blows (any device) on the same local day.
 *  - Best FEV1 / FVC / PEF = max over ACCEPTED blows (ATS-style); falls back to all blows,
 *    flagged unreliable, when none was accepted.
 *  - PEF is stored in L/s; clinicians use L/min (× 60).
 */
import type { ISODate, RawAsthmaTreatmentPlan, RawBaselineReading, RawPatientDocument } from '../types/raw';
import type { SpirometryBlow, SpirometrySession, SpirometrySummary, Status, Trend } from '../types/summary';
import { localDateOf, localTimeOf } from './dates';
import { humanizeIdentifier, makeTrend, mean, pctOf, round } from './humanize';
import { zoneFromPct } from './zones';

export interface QualityConflict {
  date: ISODate;
  time: string;
  accepted: boolean;
  quality: string;
}

export interface SpirometryBuild {
  /** All sessions up to the analysis end date, oldest → newest. */
  sessions: SpirometrySession[];
  /** Sessions of each day, oldest → newest (a day can have several sessions). */
  byDate: Map<ISODate, SpirometrySession[]>;
  personalBestPefLpm?: number;
  personalBestSource?: 'action plan' | 'observed';
  greenThresholdPct: number;
  redThresholdPct: number;
  deviceName: string;
  conflicts: QualityConflict[];
  /** Latest local blow timestamp up to end. */
  lastBlowAt?: string;
  hasDevice: boolean;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function humanizeQuality(q: string | null | undefined): string {
  if (!q || !q.trim()) return 'Not graded';
  return humanizeIdentifier(q);
}

function isAcceptableLabel(q: string | null | undefined): boolean | undefined {
  if (!q) return undefined;
  const k = q.replace(/[\s_-]/g, '').toLowerCase();
  if (k === 'notacceptable' || k === 'unacceptable') return false;
  if (k === 'acceptable' || k === 'usable') return true;
  return undefined;
}

function toBlow(r: RawBaselineReading): SpirometryBlow {
  const f = r.fvcPlusResults;
  const fev1 = finite(f?.fev1) ? f.fev1 : 0;
  const fvc = finite(f?.fvc) ? f.fvc : 0;
  const ratio = finite(f?.fev1FvcRatio) ? f.fev1FvcRatio : fvc > 0 ? (fev1 / fvc) * 100 : 0;
  const blow: SpirometryBlow = {
    time: localTimeOf(r.baselineReadingDate),
    accepted: r.accepted === true,
    qualityLabel: humanizeQuality(r.qualityReport?.quality),
    coaching: (r.qualityReport?.qualityIndications ?? [])
      .map((q) => humanizeIdentifier(q?.messageInstructions))
      .filter((s) => s !== ''),
    fev1L: round(fev1, 2),
    fvcL: round(fvc, 2),
    ratioPct: round(ratio),
    pefLpm: round((finite(f?.pef) ? f.pef : 0) * 60),
  };
  if (finite(f?.fef2575)) blow.fef2575Lps = round(f.fef2575, 2);
  return blow;
}

interface RawSession {
  date: ISODate;
  readings: RawBaselineReading[];
}

/** Blows more than this far apart start a new session. */
export const SESSION_GAP_MINUTES = 30;

function bestOf(date: ISODate, readings: RawBaselineReading[]): SpirometrySession {
  const sorted = [...readings].sort((a, b) => a.baselineReadingDate.localeCompare(b.baselineReadingDate));
  const accepted = sorted.filter((r) => r.accepted === true);
  const reliable = accepted.length > 0;
  const pool = reliable ? accepted : sorted;
  const fev1 = (r: RawBaselineReading) => (finite(r.fvcPlusResults?.fev1) ? r.fvcPlusResults.fev1 : 0);
  const fvc = (r: RawBaselineReading) => (finite(r.fvcPlusResults?.fvc) ? r.fvcPlusResults.fvc : 0);
  const pef = (r: RawBaselineReading) => (finite(r.fvcPlusResults?.pef) ? r.fvcPlusResults.pef : 0);
  const bestFev1Blow = pool.reduce((b, r) => (fev1(r) > fev1(b) ? r : b), pool[0]);
  const bestFev1 = fev1(bestFev1Blow);
  const bestFvc = Math.max(...pool.map(fvc));
  const bestPef = Math.max(...pool.map(pef));
  const rr = bestFev1Blow.fvcPlusResults?.fev1FvcRatio;
  const ratio = finite(rr) ? rr : fvc(bestFev1Blow) > 0 ? (bestFev1 / fvc(bestFev1Blow)) * 100 : 0;
  const time = localTimeOf(sorted[0].baselineReadingDate);
  return {
    date,
    ...(time ? { time } : {}),
    bestFev1L: round(bestFev1, 2),
    bestFvcL: round(bestFvc, 2),
    ratioPct: round(ratio),
    bestPefLpm: round(bestPef * 60),
    acceptableBlows: accepted.length,
    totalBlows: sorted.length,
    reliable,
    blows: sorted.map(toBlow),
  };
}

export function buildSpirometry(
  doc: RawPatientDocument,
  plan: RawAsthmaTreatmentPlan | null | undefined,
  end: ISODate,
): SpirometryBuild {
  const devices = (doc.medicalDevices ?? []).filter(Boolean);
  const all: { date: ISODate; r: RawBaselineReading }[] = [];
  const conflicts: QualityConflict[] = [];
  let lastBlowAt: string | undefined;
  for (const dev of devices) {
    for (const r of dev.baselineReadings ?? []) {
      if (!r || !r.fvcPlusResults) continue;
      const date = localDateOf(r.baselineReadingDate);
      if (!date || date > end) continue;
      all.push({ date, r });
      if (!lastBlowAt || r.baselineReadingDate.slice(0, 19) > lastBlowAt.slice(0, 19)) lastBlowAt = r.baselineReadingDate;
      const labelOk = isAcceptableLabel(r.qualityReport?.quality);
      if (labelOk !== undefined && labelOk !== (r.accepted === true)) {
        conflicts.push({ date, time: localTimeOf(r.baselineReadingDate), accepted: r.accepted === true, quality: humanizeQuality(r.qualityReport?.quality) });
      }
    }
  }
  // Split into sessions by time: a new local day or a gap > 30 min starts a new session.
  all.sort((a, b) => a.r.baselineReadingDate.localeCompare(b.r.baselineReadingDate));
  const groups: RawSession[] = [];
  let prevMs = NaN;
  for (const { date, r } of all) {
    const ms = Date.parse(r.baselineReadingDate);
    const cur = groups[groups.length - 1];
    const gapOk = Number.isFinite(ms) && Number.isFinite(prevMs) && ms - prevMs <= SESSION_GAP_MINUTES * 60_000;
    if (cur && cur.date === date && gapOk) cur.readings.push(r);
    else groups.push({ date, readings: [r] });
    prevMs = ms;
  }
  const sessions = groups.map((g) => bestOf(g.date, g.readings));

  const green = finite(plan?.greenThresholdPct) && plan.greenThresholdPct > 0 ? plan.greenThresholdPct : 80;
  const red = finite(plan?.redThresholdPct) && plan.redThresholdPct > 0 ? plan.redThresholdPct : 50;
  let personalBestPefLpm: number | undefined;
  let personalBestSource: SpirometryBuild['personalBestSource'];
  if (finite(plan?.personalBestPeakFlow) && plan.personalBestPeakFlow > 0) {
    personalBestPefLpm = round(plan.personalBestPeakFlow);
    personalBestSource = 'action plan';
  } else {
    const reliable = sessions.filter((s) => s.reliable && s.bestPefLpm > 0);
    if (reliable.length) {
      personalBestPefLpm = Math.max(...reliable.map((s) => s.bestPefLpm));
      personalBestSource = 'observed';
    }
  }
  if (personalBestPefLpm) {
    for (const s of sessions) {
      s.pctPersonalBest = round((s.bestPefLpm / personalBestPefLpm) * 100);
      s.zone = zoneFromPct(s.pctPersonalBest, green, red);
    }
  }
  const name = devices.find((d) => d.name)?.name ?? '';
  const deviceName = /spirobank/i.test(name) ? 'MIR Spirobank Smart' : name || 'Home spirometer';
  return {
    sessions,
    byDate: sessions.reduce((m, x) => m.set(x.date, [...(m.get(x.date) ?? []), x]), new Map<ISODate, SpirometrySession[]>()),
    personalBestPefLpm,
    personalBestSource,
    greenThresholdPct: green,
    redThresholdPct: red,
    deviceName,
    conflicts,
    lastBlowAt,
    hasDevice: devices.length > 0,
  };
}

export function spirometryStatus(pct: number | undefined, green: number, red: number): Status {
  if (pct === undefined) return 'unknown';
  if (pct >= green) return 'good';
  if (pct >= red) return 'watch';
  return 'concern';
}

/** Trend of the window mean vs the prior window mean, or 1st vs 2nd half when the prior window is empty. */
function sessionTrend(
  win: SpirometrySession[],
  prior: SpirometrySession[],
  pick: (s: SpirometrySession) => number,
  versus: string,
): { trend?: Trend; changePct?: number } {
  if (!win.length) return {};
  let cur: number | null;
  let prev: number | null;
  let label = versus;
  if (prior.length) {
    cur = mean(win.map(pick));
    prev = mean(prior.map(pick));
  } else {
    if (win.length < 2) return {};
    const half = Math.floor(win.length / 2);
    prev = mean(win.slice(0, half).map(pick));
    cur = mean(win.slice(win.length - half).map(pick));
    label = 'first half of window';
  }
  if (cur === null || prev === null || prev === 0) return {};
  const trend = makeTrend(cur, prev, { higherIsWorse: false, mode: 'pct', minChange: 5, versus: label });
  return { trend, changePct: ((cur - prev) / prev) * 100 };
}

export interface SpirometryWindowResult {
  summary: SpirometrySummary;
  fev1ChangePct?: number;
  pefChangePct?: number;
}

export function summarizeSpirometry(
  b: SpirometryBuild,
  w: { start: ISODate; end: ISODate; prior: { start: ISODate; end: ISODate }; versus: string },
): SpirometryWindowResult {
  const inWin = b.sessions.filter((s) => s.date >= w.start && s.date <= w.end);
  const inPrior = b.sessions.filter((s) => s.date >= w.prior.start && s.date <= w.prior.end);
  const blows = inWin.reduce((n, s) => n + s.totalBlows, 0);
  const accepted = inWin.reduce((n, s) => n + s.acceptableBlows, 0);
  const fev1 = sessionTrend(inWin, inPrior, (s) => s.bestFev1L, w.versus);
  const pef = sessionTrend(inWin, inPrior, (s) => s.bestPefLpm, w.versus);
  const latestInWin = inWin[inWin.length - 1];
  return {
    summary: {
      deviceName: b.deviceName,
      personalBestPefLpm: b.personalBestPefLpm,
      personalBestSource: b.personalBestSource,
      greenThresholdPct: b.greenThresholdPct,
      redThresholdPct: b.redThresholdPct,
      sessions: inWin,
      latest: b.sessions[b.sessions.length - 1],
      sessionsInWindow: inWin.length,
      qualityPct: pctOf(accepted, blows),
      fev1Trend: fev1.trend,
      pefTrend: pef.trend,
      status: spirometryStatus(latestInWin?.pctPersonalBest, b.greenThresholdPct, b.redThresholdPct),
    },
    fev1ChangePct: fev1.changePct,
    pefChangePct: pef.changePct,
  };
}

