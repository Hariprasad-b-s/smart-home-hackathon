/**
 * EHR background (Synthea-seeded in the demo): problem list ranking and RxNorm-style
 * medication display simplification.
 */
import type { RawEhrContext } from '../types/raw';
import type { PatientHeader } from '../types/summary';
import { isValidDate } from './dates';

const FORMS: [RegExp, string][] = [
  [/metered dose inhaler/i, 'inhaler'],
  [/dry powder inhaler/i, 'inhaler'],
  [/breath activated inhaler/i, 'inhaler'],
  [/inhalation (suspension|solution)/i, 'nebulizer'],
  [/auto-?injector/i, 'auto-injector'],
  [/prefilled syringe|injectable (suspension|solution)|injection/i, 'injection'],
  [/pen injector/i, 'pen'],
  [/extended release oral tablet/i, 'ER tablet'],
  [/delayed release oral (tablet|capsule)/i, 'DR $1'],
  [/extended release oral capsule/i, 'ER capsule'],
  [/chewable tablet/i, 'chewable tablet'],
  [/disintegrating oral tablet/i, 'dissolving tablet'],
  [/oral tablet/i, 'tablet'],
  [/oral capsule/i, 'capsule'],
  [/oral (suspension|solution)/i, 'oral $1'],
  [/nasal spray/i, 'nasal spray'],
  [/nasal (suspension|solution)/i, 'nasal spray'],
  [/topical (cream|ointment|lotion|gel)/i, '$1'],
  [/rectal (suppository|foam|enema)/i, 'rectal $1'],
  [/enema/i, 'enema'],
];

function num(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

interface Ingredient {
  name: string;
  value: number;
  unit: string; // MG | MCG | UNT | ML | %
  per?: string; // ACTUAT | ML | HR
}

/**
 * "120 ACTUAT fluticasone propionate 0.044 MG/ACTUAT Metered Dose Inhaler [Flovent]" → "Flovent HFA 44 mcg inhaler"
 * "NDA020800 0.3 ML Epinephrine 1 MG/ML Auto-Injector" → "Epinephrine auto-injector 0.3 mg"
 * "budesonide 0.25 MG/ML Inhalation Suspension" → "Budesonide 0.25 mg/mL nebulizer"
 */
export function humanizeMedication(raw: string): string {
  let s = (raw ?? '').trim();
  if (!s) return '';
  let brand: string | undefined;
  const b = /\[([^\]]+)\]\s*$/.exec(s);
  if (b) {
    brand = b[1].trim();
    s = s.slice(0, b.index).trim();
  }
  s = s
    .replace(/\bNDA\d+\b/gi, '')
    .replace(/^\{[^}]*\}\s*/, '')
    .replace(/^\d+(\.\d+)?\s*ACTUAT\b/i, '')
    .replace(/\b\d+\s*HR\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  let volumeMl: number | undefined;
  const vol = /^(\d+(?:\.\d+)?)\s*ML\b\s*/i.exec(s);
  if (vol) {
    volumeMl = Number(vol[1]);
    s = s.slice(vol[0].length);
  }
  let form = '';
  for (const [re, label] of FORMS) {
    const m = re.exec(s);
    if (m) {
      form = m[0].replace(re, label).toLowerCase().replace(/^er |^dr /, (x) => x.toUpperCase());
      s = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim();
      break;
    }
  }
  const ingredients: Ingredient[] = [];
  for (const part of s.split(/\s+\/\s+/)) {
    const m = /^(.*?)\s+(\d+(?:\.\d+)?)\s*(MG|MCG|UNT|ML|%)(?:\/(ACTUAT|ML|HR))?\b/i.exec(part.trim());
    if (m) ingredients.push({ name: m[1].trim(), value: Number(m[2]), unit: m[3].toUpperCase(), per: m[4]?.toUpperCase() });
    else if (part.trim()) ingredients.push({ name: part.trim(), value: NaN, unit: '' });
  }
  const generic = ingredients.map((i) => i.name.toLowerCase()).join(' / ');
  let name = brand ?? generic;
  if (brand && /metered dose inhaler/i.test(raw)) name = `${brand} HFA`;

  let strength = '';
  let dose = '';
  const measured = ingredients.filter((i) => Number.isFinite(i.value));
  if (measured.length) {
    const first = measured[0];
    const sameUnit = measured.every((i) => i.unit === first.unit && i.per === first.per);
    if (first.per === 'ML' && first.unit === 'MG') {
      strength = `${measured.map((i) => num(i.value)).join('/')} mg/mL`;
      if (volumeMl !== undefined && measured.length === 1) dose = `${num(volumeMl * first.value)} mg`;
    } else if (sameUnit && first.unit === 'MG' && measured.every((i) => i.value < 1)) {
      strength = `${measured.map((i) => num(i.value * 1000)).join('/')} mcg`;
    } else if (sameUnit) {
      const unit = first.unit === 'UNT' ? ' units' : first.unit === '%' ? '%' : ` ${first.unit.toLowerCase()}`;
      strength = `${measured.map((i) => num(i.value)).join('/')}${unit}`;
    } else {
      strength = measured.map((i) => `${num(i.value)} ${i.unit.toLowerCase()}`).join('/');
    }
  }
  let out: string;
  if (form === 'auto-injector' || form === 'pen') out = [name, form, dose || strength].filter(Boolean).join(' ');
  else out = [name, strength, form].filter(Boolean).join(' ');
  out = out.replace(/\s+/g, ' ').trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** "Childhood asthma (disorder)" → "Childhood asthma". */
export function humanizeProblem(display: string): string {
  return (display ?? '').replace(/\s*\((disorder|finding|situation|morphologic abnormality|procedure|event)\)\s*$/i, '').trim();
}

function problemRank(p: string): number {
  if (/asthma|migraine|headache|crohn|colitis|inflammatory bowel|ibd/i.test(p)) return 0;
  if (/allerg|rhinitis|eczema|dermatitis|anaphyla|chronic|diabetes|obesity|epilep|hypertension|sinusitis/i.test(p)) return 1;
  return 2;
}

export function mapEhr(ehr: RawEhrContext | null | undefined): PatientHeader['ehr'] | undefined {
  if (!ehr) return undefined;
  const seen = new Set<string>();
  const problems = (ehr.problems ?? [])
    .filter((p) => p && p.active)
    .map((p, i) => ({ text: humanizeProblem(p.display), i }))
    .filter((p) => p.text && !seen.has(p.text.toLowerCase()) && seen.add(p.text.toLowerCase()))
    .sort((a, b) => problemRank(a.text) - problemRank(b.text) || a.i - b.i)
    .slice(0, 8)
    .map((p) => p.text);
  const meds: string[] = [];
  for (const m of ehr.medicationsOnFile ?? []) {
    if (!m || String(m.status).toLowerCase() !== 'active') continue;
    const h = humanizeMedication(m.display);
    if (h && !meds.includes(h)) meds.push(h);
  }
  const out: NonNullable<PatientHeader['ehr']> = {
    source: ehr.source,
    problems,
    allergies: [...new Set((ehr.allergies ?? []).map((a) => humanizeProblem(String(a).replace(/\s*\(substance\)\s*$/i, ''))).filter(Boolean))],
    medicationsOnFile: meds,
  };
  if (isValidDate(ehr.lastClinicVisit)) out.lastClinicVisit = ehr.lastClinicVisit;
  if (typeof ehr.visitsLast12Months === 'number') out.visitsLast12Months = ehr.visitsLast12Months;
  return out;
}
