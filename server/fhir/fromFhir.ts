/**
 * FHIR R4 resources → raw SMART@Home entries (inverse of toFhir). Unknown resource types
 * (Patient, Condition, MedicationRequest, Questionnaire…) are ignored.
 */
import type {
  RawBaselineReading,
  RawFvcPlusResults,
  RawMedicalDevice,
  RawMedicationAdministration,
  RawPlanZone,
  RawQuestionResponse,
  RawTrackerResponse,
} from '../../shared/types/raw';
import type { MediaItem } from '../../shared/types/api';
import type { TrackerDefinition } from '../../shared/types/tracker';
import type { RuntimeEntryBody } from '../data/runtime';
import { BADGE_CODES, EXT, LOINC, OBS_CODES, SPIRO_COMPONENTS, type FhirBundle, type FhirResource } from './constants';
import { decodeAnswers } from './toFhir';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;

const extOf = (r: Json, url: string): Json | undefined => (r.extension as Json[] | undefined)?.find((e) => e.url === url);
const subExts = (e: Json | undefined, url: string): Json[] => ((e?.extension as Json[] | undefined) ?? []).filter((x) => x.url === url);
const hasCode = (cc: Json | undefined, system: string, code: string) => (cc?.coding as Json[] | undefined)?.some((c) => c.system === system && c.code === code);

export function trackerResponseFromFhir(res: FhirResource, trackers: TrackerDefinition[]): RawTrackerResponse {
  const trackerId = String(res.questionnaire ?? '').split('/').pop() ?? '';
  const def = trackers.find((t) => t.id === trackerId);
  const out: RawTrackerResponse = { id: res.identifier?.value ?? res.id, trackerId, submittedAt: res.authored };
  const mode = extOf(res, EXT.entryMode)?.valueCode;
  if (mode === 'form' || mode === 'voice') out.entryMode = mode;
  const transcript = extOf(res, EXT.transcript);
  if (transcript) out.transcript = transcript.valueString;
  else if (extOf(res, EXT.transcriptNull)?.valueBoolean) out.transcript = null;
  const media = ((res.extension as Json[] | undefined) ?? []).filter((e) => e.url === EXT.mediaReference);
  if (media.length) out.mediaIds = media.map((e) => String(e.valueReference?.reference ?? '').replace(/^urn:uuid:/, ''));
  else if (extOf(res, EXT.mediaIdsEmpty)?.valueBoolean) out.mediaIds = [];
  if (extOf(res, EXT.responsesAbsent)?.valueBoolean) return out;
  out.responses = ((res.item as Json[] | undefined) ?? []).map((item): RawQuestionResponse => {
    if (extOf(item, EXT.rawValueNull)?.valueBoolean) return { questionId: item.linkId, value: null };
    const raw = extOf(item, EXT.rawValue);
    if (raw) return { questionId: item.linkId, value: raw.valueString };
    const q = def?.questions.find((x) => x.id === item.linkId);
    return { questionId: item.linkId, value: decodeAnswers(q, item.answer ?? []) };
  });
  return out;
}

export function doseFromFhir(res: FhirResource): { day: string; data: RawMedicationAdministration } {
  const eff: string = res.effectiveDateTime;
  let value: RawMedicationAdministration['value'];
  if (extOf(res, EXT.rawValueNull)?.valueBoolean) value = null;
  else if (extOf(res, EXT.rawValue)) value = extOf(res, EXT.rawValue)!.valueString;
  else value = res.dosage?.dose?.value ?? null;
  return {
    day: eff.slice(0, 10),
    data: { id: extOf(res, EXT.appMedicationId)?.valueString ?? '', time: eff.slice(11, 16), name: res.medicationCodeableConcept?.text ?? '', value },
  };
}

export function deviceFromFhir(res: FhirResource): RawMedicalDevice {
  const e = extOf(res, EXT.device);
  const sub = (k: string) => subExts(e, k)[0];
  const names = (res.deviceName as Json[] | undefined) ?? [];
  return {
    protocol: sub('protocol')?.valueInteger ?? 0,
    address: sub('address')?.valueString ?? '',
    bootId: sub('bootId')?.valueString ?? '',
    serialNumber: res.serialNumber ?? '',
    deviceType: sub('deviceType')?.valueInteger ?? 0,
    atsStandard: sub('atsStandard')?.valueInteger ?? 0,
    name: names.find((n) => n.type === 'manufacturer-name')?.name ?? 'Spirobank',
    advertisementName: names.find((n) => n.type === 'other')?.name ?? '',
    baselineReadingDate: null,
    baselineReadings: [],
  };
}

export function readingFromFhir(res: FhirResource): RawBaselineReading {
  const f = {} as RawFvcPlusResults;
  for (const c of SPIRO_COMPONENTS) {
    const comp = (res.component as Json[]).find((x) => hasCode(x.code, LOINC, c.code));
    (f as unknown as Json)[c.field] = comp?.valueQuantity?.value;
  }
  for (const x of (extOf(res, EXT.fvcPlus)?.extension as Json[] | undefined) ?? []) {
    (f as unknown as Json)[x.url] = x.valueString === 'null' ? null : x.valueDecimal;
  }
  const reading: RawBaselineReading = {
    baselineReadingDate: res.effectiveDateTime,
    accepted: !!extOf(res, EXT.accepted)?.valueBoolean,
    fvcPlusResults: f,
  };
  if (extOf(res, EXT.qualityReportNull)?.valueBoolean) reading.qualityReport = null;
  else {
    const qr = extOf(res, EXT.qualityReport);
    if (qr) {
      const grade = subExts(qr, 'grade')[0];
      reading.qualityReport = {
        quality: grade ? grade.valueString : null,
        qualityIndications: subExts(qr, 'coaching-null').length ? null : subExts(qr, 'coaching').map((m) => ({ messageInstructions: m.valueString })),
      };
    }
  }
  return reading;
}

/** FHIR Media → MediaItem. `patientId` is filled in by the caller (the bundle's owner). */
export function mediaFromFhir(res: FhirResource): { data: MediaItem; deleted: boolean } {
  const kind = res.type?.coding?.[0]?.code === 'video' ? 'video' : 'photo';
  const data: MediaItem = {
    id: res.id,
    patientId: '',
    kind,
    contentType: res.content?.contentType ?? '',
    sizeBytes: res.content?.size ?? 0,
    takenAt: res.createdDateTime,
    uploadedAt: extOf(res, EXT.mediaUploadedAt)?.valueDateTime ?? res.issued,
    date: String(res.createdDateTime).slice(0, 10),
    url: res.content?.url ?? `/api/media/${res.id}/content`,
  };
  if (res.content?.title !== undefined) data.caption = res.content.title;
  const tr = extOf(res, EXT.mediaTrackerResponse);
  if (tr) data.trackerResponseId = tr.valueString;
  const conv = extOf(res, EXT.mediaConversation);
  if (conv) data.conversationId = conv.valueString;
  return { data, deleted: res.status === 'entered-in-error' };
}

/** Map a bundle (or resource list) back to raw entries, in resource order. */
export function fhirToRaw(input: FhirBundle | FhirResource[], trackers: TrackerDefinition[]): RuntimeEntryBody[] {
  const resources = Array.isArray(input) ? input : input.entry.map((e) => e.resource);
  const out: RuntimeEntryBody[] = [];
  for (const res of resources) {
    switch (res.resourceType) {
      case 'QuestionnaireResponse': {
        const data = trackerResponseFromFhir(res, trackers);
        out.push({ kind: 'trackerResponse', day: data.submittedAt.slice(0, 10), data });
        break;
      }
      case 'MedicationAdministration':
        out.push({ kind: 'medicationAdministration', ...doseFromFhir(res) });
        break;
      case 'Device':
        out.push({ kind: 'device', data: deviceFromFhir(res) });
        break;
      case 'Observation':
        if (hasCode(res.code, OBS_CODES, 'spirometry-blow')) out.push({ kind: 'spirometry', data: [readingFromFhir(res)] });
        else if (hasCode(res.code, OBS_CODES, 'asthma-action-plan-zone')) {
          out.push({ kind: 'planStatus', status: res.valueCodeableConcept?.coding?.[0]?.code as RawPlanZone, statusUpdatedAt: res.effectiveDateTime });
        }
        break;
      case 'Media':
        out.push({ kind: 'media', ...mediaFromFhir(res) });
        break;
      case 'Basic': {
        const code = (res.code?.coding as Json[] | undefined)?.find((c) => c.system === BADGE_CODES)?.code;
        const e = extOf(res, EXT.badge);
        if (code && e) {
          out.push({
            kind: 'badge',
            list: subExts(e, 'list')[0]?.valueCode === 'medication' ? 'medication' : 'tracker',
            data: { badgeName: code, date: subExts(e, 'date')[0]?.valueDateTime ?? res.created },
          });
        }
        break;
      }
    }
  }
  return out;
}

/** Alias matching the name in shared/types/api.ts. */
export const fromFhir = fhirToRaw;
