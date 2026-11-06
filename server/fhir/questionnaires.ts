/**
 * TrackerDefinition → FHIR R4 Questionnaire (one per tracker).
 */
import type { QuestionType, TrackerDefinition } from '../../shared/types/tracker';
import { answerSystem, questionnaireUrl, UCUM, type FhirResource } from './constants';

const ITEM_TYPE: Record<QuestionType, string> = {
  yesNo: 'boolean',
  number: 'decimal',
  scale1to10: 'integer',
  faceScale: 'choice',
  iconChoice: 'choice',
  singleChoice: 'choice',
  // Raw checkbox lists sometimes carry option variants (stray whitespace), hence open-choice.
  checkbox: 'open-choice',
  text: 'string',
  // "Please complete your spirometer reading": answer links to the spirometry Observation.
  spirometry: 'reference',
};

export function trackerToQuestionnaire(t: TrackerDefinition): FhirResource {
  return {
    resourceType: 'Questionnaire',
    id: t.id,
    url: questionnaireUrl(t.id),
    version: String(t.version),
    name: t.name.replace(/[^A-Za-z0-9]+/g, ''),
    title: t.name,
    status: 'active',
    subjectType: ['Patient'],
    useContext: [
      {
        code: { system: 'http://terminology.hl7.org/CodeSystem/usage-context-type', code: 'focus' },
        valueCodeableConcept: { text: t.conditionLabel },
      },
    ],
    item: [...t.questions]
      .sort((a, b) => a.order - b.order)
      .map((q) => {
        const item: FhirResource = { linkId: q.id, text: q.text, type: ITEM_TYPE[q.type], required: false } as unknown as FhirResource;
        const extension: unknown[] = [];
        if (q.min !== undefined) extension.push({ url: 'http://hl7.org/fhir/StructureDefinition/minValue', [q.type === 'number' ? 'valueDecimal' : 'valueInteger']: q.min });
        if (q.max !== undefined) extension.push({ url: 'http://hl7.org/fhir/StructureDefinition/maxValue', [q.type === 'number' ? 'valueDecimal' : 'valueInteger']: q.max });
        if (q.unit) extension.push({ url: 'http://hl7.org/fhir/StructureDefinition/questionnaire-unit', valueCoding: { system: UCUM, code: q.unit === 'hours' ? 'h' : `{${q.unit}}`, display: q.unit } });
        if (extension.length) item.extension = extension;
        if (q.type === 'checkbox') item.repeats = true;
        if (q.type === 'spirometry') item.extension = [...(item.extension ?? []), { url: 'http://hl7.org/fhir/StructureDefinition/questionnaire-referenceResource', valueCode: 'Observation' }];
        if (q.options?.length) {
          item.answerOption = q.options.map((o) => ({ valueCoding: { system: answerSystem(t.id, q.id), code: o.value, display: o.label } }));
        }
        return item;
      }),
  };
}

export function questionnaireBundle(trackers: TrackerDefinition[]) {
  return {
    resourceType: 'Bundle' as const,
    type: 'collection' as const,
    entry: trackers.map((t) => ({ fullUrl: questionnaireUrl(t.id), resource: trackerToQuestionnaire(t) })),
  };
}
