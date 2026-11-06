import { useId, useState, type KeyboardEvent } from 'react';
import type { PatientSummary, SpirometrySession } from '@shared/types';
import { SpirometryTrendChart, type SpirometryMetric } from '../../components/charts';
import { Icon, Panel, StatusBadge, StatusIcon, TrendIndicator, ZoneBadge } from '../../components/ui';
import { formatDate, formatTime, plural } from '../../lib/format';
import s from './Dashboard.module.css';

const METRICS: { value: SpirometryMetric; label: string; help: string }[] = [
  { value: 'pctPersonalBest', label: '% personal best', help: 'Peak flow as a percentage of personal best, with action-plan zones' },
  { value: 'pef', label: 'Peak flow', help: 'Peak expiratory flow, litres per minute' },
  { value: 'fev1', label: 'FEV1', help: 'Air blown out in the first second, litres' },
  { value: 'fvc', label: 'FVC', help: 'Total air blown out, litres' },
  { value: 'ratio', label: 'FEV1/FVC', help: 'FEV1 as a percentage of FVC' },
];

interface Props {
  summary: PatientSummary;
  span: 1 | 2;
  onSelectDay: (d: string) => void;
}

export function LungFunctionPanel({ summary, span, onSelectDay }: Props) {
  const sp = summary.spirometry!;
  const [metric, setMetric] = useState<SpirometryMetric>(sp.personalBestPefLpm ? 'pctPersonalBest' : 'pef');
  const tabsId = useId();
  const latest = sp.latest;

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (i + (e.key === 'ArrowRight' ? 1 : METRICS.length - 1)) % METRICS.length;
    setMetric(METRICS[next].value);
    document.getElementById(`${tabsId}-tab-${METRICS[next].value}`)?.focus();
  };

  return (
    <Panel
      id="lung-function"
      title="Is lung function changing?"
      icon={<Icon name="lungs" />}
      span={span}
      subtitle={`${sp.deviceName}, ${plural(sp.sessionsInWindow, 'session')} in this period`}
    >
      <div className={s.lungGrid}>
        <div className={s.lungChart}>
          <div role="tablist" aria-label="Spirometry measure" className={`${s.tabs} no-print`}>
            {METRICS.map((m, i) => (
              <button
                key={m.value}
                id={`${tabsId}-tab-${m.value}`}
                role="tab"
                type="button"
                aria-selected={metric === m.value}
                aria-controls={`${tabsId}-panel`}
                tabIndex={metric === m.value ? 0 : -1}
                title={m.help}
                className={`${s.tab} ${metric === m.value ? s.tabOn : ''}`}
                onClick={() => setMetric(m.value)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-tab-${metric}`}>
            <SpirometryTrendChart
              spirometry={sp}
              metric={metric}
              showZoneBands={metric === 'pef' || metric === 'pctPersonalBest'}
              windowStart={summary.window.start}
              windowEnd={summary.window.end}
              onSelectDay={onSelectDay}
              height={220}
            />
          </div>
          <dl className={s.lungFacts}>
            <div>
              <dt>Personal best</dt>
              <dd>
                {sp.personalBestPefLpm ? (
                  <>
                    <span className="num">{sp.personalBestPefLpm} L/min</span>
                    <span className={s.muted}> {sp.personalBestSource === 'action plan' ? 'from the action plan' : 'highest reliable reading'}</span>
                  </>
                ) : (
                  'Not set'
                )}
              </dd>
            </div>
            <div>
              <dt>Blow quality</dt>
              <dd>
                {sp.qualityPct === null ? '—' : <span className="num">{sp.qualityPct}% acceptable</span>}
              </dd>
            </div>
            <div>
              <dt>Peak flow trend</dt>
              <dd>{sp.pefTrend && sp.pefTrend.direction !== 'unknown' ? <TrendIndicator trend={sp.pefTrend} /> : '—'}</dd>
            </div>
            <div>
              <dt>FEV1 trend</dt>
              <dd>{sp.fev1Trend && sp.fev1Trend.direction !== 'unknown' ? <TrendIndicator trend={sp.fev1Trend} /> : '—'}</dd>
            </div>
          </dl>
        </div>

        {latest ? <LatestSession session={latest} personalBest={sp.personalBestPefLpm} inWindow={latest.date >= summary.window.start} /> : null}
      </div>

      {sp.sessions.length ? (
        <details className={s.details}>
          <summary>All {plural(sp.sessions.length, 'session')} in this period</summary>
          <div className={s.tableScroll}>
            <table className={s.dataTable}>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col" className={s.r}>Peak flow</th>
                  <th scope="col" className={s.r}>% best</th>
                  <th scope="col" className={s.r}>FEV1</th>
                  <th scope="col" className={s.r}>FVC</th>
                  <th scope="col" className={s.r}>FEV1/FVC</th>
                  <th scope="col">Acceptable blows</th>
                </tr>
              </thead>
              <tbody>
                {[...sp.sessions].reverse().map((x) => (
                  <tr key={x.date} className={!x.reliable ? s.lowConf : undefined}>
                    <td>
                      <button type="button" className={s.linkBtn} onClick={() => onSelectDay(x.date)}>
                        {formatDate(x.date)}
                      </button>
                    </td>
                    <td className={`${s.r} num`}>{x.bestPefLpm} L/min</td>
                    <td className={`${s.r} num`}>{x.pctPersonalBest !== undefined ? `${x.pctPersonalBest}%` : '—'}</td>
                    <td className={`${s.r} num`}>{x.bestFev1L.toFixed(2)} L</td>
                    <td className={`${s.r} num`}>{x.bestFvcL.toFixed(2)} L</td>
                    <td className={`${s.r} num`}>{x.ratioPct}%</td>
                    <td className="num">
                      {x.acceptableBlows} of {x.totalBlows}
                      {!x.reliable ? <span className={s.lowConfTag}> low confidence</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </Panel>
  );
}

export function LatestSession({ session: x, personalBest, inWindow }: { session: SpirometrySession; personalBest?: number; inWindow: boolean }) {
  const coaching = [...new Set(x.blows.flatMap((b) => b.coaching))];
  return (
    <article className={s.latest} aria-labelledby="latest-session-title">
      <header className={s.latestHead}>
        <h3 id="latest-session-title" className={s.subTitle}>
          Latest session
        </h3>
        <span className={s.muted}>
          {formatDate(x.date)}
          {!inWindow ? ' (before this period)' : ''}
        </span>
      </header>
      <div className={s.latestZone}>
        {x.pctPersonalBest !== undefined ? (
          <span className={`${s.latestPct} num`}>
            {x.pctPersonalBest}%<span className={s.latestPctLabel}> of personal best</span>
          </span>
        ) : null}
        {x.zone ? <ZoneBadge zone={x.zone} /> : null}
      </div>
      <dl className={s.latestValues}>
        <div>
          <dt>Peak flow</dt>
          <dd className="num">{x.bestPefLpm} L/min</dd>
        </div>
        <div>
          <dt>FEV1</dt>
          <dd className="num">{x.bestFev1L.toFixed(2)} L</dd>
        </div>
        <div>
          <dt>FVC</dt>
          <dd className="num">{x.bestFvcL.toFixed(2)} L</dd>
        </div>
        <div>
          <dt>FEV1/FVC</dt>
          <dd className="num">{x.ratioPct}%</dd>
        </div>
      </dl>
      <p className={s.blowLine}>
        <StatusIcon status={x.reliable ? (x.acceptableBlows >= 3 ? 'good' : 'watch') : 'concern'} size={15} />
        {x.acceptableBlows} of {x.totalBlows} blows acceptable
        {!x.reliable ? ', values shown are low confidence' : ''}
      </p>
      {personalBest ? null : <StatusBadge status="unknown" label="No personal best on file" />}
      {coaching.length ? (
        <div className={s.coaching}>
          <p className={s.coachingTitle}>Device coaching given</p>
          <ul>
            {coaching.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <details className={s.details}>
        <summary>Each blow ({x.totalBlows})</summary>
        <div className={s.tableScroll}>
          <table className={s.dataTable}>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Quality</th>
                <th scope="col" className={s.r}>PEF</th>
                <th scope="col" className={s.r}>FEV1</th>
                <th scope="col" className={s.r}>FVC</th>
              </tr>
            </thead>
            <tbody>
              {x.blows.map((b, i) => (
                <tr key={`${b.time}-${i}`}>
                  <td className="num">{formatTime(b.time)}</td>
                  <td>
                    <span className={b.accepted ? s.fg_good : s.fg_watch}>{b.qualityLabel}</span>
                    {b.coaching.length ? <div className={s.muted}>{b.coaching.join('; ')}</div> : null}
                  </td>
                  <td className={`${s.r} num`}>{b.pefLpm}</td>
                  <td className={`${s.r} num`}>{b.fev1L.toFixed(2)}</td>
                  <td className={`${s.r} num`}>{b.fvcL.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={s.muted}>PEF in L/min; FEV1 and FVC in litres.</p>
      </details>
    </article>
  );
}
