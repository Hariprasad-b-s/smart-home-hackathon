/**
 * Synthea-style FHIR R4 Bundles: the patient-app runtime store and the full patient export
 * (Patient + Synthea EHR background + all home-monitoring data + Questionnaires).
 */
import type { MediaItem } from '../../shared/types/api';
import type { RawPatientDocument } from '../../shared/types/raw';
import type { TrackerDefinition } from '../../shared/types/tracker';
import { MRN_SYSTEM, PROFILE, RXNORM, SNOMED, LOINC, UCUM, stableUuid, urn, type FhirBundle, type FhirResource } from './constants';
import { trackerToQuestionnaire } from './questionnaires';
import { docToEntries, entriesToFhir, fhirPatientId, makeContext, mediaResource } from './toFhir';

export const toEntry = (resource: FhirResource) => ({
  fullUrl: resource.resourceType === 'Questionnaire' ? (resource.url as string) : urn(resource.id),
  resource,
});

export function patientResource(doc: RawPatientDocument): FhirResource {
  const p = doc.profile;
  const genders = { F: 'female', M: 'male', X: 'other' } as const;
  return {
    resourceType: 'Patient',
    id: fhirPatientId(doc),
    meta: { profile: [PROFILE.patient] },
    identifier: [
      { system: 'https://github.com/synthetichealth/synthea', value: fhirPatientId(doc) },
      {
        type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR', display: 'Medical Record Number' }], text: 'Medical Record Number' },
        system: MRN_SYSTEM,
        value: p.mrn,
      },
    ],
    name: [{ use: 'official', family: p.lastName, given: [p.firstName] }],
    ...(p.sex ? { gender: genders[p.sex] } : {}),
    birthDate: p.dateOfBirth,
    address: [{ city: p.city ?? 'Cincinnati', state: p.state ?? 'OH', ...(p.postalCode ? { postalCode: p.postalCode } : {}), country: 'US' }],
  };
}

/** Reconstruct the Synthea EHR background (problems, prescriptions, allergies, vitals). */
export function ehrResources(doc: RawPatientDocument, today: string): FhirResource[] {
  const pid = fhirPatientId(doc);
  const subject = { reference: urn(pid) };
  const ehr = doc.profile.ehr;
  const out: FhirResource[] = [];
  for (const pr of ehr?.problems ?? []) {
    out.push({
      resourceType: 'Condition',
      id: stableUuid(pid, 'condition', pr.display, pr.onsetDate ?? ''),
      meta: { profile: [PROFILE.condition] },
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: pr.active ? 'active' : 'resolved' }] },
      verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed' }] },
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'encounter-diagnosis', display: 'Encounter Diagnosis' }] }],
      code: { ...(pr.snomed ? { coding: [{ system: SNOMED, code: pr.snomed, display: pr.display }] } : {}), text: pr.display },
      subject,
      ...(pr.onsetDate ? { onsetDateTime: pr.onsetDate } : {}),
    });
  }
  for (const m of ehr?.medicationsOnFile ?? []) {
    out.push({
      resourceType: 'MedicationRequest',
      id: stableUuid(pid, 'medication-request', m.display),
      meta: { profile: [PROFILE.medicationRequest] },
      status: m.status === 'active' ? 'active' : 'stopped',
      intent: 'order',
      medicationCodeableConcept: { ...(m.rxnorm ? { coding: [{ system: RXNORM, code: m.rxnorm, display: m.display }] } : {}), text: m.display },
      subject,
    });
  }
  for (const a of ehr?.allergies ?? []) {
    out.push({
      resourceType: 'AllergyIntolerance',
      id: stableUuid(pid, 'allergy', a),
      meta: { profile: [PROFILE.allergy] },
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
      verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: 'confirmed' }] },
      code: { text: a },
      patient: subject,
    });
  }
  const vitalsDate = ehr?.lastClinicVisit ?? today;
  const vital = (kind: 'height' | 'weight', code: string, display: string, value: number, unit: string): FhirResource => ({
    resourceType: 'Observation',
    id: stableUuid(pid, kind, vitalsDate),
    meta: { profile: [PROFILE[kind]] },
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs', display: 'Vital signs' }] }],
    code: { coding: [{ system: LOINC, code, display }], text: display },
    subject,
    effectiveDateTime: vitalsDate,
    valueQuantity: { value, unit, system: UCUM, code: unit },
  });
  if (doc.profile.heightCm) out.push(vital('height', '8302-2', 'Body Height', doc.profile.heightCm, 'cm'));
  if (doc.profile.weightKg) out.push(vital('weight', '29463-7', 'Body Weight', doc.profile.weightKg, 'kg'));
  return out;
}

/** Full Synthea-style export: Patient, EHR background, Questionnaires, all home-monitoring data. */
export function patientBundle(doc: RawPatientDocument, trackers: TrackerDefinition[], today: string, media: MediaItem[] = []): FhirBundle {
  const assigned = trackers.filter((t) => doc.trackers.some((a) => a.trackerId === t.id));
  const mediaCtx = makeContext(doc, trackers, 'empty');
  const resources = [
    patientResource(doc),
    ...ehrResources(doc, today),
    ...assigned.map(trackerToQuestionnaire),
    ...entriesToFhir(docToEntries(doc), makeContext(doc, trackers, 'empty')),
    ...media.map((m) => mediaResource(m, mediaCtx)),
  ];
  return {
    resourceType: 'Bundle',
    id: stableUuid('export', fhirPatientId(doc), today),
    type: 'collection',
    entry: resources.map(toEntry),
  };
}

/** Empty runtime bundle for a patient (Patient resource first, like Synthea). */
export function newRuntimeBundle(doc: RawPatientDocument): FhirBundle {
  return { resourceType: 'Bundle', id: stableUuid('runtime', doc.id), type: 'collection', entry: [toEntry(patientResource(doc))] };
}

export function isBundle(x: unknown): x is FhirBundle {
  return typeof x === 'object' && x !== null && (x as FhirBundle).resourceType === 'Bundle' && Array.isArray((x as FhirBundle).entry);
}
