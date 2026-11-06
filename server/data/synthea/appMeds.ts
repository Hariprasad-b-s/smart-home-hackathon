/**
 * RxNorm / Synthea prescription display → SMART@Home app medication.
 *
 * Synthea writes raw RxNorm display strings such as
 *   "120 ACTUAT fluticasone propionate 0.044 MG/ACTUAT Metered Dose Inhaler [Flovent]".
 * The patient app shows friendlier names with a schedule. This helper turns the asthma
 * prescriptions into app medications; anything else returns null (stays EHR-only context).
 */
import type { RawHowOften } from '../../../shared/types/raw';

export type AppMedRole = 'controller' | 'rescue';

export interface AppMedSpec {
  role: AppMedRole;
  name: string;
  icon: 'Inhaler' | 'Liquid' | 'Tablet' | 'Capsule' | 'Injection';
  howOften: RawHowOften;
  quantity: number;
  unit: string;
  /** Times per day for scheduled meds. */
  frequency?: number;
  timesOfDay?: string[];
}

const mcg = (mgPerActuation: string) => Math.round(parseFloat(mgPerActuation) * 1000);

/** Map a Synthea MedicationRequest display (and optional RxNorm code) to an app medication. */
export function toAppMedication(display: string, _rxnorm?: string): AppMedSpec | null {
  const d = display.toLowerCase();

  // Inhaled corticosteroid MDI, e.g. "... fluticasone propionate 0.044 MG/ACTUAT Metered Dose Inhaler [Flovent]".
  let m = d.match(/fluticasone propionate ([\d.]+) mg\/actuat metered dose inhaler/);
  if (m) {
    return {
      role: 'controller', name: `Flovent HFA ${mcg(m[1])} mcg`, icon: 'Inhaler', howOften: 'Daily',
      quantity: 2, unit: 'puffs', frequency: 2, timesOfDay: ['07:30', '20:00'],
    };
  }
  // Nebulised budesonide, e.g. "budesonide 0.25 MG/ML Inhalation Suspension".
  m = d.match(/budesonide ([\d.]+) mg\/ml inhalation suspension/);
  if (m) {
    return {
      role: 'controller', name: `Budesonide nebulizer ${parseFloat(m[1])} mg`, icon: 'Liquid', howOften: 'Daily',
      quantity: 1, unit: 'vial', frequency: 2, timesOfDay: ['07:30', '20:00'],
    };
  }
  // Rescue MDI, e.g. "NDA020983 200 ACTUAT albuterol 0.09 MG/ACTUAT Metered Dose Inhaler [Ventolin]".
  if (/albuterol [\d.]+ mg\/actuat metered dose inhaler/.test(d)) {
    const brand = display.match(/\[(\w[\w ]*)\]/)?.[1];
    return {
      role: 'rescue', name: brand ? `Albuterol (${brand} HFA)` : 'Albuterol HFA', icon: 'Inhaler', howOften: 'As Needed',
      quantity: 2, unit: 'puffs',
    };
  }
  // Nebulised albuterol, e.g. "albuterol 0.83 MG/ML Inhalation Solution".
  if (/albuterol [\d.]+ mg\/ml inhalation solution/.test(d)) {
    return { role: 'rescue', name: 'Albuterol nebulizer', icon: 'Liquid', howOften: 'As Needed', quantity: 1, unit: 'vial' };
  }
  return null;
}
