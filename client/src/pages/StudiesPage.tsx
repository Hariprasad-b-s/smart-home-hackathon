import { Link } from 'react-router-dom';
import type { PatientListItem } from '@shared/types';
import { fetchPatients, useApi } from '../api';
import { Avatar, Chip, ErrorState, Icon, LoadingState, StatusIcon } from '../components/ui';
import { formatDaysAgo } from '../lib/format';
import { needsAttention } from '../lib/triage';
import s from './ListPages.module.css';

const NO_STUDY = 'Not enrolled in a study';

export function groupByStudy(patients: PatientListItem[]): { study: string; patients: PatientListItem[] }[] {
  const groups = new Map<string, PatientListItem[]>();
  for (const p of patients) {
    const keys = p.studyIds.length ? p.studyIds : [NO_STUDY];
    for (const k of keys) groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups.entries()]
    .map(([study, ps]) => ({ study, patients: [...ps].sort((a, b) => b.attentionScore - a.attentionScore) }))
    .sort((a, b) => (a.study === NO_STUDY ? 1 : b.study === NO_STUDY ? -1 : b.patients.length - a.patients.length));
}

export function StudiesPage() {
  const { data, error, loading, reload } = useApi((signal) => fetchPatients(signal), []);
  return (
    <div className={s.page}>
      <header className={s.head}>
        <h1 className={s.title}>Studies</h1>
        <p className={s.lede}>Patients grouped by the research study they are enrolled in.</p>
      </header>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <LoadingState label="Loading studies…" /> : null}
      {data
        ? groupByStudy(data.patients).map((g) => {
            const attention = g.patients.filter(needsAttention).length;
            const active = g.patients.filter((p) => (p.daysSinceLastActivity ?? 999) <= 7).length;
            const conds = [...new Set(g.patients.flatMap((p) => p.trackers.map((t) => t.conditionLabel)))];
            const isNct = /^NCT\d+$/.test(g.study);
            return (
              <section key={g.study} className={s.card} aria-labelledby={`study-${g.study}`}>
                <header className={s.cardHead}>
                  <span className={s.cardIcon}>
                    <Icon name={g.study === NO_STUDY ? 'users' : 'beaker'} />
                  </span>
                  <div>
                    <h2 id={`study-${g.study}`} className={s.cardTitle}>
                      {isNct ? (
                        <a href={`https://clinicaltrials.gov/study/${g.study}`} target="_blank" rel="noreferrer">
                          {g.study}
                        </a>
                      ) : (
                        g.study
                      )}
                    </h2>
                    <p className={s.cardMeta}>
                      {conds.map((c) => (
                        <Chip key={c}>{c}</Chip>
                      ))}
                    </p>
                  </div>
                  <dl className={s.stats}>
                    <div>
                      <dt>Patients</dt>
                      <dd className="num">{g.patients.length}</dd>
                    </div>
                    <div>
                      <dt>Active this week</dt>
                      <dd className="num">{active}</dd>
                    </div>
                    <div>
                      <dt>Need attention</dt>
                      <dd className="num">{attention}</dd>
                    </div>
                  </dl>
                </header>
                <ul className={s.people}>
                  {g.patients.map((p) => (
                    <li key={p.id}>
                      <Link to={`/patients/${encodeURIComponent(p.id)}`} className={s.person}>
                        <Avatar initials={p.initials} size={28} />
                        <span className={s.personName}>{p.displayName}</span>
                        <span className={s.personMeta}>
                          <StatusIcon status={p.freshnessStatus} size={14} /> {formatDaysAgo(p.daysSinceLastActivity)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        : null}
    </div>
  );
}
