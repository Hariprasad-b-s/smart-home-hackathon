/**
 * Typed access to the committed Synthea seeds (server/data/synthea/seeds.json).
 * Produced by import.ts from Synthea FHIR output; read at runtime by the generator.
 */
import seedFile from './seeds.json';

export interface SyntheaSeed {
  /** Synthea Patient.id */
  id: string;
  firstName: string;
  lastName: string;
  sex: 'F' | 'M' | 'X';
  birthDate: string;
  city?: string;
  state?: string;
  postalCode?: string;
  heightCm?: number;
  weightKg?: number;
  asthma: boolean;
  problems: { display: string; snomed?: string; onsetDate?: string; active: boolean }[];
  meds: { display: string; rxnorm?: string; status: 'active' | 'stopped' }[];
  allergies: string[];
  lastClinicVisit?: string | null;
  visitsLast12Months?: number;
  /** Import-time only; removed before writing seeds.json. */
  clinicVisits?: string[];
}

export interface SyntheaSeedFile {
  source: 'synthea';
  /** Synthea simulation end date; seed dates are shifted by (today − referenceDate). */
  referenceDate: string;
  syntheaArgs: string;
  seeds: SyntheaSeed[];
}

export const SYNTHEA: SyntheaSeedFile = seedFile as SyntheaSeedFile;
