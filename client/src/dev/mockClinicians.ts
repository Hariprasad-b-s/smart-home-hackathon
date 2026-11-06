/** DEV-ONLY mock clinicians and an in-memory preferences store (used when VITE_USE_MOCKS === 'true'). */
import type { ClinicianPreferences, ClinicianProfile } from '@shared/types';
import { defaultPreferences, normalizePreferences } from '../lib/prefs';

export const mockClinicians: ClinicianProfile[] = [
  { id: 'demo-pulm', displayName: 'Dr. Alex Rivera', role: 'Pediatric pulmonologist', defaultView: 'pulmonology' },
  { id: 'demo-neuro', displayName: 'Dr. Priya Shah', role: 'Pediatric neurologist', defaultView: 'neurology' },
  { id: 'demo-nurse', displayName: 'Sam Lee, RN', role: 'Nurse care coordinator', defaultView: 'nursing' },
  { id: 'demo-pcp', displayName: 'Dr. Morgan Ellis', role: 'Primary care pediatrician', defaultView: 'primaryCare' },
];

const store = new Map<string, ClinicianPreferences>();

export function getMockPreferences(id: string): ClinicianPreferences | undefined {
  if (!mockClinicians.some((c) => c.id === id)) return undefined;
  return structuredClone(store.get(id) ?? defaultPreferences(id));
}

export function putMockPreferences(id: string, body: ClinicianPreferences): ClinicianPreferences | undefined {
  if (!mockClinicians.some((c) => c.id === id)) return undefined;
  const saved = { ...normalizePreferences(body, id), clinicianId: id, updatedAt: new Date().toISOString() };
  store.set(id, saved);
  return structuredClone(saved);
}
