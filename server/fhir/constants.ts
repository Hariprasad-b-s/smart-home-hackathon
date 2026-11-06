/**
 * FHIR R4 constants and small helpers shared by the SMART@Home ↔ FHIR mappers.
 * Resources follow Synthea's exporter style: `fullUrl: urn:uuid:<id>`, `resource.id`,
 * US Core meta.profile where one applies, `subject: { reference: urn:uuid:<patient> }`.
 */
import { createHash } from 'node:crypto';

export const BASE = 'https://smart-home.example.org/fhir';
export const questionnaireUrl = (trackerId: string) => `${BASE}/Questionnaire/${trackerId}`;
/** Answer coding system for a choice question: questionnaire canonical + '#' + questionId. */
export const answerSystem = (trackerId: string, questionId: string) => `${questionnaireUrl(trackerId)}#${questionId}`;
export const OBS_CODES = `${BASE}/CodeSystem/observation`;
export const ZONE_SYSTEM = `${BASE}/CodeSystem/asthma-action-plan-zone`;
export const BADGE_CODES = `${BASE}/CodeSystem/badge`;
export const MRN_SYSTEM = `${BASE}/sid/demo-mrn`;

const ext = (name: string) => `${BASE}/StructureDefinition/${name}`;
export const EXT = {
  appMedicationId: ext('app-medication-id'),
  /** Exact raw answer/dose string when the coded value does not reproduce it verbatim. */
  rawValue: ext('raw-value'),
  /** Raw value was JSON null (vs "" which is an item without answer). */
  rawValueNull: ext('raw-value-null'),
  /** RawTrackerResponse had no `responses` field at all (opened and closed). */
  responsesAbsent: ext('responses-absent'),
  accepted: ext('spirometry-accepted'),
  qualityReport: ext('spirometry-quality-report'),
  qualityReportNull: ext('spirometry-quality-report-null'),
  fvcPlus: ext('spirometry-fvc-plus'),
  device: ext('spirobank-device'),
  badge: ext('badge'),
  entryMode: ext('entry-mode'),
  transcript: ext('voice-transcript'),
  transcriptNull: ext('voice-transcript-null'),
  mediaReference: ext('evidence-media'),
  mediaIdsEmpty: ext('evidence-media-empty'),
  mediaTrackerResponse: ext('media-tracker-response'),
  mediaConversation: ext('media-conversation'),
  mediaUploadedAt: ext('media-uploaded-at'),
} as const;

export const MEDIA_TYPE = 'http://terminology.hl7.org/CodeSystem/media-type';

export const LOINC = 'http://loinc.org';
export const SNOMED = 'http://snomed.info/sct';
export const RXNORM = 'http://www.nlm.nih.gov/research/umls/rxnorm';
export const UCUM = 'http://unitsofmeasure.org';

export const PROFILE = {
  patient: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient',
  condition: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-condition-encounter-diagnosis',
  medicationRequest: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-medicationrequest',
  allergy: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-allergyintolerance',
  height: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-body-height',
  weight: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-body-weight',
  questionnaireResponse: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-questionnaireresponse',
} as const;

/** Spirometry components (LOINC). PEF is recorded in L/s exactly as the device stores it. */
export const SPIRO_COMPONENTS = [
  { field: 'fev1', code: '20150-9', display: 'FEV1', unit: 'L' },
  { field: 'fvc', code: '19868-9', display: 'FVC', unit: 'L' },
  { field: 'fev1FvcRatio', code: '19926-5', display: 'FEV1/FVC', unit: '%' },
  { field: 'pef', code: '19935-6', display: 'Peak expiratory flow', unit: 'L/s' },
] as const;

/** Deterministic UUID (v5-shaped) from arbitrary parts — stable resource ids across runs. */
export function stableUuid(...parts: (string | number)[]): string {
  const h = createHash('sha1').update(parts.join('|')).digest('hex');
  const v = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const urn = (id: string) => `urn:uuid:${id}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Loosely-typed FHIR resource (we emit/consume plain JSON). */
export type FhirResource = { resourceType: string; id: string; [k: string]: any };
export interface FhirBundle {
  resourceType: 'Bundle';
  id?: string;
  type: 'collection';
  timestamp?: string;
  entry: { fullUrl: string; resource: FhirResource }[];
}
