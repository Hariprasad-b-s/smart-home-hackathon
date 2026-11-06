/**
 * Guarded localStorage access. Private browsing, blocked cookies or quota errors make
 * localStorage throw; the app must keep working (the choice just won't be remembered).
 */
export const PATIENT_KEY = 'smart-home-patient-id';

export function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked: lasts for this page only */
  }
}

export function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = safeGet(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const getStoredPatientId = () => safeGet(PATIENT_KEY);
export const storePatientId = (id: string) => safeSet(PATIENT_KEY, id);
export const clearStoredPatientId = () => safeRemove(PATIENT_KEY);
