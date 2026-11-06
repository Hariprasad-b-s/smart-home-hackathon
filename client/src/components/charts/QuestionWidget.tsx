/**
 * QuestionWidget — generic renderer for ANY tracker question (asthma, migraine, IBD, …).
 * Dispatches on `question.kind`:
 *   categorical → 100 % stacked distribution bar + per-day strip
 *   multi       → horizontal frequency bars (days with item / answered days) + any-item strip
 *   numeric     → line/dot chart with concern threshold + stats row
 *   boolean     → "N of M days" figure + yes/no day strip
 *   text        → recent answers list
 */
import { useMemo, useState, type PointerEvent, type ReactNode } from 'react';
import type {
  BooleanQuestionSummary,
  CategoricalQuestionSummary,
  MultiSelectQuestionSummary,
  NumericQuestionSummary,
  TextQuestionSummary,
} from '@shared/types';
import type { QuestionWidgetProps } from './types';
import {
  bandScale,
  dateTicks,
  fmtDay,
  fmtDayLong,
  fmtNumber,
  niceTicks,
  plural,
  SERIES_VARS,
  SEVERITY_VAR,
} from './chartUtils';
import {
  ChartTooltip,
  DateAxis,
  EmptyState,
  Legend,
  TooltipRow,
  TooltipTitle,
  useContainerWidth,
  useDayCursor,
  VisuallyHidden,
} from './chartKit';
import { DayStrip, type StripCell } from './DayStrip';
import cs from './charts.module.css';
import s from './QuestionWidget.module.css';

export function QuestionWidget({ question, onSelectDay, compact = false }: QuestionWidgetProps) {
  const q = question;
  let body: ReactNode;
  if (q.answeredDays === 0 && (q.kind !== 'text' || q.recent.length === 0)) {
    body = <EmptyState>No answers in this period</EmptyState>;
  } else {
    switch (q.kind) {
      case 'categorical':
        body = <CategoricalBody q={q} compact={compact} onSelectDay={onSelectDay} />;
        break;
      case 'multi':
        body = <MultiBody q={q} compact={compact} onSelectDay={onSelectDay} />;
        break;
      case 'numeric':
        body = <NumericBody q={q} compact={compact} onSelectDay={onSelectDay} />;
        break;
      case 'boolean':
        body = <BooleanBody q={q} compact={compact} onSelectDay={onSelectDay} />;
        break;
      case 'text':
        body = <TextBody q={q} compact={compact} onSelectDay={onSelectDay} />;
        break;
    }
  }
  return (
    <figure className={`${cs.root} ${s.widget} ${compact ? s.compact : ''}`} data-kind={q.kind} aria-label={`${q.shortLabel}: ${q.text}`} role="group">
      <figcaption className={s.header}>
        <span className={s.title} title={q.text}>
          {q.shortLabel}
        </span>
        <span className={s.answered}>
          answered {q.answeredDays} of {q.windowDays} days
        </span>
        {!compact && q.text !== q.shortLabel && <span className={s.fullText}>{q.text}</span>}
      </figcaption>
      {body}
    </figure>
  );
}

interface BodyProps<T> {
  q: T;
  compact: boolean;
  onSelectDay?: (date: string) => void;
}

// ───────────────────────── categorical ─────────────────────────

const MAX_CATS = 6;

function categoricalColors(q: CategoricalQuestionSummary): Map<string, string> {
  const m = new Map<string, string>();
  const anySeverity = q.distribution.some((d) => d.severity != null);
  q.distribution.forEach((d, i) => {
    if (anySeverity && d.severity != null) m.set(d.label, SEVERITY_VAR[d.severity]);
    else m.set(d.label, i < MAX_CATS - 1 || q.distribution.length <= MAX_CATS ? SERIES_VARS[i] : 'var(--unknown)');
  });
  return m;
}

function CategoricalBody({ q, compact, onSelectDay }: BodyProps<CategoricalQuestionSummary>) {
  const colors = useMemo(() => categoricalColors(q), [q]);
  const [ref, width] = useContainerWidth<HTMLDivElement>(400);
  const [hover, setHover] = useState<{ label: string; x: number } | null>(null);
  const summary = `${q.shortLabel} distribution over ${plural(q.answeredDays, 'answered day')}: ${q.distribution
    .map((d) => `${d.label} ${plural(d.days, 'day')} (${d.pct}%)`)
    .join(', ')}.`;
  const cells: StripCell[] = q.series.map((p) => ({
    date: p.date,
    kind: p.label == null ? 'nodata' : 'fill',
    color: p.label == null ? undefined : (colors.get(p.label) ?? (p.severity != null ? SEVERITY_VAR[p.severity] : 'var(--unknown)')),
  }));
  const hovered = hover ? q.distribution.find((d) => d.label === hover.label) : undefined;
  return (
    <>
      <div ref={ref} className={s.relative}>
        <div className={s.stack} role="img" aria-label={summary}>
          {q.distribution.map((d) => (
            <div
              key={d.label}
              className={s.seg}
              style={{ flexGrow: d.days, background: colors.get(d.label) }}
              data-label={d.label}
              onPointerEnter={(e) => {
                const root = ref.current?.getBoundingClientRect();
                const r = e.currentTarget.getBoundingClientRect();
                setHover({ label: d.label, x: root ? r.left - root.left + r.width / 2 : 0 });
              }}
              onPointerLeave={() => setHover(null)}
            />
          ))}
        </div>
        {hovered && hover && (
          <ChartTooltip x={hover.x} y={0} containerWidth={width}>
            <TooltipRow value={plural(hovered.days, 'day')} label={`${hovered.label} · ${hovered.pct}%`} color={colors.get(hovered.label)} keyShape="dot" />
          </ChartTooltip>
        )}
      </div>
      <Legend items={q.distribution.map((d) => ({ kind: 'fill' as const, color: colors.get(d.label), label: d.label, count: `${d.days} d · ${d.pct}%` }))} />
      {!compact && (
        <div className={s.strip}>
          <DayStrip
            cells={cells}
            cellHeight={14}
            ariaLabel={`${q.shortLabel} by day. Use arrow keys to move between days.`}
            onSelectDay={onSelectDay}
            describe={(i) => `${fmtDay(q.series[i].date)}: ${q.series[i].label ?? 'no answer'}`}
            tooltip={(i) => (
              <>
                <TooltipTitle>{fmtDayLong(q.series[i].date)}</TooltipTitle>
                <TooltipRow value={q.series[i].label ?? 'No answer'} color={cells[i].color} keyShape="dot" />
              </>
            )}
          />
        </div>
      )}
    </>
  );
}

// ───────────────────────── multi ─────────────────────────

const MAX_ITEMS = 8;

function MultiBody({ q, compact, onSelectDay }: BodyProps<MultiSelectQuestionSummary>) {
  const shown = q.items.slice(0, compact ? 5 : MAX_ITEMS);
  const rest = q.items.length - shown.length;
  const cells: StripCell[] = q.series.map((p) => ({
    date: p.date,
    kind: p.items == null ? 'nodata' : p.items.length ? 'fill' : 'outline',
    color: p.items && p.items.length ? 'var(--chart-s2)' : 'var(--border-strong)',
  }));
  return (
    <>
      <p className={s.figureLine}>
        <strong>{q.anyDays}</strong> of {plural(q.answeredDays, 'answered day')} with at least one
      </p>
      {shown.length === 0 ? (
        <p className={s.muted}>Nothing selected in this period.</p>
      ) : (
        <ul className={s.freq} aria-label={`${q.shortLabel} frequency`}>
          {shown.map((it) => (
            <li key={it.label} className={s.freqRow} data-item={it.label}>
              <span className={s.freqLabel} title={it.label}>
                {it.label}
              </span>
              <span className={s.track} aria-hidden="true">
                <span className={s.fill} style={{ width: `${Math.max(it.pct, it.days > 0 ? 2 : 0)}%` }} />
              </span>
              <span className={s.freqValue}>
                {it.days} d<span className={s.muted}> · {it.pct}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && <p className={s.muted}>+{rest} more less-frequent items</p>}
      {!compact && (
        <div className={s.strip}>
          <DayStrip
            cells={cells}
            cellHeight={14}
            ariaLabel={`${q.shortLabel} by day. Use arrow keys to move between days.`}
            onSelectDay={onSelectDay}
            describe={(i) => {
              const it = q.series[i].items;
              return `${fmtDay(q.series[i].date)}: ${it == null ? 'no answer' : it.length ? it.join(', ') : 'none'}`;
            }}
            tooltip={(i) => {
              const it = q.series[i].items;
              return (
                <>
                  <TooltipTitle>{fmtDayLong(q.series[i].date)}</TooltipTitle>
                  {it == null ? (
                    <TooltipRow value="No answer" />
                  ) : it.length ? (
                    it.map((x) => <TooltipRow key={x} value={x} color="var(--chart-s2)" keyShape="dot" />)
                  ) : (
                    <TooltipRow value="None" />
                  )}
                </>
              );
            }}
          />
          <Legend
            items={[
              { kind: 'fill', color: 'var(--chart-s2)', label: 'Any selected' },
              { kind: 'outline', color: 'var(--border-strong)', label: 'None' },
              { kind: 'nodata', label: 'No answer' },
            ]}
          />
        </div>
      )}
    </>
  );
}

// ───────────────────────── numeric ─────────────────────────

function NumericBody({ q, compact, onSelectDay }: BodyProps<NumericQuestionSummary>) {
  const [ref, width] = useContainerWidth<HTMLDivElement>(400);
  const n = q.series.length;
  const dates = useMemo(() => q.series.map((p) => p.date), [q.series]);
  const valued = useMemo(() => q.series.map((p, i) => ({ ...p, i })).filter((p) => p.value != null), [q.series]);
  const cursor = useDayCursor(n, {
    onSelect: (i) => onSelectDay?.(dates[i]),
    isStop: (i) => q.series[i]?.value != null,
    initial: () => (valued.length ? valued[valued.length - 1].i : n - 1),
  });
  if (valued.length === 0) return <EmptyState>No answers in this period</EmptyState>;
  const higherIsWorse = q.direction === 'higherIsWorse';
  const atConcern = (v: number) =>
    q.concernThreshold != null && (higherIsWorse ? v >= q.concernThreshold : v <= q.concernThreshold);
  const unit = q.unit ? ` ${q.unit}` : '';
  const fmt = (v: number | null) => (v == null ? '—' : `${fmtNumber(v, Number.isInteger(v) ? 0 : 1)}${unit}`);

  const vals = valued.map((p) => p.value as number);
  let lo = q.min ?? Math.min(...vals, q.concernThreshold ?? Infinity);
  let hi = q.max ?? Math.max(...vals, q.concernThreshold ?? -Infinity);
  if (q.min == null) lo = Math.min(lo, 0);
  if (hi === lo) hi = lo + 1;
  const ticks = niceTicks(lo, hi, compact ? 2 : 3);
  const yLo = Math.min(lo, ticks[0] ?? lo);
  const yHi = Math.max(hi, ticks[ticks.length - 1] ?? hi);
  const H = compact ? 72 : 112;
  const m = { l: 30, r: 6, t: 8, b: 20 };
  const x = bandScale(n, Math.max(40, width - m.l - m.r), m.l);
  const y = (v: number) => m.t + (H - m.t - m.b) * (1 - (v - yLo) / (yHi - yLo));
  const base = H - m.b;

  let path = '';
  valued.forEach((p, k) => {
    const joined = k > 0 && p.i - valued[k - 1].i === 1;
    path += `${joined ? 'L' : 'M'}${x.center(p.i).toFixed(1)},${y(p.value as number).toFixed(1)} `;
  });
  const active = cursor.active;
  const ap = active != null ? q.series[active] : undefined;
  const summary =
    `${q.shortLabel}${q.unit ? ` (${q.unit})` : ''} over ${plural(q.answeredDays, 'answered day')}: ` +
    `average ${fmt(q.stats.mean)}, range ${fmt(q.stats.min)} – ${fmt(q.stats.max)}, latest ${fmt(q.stats.last)}` +
    (q.concernThreshold != null ? `; ${plural(q.stats.daysAtConcern, 'day')} at or past the concern level of ${fmt(q.concernThreshold)}` : '') +
    (q.trend ? `; trend ${q.trend.text}` : '') +
    '.';

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < m.l) return cursor.setPointer(null);
    const i = x.indexAt(px);
    // snap to nearest answered day within 3 bands
    let best: number | null = null;
    let bd = Infinity;
    for (const p of valued) {
      const d = Math.abs(p.i - i);
      if (d < bd) {
        bd = d;
        best = p.i;
      }
    }
    cursor.setPointer(best != null && bd <= 3 ? best : null);
  };

  return (
    <>
      <div
        ref={ref}
        className={`${cs.plot} ${cs.interactive}`}
        tabIndex={0}
        role="group"
        aria-label={summary + ' Use arrow keys to move between answered days.'}
        onKeyDown={cursor.onKeyDown}
        onFocus={cursor.onFocus}
        onBlur={cursor.onBlur}
      >
        <svg
          className={cs.svg}
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          aria-hidden="true"
          onPointerMove={onMove}
          onPointerLeave={() => cursor.setPointer(null)}
          onClick={() => {
            if (ap && onSelectDay) onSelectDay(ap.date);
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={width - m.r} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} style={{ stroke: 'var(--grid)' }} />
              <text className={cs.axisText} x={m.l - 5} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {fmtNumber(t, Number.isInteger(t) ? 0 : 1)}
              </text>
            </g>
          ))}
          {q.concernThreshold != null && (
            <g data-testid="concern-line">
              <line
                x1={m.l}
                x2={width - m.r}
                y1={y(q.concernThreshold)}
                y2={y(q.concernThreshold)}
                style={{ stroke: 'var(--concern)', strokeWidth: 1, strokeDasharray: '4 3' }}
              />
            </g>
          )}
          {ap && <line x1={x.center(active!)} x2={x.center(active!)} y1={m.t} y2={base} style={{ stroke: 'var(--text-3)' }} />}
          <path d={path} style={{ fill: 'none', stroke: 'var(--chart-s1)', strokeWidth: 1.75, strokeLinejoin: 'round' }} />
          {valued.map((p) => {
            const v = p.value as number;
            const bad = atConcern(v);
            return (
              <circle
                key={p.i}
                cx={x.center(p.i)}
                cy={y(v)}
                r={p.i === active ? 4.5 : bad ? 3.5 : 3}
                data-concern={bad ? 'true' : 'false'}
                style={{ fill: bad ? 'var(--concern)' : 'var(--chart-s1)', stroke: 'var(--surface)', strokeWidth: 1.5 }}
              />
            );
          })}
          <line x1={m.l} x2={width - m.r} y1={base + 0.5} y2={base + 0.5} style={{ stroke: 'var(--border-strong)' }} />
          <DateAxis dates={dates} ticks={dateTicks(dates, x.band, 56)} center={x.center} y={base + 4} x0={m.l} x1={width - m.r} />
        </svg>
        {ap && ap.value != null && (
          <ChartTooltip x={x.center(active!)} y={y(ap.value)} containerWidth={width}>
            <TooltipTitle>{fmtDayLong(ap.date)}</TooltipTitle>
            <TooltipRow
              value={fmt(ap.value)}
              label={atConcern(ap.value) ? `${q.shortLabel} · at concern level` : q.shortLabel}
              color={atConcern(ap.value) ? 'var(--concern)' : 'var(--chart-s1)'}
              keyShape="dot"
            />
          </ChartTooltip>
        )}
        <VisuallyHidden live>{ap && cursor.viaKeyboard ? `${fmtDay(ap.date)}: ${fmt(ap.value)}` : ''}</VisuallyHidden>
      </div>
      <dl className={s.stats}>
        <Stat label="Average" value={fmt(q.stats.mean)} />
        <Stat label="Range" value={q.stats.min == null ? '—' : `${fmtNumber(q.stats.min, Number.isInteger(q.stats.min) ? 0 : 1)}–${fmt(q.stats.max)}`} />
        <Stat label="Latest" value={fmt(q.stats.last)} />
        {q.concernThreshold != null && (
          <Stat
            label={`Days ${higherIsWorse ? '≥' : '≤'} ${fmt(q.concernThreshold)} (dashed line)`}
            value={String(q.stats.daysAtConcern)}
            warn={q.stats.daysAtConcern > 0}
          />
        )}
        {q.trend && !compact && (
          <Stat
            label="Trend"
            value={`${q.trend.direction === 'up' ? '↑' : q.trend.direction === 'down' ? '↓' : '→'} ${q.trend.text}`}
            warn={q.trend.meaning === 'worse'}
          />
        )}
      </dl>
    </>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={s.stat}>
      <dt>{label}</dt>
      <dd className={warn ? s.warn : undefined}>{value}</dd>
    </div>
  );
}

// ───────────────────────── boolean ─────────────────────────

function BooleanBody({ q, compact, onSelectDay }: BodyProps<BooleanQuestionSummary>) {
  const cells: StripCell[] = q.series.map((p) => ({
    date: p.date,
    kind: p.value == null ? 'nodata' : p.value ? 'fill' : 'outline',
    color: p.value ? 'var(--series-3)' : 'var(--border-strong)',
  }));
  return (
    <>
      <p className={s.bigFigure}>
        <span className={s.bigNum}>{q.yesDays}</span>
        <span className={s.bigOf}>
          of {plural(q.answeredDays, 'answered day')} “yes” <span className={s.muted}>({q.yesPct}%)</span>
        </span>
      </p>
      {!compact && (
        <div className={s.strip}>
          <DayStrip
            cells={cells}
            cellHeight={14}
            ariaLabel={`${q.shortLabel}: yes on ${q.yesDays}, no on ${q.noDays} of ${q.windowDays} days. Use arrow keys to move between days.`}
            onSelectDay={onSelectDay}
            describe={(i) => `${fmtDay(q.series[i].date)}: ${q.series[i].value == null ? 'no answer' : q.series[i].value ? 'yes' : 'no'}`}
            tooltip={(i) => (
              <>
                <TooltipTitle>{fmtDayLong(q.series[i].date)}</TooltipTitle>
                <TooltipRow
                  value={q.series[i].value == null ? 'No answer' : q.series[i].value ? 'Yes' : 'No'}
                  color={q.series[i].value ? 'var(--series-3)' : undefined}
                  keyShape="dot"
                />
              </>
            )}
          />
          <Legend
            items={[
              { kind: 'fill', color: 'var(--series-3)', label: 'Yes', count: q.yesDays },
              { kind: 'outline', color: 'var(--border-strong)', label: 'No', count: q.noDays },
              { kind: 'nodata', label: 'No answer', count: q.windowDays - q.answeredDays },
            ]}
          />
        </div>
      )}
    </>
  );
}

// ───────────────────────── text ─────────────────────────

function TextBody({ q, compact, onSelectDay }: BodyProps<TextQuestionSummary>) {
  const items = q.recent.slice(0, compact ? 3 : 10);
  return (
    <ul className={s.textList}>
      {items.map((r, i) => (
        <li key={`${r.date}-${i}`} className={s.textItem}>
          {onSelectDay ? (
            <button type="button" className={s.dateBtn} onClick={() => onSelectDay(r.date)} aria-label={`Open ${fmtDay(r.date)}`}>
              {fmtDay(r.date)}
            </button>
          ) : (
            <span className={s.date}>{fmtDay(r.date)}</span>
          )}
          <span className={s.textBody}>{r.text}</span>
        </li>
      ))}
      {q.recent.length > items.length && <li className={s.muted}>+{q.recent.length - items.length} more</li>}
    </ul>
  );
}
