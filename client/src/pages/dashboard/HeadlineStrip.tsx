import type { CSSProperties } from 'react';
import type { HeadlineMetric, PatientSummary } from '@shared/types';
import { Sparkline } from '../../components/charts';
import { Icon, InfoTip, StatusIcon, TrendIndicator } from '../../components/ui';
import type { SpecialtyPreset } from '../../config/specialties';
import type { ResolvedMetric } from '../../lib/prefs';
import { STATUS_LABEL } from '../../lib/format';
import { useDragReorder } from '../../lib/useDragReorder';
import s from './Dashboard.module.css';
import e from './LayoutEditor.module.css';

interface Props {
  summary: PatientSummary;
  preset: SpecialtyPreset;
  items: ResolvedMetric[];
  fellBack?: boolean;
  editing?: boolean;
  onMove?: (from: number, to: number) => void;
  onToggle?: (index: number) => void;
}

/** The 30-second read: the few numbers a clinician needs before walking in. */
export function HeadlineStrip({ summary, preset, items, fellBack, editing, onMove, onToggle }: Props) {
  const dnd = useDragReorder((from, to) => onMove?.(from, to));
  const shown = editing ? items : items.filter((i) => i.visible);
  if (shown.length === 0) return null;
  const cols = shown.length <= 6 ? shown.length : Math.ceil(shown.length / 2);
  return (
    <section className={s.strip} aria-labelledby="headline-title">
      <h2 id="headline-title" className="sr-only">
        Key numbers, {summary.window.label.toLowerCase()}
      </h2>
      {fellBack && !editing ? (
        <p className={s.stripNote}>
          None of the {preset.label.toLowerCase()} measures apply to this patient’s trackers; showing the overview numbers instead.
        </p>
      ) : null}
      <ul className={s.metrics} style={{ '--cols': cols } as CSSProperties}>
        {shown.map((item, i) =>
          editing ? (
            <li
              key={item.metric.id}
              className={`${s.metricEdit} ${item.visible ? '' : s.metricHidden} ${dnd.indicator(i) ? e[`drop_${dnd.indicator(i)}`] : ''} ${e.axisX}`}
              data-testid={`metric-edit-${item.metric.id}`}
              {...dnd.itemProps(i, 'x')}
            >
              <div className={`${s.metricTools} no-print`}>
                <span className={e.handle} aria-hidden="true" title="Drag to reorder">
                  <Icon name="grip" size={16} strokeWidth={3} />
                </span>
                <button
                  type="button"
                  className={e.tool}
                  aria-label={`Move ${item.metric.label} earlier`}
                  data-focus-key={`metric-${item.metric.id}:up`}
                  disabled={i === 0}
                  onClick={() => onMove?.(i, i - 1)}
                >
                  <Icon name="arrowLeft" size={14} />
                </button>
                <button
                  type="button"
                  className={e.tool}
                  aria-label={`Move ${item.metric.label} later`}
                  data-focus-key={`metric-${item.metric.id}:down`}
                  disabled={i === shown.length - 1}
                  onClick={() => onMove?.(i, i + 1)}
                >
                  <Icon name="arrowRight" size={14} />
                </button>
                <button type="button" className={e.tool} aria-pressed={!item.visible} aria-label={`Hide ${item.metric.label}`} onClick={() => onToggle?.(i)}>
                  <Icon name={item.visible ? 'eye' : 'eyeOff'} size={14} />
                </button>
              </div>
              <div inert className={e.content}>
                <MetricBody metric={item.metric} />
              </div>
            </li>
          ) : (
            <li key={item.metric.id} className={`${s.metric} ${s[`metric_${item.metric.status}`]}`} data-testid={`metric-${item.metric.id}`}>
              <MetricBody metric={item.metric} />
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function MetricBody({ metric: m }: { metric: HeadlineMetric }) {
  const hasSpark = !!m.sparkline && m.sparkline.some((p) => p.value !== null);
  return (
    <>
      <div className={s.metricTop}>
        <span className={s.metricLabel}>{m.label}</span>
        <InfoTip label={`How ${m.label.toLowerCase()} is calculated`}>{m.method}</InfoTip>
      </div>
      <div className={s.metricValueRow}>
        <span className={`${s.metricValue} num`}>{m.value}</span>
        <span className={s.metricStatus}>
          <StatusIcon status={m.status} size={16} />
          <span>{STATUS_LABEL[m.status]}</span>
        </span>
      </div>
      {m.detail ? <p className={s.metricDetail}>{m.detail}</p> : null}
      <div className={s.metricFoot}>
        <TrendIndicator trend={m.trend} />
        {hasSpark ? (
          <span className={s.metricSpark}>
            <Sparkline points={m.sparkline!} status={m.status} width={96} height={24} ariaLabel={`${m.label}, daily values over the period`} />
          </span>
        ) : null}
      </div>
    </>
  );
}
