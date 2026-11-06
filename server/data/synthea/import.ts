/**
 * Synthea FHIR → compact seeds.json importer.
 *
 *   tsx server/data/synthea/import.ts [fhirDir]   (default: server/data/synthea/output/fhir)
 *
 * Reads Synthea patient bundles (see run-synthea.sh), skips deceased patients and writes a
 * small, deterministic `seeds.json`: every asthma patient plus a handful of non-asthma
 * adolescents. The demo generator reads ONLY seeds.json at runtime (no Java, no 255 MB output).
 * All data are synthetic (Synthea).
 */
import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SyntheaSeed, SyntheaSeedFile } from './seeds';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NON_ASTHMA_COUNT = 6;

// FHIR shapes we touch (loosely typed — Synthea output only).
interface Coding { system?: string; code?: string; display?: string }
interface Resource {
  resourceType: string;
  id: string;
  [k: string]: unknown;
}
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const stripDigits = (s: string) => s.replace(/\d+/g, '').trim();
/** "Childhood asthma (disorder)" → "Childhood asthma". */
export const stripSemanticTag = (s: string) => s.replace(/\s*\((disorder|finding|situation|substance|organism|morphologic abnormality|procedure|regime\/therapy)\)\s*$/i, '').trim();
const firstCoding = (cc: Any | undefined): Coding => (cc?.coding?.[0] ?? {}) as Coding;
const dateOnly = (s?: string) => (s ? s.slice(0, 10) : undefined);

/** Social-determinant / administrative findings that are not clinical problems. */
const DROP_PROBLEM =
  /employment|education|stress \(|labor force|social|violence|abuse|criminal|alcohol|transportation|housing|homeless|risk activity|medication review|dental filling|unemployed|refugee|prison|tobacco|smokes|received certificate|limited social|isolation|misuses drugs/i;
/** Self-limited acute illness / injury: only kept while still active. */
const ACUTE =
  /acute|viral|pharyngitis|streptococcal|sinusitis|otitis|bronchitis|cystitis|pyelonephritis|gingiv|dental caries|infection of tooth|fracture|sprain|laceration|burn|wound|injury|whiplash|concussion|cough|fever|nasal congestion|sputum|loss of taste|febrile|alveolitis|tear of|rupture of|loss of teeth/i;
const ASTHMA = /asthma/i;
const CLINIC_ENCOUNTER = /well child|check up|outpatient|encounter for (symptom|problem)|consultation|asthma follow-up|allergic disorder|follow-up|urgent care/i;

interface Parsed {
  seed: SyntheaSeed;
  maxDate: string;
}

function parseBundle(bundle: Any): Parsed | null {
  const resources: Resource[] = (bundle.entry ?? []).map((e: Any) => e.resource);
  const patient = resources.find((r) => r.resourceType === 'Patient') as Any | undefined;
  if (!patient || patient.deceasedDateTime || patient.deceasedBoolean) return null;
  const byUrn = new Map<string, Any>();
  for (const e of bundle.entry ?? []) if (e.fullUrl) byUrn.set(e.fullUrl, e.resource);

  const name = (patient.name ?? []).find((n: Any) => n.use === 'official') ?? patient.name?.[0] ?? {};
  const addr = patient.address?.[0] ?? {};
  let maxDate = '';
  const bump = (d?: string) => {
    if (d && d.slice(0, 10) > maxDate) maxDate = d.slice(0, 10);
  };

  // Latest height / weight.
  let height: { d: string; v: number } | undefined;
  let weight: { d: string; v: number } | undefined;
  for (const r of resources as Any[]) {
    if (r.resourceType !== 'Observation') continue;
    const code = firstCoding(r.code).code;
    const v = r.valueQuantity?.value;
    const d = r.effectiveDateTime ?? '';
    if (typeof v !== 'number') continue;
    if (code === '8302-2' && (!height || d > height.d)) height = { d, v };
    if (code === '29463-7' && (!weight || d > weight.d)) weight = { d, v };
  }

  // Problems: latest occurrence per display; drop SDOH / admin; drop resolved acute episodes.
  const problems = new Map<string, SyntheaSeed['problems'][number]>();
  let asthma = false;
  for (const r of resources as Any[]) {
    if (r.resourceType !== 'Condition') continue;
    const c = firstCoding(r.code);
    const raw = c.display ?? r.code?.text ?? '';
    if (!raw || DROP_PROBLEM.test(raw)) continue;
    const active = firstCoding(r.clinicalStatus).code === 'active';
    if (ASTHMA.test(raw)) asthma = true;
    if (!active && ACUTE.test(raw)) continue;
    if (/\((finding|situation)\)$/i.test(raw) && !/anxiety|history of seizure|history of appendectomy|obesity|body mass index/i.test(raw)) continue;
    const display = stripSemanticTag(raw);
    const onsetDate = dateOnly(r.onsetDateTime);
    bump(onsetDate);
    const prev = problems.get(display);
    if (!prev || (onsetDate ?? '') > (prev.onsetDate ?? '') || (active && !prev.active)) {
      problems.set(display, { display, snomed: c.code, onsetDate, active: active || (prev?.active ?? false) });
    }
  }

  // Medications: one entry per display; active wins over stopped.
  const meds = new Map<string, SyntheaSeed['meds'][number]>();
  for (const r of resources as Any[]) {
    if (r.resourceType !== 'MedicationRequest') continue;
    let cc = r.medicationCodeableConcept;
    if (!cc && r.medicationReference?.reference) cc = byUrn.get(r.medicationReference.reference)?.code;
    const c = firstCoding(cc);
    const display = c.display ?? cc?.text;
    if (!display) continue;
    const status = r.status === 'active' ? 'active' : 'stopped';
    const prev = meds.get(display);
    if (!prev || (status === 'active' && prev.status !== 'active')) meds.set(display, { display, rxnorm: c.code, status });
    bump(r.authoredOn);
  }

  const allergies = new Set<string>();
  for (const r of resources as Any[]) {
    if (r.resourceType !== 'AllergyIntolerance') continue;
    const raw = firstCoding(r.code).display ?? r.code?.text;
    if (raw && !/allergic disposition/i.test(raw)) allergies.add(stripSemanticTag(raw));
  }

  const clinicVisits: string[] = [];
  for (const r of resources as Any[]) {
    if (r.resourceType !== 'Encounter') continue;
    const start = dateOnly(r.period?.start);
    bump(r.period?.end ?? r.period?.start);
    const typ = firstCoding(r.type?.[0]).display ?? '';
    if (start && r.class?.code === 'AMB' && CLINIC_ENCOUNTER.test(typ)) clinicVisits.push(start);
  }
  clinicVisits.sort();

  const seed: SyntheaSeed = {
    id: patient.id,
    firstName: stripDigits(name.given?.[0] ?? ''),
    lastName: stripDigits(name.family ?? ''),
    sex: patient.gender === 'female' ? 'F' : patient.gender === 'male' ? 'M' : 'X',
    birthDate: patient.birthDate,
    city: addr.city,
    state: addr.state,
    postalCode: addr.postalCode,
    heightCm: height ? Math.round(height.v * 10) / 10 : undefined,
    weightKg: weight ? Math.round(weight.v * 10) / 10 : undefined,
    asthma,
    problems: [...problems.values()].sort((a, b) => (b.onsetDate ?? '').localeCompare(a.onsetDate ?? '') || a.display.localeCompare(b.display)),
    meds: [...meds.values()].sort((a, b) => (a.status === b.status ? a.display.localeCompare(b.display) : a.status === 'active' ? -1 : 1)),
    allergies: [...allergies].sort(),
    clinicVisits,
  };
  return { seed, maxDate };
}

export function importSynthea(fhirDir: string): SyntheaSeedFile {
  const files = readdirSync(fhirDir).filter((f) => f.endsWith('.json')).sort();
  const parsed: Parsed[] = [];
  for (const f of files) {
    const bundle = JSON.parse(readFileSync(path.join(fhirDir, f), 'utf8'));
    if (bundle.resourceType !== 'Bundle') continue;
    const p = parseBundle(bundle);
    if (p) parsed.push(p);
  }
  // Synthea's simulation end date ≈ the latest date anywhere in the output.
  const referenceDate = parsed.reduce((m, p) => (p.maxDate > m ? p.maxDate : m), '');
  const yearAgo = `${+referenceDate.slice(0, 4) - 1}${referenceDate.slice(4)}`;

  const finalize = (s: SyntheaSeed) => {
    const visits = s.clinicVisits ?? [];
    const out: SyntheaSeed = { ...s, lastClinicVisit: visits.at(-1) ?? null, visitsLast12Months: visits.filter((d) => d > yearAgo && d <= referenceDate).length };
    delete out.clinicVisits;
    return out;
  };
  const asthma = parsed.filter((p) => p.seed.asthma).map((p) => finalize(p.seed));
  // Non-asthma: deterministic pick (by id) of adolescents with at least one ongoing chronic problem.
  const others = parsed
    .filter((p) => !p.seed.asthma && p.seed.problems.some((x) => x.active && (!ACUTE.test(x.display) || /chronic|recurrent/i.test(x.display))))
    .map((p) => finalize(p.seed))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, NON_ASTHMA_COUNT);
  return {
    source: 'synthea',
    referenceDate,
    syntheaArgs: '-s 20260624 -cs 20260624 -p 300 -a 12-17 --exporter.years_of_history=5 Ohio Cincinnati',
    seeds: [...asthma.sort((a, b) => a.id.localeCompare(b.id)), ...others],
  };
}

function isMain(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const dir = path.resolve(process.argv[2] ?? path.join(HERE, 'output', 'fhir'));
  const result = importSynthea(dir);
  const out = path.join(HERE, 'seeds.json');
  // One seed per line: compact but diff-friendly.
  const body = `{\n"source": ${JSON.stringify(result.source)},\n"referenceDate": ${JSON.stringify(result.referenceDate)},\n"syntheaArgs": ${JSON.stringify(result.syntheaArgs)},\n"seeds": [\n${result.seeds.map((s) => JSON.stringify(s)).join(',\n')}\n]\n}\n`;
  writeFileSync(out, body);
  const nAsthma = result.seeds.filter((s) => s.asthma).length;
  console.log(`Wrote ${result.seeds.length} seeds (${nAsthma} asthma) to ${out} — ${(body.length / 1024).toFixed(1)} KB, referenceDate=${result.referenceDate}`);
}
