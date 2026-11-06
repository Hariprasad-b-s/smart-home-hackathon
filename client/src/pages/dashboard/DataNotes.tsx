import type { PatientSummary } from '@shared/types';
import { Icon } from '../../components/ui';
import { formatDate } from '../../lib/format';
import s from './Dashboard.module.css';

export function DataNotes({ summary }: { summary: PatientSummary }) {
  return (
    <footer className={s.notes} aria-labelledby="data-notes-title">
      <h2 id="data-notes-title" className={s.notesTitle}>
        <Icon name="database" size={16} /> About this data
      </h2>
      <ul className={s.notesList}>
        {summary.dataQuality.map((n) => (
          <li key={n.id} className={n.level === 'warning' ? s.noteWarn : undefined}>
            <Icon name={n.level === 'warning' ? 'alertTriangle' : 'info'} size={14} />
            <span>
              {n.level === 'warning' ? <span className="sr-only">Warning: </span> : null}
              {n.text}
            </span>
          </li>
        ))}
        <li>
          <Icon name="info" size={14} />
          <span>
            Doses and answers are the patient’s own reports from the SMART@Home app. Data flow one way from the app; nothing here is written to
            the medical record.
          </span>
        </li>
      </ul>
      <p className={s.synthetic}>
        Synthetic demo data. No real patient information. Summary as of {formatDate(summary.today)}, covering{' '}
        {formatDate(summary.window.start)} – {formatDate(summary.window.end)}.
      </p>
    </footer>
  );
}
