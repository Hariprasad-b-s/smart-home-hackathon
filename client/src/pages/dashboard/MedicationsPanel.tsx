import { useState } from 'react';
import type { AsNeededMedicationSummary, PatientSummary, ScheduledMedicationSummary } from '@shared/types';
import { AdherenceStrip, AsNeededBars } from '../../components/charts';
import { Chip, Icon, Panel, StatusBadge, TrendIndicator } from '../../components/ui';
import { conditionLabel, formatDate, formatShortDate, pct, plural } from '../../lib/format';
import s from './Dashboard.module.css';

interface Props {
  summary: PatientSummary;
  span: 1 | 2;
  onSelectDay: (d: string) => void;
  conditionFilter: (c?: string) => boolean;
}

const ROLE_LABEL: Record<string, string> = {
  controller: 'Controller',
  preventive: 'Preventive',
  maintenance: 'Maintenance',
  rescue: 'Rescue',
  abortive: 'Abortive',
  asNeeded: 'As needed',
};

export function MedicationsPanel({ summary, span, onSelectDay, conditionFilter }: Props) {
  const [showAll, setShowAll] = useState(false);
  const { scheduled, asNeeded, notes, overallAdherencePct } = summary.medications;
  const keep = <T extends { condition?: string }>(m: T) => showAll || conditionFilter(m.condition);
  const sched = scheduled.filter(keep);
  const prn = asNeeded.filter(keep);
  const hidden = scheduled.length + asNeeded.length - sched.length - prn.length;

  return (
    <Panel
      id="medications"
      title="Is the medicine being taken?"
      icon={<Icon name="pill" />}
      span={span}
      subtitle={overallAdherencePct !== null ? `${pct(overallAdherencePct)} of scheduled doses marked taken overall` : undefined}
    >
      <div className={s.medList}>
        {sched.map((m) => (
          <ScheduledCard key={m.key} med={m} onSelectDay={onSelectDay} />
        ))}
        {prn.map((m) => (
          <AsNeededCard key={m.key} med={m} onSelectDay={onSelectDay} />
        ))}
      </div>
      {hidden > 0 || showAll ? (
        <button type="button" className={`${s.linkBtn} no-print`} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show only medicines for this view' : `Show ${plural(hidden, 'medicine')} for other conditions`}
        </button>
      ) : null}
      {notes.length ? (
        <ul className={s.finePrint}>
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function ScheduledCard({ med: m, onSelectDay }: { med: ScheduledMedicationSummary; onSelectDay: (d: string) => void }) {
  return (
    <article className={s.med} aria-labelledby={`med-${m.key}`} data-testid="med-scheduled">
      <header className={s.medHead}>
        <div>
          <h3 id={`med-${m.key}`} className={s.medName}>
            <Icon name={m.icon === 'inhaler' ? 'inhaler' : 'pill'} size={16} /> {m.name}
          </h3>
          <p className={s.medRegimen}>{m.regimen}</p>
        </div>
        <div className={s.medChips}>
          <Chip tone="purple">{ROLE_LABEL[m.role] ?? m.role}</Chip>
          {m.condition ? <Chip>{conditionLabel(m.condition)}</Chip> : null}
        </div>
      </header>
      <div className={s.medStats}>
        <div className={s.medBig}>
          {m.adherencePct === null ? (
            <>
              <span className={`${s.medBigValue} num`}>No data</span>
              <span className={s.medBigLabel}>no app activity to measure doses in this period</span>
            </>
          ) : (
            <>
              <span className={`${s.medBigValue} num`}>{pct(m.adherencePct)}</span>
              <span className={s.medBigLabel}>
                of doses taken ({m.dosesTaken} of {m.dosesExpected})
              </span>
            </>
          )}
        </div>
        {m.adherencePct === null ? <StatusBadge status="unknown" /> : <StatusBadge status={m.status} />}
        {m.adherencePct === null ? null : <TrendIndicator trend={m.trend} />}
      </div>
      {m.measuredThrough ? (
        <p className={s.measured} data-testid="measured-through">
          <Icon name="clock" size={14} /> Measured through {formatShortDate(m.measuredThrough)}: no app activity since
        </p>
      ) : null}
      <dl className={s.medFacts}>
        <div>
          <dt>Every dose taken</dt>
          <dd className="num">{m.fullDosePct === null ? 'No data' : `${pct(m.fullDosePct)} of days`}</dd>
        </div>
        <div>
          <dt>Current streak</dt>
          <dd className="num">{plural(m.currentStreakDays, 'day')}</dd>
        </div>
        <div>
          <dt>Last taken</dt>
          <dd>{m.lastTakenDate ? formatDate(m.lastTakenDate) : 'Not in this period'}</dd>
        </div>
      </dl>
      <AdherenceStrip medication={m} showWeekly onSelectDay={onSelectDay} />
    </article>
  );
}

function AsNeededCard({ med: m, onSelectDay }: { med: AsNeededMedicationSummary; onSelectDay: (d: string) => void }) {
  return (
    <article className={s.med} aria-labelledby={`med-${m.key}`} data-testid="med-asneeded">
      <header className={s.medHead}>
        <div>
          <h3 id={`med-${m.key}`} className={s.medName}>
            <Icon name={m.icon === 'inhaler' ? 'inhaler' : 'pill'} size={16} /> {m.name}
          </h3>
          <p className={s.medRegimen}>{m.regimen}</p>
        </div>
        <div className={s.medChips}>
          <Chip tone="magenta">{ROLE_LABEL[m.role] ?? m.role}</Chip>
          {m.condition ? <Chip>{conditionLabel(m.condition)}</Chip> : null}
        </div>
      </header>
      <div className={s.medStats}>
        <div className={s.medBig}>
          <span className={`${s.medBigValue} num`}>{m.perWeek}</span>
          <span className={s.medBigLabel}>uses a week</span>
        </div>
        <StatusBadge status={m.status} />
        <TrendIndicator trend={m.trend} />
      </div>
      <dl className={s.medFacts}>
        <div>
          <dt>Total uses</dt>
          <dd className="num">{m.totalUses}</dd>
        </div>
        <div>
          <dt>Days used</dt>
          <dd className="num">{m.daysUsed}</dd>
        </div>
        <div>
          <dt>Last used</dt>
          <dd>{m.lastUsedDate ? formatDate(m.lastUsedDate) : 'Not in this period'}</dd>
        </div>
      </dl>
      <AsNeededBars medication={m} onSelectDay={onSelectDay} />
    </article>
  );
}
