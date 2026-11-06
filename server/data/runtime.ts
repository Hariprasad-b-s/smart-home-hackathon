/**
 * Patient-app write storage.
 *
 * Every patient-app write is described as raw entries (the exact raw objects appended to the
 * patient document), converted to FHIR R4 resources in Synthea's format and appended to
 * server/data/runtime/fhir/<patientId>.json (a Bundle of type "collection", gitignored).
 * On startup the store regenerates the synthetic data and merges each bundle back via fhirToRaw.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  RawBadge,
  RawBaselineReading,
  RawDailyLog,
  RawMedicalDevice,
  RawMedicationAdministration,
  RawPatientDocument,
  RawPlanZone,
  RawTrackerResponse,
} from '../../shared/types/raw';
import type { MediaItem } from '../../shared/types/api';
import { isBundle, newRuntimeBundle, toEntry } from '../fhir/bundle';
import type { FhirBundle, FhirResource } from '../fhir/constants';

export const DEFAULT_RUNTIME_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runtime', 'fhir');

export type RuntimeEntryBody =
  | { kind: 'trackerResponse'; day: string; data: RawTrackerResponse }
  | { kind: 'medicationAdministration'; day: string; data: RawMedicationAdministration }
  | { kind: 'device'; data: RawMedicalDevice }
  | { kind: 'spirometry'; data: RawBaselineReading[] }
  | { kind: 'badge'; list: 'tracker' | 'medication'; data: RawBadge }
  | { kind: 'planStatus'; status: RawPlanZone; statusUpdatedAt: string }
  /** Photo/video evidence. Not part of the raw document — the store keeps a media registry. */
  | { kind: 'media'; data: MediaItem; deleted?: boolean };

/** Find or create (in sorted position) the daily log for `day`. */
export function dailyLogFor(doc: RawPatientDocument, day: string): RawDailyLog {
  let log = doc.dailyLogs.find((l) => l.day === day);
  if (!log) {
    log = { day };
    const i = doc.dailyLogs.findIndex((l) => l.day > day);
    if (i === -1) doc.dailyLogs.push(log);
    else doc.dailyLogs.splice(i, 0, log);
  }
  return log;
}

/** Apply one entry to a patient document (mutates). Idempotent for devices (by serial). */
export function applyEntry(doc: RawPatientDocument, e: RuntimeEntryBody): void {
  switch (e.kind) {
    case 'trackerResponse':
      (dailyLogFor(doc, e.day).trackerResponses ??= []).push(structuredClone(e.data));
      break;
    case 'medicationAdministration':
      (dailyLogFor(doc, e.day).medicationAdministrations ??= []).push(structuredClone(e.data));
      break;
    case 'device':
      if (!(doc.medicalDevices ?? []).some((d) => d.serialNumber === e.data.serialNumber)) {
        (doc.medicalDevices ??= []).push({ ...structuredClone(e.data), baselineReadings: [] });
      }
      break;
    case 'spirometry': {
      const device = doc.medicalDevices?.[0];
      if (!device) return;
      device.baselineReadings.push(...structuredClone(e.data));
      device.baselineReadings.sort((a, b) => Date.parse(a.baselineReadingDate) - Date.parse(b.baselineReadingDate));
      device.baselineReadingDate = device.baselineReadings.at(-1)?.baselineReadingDate ?? null;
      break;
    }
    case 'badge':
      if (e.list === 'tracker') (doc.earnedTrackerBadges ??= []).push({ ...e.data });
      else (doc.earnedMedicationBadges ??= []).push({ ...e.data });
      break;
    case 'planStatus':
      doc.asthmaTreatmentPlan ??= {};
      doc.asthmaTreatmentPlan.status = e.status;
      doc.asthmaTreatmentPlan.statusUpdatedAt = e.statusUpdatedAt;
      break;
    case 'media':
      break; // handled by the store's media registry
  }
}

/** Per-patient FHIR bundles on disk (or in memory only when `dir` is null). */
export class FhirRuntimeStore {
  private readonly bundles = new Map<string, FhirBundle>();

  constructor(readonly dir: string | null) {
    if (!dir || !existsSync(dir)) return;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      try {
        const b = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
        if (isBundle(b)) this.bundles.set(f.slice(0, -5), b);
      } catch (err) {
        console.warn(`[runtime] Ignoring unreadable ${f}: ${(err as Error).message}`);
      }
    }
  }

  /** Raw patient id → bundle. */
  all(): ReadonlyMap<string, FhirBundle> {
    return this.bundles;
  }

  get(patientId: string): FhirBundle | undefined {
    return this.bundles.get(patientId);
  }

  append(doc: RawPatientDocument, resources: FhirResource[], timestamp: string): void {
    let b = this.bundles.get(doc.id);
    if (!b) this.bundles.set(doc.id, (b = newRuntimeBundle(doc)));
    b.entry.push(...resources.map(toEntry));
    b.timestamp = timestamp;
    this.flush(doc.id, b);
  }

  /** Mutate one resource in a patient's bundle (e.g. Media → entered-in-error) and persist. */
  update(patientId: string, resourceId: string, mutate: (r: FhirResource) => void): boolean {
    const b = this.bundles.get(patientId);
    const entry = b?.entry.find((e) => e.resource.id === resourceId);
    if (!b || !entry) return false;
    mutate(entry.resource);
    this.flush(patientId, b);
    return true;
  }

  clear(): void {
    this.bundles.clear();
    if (!this.dir || !existsSync(this.dir)) return;
    for (const f of readdirSync(this.dir)) if (f.endsWith('.json') || f.endsWith('.tmp')) rmSync(path.join(this.dir, f));
  }

  /** Atomic write: temp file in the same directory, then rename over the target. */
  private flush(patientId: string, b: FhirBundle): void {
    if (!this.dir) return;
    mkdirSync(this.dir, { recursive: true });
    const file = path.join(this.dir, `${patientId}.json`);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(b, null, 1) + '\n');
    renameSync(tmp, file);
  }
}
