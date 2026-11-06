/**
 * One medicine with one-tap dose marking: "Mark taken" per scheduled time, or "I used it"
 * for as-needed medicines. Guards against double taps (sync ref + disabled while saving).
 */
import { useRef, useState } from 'react';
import type { PatientAppMedication, WriteResult } from '@shared/types/api';
import type { HHmm, ISODate, RawMedicationAdministration } from '@shared/types/raw';
import { api } from '../api';
import { toApiError } from '../lib/errors';
import { recordLocalDose } from '../lib/medHistory';
import { hhmm } from '../lib/time';
import { Icon } from './Icon';
import ui from '../styles/ui.module.css';
import s from './components.module.css';

export interface DoseSlot {
  time: HHmm | null;
  takenAt?: HHmm;
}

/** Scheduled slots for today; the first N slots count as taken (N = doses marked today). */
export function doseSlots(med: PatientAppMedication): DoseSlot[] {
  const times = [...med.timesOfDay].sort();
  const n = Math.max(times.length, med.dosesDueToday);
  const taken = [...med.takenTimesToday].sort();
  return Array.from({ length: n }, (_, i) => ({
    time: times[i] ?? null,
    takenAt: i < med.dosesTakenToday ? (taken[i] ?? '') : undefined,
  }));
}

export function MedRow({
  med,
  patientId,
  today,
  onTaken,
  compact = false,
}: {
  med: PatientAppMedication;
  patientId: string;
  today: ISODate;
  onTaken?: (medicationId: string, time: HHmm, result: WriteResult<RawMedicationAdministration>) => void;
  compact?: boolean;
}) {
  const inflight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mark() {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    const time = hhmm();
    try {
      const result = await api.markDose(patientId, { medicationId: med.id, day: today, time });
      const at = result.created?.time || time;
      recordLocalDose(patientId, today, med.id, at);
      onTaken?.(med.id, at, result);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  const asNeeded = med.kind === 'asNeeded';
  const slots = asNeeded ? [] : doseSlots(med);
  const firstOpen = slots.findIndex((sl) => sl.takenAt === undefined);
  const allDone = !asNeeded && slots.length > 0 && firstOpen === -1;

  return (
    <div className={s.med}>
      <div className={ui.row} style={{ minHeight: 0, paddingBottom: asNeeded ? 14 : 8 }}>
        <span className={`${ui.iconWell} ${allDone ? s.wellDone : ''}`}>
          <Icon name={/inhal/i.test(med.icon ?? med.name) ? 'inhaler' : 'pill'} />
        </span>
        <div className={ui.rowBody}>
          <p className={ui.rowTitle}>{med.name}</p>
          <p className={ui.rowSub}>
            {med.regimen}
            {asNeeded &&
              (med.takenTimesToday.length > 0
                ? `. Used ${med.takenTimesToday.length === 1 ? 'once' : `${med.takenTimesToday.length} times`} today (${[...med.takenTimesToday].sort().join(', ')})`
                : '. Not used today')}
          </p>
        </div>
        {asNeeded && (
          <button
            type="button"
            className={`${ui.btn} ${ui.secondary} ${ui.small}`}
            onClick={mark}
            disabled={busy}
            aria-label={`I used ${med.name}`}
          >
            {busy ? 'Saving…' : 'I used it'}
          </button>
        )}
      </div>
      {!asNeeded && slots.length > 0 && (
        <ul className={s.slots} aria-label={`${med.name} doses today`}>
          {slots.map((sl, i) =>
            sl.takenAt !== undefined ? (
              <li key={i} className={`${s.slot} ${s.slotDone}`}>
                <Icon name="check" size={18} />
                <span>
                  {sl.time ? `${sl.time} ` : ''}
                  <span className={s.slotNote}>taken{sl.takenAt ? ` at ${sl.takenAt}` : ''}</span>
                </span>
              </li>
            ) : (
              <li key={i} className={s.slot}>
                <span className={s.slotTime}>{sl.time ?? `Dose ${i + 1}`}</span>
                {(!compact || i === firstOpen) && (
                  <button
                    type="button"
                    className={`${ui.btn} ${ui.small} ${i === firstOpen ? '' : ui.secondary}`}
                    onClick={mark}
                    disabled={busy}
                    aria-label={`Mark ${med.name}${sl.time ? ` ${sl.time}` : ''} dose taken`}
                  >
                    {busy && i === firstOpen ? 'Saving…' : 'Mark taken'}
                  </button>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {!asNeeded && slots.length === 0 && <p className={`${ui.note} ${s.medNote}`}>Nothing due today.</p>}
      {error && (
        <p className={`${ui.inlineError} ${s.medNote}`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
