/**
 * Colour theme preference: 'system' follows prefers-color-scheme (no data-theme attribute);
 * 'light' / 'dark' set <html data-theme>, which tokens.css honours. Persisted in localStorage
 * (all access guarded: blocked storage degrades to 'system'). index.html applies the stored
 * value before React mounts to avoid a flash of the wrong theme.
 */
import { useCallback, useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_STORAGE_KEY = 'smart-home-theme';

const isPref = (v: unknown): v is ThemePreference => v === 'system' || v === 'light' || v === 'dark';

export function readStoredTheme(): ThemePreference {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPref(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

function writeStoredTheme(pref: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* storage blocked: preference lasts for this page only */
  }
}

export function applyTheme(pref: ThemePreference) {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'color-scheme';
    document.head.appendChild(meta);
  }
  meta.content = pref === 'system' ? 'light dark' : pref;
}

// Tiny shared store so every toggle instance stays in sync.
let current: ThemePreference | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): ThemePreference {
  if (current === null) {
    current = readStoredTheme();
    applyTheme(current);
  }
  return current;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) setThemePreference(isPref(e.newValue) ? e.newValue : 'system', false);
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function setThemePreference(pref: ThemePreference, persist = true) {
  current = pref;
  applyTheme(pref);
  if (persist) writeStoredTheme(pref);
  listeners.forEach((l) => l());
}

/** Test helper: forget the cached preference so the next read comes from storage. */
export function resetThemeStoreForTests() {
  current = null;
}

export function useTheme(): [ThemePreference, (p: ThemePreference) => void] {
  const theme = useSyncExternalStore(subscribe, getSnapshot, () => 'system' as ThemePreference);
  const set = useCallback((p: ThemePreference) => setThemePreference(p), []);
  return [theme, set];
}
