/** Demo sign-in: pick a synthetic patient. In production: enrollment code or QR from the care team. */
import { useCallback, useEffect, useState } from 'react';
import type { PatientListItem } from '@shared/types/summary';
import { api } from '../api';
import { toApiError, type ApiError } from '../lib/errors';
import { ErrorState } from '../components/States';
import { Icon } from '../components/Icon';
import ui from '../styles/ui.module.css';
import s from './screens.module.css';

export function ChoosePatient({ onChoose, currentId }: { onChoose: (id: string) => void; currentId?: string | null }) {
  const [patients, setPatients] = useState<PatientListItem[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.listPatients();
      setPatients(r.patients);
    } catch (e) {
      setError(toApiError(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={s.choose}>
      <h1 className={s.h1}>Demo: choose a patient</h1>
      <p className={ui.muted}>
        All people here are made up. In the real app you'd join with an enrollment code or QR code from your care team.
      </p>
      {error && <ErrorState error={error} onRetry={load} title="Couldn't load the demo patients" />}
      {!error && !patients && (
        <div className={ui.stack} role="status" aria-label="Loading patients">
          {[0, 1, 2].map((i) => (
            <div key={i} className={ui.skeleton} style={{ height: 72 }} />
          ))}
        </div>
      )}
      {patients && patients.length === 0 && <p className={ui.note}>No demo patients yet. Ask the demo host to reset the data.</p>}
      {patients && patients.length > 0 && (
        <ul className={ui.group}>
          {patients.map((p) => (
            <li key={p.id}>
              <button type="button" className={s.patientBtn} onClick={() => onChoose(p.id)} aria-current={p.id === currentId ? 'true' : undefined}>
                <span className={s.avatar} aria-hidden="true">
                  {p.initials}
                </span>
                <span className={ui.rowBody}>
                  <span className={`${ui.rowTitle} ${s.blockText}`}>{p.displayName}</span>
                  <span className={`${ui.rowSub} ${s.blockText}`}>
                    {p.ageYears} years old
                    {p.trackers.length > 0 && ` · ${p.trackers.map((t) => t.conditionLabel).join(', ')}`}
                  </span>
                </span>
                {p.id === currentId && <span className={s.current}>Current</span>}
                <Icon name="chevronRight" size={20} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
