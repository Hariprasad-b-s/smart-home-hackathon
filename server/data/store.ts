/**
 * In-memory store of SYNTHETIC patient documents + tracker definitions.
 * Data are generated at startup relative to the demo "today"; patient-app writes, stored as
 * Synthea-style FHIR bundles in server/data/runtime/fhir/<patientId>.json, are then merged back.
 */
import type { RawPatientDocument } from '../../shared/types/raw';
import type { TrackerDefinition } from '../../shared/types/tracker';
import { generatePatients, localDateString } from './generate';
import { fhirToRaw } from '../fhir/fromFhir';
import { entriesToFhir, makeContext } from '../fhir/toFhir';
import { DEFAULT_MEDIA_DIR, MediaStore } from '../media/storage';
import { ClinicianPrefsStore, DEFAULT_CLINICIANS_DIR } from './clinicians';
import { applyEntry, DEFAULT_RUNTIME_DIR, FhirRuntimeStore, type RuntimeEntryBody } from './runtime';
import { TRACKERS } from './trackers';

export interface Store {
  /** Demo "today" (patient-local YYYY-MM-DD). */
  today: string;
  trackers: TrackerDefinition[];
  listPatients(): RawPatientDocument[];
  getPatient(id: string): RawPatientDocument | undefined;
  /** Current wall-clock time (injectable for tests). */
  now(): Date;
  /** Apply patient-app write entries to a document and append them as FHIR to its runtime bundle. */
  record(doc: RawPatientDocument, entries: RuntimeEntryBody[]): void;
  /** Saved clinician dashboard / visit-mode preferences. */
  clinicianPrefs: ClinicianPrefsStore;
  /** Photo/video evidence registry + bytes. */
  media: MediaStore;
  /** Delete a media item: remove its bytes and mark its FHIR Media entered-in-error. */
  deleteMedia(doc: RawPatientDocument, mediaId: string): boolean;
  /** Drop every patient-app entry and clinician preference, and regenerate the synthetic data. */
  reset(): void;
  /** Folder of per-patient FHIR runtime bundles, or null when persistence is disabled. */
  runtimeDir: string | null;
  /** Runtime FHIR bundle of patient-app writes for a patient, if any. */
  runtimeBundle(patientId: string): import('../fhir/constants').FhirBundle | undefined;
}

export interface StoreOptions {
  today?: string;
  seed?: number;
  /**
   * Folder for runtime FHIR bundles. `null` disables persistence. Defaults to
   * server/data/runtime/fhir, except under Vitest where it defaults to null so tests never
   * touch the real folder.
   */
  runtimeDir?: string | null;
  /** Folder for clinician preferences (same defaults/semantics as runtimeDir). */
  cliniciansDir?: string | null;
  /** Folder for uploaded photo/video bytes (same defaults/semantics as runtimeDir). */
  mediaDir?: string | null;
  now?: () => Date;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Resolve "today": explicit option → env DEMO_TODAY → real local date (local TZ, not UTC). */
export function resolveToday(explicit?: string): string {
  if (explicit) {
    if (!ISO_DATE.test(explicit)) throw new Error(`Invalid today "${explicit}" (expected YYYY-MM-DD)`);
    return explicit;
  }
  const env = process.env.DEMO_TODAY?.trim();
  if (env) {
    if (ISO_DATE.test(env) && !Number.isNaN(Date.parse(`${env}T00:00:00Z`))) return env;
    console.warn(`[store] Ignoring invalid DEMO_TODAY="${env}" (expected YYYY-MM-DD)`);
  }
  return localDateString();
}

export function createStore(opts: StoreOptions = {}): Store {
  const today = resolveToday(opts.today);
  const runtimeDir = opts.runtimeDir !== undefined ? opts.runtimeDir : process.env.VITEST ? null : DEFAULT_RUNTIME_DIR;
  const fhir = new FhirRuntimeStore(runtimeDir);
  const cliniciansDir = opts.cliniciansDir !== undefined ? opts.cliniciansDir : process.env.VITEST ? null : DEFAULT_CLINICIANS_DIR;
  const clinicianPrefs = new ClinicianPrefsStore(cliniciansDir);
  const mediaDir = opts.mediaDir !== undefined ? opts.mediaDir : process.env.VITEST ? null : DEFAULT_MEDIA_DIR;
  const media = new MediaStore(mediaDir);
  /** Raw entries go into the document; media entries go into the media registry. */
  const applyAny = (doc: RawPatientDocument, e: RuntimeEntryBody) => {
    if (e.kind === 'media') media.register({ ...e.data, patientId: doc.id }, e.deleted ?? false);
    else applyEntry(doc, e);
  };
  const now = opts.now ?? (() => new Date());

  let patients: RawPatientDocument[] = [];
  const byId = new Map<string, RawPatientDocument>();
  const load = () => {
    media.resetRegistry();
    patients = generatePatients({ today, seed: opts.seed });
    byId.clear();
    for (const p of patients) {
      byId.set(p.id, p);
      byId.set(p.patientId, p);
    }
    for (const [patientId, bundle] of fhir.all()) {
      const doc = byId.get(patientId);
      if (!doc) {
        console.warn(`[store] Skipping runtime FHIR bundle for unknown patient ${patientId}`);
        continue;
      }
      for (const e of fhirToRaw(bundle, TRACKERS)) applyAny(doc, e);
    }
  };
  load();

  return {
    today,
    trackers: TRACKERS,
    runtimeDir,
    now,
    runtimeBundle: (id) => fhir.get(id),
    clinicianPrefs,
    media,
    deleteMedia(doc, mediaId) {
      const item = media.get(mediaId);
      if (!item || item.patientId !== doc.id) return false;
      media.remove(mediaId);
      fhir.update(doc.id, mediaId, (r) => {
        r.status = 'entered-in-error';
      });
      return true;
    },
    listPatients: () => patients,
    getPatient: (id) => byId.get(id),
    record(doc, entries) {
      // A runtime bundle that gets spirometry also carries the Device it references.
      const bundle = fhir.get(doc.id);
      const device = doc.medicalDevices?.[0];
      if (device && entries.some((e) => e.kind === 'spirometry') && !bundle?.entry.some((x) => x.resource.resourceType === 'Device')) {
        entries = [{ kind: 'device', data: { ...device, baselineReadings: [] } }, ...entries];
      }
      // Convert BEFORE applying so duplicate-occurrence ids continue from the current document.
      const resources = entriesToFhir(entries, makeContext(doc, TRACKERS, 'doc'));
      for (const e of entries) applyAny(doc, e);
      fhir.append(doc, resources, now().toISOString());
    },
    reset() {
      fhir.clear();
      clinicianPrefs.clear();
      media.clearAll();
      load();
    },
  };
}
