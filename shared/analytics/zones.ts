/**
 * Asthma action-plan zones. The app only stores the CURRENT plan zone, so a daily zone history
 * is derived from what the patient recorded each day.
 */
import type { Status, Zone } from '../types/summary';

const RANK: Record<Zone, number> = { green: 0, yellow: 1, red: 2 };

export function zoneRank(z: Zone): number {
  return RANK[z];
}

export function worseZone(a: Zone | undefined, b: Zone | undefined): Zone | undefined {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

export function zoneFromPct(pct: number, greenPct: number, redPct: number): Zone {
  if (pct >= greenPct) return 'green';
  if (pct >= redPct) return 'yellow';
  return 'red';
}

export function zoneStatus(z: Zone | undefined): Status {
  if (z === 'green') return 'good';
  if (z === 'yellow') return 'watch';
  if (z === 'red') return 'concern';
  return 'unknown';
}

export function parsePlanZone(z: unknown): Zone | undefined {
  if (typeof z !== 'string') return undefined;
  const k = z.trim().toLowerCase();
  return k === 'green' || k === 'yellow' || k === 'red' ? k : undefined;
}

export interface SymptomZoneInput {
  /** Severity of the day's overall feeling (undefined = not answered / unknown severity). */
  feelingSeverity?: number;
  symptomCount: number;
  nightWaking: boolean;
  rescueUses: number;
}

/**
 * Symptom zone for one day:
 *  red    — feeling severe (3) with ≥ 2 symptoms, or ≥ 4 rescue uses;
 *  yellow — any symptom, night waking, ≥ 1 rescue use, or feeling ≥ moderate (2);
 *  green  — feeling answered (≤ mild) and none of the above;
 *  undefined when there is no basis.
 */
export function symptomZone(i: SymptomZoneInput): Zone | undefined {
  if ((i.feelingSeverity === 3 && i.symptomCount >= 2) || i.rescueUses >= 4) return 'red';
  if (i.symptomCount > 0 || i.nightWaking || i.rescueUses >= 1 || (i.feelingSeverity ?? 0) >= 2) return 'yellow';
  if (i.feelingSeverity !== undefined && i.feelingSeverity <= 1) return 'green';
  return undefined;
}

export function zoneMethod(greenPct: number, redPct: number): string {
  return (
    `Each day's zone is the worse of the peak-flow zone of the day's WORST spirometry session (at least ${greenPct}% of personal best is green, ` +
    `${redPct}–${greenPct - 1}% yellow, below ${redPct}% red) and a symptom zone from the asthma check-in ` +
    `(any symptom, night waking, rescue inhaler use or feeling unwell is yellow; feeling very bad with 2+ symptoms ` +
    `or 4+ rescue uses is red), so a red reading at any time of day makes the day red. Blows more than 30 minutes apart ` +
    `are separate sessions. Days with neither a reading nor a check-in have no zone.`
  );
}
