/**
 * Demo clinician identity + preferences (layouts per view, visit-mode visibility).
 * Preferences load once per clinician; updates are optimistic with a debounced PUT and
 * roll back (with a toast) when saving fails. Also holds the dashboard layout edit session,
 * so unsaved edits survive changing patient and can be saved or discarded later.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ClinicianPreferences, ClinicianProfile, HeadlineMetricId } from '@shared/types';
import { fetchClinicianPrefs, fetchClinicians, saveClinicianPrefs } from '../api/client';
import { defaultPreferences, normalizePreferences, toDashboardLayout, type ResolvedSection } from '../lib/prefs';

export const CLINICIAN_STORAGE_KEY = 'smart-home-clinician-id';
export const SAVE_DEBOUNCE_MS = 600;

export interface LayoutDraft {
  sections: ResolvedSection[];
  headline: { id: HeadlineMetricId; visible: boolean }[];
}

export interface EditSession {
  viewId: string;
  viewLabel: string;
  patientId: string;
  draft: LayoutDraft;
  dirty: boolean;
}

export interface ClinicianContextValue {
  /** False when rendered without a provider (prefs are defaults, nothing persists). */
  available: boolean;
  clinicians: ClinicianProfile[];
  clinician?: ClinicianProfile;
  setClinicianId: (id: string) => void;
  prefs: ClinicianPreferences;
  prefsLoading: boolean;
  updatePrefs: (fn: (p: ClinicianPreferences) => ClinicianPreferences, opts?: { immediate?: boolean }) => void;
  editSession: EditSession | null;
  startEdit: (s: Omit<EditSession, 'dirty'>, dirty?: boolean) => void;
  updateDraft: (fn: (d: LayoutDraft) => LayoutDraft) => void;
  /** save=true writes the draft into prefs.layouts[viewId] and saves immediately. */
  endEdit: (save: boolean) => void;
  resetLayout: (viewId: string) => void;
  toast: (message: string) => void;
}

const FALLBACK_PREFS = defaultPreferences('anonymous');
const noop = () => {};
const ClinicianContext = createContext<ClinicianContextValue>({
  available: false,
  clinicians: [],
  setClinicianId: noop,
  prefs: FALLBACK_PREFS,
  prefsLoading: false,
  updatePrefs: noop,
  editSession: null,
  startEdit: noop,
  updateDraft: noop,
  endEdit: noop,
  resetLayout: noop,
  toast: noop,
});

export const useClinicianPrefs = () => useContext(ClinicianContext);

function readStoredClinician(): string | null {
  try {
    return window.localStorage.getItem(CLINICIAN_STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeStoredClinician(id: string) {
  try {
    window.localStorage.setItem(CLINICIAN_STORAGE_KEY, id);
  } catch {
    /* storage blocked */
  }
}

export function ClinicianProvider({ children }: { children: ReactNode }) {
  const [clinicians, setClinicians] = useState<ClinicianProfile[]>([]);
  const [clinicianId, setClinicianIdState] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ClinicianPreferences>(FALLBACK_PREFS);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [editSession, setEditSession] = useState<EditSession | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);

  const prefsRef = useRef(prefs);
  const confirmedRef = useRef(prefs);
  const clinicianRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  const toast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const id = clinicianRef.current;
    if (!id || !dirtyRef.current) return;
    dirtyRef.current = false;
    const body = prefsRef.current;
    saveClinicianPrefs(id, body)
      .then(() => {
        if (clinicianRef.current === id) confirmedRef.current = body;
      })
      .catch((err: unknown) => {
        if (clinicianRef.current !== id) return;
        prefsRef.current = confirmedRef.current;
        setPrefs(confirmedRef.current);
        toast(`Couldn’t save your preferences, so the last change was undone. ${err instanceof Error ? err.message : ''}`.trim());
      });
  }, [toast]);

  const updatePrefs = useCallback<ClinicianContextValue['updatePrefs']>(
    (fn, opts) => {
      const next = fn(prefsRef.current);
      prefsRef.current = next;
      setPrefs(next);
      if (!clinicianRef.current) return;
      dirtyRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (opts?.immediate) flush();
      else timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // Load the clinician list once.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchClinicians(ctrl.signal)
      .then((list) => {
        setClinicians(list);
        const stored = readStoredClinician();
        setClinicianIdState(list.some((c) => c.id === stored) ? stored : (list[0]?.id ?? null));
      })
      .catch(() => {
        /* endpoint unavailable: run without a signed-in clinician */
      });
    return () => ctrl.abort();
  }, []);

  // Load preferences once per clinician.
  useEffect(() => {
    if (!clinicianId) return;
    flush(); // save anything pending for the previous clinician first
    clinicianRef.current = clinicianId;
    const ctrl = new AbortController();
    setPrefsLoading(true);
    fetchClinicianPrefs(clinicianId, ctrl.signal)
      .then((p) => normalizePreferences(p, clinicianId))
      .catch((err: unknown) => {
        if ((err as Error)?.name !== 'AbortError') toast('Couldn’t load your saved preferences; using the defaults.');
        return defaultPreferences(clinicianId);
      })
      .then((p) => {
        if (ctrl.signal.aborted) return;
        prefsRef.current = p;
        confirmedRef.current = p;
        setPrefs(p);
        setPrefsLoading(false);
      });
    return () => ctrl.abort();
  }, [clinicianId, flush, toast]);

  // Save pending changes when the page goes away.
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [flush]);

  const setClinicianId = useCallback((id: string) => {
    writeStoredClinician(id);
    setEditSession(null);
    setClinicianIdState(id);
  }, []);

  const startEdit = useCallback((s: Omit<EditSession, 'dirty'>, dirty = false) => setEditSession({ ...s, dirty }), []);
  const updateDraft = useCallback((fn: (d: LayoutDraft) => LayoutDraft) => {
    setEditSession((s) => (s ? { ...s, draft: fn(s.draft), dirty: true } : s));
  }, []);
  const editRef = useRef<EditSession | null>(null);
  useEffect(() => {
    editRef.current = editSession;
  }, [editSession]);
  const endEdit = useCallback(
    (save: boolean) => {
      const s = editRef.current;
      editRef.current = null;
      setEditSession(null);
      if (s && save) {
        const { viewId, draft } = s;
        updatePrefs(
          (p) => ({ ...p, layouts: { ...p.layouts, [viewId]: toDashboardLayout(draft.sections, draft.headline, p.layouts[viewId]) } }),
          { immediate: true },
        );
      }
    },
    [updatePrefs],
  );
  const resetLayout = useCallback(
    (viewId: string) => {
      setEditSession(null);
      updatePrefs(
        (p) => {
          const layouts = { ...p.layouts };
          delete layouts[viewId];
          return { ...p, layouts };
        },
        { immediate: true },
      );
    },
    [updatePrefs],
  );

  const value = useMemo<ClinicianContextValue>(
    () => ({
      available: true,
      clinicians,
      clinician: clinicians.find((c) => c.id === clinicianId),
      setClinicianId,
      prefs,
      prefsLoading,
      updatePrefs,
      editSession,
      startEdit,
      updateDraft,
      endEdit,
      resetLayout,
      toast,
    }),
    [clinicians, clinicianId, setClinicianId, prefs, prefsLoading, updatePrefs, editSession, startEdit, updateDraft, endEdit, resetLayout, toast],
  );

  return (
    <ClinicianContext.Provider value={value}>
      {children}
      <div className="toast-region no-print" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.message}
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ClinicianContext.Provider>
  );
}
