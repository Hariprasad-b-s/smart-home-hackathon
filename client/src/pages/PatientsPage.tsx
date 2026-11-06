import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { PatientListItem } from '@shared/types';
import { fetchPatients, useApi } from '../api';
import { Avatar, Chip, EmptyState, ErrorState, Icon, LoadingState, StatusBadge, StatusIcon, ZoneBadge } from '../components/ui';
import { formatDate, formatDaysAgo, pct } from '../lib/format';
import { conditionOptions, filterAndSortPatients, needsAttention, type TriageSort } from '../lib/triage';
import { isOpenStatus, useNotifications } from '../state/NotificationsContext';
import s from './PatientsPage.module.css';

const SORTS: { value: TriageSort; label: string }[] = [
  { value: 'attention', label: 'Needs attention' },
  { value: 'lastActivity', label: 'Longest since activity' },
  { value: 'adherence', label: 'Lowest adherence' },
  { value: 'symptoms', label: 'Most symptom days' },
  { value: 'name', label: 'Name' },
];

export function PatientsPage() {
  const { data, error, loading, reload } = useApi((signal) => fetchPatients(signal), []);
  return (
    <div className={s.page}>
      <div className={s.head}>
        <h1 className={s.title}>Patients</h1>
        <p className={s.lede}>Sorted so the people who need a look before their visit come first.</p>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <LoadingState label="Loading patients…" /> : data ? <PatientTriage patients={data.patients} today={data.today} /> : null}
    </div>
  );
}

export function PatientTriage({ patients, today }: { patients: PatientListItem[]; today?: string }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { inbox } = useNotifications();
  const messageFor = (patientId: string) => inbox.find((i) => i.patientId === patientId && isOpenStatus(i.status) && (i.unread > 0 || i.status === 'waiting'));
  const query = params.get('q') ?? '';
  const condition = params.get('condition') ?? '';
  const sortParam = params.get('sort');
  const sort: TriageSort = SORTS.some((o) => o.value === sortParam) ? (sortParam as TriageSort) : 'attention';

  const setParam = (key: string, value: string, fallback = '') => {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const rows = useMemo(() => filterAndSortPatients(patients, { query, condition, sort }), [patients, query, condition, sort]);
  const conds = useMemo(() => conditionOptions(patients), [patients]);
  const attention = patients.filter(needsAttention);
  const stale = patients.filter((p) => p.freshnessStatus === 'concern').length;
  const lowAdh = patients.filter((p) => p.adherenceStatus === 'concern').length;
  const zoneAlert = patients.filter((p) => p.currentZone === 'yellow' || p.currentZone === 'red').length;

  return (
    <>
      <section className={s.summary} aria-label="Panel summary">
        <p className={s.summaryLead}>
          <strong className={s.summaryCount}>{attention.length}</strong>{' '}
          {attention.length === 1 ? 'patient needs' : 'patients need'} attention
          <span className={s.summaryOf}> of {patients.length}</span>
        </p>
        <ul className={s.summaryFacts}>
          <li>
            <StatusIcon status={stale ? 'concern' : 'good'} /> {stale} with no activity for over a week
          </li>
          <li>
            <StatusIcon status={lowAdh ? 'concern' : 'good'} /> {lowAdh} below 50% adherence
          </li>
          <li>
            <StatusIcon status={zoneAlert ? 'watch' : 'good'} /> {zoneAlert} in yellow or red zone
          </li>
          {today ? <li className={s.asOf}>Data as of {formatDate(today)}</li> : null}
        </ul>
      </section>

      <div className={s.controls} role="search">
        <label className={s.search}>
          <Icon name="search" size={16} />
          <span className="sr-only">Search patients</span>
          <input
            className="input"
            type="search"
            placeholder="Search name, MRN, condition or study"
            value={query}
            onChange={(e) => setParam('q', e.target.value)}
          />
        </label>
        <label className={s.field}>
          <span>Condition</span>
          <select className="select" value={condition} onChange={(e) => setParam('condition', e.target.value)}>
            <option value="">All conditions</option>
            {conds.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className={s.field}>
          <span>Sort by</span>
          <select className="select" value={sort} onChange={(e) => setParam('sort', e.target.value, 'attention')}>
            {SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No patients match"
          action={
            <button type="button" className="btn" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Clear filters
            </button>
          }
        >
          Try a different name, MRN or condition.
        </EmptyState>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <caption className="sr-only">
              Patients, sorted by {SORTS.find((o) => o.value === sort)?.label.toLowerCase()}. Select a row to open the dashboard.
            </caption>
            <thead>
              <tr>
                <th scope="col">Patient</th>
                <th scope="col">Conditions</th>
                <th scope="col">Zone</th>
                <th scope="col" className={s.numCol}>
                  Adherence, 30 d
                </th>
                <th scope="col" className={s.numCol}>
                  Symptom days
                </th>
                <th scope="col">Flags</th>
                <th scope="col">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const go = () => navigate(`/patients/${encodeURIComponent(p.id)}`);
                return (
                  <tr
                    key={p.id}
                    className={`${s.row} ${needsAttention(p) ? s.rowAttention : ''}`}
                    onClick={go}
                    data-testid="patient-row"
                  >
                    <td data-label="Patient">
                      <div className={s.who}>
                        <Avatar initials={p.initials} />
                        <div>
                          <Link
                            to={`/patients/${encodeURIComponent(p.id)}`}
                            className={s.name}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {p.displayName}
                          </Link>
                          {messageFor(p.id) ? (
                            <Link
                              to={`/inbox/${encodeURIComponent(messageFor(p.id)!.conversationId)}`}
                              className={s.msgIcon}
                              aria-label={`${p.displayName} has a conversation waiting`}
                              title="Conversation waiting"
                              onClick={(e) => e.stopPropagation()}
                              data-testid="patient-message-icon"
                            >
                              <Icon name="message" size={14} />
                            </Link>
                          ) : null}
                          <div className={s.meta}>
                            {p.ageYears} y <span aria-hidden="true">/</span> {p.mrn}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Conditions">
                      <div className={s.chips}>
                        {p.trackers.map((t) => (
                          <Chip key={t.id}>{t.conditionLabel}</Chip>
                        ))}
                      </div>
                    </td>
                    <td data-label="Zone">{p.trackers.some((t) => t.condition === 'asthma') ? <ZoneBadge zone={p.currentZone} suffix="" /> : <span className={s.na}>n/a</span>}</td>
                    <td data-label="Adherence, 30 d" className={s.numCol}>
                      <span className={s.adh}>
                        <span className={`num ${s.adhValue}`}>{p.adherencePct30d === null ? 'No data' : pct(p.adherencePct30d)}</span>
                        <StatusIcon status={p.adherenceStatus} size={15} />
                        <span className="sr-only">{p.adherenceStatus}</span>
                      </span>
                    </td>
                    <td data-label="Symptom days" className={`num ${s.numCol}`}>
                      {p.symptomDays30d}
                    </td>
                    <td data-label="Flags">
                      <div className={s.flags}>
                        {p.highFlags > 0 ? <StatusBadge status="concern" label={`${p.highFlags} high`} /> : null}
                        {p.mediumFlags > 0 ? <StatusBadge status="watch" label={`${p.mediumFlags} medium`} /> : null}
                        {p.highFlags + p.mediumFlags === 0 ? <span className={s.na}>None</span> : null}
                      </div>
                      {p.topFlag ? <div className={s.topFlag}>{p.topFlag}</div> : null}
                    </td>
                    <td data-label="Last activity">
                      <span className={`${s.fresh} ${s[`fresh_${p.freshnessStatus}`]}`} title={p.lastActivityDate ? formatDate(p.lastActivityDate) : undefined}>
                        <StatusIcon status={p.freshnessStatus} size={15} />
                        {formatDaysAgo(p.daysSinceLastActivity)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
