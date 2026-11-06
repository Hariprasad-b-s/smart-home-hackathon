import type { QuestionRole, QuestionType, TrackerDefinition } from '@shared/types';
import { fetchTrackers, useApi } from '../api';
import { Chip, ErrorState, Icon, LoadingState } from '../components/ui';
import s from './ListPages.module.css';

const TYPE_LABEL: Record<QuestionType, string> = {
  yesNo: 'Yes / no',
  number: 'Number',
  faceScale: 'Face scale',
  iconChoice: 'Icon choice',
  checkbox: 'Checkboxes',
  singleChoice: 'Single choice',
  scale1to10: '1–10 scale',
  spirometry: 'Spirometer',
  text: 'Free text',
};

const ROLE_LABEL: Record<QuestionRole, string> = {
  overallFeeling: 'Overall feeling',
  symptoms: 'Symptoms',
  symptomSeverity: 'Symptom severity',
  spirometry: 'Spirometry',
  missedSchool: 'Missed school',
  nightWaking: 'Night waking',
  activityLimitation: 'Activity limitation',
  rescueMedUse: 'Rescue med use',
  painSeverity: 'Pain severity',
  headache: 'Headache',
  headacheDurationHours: 'Headache hours',
  stoolFrequency: 'Stool frequency',
  bloodInStool: 'Blood in stool',
  triggers: 'Triggers',
  sleepHours: 'Sleep hours',
  other: 'Other',
};

export function TrackersPage() {
  const { data, error, loading, reload } = useApi((signal) => fetchTrackers(signal), []);
  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>Trackers</h1>
        <p className={s.lede}>
          Each question carries a <strong>type</strong>, which decides how it is charted, and an optional <strong>role</strong>, picked by the
          care team in the tracker builder. Roles are what let the clinician view count symptom days, hard days or missed school for any
          condition, without custom code. Untagged questions still get a chart chosen by their type.
        </p>
      </header>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <LoadingState label="Loading trackers…" /> : null}
      {data?.map((t) => <TrackerCard key={t.id} tracker={t} />)}
    </div>
  );
}

function TrackerCard({ tracker }: { tracker: TrackerDefinition }) {
  const tagged = tracker.questions.filter((q) => q.role && q.role !== 'other').length;
  const qs = [...tracker.questions].sort((a, b) => a.order - b.order);
  return (
    <section className={s.card} aria-labelledby={`t-${tracker.id}`}>
      <header className={s.cardHead}>
        <span className={s.cardIcon}>
          <Icon name="clipboard" />
        </span>
        <div>
          <h2 id={`t-${tracker.id}`} className={s.cardTitle}>
            {tracker.name}
          </h2>
          <p className={s.cardMeta}>
            <Chip tone="accent">{tracker.conditionLabel}</Chip> Version {tracker.version}, {tracker.questions.length} questions, {tagged} with a role
          </p>
        </div>
      </header>
      <div className={s.tableScroll}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">Question</th>
              <th scope="col">Short label</th>
              <th scope="col">Type</th>
              <th scope="col">Role</th>
              <th scope="col">Answers</th>
            </tr>
          </thead>
          <tbody>
            {qs.map((q) => (
              <tr key={q.id}>
                <td>{q.text}</td>
                <td className={s.nowrap}>{q.shortLabel}</td>
                <td>
                  <Chip>{TYPE_LABEL[q.type] ?? q.type}</Chip>
                </td>
                <td>{q.role ? <Chip tone={q.role === 'other' ? 'muted' : 'purple'}>{ROLE_LABEL[q.role] ?? q.role}</Chip> : <span className={s.muted}>Untagged</span>}</td>
                <td className={s.small}>
                  {q.options?.length
                    ? q.options.map((o) => o.label).join(', ')
                    : q.min !== undefined || q.max !== undefined
                      ? `${q.min ?? ''}–${q.max ?? ''}${q.unit ? ' ' + q.unit : ''}${q.concernThreshold !== undefined ? `, concern at ${q.direction === 'higherIsBetter' ? '<' : '≥'} ${q.concernThreshold}` : ''}`
                      : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
