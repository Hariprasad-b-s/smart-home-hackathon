/** Home payload for the chosen patient, shared by every tab, plus a polite announcer. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PatientAppHome } from '@shared/types/api';
import type { HHmm } from '@shared/types/raw';
import { api } from '../api';
import { ApiError, toApiError } from './errors';

interface HomeState {
  patientId: string;
  home: PatientAppHome | null;
  loading: boolean;
  error: ApiError | null;
  /** Re-fetch. `quiet` keeps the current data on screen while loading. */
  reload: (quiet?: boolean) => Promise<void>;
  /** Optimistically record a dose so every tab updates before the re-fetch lands. */
  applyDose: (medicationId: string, time: HHmm) => void;
}

const HomeContext = createContext<HomeState | null>(null);

export function HomeProvider({
  patientId,
  onUnknownPatient,
  children,
}: {
  patientId: string;
  onUnknownPatient?: () => void;
  children: ReactNode;
}) {
  const [home, setHome] = useState<PatientAppHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const seq = useRef(0);
  const unknownRef = useRef(onUnknownPatient);
  unknownRef.current = onUnknownPatient;

  const reload = useCallback(
    async (quiet = false) => {
      const my = ++seq.current;
      if (!quiet) setLoading(true);
      try {
        const h = await api.getHome(patientId);
        if (my !== seq.current) return;
        setHome(h);
        setError(null);
      } catch (e) {
        if (my !== seq.current) return;
        const err = toApiError(e);
        if (err.status === 404) unknownRef.current?.();
        if (!quiet) setError(err);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [patientId],
  );

  useEffect(() => {
    setHome(null);
    void reload();
  }, [reload]);

  const applyDose = useCallback((medicationId: string, time: HHmm) => {
    setHome((h) =>
      h && {
        ...h,
        medications: h.medications.map((m) =>
          m.id === medicationId
            ? { ...m, dosesTakenToday: m.dosesTakenToday + 1, takenTimesToday: [...m.takenTimesToday, time] }
            : m,
        ),
      },
    );
  }, []);

  const value = useMemo(
    () => ({ patientId, home, loading, error, reload, applyDose }),
    [patientId, home, loading, error, reload, applyDose],
  );
  return <HomeContext.Provider value={value}>{children}</HomeContext.Provider>;
}

export function useHome(): HomeState {
  const ctx = useContext(HomeContext);
  if (!ctx) throw new Error('useHome must be used inside <HomeProvider>');
  return ctx;
}

/** Optional variant for components that also render outside the provider (tests). */
export function useOptionalHome(): HomeState | null {
  return useContext(HomeContext);
}

// ── Announcer (toast + aria-live) ────────────────────────────────────────────────

type Announce = (message: string) => void;
const AnnounceContext = createContext<Announce>(() => {});

export function AnnounceProvider({ children, render }: { children: ReactNode; render: (msg: string | null) => ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const announce = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 4000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      {render(msg)}
    </AnnounceContext.Provider>
  );
}

export const useAnnounce = () => useContext(AnnounceContext);

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
