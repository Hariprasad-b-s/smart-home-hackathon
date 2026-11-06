import { useEffect, useMemo, useState } from 'react';
import type { PatientAppHome } from '@shared/types/api';
import { api } from '../api';
import { useAnnounce, useHome } from '../lib/home';
import { buildHistory, logFromRaw, readLocalLog, type DayCell, type DoseLog } from '../lib/medHistory';
import { addDays, shortDate, weekdayShort } from '../lib/time';
import { Icon } from '../components/Icon';
import { MedRow } from '../components/MedRow';
import { ErrorState, LoadingBlocks } from '../components/States';
import ui from '../styles/ui.module.css';
import s from './screens.module.css';

const CELL_TEXT: Record<DayCell, string> = {
  taken: 'Taken',
  some: 'Some taken',
  missed: 'Missed',
  pending: 'Still to do',
  none: 'Not scheduled',
};

/** Past-day dose log: raw document if reachable, else doses marked on this device. */
function usePastLog(patientId: string, home: PatientAppHome | null): { log: DoseLog; source: 'server' | 'device' } {
  const [raw, setRaw] = useState<DoseLog | null>(null);
  const today = home?.today;
  const meds = home?.medications;
  // Re-fetch only when the patient or day changes, not on every optimistic dose.
  const medKey = meds?.map((m) => m.id).join(',');
  useEffect(() => {
    if (!today || !meds) return;
    let alive = true;
    api
      .getRaw(patientId)
      .then((doc) => alive && setRaw(logFromRaw(doc, meds, addDays(today, -6), addDays(today, -1))))
      .catch(() => alive && setRaw(null));
    return () => {
      alive = false;
    };
  }, [patientId, today, medKey]);
  return useMemo(() => (raw ? { log: raw, source: 'server' } : { log: readLocalLog(patientId), source: 'device' }), [raw, patientId, home]);
}

export function Medicines() {
  const { home, loading, error, reload, applyDose, patientId } = useHome();
  const announce = useAnnounce();
  const past = usePastLog(patientId, home);

  if (!home) {
    if (error) return <ErrorState error={error} onRetry={() => reload()} />;
    return loading ? <LoadingBlocks /> : null;
  }

  const scheduled = home.medications.filter((m) => m.kind === 'scheduled');
  const asNeeded = home.medications.filter((m) => m.kind === 'asNeeded');
  const history = buildHistory(home.medications, home.today, past.log);
  const onTaken = (id: string, time: string, r: { message: string; newBadge?: { label: string } }) => {
    applyDose(id, time);
    announce(r.newBadge ? `${r.message} New badge: ${r.newBadge.label}` : r.message || 'Marked as taken');
    void reload(true);
  };

  return (
    <div>
      <h1 className={s.h1}>Medicines</h1>
      {home.medications.length === 0 && <p className={ui.muted}>No medicines are on your list. Your care team adds them.</p>}

      {scheduled.length > 0 && (
        <>
          <h2 className={ui.sectionTitle}>Today's schedule</h2>
          <div className={ui.group}>
            {scheduled.map((m) => (
              <MedRow key={m.id} med={m} patientId={patientId} today={home.today} onTaken={onTaken} />
            ))}
          </div>
        </>
      )}

      {asNeeded.length > 0 && (
        <>
          <h2 className={ui.sectionTitle}>When you need it</h2>
          <p className={`${ui.note} ${s.lead}`}>Tap "I used it" each time, so your care team knows how often you need it.</p>
          <div className={ui.group}>
            {asNeeded.map((m) => (
              <MedRow key={m.id} med={m} patientId={patientId} today={home.today} onTaken={onTaken} />
            ))}
          </div>
        </>
      )}

      {history.length > 0 && (
        <>
          <h2 className={ui.sectionTitle}>Last 7 days</h2>
          <div className={`${ui.panel} ${s.histPanel}`}>
            <table className={s.hist}>
              <caption className={ui.srOnly}>Medicines marked in the last 7 days</caption>
              <thead>
                <tr>
                  {history[0].cells.map((c) => (
                    <th key={c.day} scope="col" className={c.day === home.today ? s.histToday : ''}>
                      <abbr title={shortDate(c.day)}>{c.day === home.today ? 'Today' : weekdayShort(c.day).slice(0, 2)}</abbr>
                    </th>
                  ))}
                </tr>
              </thead>
              {history.map((row) => (
                <tbody key={row.med.id}>
                  <tr>
                    <th scope="rowgroup" colSpan={row.cells.length} className={s.histMed}>
                      {row.med.name}
                    </th>
                  </tr>
                  <tr>
                    {row.cells.map((c) => (
                      <td key={c.day}>
                        <span
                          className={`${s.cell} ${s[`cell_${c.state}`]}`}
                          title={`${shortDate(c.day)}: ${CELL_TEXT[c.state]}${c.taken ? ` (${c.taken})` : ''}`}
                        >
                          {c.state === 'taken' && <Icon name="check" size={14} />}
                          {c.state === 'some' && c.taken}
                          {c.state === 'none' && c.taken === 0 && '–'}
                          <span className={ui.srOnly}>
                            {shortDate(c.day)}: {CELL_TEXT[c.state]}
                            {c.taken ? `, ${c.taken} marked` : ''}
                          </span>
                        </span>
                      </td>
                    ))}
                  </tr>
                </tbody>
              ))}
            </table>
            <p className={s.legend} aria-hidden="true">
              <span className={`${s.cell} ${s.cell_taken}`}>
                <Icon name="check" size={12} />
              </span>
              Taken
              <span className={`${s.cell} ${s.cell_some}`}>1</span>
              Some
              <span className={`${s.cell} ${s.cell_missed}`} />
              Missed
              <span className={`${s.cell} ${s.cell_pending}`} />
              Still to do
            </p>
          </div>
          <p className={`${ui.note} ${s.afterNote}`}>
            {past.source === 'server'
              ? 'Based on the doses you marked in the app.'
              : 'Showing doses marked on this phone. Earlier days will appear when you are back online.'}{' '}
            Forgot to mark one? That's okay, just keep going today.
          </p>
        </>
      )}
    </div>
  );
}
