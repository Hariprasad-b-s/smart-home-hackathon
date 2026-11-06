import { useState } from 'react';
import type { PatientSummary, TrackerSummary } from '@shared/types';
import { QuestionWidget } from '../../components/charts';
import { Chip, Icon, Panel, StatusBadge } from '../../components/ui';
import { plural } from '../../lib/format';
import s from './Dashboard.module.css';

interface Props {
  summary: PatientSummary;
  span: 1 | 2;
  onSelectDay: (d: string) => void;
  conditionFilter: (c?: string) => boolean;
}

/** Every question of every tracker, rendered generically by type — works for any tracker. */
export function TrackersPanel({ summary, span, onSelectDay, conditionFilter }: Props) {
  const [showAll, setShowAll] = useState(false);
  const shown = summary.trackers.filter((t) => showAll || conditionFilter(t.tracker.condition));
  const hidden = summary.trackers.length - shown.length;
  return (
    <Panel id="trackers" title="Tracker answers" icon={<Icon name="clipboard" />} span={span} subtitle="Each day uses the last non-empty answer; repeat entries are combined.">
      {shown.map((t) => (
        <TrackerBlock key={t.tracker.id} t={t} onSelectDay={onSelectDay} />
      ))}
      {hidden > 0 || showAll ? (
        <button type="button" className={`${s.linkBtn} no-print`} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show only trackers for this view' : `Show ${plural(hidden, 'tracker')} for other conditions`}
        </button>
      ) : null}
    </Panel>
  );
}

function TrackerBlock({ t, onSelectDay }: { t: TrackerSummary; onSelectDay: (d: string) => void }) {
  const status = t.completionPct >= 70 ? 'good' : t.completionPct >= 40 ? 'watch' : 'concern';
  const windowDays = t.questions[0]?.windowDays;
  return (
    <section className={s.tracker} aria-labelledby={`tr-${t.tracker.id}`}>
      <header className={s.trackerHead}>
        <h3 id={`tr-${t.tracker.id}`} className={s.subTitle}>
          {t.tracker.name}
        </h3>
        <Chip tone="accent">{t.tracker.conditionLabel}</Chip>
        <StatusBadge status={status} label={`${t.completionPct}% of days logged`} />
        <span className={s.muted}>
          {t.daysWithSubmission}
          {windowDays ? ` of ${windowDays}` : ''} days, {plural(t.submissions, 'submission')}
          {t.blankSubmissions ? `, ${t.blankSubmissions} blank` : ''}
          {t.collapsedDays ? `, ${plural(t.collapsedDays, 'day')} with repeat entries combined` : ''}
        </span>
      </header>
      <div className={s.questionGrid}>
        {t.questions.map((q) => (
          <div key={q.questionId} className={s.question} data-testid="question">
            <QuestionWidget question={q} onSelectDay={onSelectDay} />
          </div>
        ))}
      </div>
    </section>
  );
}
