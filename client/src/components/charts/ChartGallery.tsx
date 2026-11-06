/**
 * Dev-only page (/dev/charts): every chart in several states — rich asthma data, sparse 90-day
 * data, an empty window, and a non-asthma (migraine) tracker — using synthetic fixtures.
 * Clicking any day selects it across all charts so linked highlighting can be checked.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  AdherenceStrip,
  AsNeededBars,
  CalendarHeatmap,
  DailyTimeline,
  QuestionWidget,
  Sparkline,
  SpirometryTrendChart,
  ZoneDistributionBar,
  type CalendarColorBy,
  type SpirometryMetric,
} from './index';
import { makeAsthmaFixture, makeEmptyFixture, makeMigraineFixture, type ChartFixture } from './__fixtures__/fixtures';
import '../../styles/tokens.css';
import s from './ChartGallery.module.css';

type FixtureKey = 'rich' | 'sparse' | 'empty' | 'migraine';

const FIXTURE_LABELS: Record<FixtureKey, string> = {
  rich: 'Asthma · 30 d · rich',
  sparse: 'Asthma · 90 d · sparse',
  empty: 'No entries',
  migraine: 'Migraine (non-asthma)',
};

export default function ChartGallery() {
  const fixtures = useMemo<Record<FixtureKey, ChartFixture>>(
    () => ({
      rich: makeAsthmaFixture({ days: 30, density: 'rich' }),
      sparse: makeAsthmaFixture({ days: 90, density: 'sparse', seed: 11 }),
      empty: makeEmptyFixture({ days: 30 }),
      migraine: makeMigraineFixture({ days: 30 }),
    }),
    [],
  );
  const [key, setKey] = useState<FixtureKey>('rich');
  const [selected, setSelected] = useState<string | undefined>();
  const [colorBy, setColorBy] = useState<CalendarColorBy>('zone');
  const [metric, setMetric] = useState<SpirometryMetric>('pctPersonalBest');
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');
  const fx = fixtures[key];
  const isMigraine = key === 'migraine';
  const highlight = useMemo(() => fx.days.filter((d) => d.discordant).map((d) => d.date), [fx]);

  const applyTheme = (t: 'auto' | 'light' | 'dark') => {
    setTheme(t);
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  };

  const sched = fx.scheduled[0];
  const asNeeded = fx.asNeeded[0];
  const rows = isMigraine
    ? (['symptoms', 'scheduledDoses', 'asNeeded'] as const)
    : (['feeling', 'symptoms', 'scheduledDoses', 'asNeeded', 'peakFlow', 'zone'] as const);

  return (
    <div className={s.page}>
      <header className={s.header}>
        <h1>Chart gallery</h1>
        <p>Synthetic fixtures only. Click any day to select it across charts{selected ? ` · selected ${selected}` : ''}.</p>
        <div className={s.controls}>
          <Seg label="Data" value={key} options={Object.keys(FIXTURE_LABELS) as FixtureKey[]} render={(k) => FIXTURE_LABELS[k]} onChange={(k) => { setKey(k); setSelected(undefined); }} />
          <Seg label="Calendar" value={colorBy} options={['zone', 'hardDay', 'symptomDay', 'feeling', 'adherence']} onChange={setColorBy} />
          <Seg label="Spirometry" value={metric} options={['pctPersonalBest', 'pef', 'fev1', 'fvc', 'ratio']} onChange={setMetric} />
          <Seg label="Theme" value={theme} options={['auto', 'light', 'dark']} onChange={applyTheme} />
        </div>
      </header>

      <div className={s.grid}>
        <Card title="Calendar · compact" span>
          <CalendarHeatmap days={fx.days} colorBy={colorBy} selectedDate={selected} onSelectDay={setSelected} highlightDates={highlight} showMarkers />
        </Card>
        <Card title="Calendar · visit mode (large, hard days)" span>
          <CalendarHeatmap days={fx.days.slice(-31)} colorBy="hardDay" size="large" selectedDate={selected} onSelectDay={setSelected} showMarkers />
        </Card>
        <Card title="Daily timeline (context view)" span>
          <DailyTimeline
            days={fx.days}
            rows={[...rows]}
            spirometry={fx.spirometry}
            selectedDate={selected}
            onSelectDay={setSelected}
            highlightDates={highlight}
            rowLabels={isMigraine ? { symptoms: 'Headache symptoms', scheduledDoses: 'Topiramate', asNeeded: 'Excedrin uses' } : undefined}
          />
        </Card>
        {sched && (
          <Card title={`${sched.name} · ${sched.regimen} · ${sched.adherencePct ?? '—'}%`}>
            <AdherenceStrip medication={sched} onSelectDay={setSelected} />
          </Card>
        )}
        {asNeeded && (
          <Card title={`${asNeeded.name} · ${asNeeded.perWeek} days/wk`}>
            <AsNeededBars medication={asNeeded} onSelectDay={setSelected} />
          </Card>
        )}
        {fx.spirometry ? (
          <Card title="Spirometry trend" span>
            <SpirometryTrendChart
              spirometry={fx.spirometry}
              metric={metric}
              showZoneBands
              windowStart={fx.window.start}
              windowEnd={fx.window.end}
              onSelectDay={setSelected}
            />
          </Card>
        ) : (
          <Card title="Spirometry trend">
            <p className={s.note}>This tracker has no spirometer (chart not shown).</p>
          </Card>
        )}
        {fx.zoneDays && (
          <Card title="Zone distribution">
            <ZoneDistributionBar zoneDays={fx.zoneDays} />
            <div className={s.spacer} />
            <ZoneDistributionBar zoneDays={{ green: 0, yellow: 0, red: 0, unknown: 0 }} />
          </Card>
        )}
        <Card title="Sparklines">
          <div className={s.sparkRow}>
            <span>Controller %</span>
            <Sparkline
              points={(sched?.weekly ?? []).map((w) => ({ date: w.weekStart, value: w.pct }))}
              status={sched?.status ?? 'neutral'}
              width={120}
              ariaLabel="Weekly controller adherence"
            />
          </div>
          <div className={s.sparkRow}>
            <span>PEF % best</span>
            <Sparkline
              points={fx.days.map((d) => ({ date: d.date, value: d.spirometry?.pctPersonalBest ?? null }))}
              status="watch"
              width={120}
              ariaLabel="Peak flow percent of personal best, daily"
            />
          </div>
          <div className={s.sparkRow}>
            <span>Symptoms/day (fluid)</span>
            <Sparkline points={fx.days.map((d) => ({ date: d.date, value: d.hasData ? d.symptoms.length : null }))} status="concern" ariaLabel="Symptoms per day" />
          </div>
          <div className={s.sparkRow}>
            <span>Empty</span>
            <Sparkline points={[]} width={120} ariaLabel="No data" />
          </div>
        </Card>
        {fx.questions.map((q) => (
          <Card key={q.questionId} title={`QuestionWidget · ${q.kind}`}>
            <QuestionWidget question={q} onSelectDay={setSelected} />
          </Card>
        ))}
        {fx.questions.slice(0, 3).map((q) => (
          <Card key={`c-${q.questionId}`} title={`QuestionWidget · ${q.kind} · compact`}>
            <QuestionWidget question={q} compact onSelectDay={setSelected} />
          </Card>
        ))}
        <Card title="Empty states" span>
          <div className={s.emptyGrid}>
            <CalendarHeatmap days={[]} colorBy="zone" />
            <DailyTimeline days={[]} rows={['feeling']} />
            <AdherenceStrip medication={{ ...fixtures.rich.scheduled[0], daily: [], weekly: [] }} />
            <AsNeededBars medication={{ ...fixtures.rich.asNeeded[0], daily: [] }} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children, span }: { title: string; children: ReactNode; span?: boolean }) {
  return (
    <section className={`${s.card} ${span ? s.span : ''}`}>
      <h2 className={s.cardTitle}>{title}</h2>
      {children}
    </section>
  );
}

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
  render,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (v: T) => void;
  render?: (v: T) => string;
}) {
  return (
    <div className={s.seg} role="radiogroup" aria-label={label}>
      <span className={s.segLabel}>{label}</span>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={o === value} className={`${s.segBtn} ${o === value ? s.segOn : ''}`} onClick={() => onChange(o)}>
          {render ? render(o) : o}
        </button>
      ))}
    </div>
  );
}
