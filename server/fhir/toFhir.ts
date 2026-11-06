/**
 * Raw SMART@Home entries → FHIR R4 resources (Synthea style).
 *
 *   check-in   → QuestionnaireResponse      dose  → MedicationAdministration
 *   blow       → Observation (spirometry)   device → Device (Spirobank)
 *   badge      → Basic                      plan zone → Observation
 *
 * The mapping is LOSSLESS: anything the coded FHIR value cannot reproduce verbatim (e.g. "Yes"
 * vs "true", dose value "1" as a string, blank vs null answers) is preserved in a
 * smart-home extension so fromFhir() rebuilds the identical raw objects.
 */
import type {
  RawBadge,
  RawBaselineReading,
  RawMedicalDevice,
  RawMedicationAdministration,
  RawPatientDocument,
  RawQuestionResponse,
  RawTrackerResponse,
} from '../../shared/types/raw';
import type { MediaItem } from '../../shared/types/api';
import type { TrackerDefinition, TrackerQuestion } from '../../shared/types/tracker';
import { offsetFor } from '../data/generate';
import type { RuntimeEntryBody } from '../data/runtime';
import { toAppMedication } from '../data/synthea/appMeds';
import {
  answerSystem,
  BADGE_CODES,
  BASE,
  EXT,
  LOINC,
  MEDIA_TYPE,
  OBS_CODES,
  PROFILE,
  questionnaireUrl,
  RXNORM,
  SPIRO_COMPONENTS,
  stableUuid,
  UCUM,
  urn,
  ZONE_SYSTEM,
  type FhirResource,
} from './constants';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Answer = Record<string, any>;

// ───────────────────────────────── Answers ─────────────────────────────────

export const blowObservationId = (patientFhirId: string, ts: string, n = 0) => stableUuid(patientFhirId, 'blow', ts, n);

/** Encode one raw answer string as QuestionnaireResponse answers (may be empty). */
export function encodeAnswers(q: TrackerQuestion, trackerId: string, raw: string, patientFhirId: string): Answer[] {
  const s = raw.trim();
  if (s === '') return [];
  const option = (v: string) => q.options?.find((o) => o.value.trim() === v.trim());
  switch (q.type) {
    case 'yesNo':
      if (/^(true|yes)$/i.test(s)) return [{ valueBoolean: true }];
      if (/^(false|no)$/i.test(s)) return [{ valueBoolean: false }];
      return [];
    case 'number': {
      const n = Number(s);
      return Number.isFinite(n) ? [{ valueDecimal: n }] : [];
    }
    case 'scale1to10': {
      const n = Number(s);
      return Number.isInteger(n) ? [{ valueInteger: n }] : [];
    }
    case 'faceScale':
    case 'iconChoice':
    case 'singleChoice': {
      const o = option(s);
      return o ? [{ valueCoding: { system: answerSystem(trackerId, q.id), code: o.value, display: o.label } }] : [];
    }
    case 'checkbox': {
      let arr: unknown;
      try {
        arr = JSON.parse(raw);
      } catch {
        return [];
      }
      if (!Array.isArray(arr)) return [];
      const opts = arr.map((v) => (typeof v === 'string' ? option(v) : undefined));
      if (opts.some((o) => !o)) return [];
      // One answer per selected option — the isNone option ("None of these ") is kept as an explicit coding.
      return opts.map((o) => ({ valueCoding: { system: answerSystem(trackerId, q.id), code: o!.value, display: o!.label } }));
    }
    case 'text':
      return [{ valueString: raw }];
    case 'spirometry':
      return Number.isNaN(Date.parse(s)) ? [] : [{ valueReference: { reference: urn(blowObservationId(patientFhirId, s)), display: s } }];
  }
}

/** Canonical raw string for a set of answers (inverse of encodeAnswers). */
export function decodeAnswers(q: TrackerQuestion | undefined, answers: Answer[]): string {
  if (!q || answers.length === 0) return '';
  const a = answers[0];
  switch (q.type) {
    case 'yesNo':
      return String(a.valueBoolean);
    case 'number':
    case 'scale1to10':
      return String(a.valueDecimal ?? a.valueInteger);
    case 'faceScale':
    case 'iconChoice':
    case 'singleChoice':
      return a.valueCoding?.code ?? '';
    case 'checkbox':
      return JSON.stringify(answers.map((x) => x.valueCoding?.code ?? x.valueString));
    case 'text':
      return a.valueString ?? '';
    case 'spirometry':
      return a.valueReference?.display ?? '';
  }
}

// ───────────────────────────────── Context ─────────────────────────────────

export interface FhirContext {
  patientFhirId: string;
  trackers: TrackerDefinition[];
  doc: RawPatientDocument;
  /**
   * 'doc'  — runtime write: occurrence counters start from what is already in `doc`
   *          (entries are converted BEFORE being applied).
   * 'empty' — full export / round trip: counters start at zero.
   */
  baseline: 'doc' | 'empty';
  counters: Map<string, number>;
  deviceSerial?: string;
}

export function fhirPatientId(doc: RawPatientDocument): string {
  return doc.profile.ehr?.sourcePatientId ?? stableUuid('smart-home-patient', doc.id);
}

export function makeContext(doc: RawPatientDocument, trackers: TrackerDefinition[], baseline: 'doc' | 'empty'): FhirContext {
  return { patientFhirId: fhirPatientId(doc), trackers, doc, baseline, counters: new Map() };
}

/** n-th occurrence of an identical item (gives duplicates distinct but stable ids). */
function occurrence(ctx: FhirContext, key: string, existing: () => number): number {
  if (!ctx.counters.has(key)) ctx.counters.set(key, ctx.baseline === 'doc' ? existing() : 0);
  const n = ctx.counters.get(key)!;
  ctx.counters.set(key, n + 1);
  return n;
}

const subject = (ctx: FhirContext) => ({ reference: urn(ctx.patientFhirId) });
export const deviceId = (patientFhirId: string, serial: string) => stableUuid(patientFhirId, 'device', serial);

// ───────────────────────────────── Resources ─────────────────────────────────

export function questionnaireResponse(r: RawTrackerResponse, ctx: FhirContext): FhirResource {
  const def = ctx.trackers.find((t) => t.id === r.trackerId);
  const res: FhirResource = {
    resourceType: 'QuestionnaireResponse',
    id: r.id,
    meta: { profile: [PROFILE.questionnaireResponse] },
    identifier: { system: `${BASE}/sid/tracker-response`, value: r.id },
    questionnaire: questionnaireUrl(r.trackerId),
    status: 'completed',
    subject: subject(ctx),
    authored: r.submittedAt,
  };
  const extension: Answer[] = [];
  if (r.entryMode) extension.push({ url: EXT.entryMode, valueCode: r.entryMode });
  if (typeof r.transcript === 'string') extension.push({ url: EXT.transcript, valueString: r.transcript });
  else if (r.transcript === null) extension.push({ url: EXT.transcriptNull, valueBoolean: true });
  if (r.mediaIds) {
    if (!r.mediaIds.length) extension.push({ url: EXT.mediaIdsEmpty, valueBoolean: true });
    for (const id of r.mediaIds) extension.push({ url: EXT.mediaReference, valueReference: { reference: urn(id), display: id } });
  }
  if (r.responses === undefined) extension.push({ url: EXT.responsesAbsent, valueBoolean: true });
  if (extension.length) res.extension = extension;
  if (r.responses === undefined) return res;
  res.item = r.responses.map((x: RawQuestionResponse) => {
    const q = def?.questions.find((qq) => qq.id === x.questionId);
    const item: Answer = { linkId: x.questionId };
    if (q) item.text = q.text;
    if (x.value === null) {
      item.extension = [{ url: EXT.rawValueNull, valueBoolean: true }];
      return item;
    }
    const answers = q ? encodeAnswers(q, r.trackerId, x.value, ctx.patientFhirId) : [];
    if (answers.length) item.answer = answers;
    if (decodeAnswers(q, answers) !== x.value) item.extension = [{ url: EXT.rawValue, valueString: x.value }];
    return item;
  });
  return res;
}

/** RxNorm coding from the patient's Synthea prescriptions whose app name matches. */
function rxnormFor(doc: RawPatientDocument, name: string): { code: string; display: string } | undefined {
  const onFile = doc.profile.ehr?.medicationsOnFile ?? [];
  const hits = onFile.filter((m) => m.rxnorm && toAppMedication(m.display, m.rxnorm)?.name === name);
  const best = hits.find((m) => m.status === 'active') ?? hits[0];
  return best ? { code: best.rxnorm!, display: best.display } : undefined;
}

export function medicationAdministration(day: string, d: RawMedicationAdministration, ctx: FhirContext): FhirResource {
  const med = ctx.doc.medications.find((m) => m.id === d.id);
  const n = occurrence(ctx, `dose|${day}|${d.time}|${d.id}`, () =>
    (ctx.doc.dailyLogs.find((l) => l.day === day)?.medicationAdministrations ?? []).filter((x) => x.id === d.id && x.time === d.time).length,
  );
  const rx = rxnormFor(ctx.doc, med?.name ?? d.name);
  const extension: Answer[] = [{ url: EXT.appMedicationId, valueString: d.id }];
  const res: FhirResource = {
    resourceType: 'MedicationAdministration',
    id: stableUuid(ctx.patientFhirId, 'dose', day, d.time, d.id, n),
    extension,
    status: 'completed',
    medicationCodeableConcept: { ...(rx ? { coding: [{ system: RXNORM, code: rx.code, display: rx.display }] } : {}), text: d.name },
    subject: subject(ctx),
    effectiveDateTime: `${day}T${d.time}:00${offsetFor(day)}`,
  };
  if (typeof d.value === 'number') res.dosage = { dose: { value: d.value, unit: med?.dosage?.unit ?? 'dose' } };
  else if (d.value === null) extension.push({ url: EXT.rawValueNull, valueBoolean: true });
  else extension.push({ url: EXT.rawValue, valueString: d.value });
  return res;
}

export function deviceResource(dev: RawMedicalDevice, ctx: FhirContext): FhirResource {
  return {
    resourceType: 'Device',
    id: deviceId(ctx.patientFhirId, dev.serialNumber),
    extension: [
      {
        url: EXT.device,
        extension: [
          { url: 'protocol', valueInteger: dev.protocol },
          { url: 'address', valueString: dev.address },
          { url: 'bootId', valueString: dev.bootId },
          { url: 'deviceType', valueInteger: dev.deviceType },
          { url: 'atsStandard', valueInteger: dev.atsStandard },
        ],
      },
    ],
    status: 'active',
    manufacturer: 'MIR',
    deviceName: [
      { name: dev.name, type: 'manufacturer-name' },
      { name: dev.advertisementName, type: 'other' },
    ],
    modelNumber: 'Spirobank Smart',
    serialNumber: dev.serialNumber,
    type: { text: 'Home spirometer' },
    patient: subject(ctx),
  };
}

const FVC_EXTRA = ['fef2575', 'fev6', 'fet', 'pefTime', 'extrapolatedVolume'] as const;

export function spirometryObservation(r: RawBaselineReading, ctx: FhirContext): FhirResource {
  const serial = ctx.deviceSerial ?? ctx.doc.medicalDevices?.[0]?.serialNumber ?? 'unknown';
  const n = occurrence(ctx, `blow|${r.baselineReadingDate}`, () =>
    (ctx.doc.medicalDevices ?? []).flatMap((d) => d.baselineReadings).filter((b) => b.baselineReadingDate === r.baselineReadingDate).length,
  );
  const f = r.fvcPlusResults;
  const extension: Answer[] = [{ url: EXT.accepted, valueBoolean: r.accepted }];
  const extra: Answer[] = [];
  for (const k of FVC_EXTRA) {
    const v = f[k];
    if (v === undefined) continue;
    extra.push(v === null ? { url: k, valueString: 'null' } : { url: k, valueDecimal: v });
  }
  if (extra.length) extension.push({ url: EXT.fvcPlus, extension: extra });
  if (r.qualityReport === null) extension.push({ url: EXT.qualityReportNull, valueBoolean: true });
  else if (r.qualityReport) {
    const sub: Answer[] = [];
    if (typeof r.qualityReport.quality === 'string') sub.push({ url: 'grade', valueString: r.qualityReport.quality });
    const qi = r.qualityReport.qualityIndications;
    if (Array.isArray(qi)) for (const m of qi) sub.push({ url: 'coaching', valueString: m.messageInstructions });
    else sub.push({ url: 'coaching-null', valueBoolean: true });
    extension.push({ url: EXT.qualityReport, extension: sub });
  }
  return {
    resourceType: 'Observation',
    id: blowObservationId(ctx.patientFhirId, r.baselineReadingDate, n),
    extension,
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'exam', display: 'Exam' }] }],
    code: { coding: [{ system: OBS_CODES, code: 'spirometry-blow', display: 'Home spirometry blow (Spirobank)' }], text: 'Spirometry blow' },
    subject: subject(ctx),
    effectiveDateTime: r.baselineReadingDate,
    device: { reference: urn(deviceId(ctx.patientFhirId, serial)), display: 'MIR Spirobank Smart' },
    component: SPIRO_COMPONENTS.map((c) => ({
      code: { coding: [{ system: LOINC, code: c.code, display: c.display }], text: c.display },
      valueQuantity: { value: f[c.field], unit: c.unit, system: UCUM, code: c.unit },
    })),
  };
}

export function badgeResource(list: 'tracker' | 'medication', b: RawBadge, ctx: FhirContext): FhirResource {
  return {
    resourceType: 'Basic',
    id: stableUuid(ctx.patientFhirId, 'badge', list, b.badgeName, b.date),
    extension: [{ url: EXT.badge, extension: [{ url: 'list', valueCode: list }, { url: 'date', valueDateTime: b.date }] }],
    code: { coding: [{ system: BADGE_CODES, code: b.badgeName }], text: b.badgeName },
    subject: subject(ctx),
    created: b.date.slice(0, 10),
  };
}

export function planZoneObservation(status: string, statusUpdatedAt: string, ctx: FhirContext): FhirResource {
  return {
    resourceType: 'Observation',
    id: stableUuid(ctx.patientFhirId, 'plan-zone', statusUpdatedAt, status),
    status: 'final',
    code: { coding: [{ system: OBS_CODES, code: 'asthma-action-plan-zone', display: 'Asthma action plan zone' }], text: 'Asthma action plan zone' },
    subject: subject(ctx),
    effectiveDateTime: statusUpdatedAt,
    valueCodeableConcept: { coding: [{ system: ZONE_SYSTEM, code: status, display: status }], text: status },
  };
}

/** Photo/video evidence → FHIR R4 Media. */
export function mediaResource(m: MediaItem, ctx: FhirContext, deleted = false): FhirResource {
  const extension: Answer[] = [{ url: EXT.mediaUploadedAt, valueDateTime: m.uploadedAt }];
  if (m.trackerResponseId !== undefined) extension.push({ url: EXT.mediaTrackerResponse, valueString: m.trackerResponseId });
  if (m.conversationId !== undefined) extension.push({ url: EXT.mediaConversation, valueString: m.conversationId });
  return {
    resourceType: 'Media',
    id: m.id,
    extension,
    status: deleted ? 'entered-in-error' : 'completed',
    // R4 media-type codes are image | video | audio (a "photo" is code "image").
    type: { coding: [{ system: MEDIA_TYPE, code: m.kind === 'photo' ? 'image' : 'video', display: m.kind === 'photo' ? 'Image' : 'Video' }], text: m.kind },
    subject: subject(ctx),
    createdDateTime: m.takenAt,
    issued: m.uploadedAt,
    content: { contentType: m.contentType, url: m.url, size: m.sizeBytes, ...(m.caption !== undefined ? { title: m.caption } : {}) },
  };
}

/** Convert entries (in order) to FHIR resources. */
export function entriesToFhir(entries: RuntimeEntryBody[], ctx: FhirContext): FhirResource[] {
  const out: FhirResource[] = [];
  for (const e of entries) {
    switch (e.kind) {
      case 'trackerResponse':
        out.push(questionnaireResponse(e.data, ctx));
        break;
      case 'medicationAdministration':
        out.push(medicationAdministration(e.day, e.data, ctx));
        break;
      case 'device':
        ctx.deviceSerial = e.data.serialNumber;
        out.push(deviceResource(e.data, ctx));
        break;
      case 'spirometry':
        for (const r of e.data) out.push(spirometryObservation(r, ctx));
        break;
      case 'badge':
        out.push(badgeResource(e.list, e.data, ctx));
        break;
      case 'planStatus':
        out.push(planZoneObservation(e.status, e.statusUpdatedAt, ctx));
        break;
      case 'media':
        out.push(mediaResource(e.data, ctx, e.deleted));
        break;
    }
  }
  return out;
}

/** All home-monitoring data of a raw document as entries (generated history + app writes). */
export function docToEntries(doc: RawPatientDocument): RuntimeEntryBody[] {
  const out: RuntimeEntryBody[] = [];
  for (const dev of doc.medicalDevices ?? []) {
    out.push({ kind: 'device', data: { ...dev, baselineReadings: [] } });
    if (dev.baselineReadings.length) out.push({ kind: 'spirometry', data: dev.baselineReadings });
  }
  for (const l of doc.dailyLogs) {
    for (const r of l.trackerResponses ?? []) out.push({ kind: 'trackerResponse', day: l.day, data: r });
    for (const d of l.medicationAdministrations ?? []) out.push({ kind: 'medicationAdministration', day: l.day, data: d });
  }
  for (const b of doc.earnedTrackerBadges ?? []) out.push({ kind: 'badge', list: 'tracker', data: b });
  for (const b of doc.earnedMedicationBadges ?? []) out.push({ kind: 'badge', list: 'medication', data: b });
  const plan = doc.asthmaTreatmentPlan;
  if (plan?.status && plan.statusUpdatedAt) out.push({ kind: 'planStatus', status: plan.status, statusUpdatedAt: plan.statusUpdatedAt });
  return out;
}
