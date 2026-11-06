/**
 * SpirometryTrendChart — "is lung function changing?"
 * One metric over the full analysis window (x-axis spans windowStart..windowEnd even when
 * sessions are sparse), optional green/yellow/red zone bands (PEF / % personal best),
 * personal-best reference line, hollow markers for low-quality sessions (no accepted blow).
 * Crosshair snaps to the nearest session; tooltip lists FEV1 / FVC / ratio / PEF / %PB + blow counts.
 */
import { useMemo, type PointerEvent } from 'react';
import type { SpirometrySession } from '@shared/types';
import type { SpirometryMetric, SpirometryTrendChartProps } from './types';
import { bandScale, dateRange, dateTicks, daysBetween, fmtDay, fmtDayLong, fmtNumber, niceTicks, plural, ZONE_SOFT_VAR } from './chartUtils';
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
import cs from './charts.module.css';

interface MetricDef {
  label: string;
  unit: string;
  dp: number;
  get: (s: SpirometrySession) => number | undefined;
}

const METRICS: Record<SpirometryMetric, MetricDef> = {
  pef: { label: 'Peak flow', unit: 'L/min', dp: 0, get: (s) => s.bestPefLpm },
  pctPersonalBest: { label: 'Peak flow, % of personal best', unit: '%', dp: 0, get: (s) => s.pctPersonalBest },
  fev1: { label: 'FEV1', unit: 'L', dp: 2, get: (s) => s.bestFev1L },
  fvc: { label: 'FVC', unit: 'L', dp: 2, get: (s) => s.bestFvcL },
  ratio: { label: 'FEV1/FVC', unit: '%', dp: 0, get: (s) => s.ratioPct },
};

function fmtVal(v: number, m: MetricDef): string {
  return `${fmtNumber(v, m.dp)}${m.unit === '%' ? '%' : ' ' + m.unit}`;
}

export function SpirometryTrendChart({
  spirometry,
  metric,
  showZoneBands = false,
  windowStart,
  windowEnd,
  onSelectDay,
  height = 220,
}: SpirometryTrendChartProps) {
  const [ref, width] = useContainerWidth<HTMLDivElement>(640);
  const def = METRICS[metric];
  const dates = useMemo(() => (windowStart <= windowEnd ? dateRange(windowStart, windowEnd) : []), [windowStart, windowEnd]);
  const pts = useMemo(
    () =>
      spirometry.sessions
        .filter((s) => s.date >= windowStart && s.date <= windowEnd)
        .map((s) => ({ s, v: def.get(s), i: daysBetween(windowStart, s.date) }))
        .filter((p): p is { s: SpirometrySession; v: number; i: number } => p.v != null && isFinite(p.v)),
    [spirometry.sessions, windowStart, windowEnd, def],
  );
  const cursor = useDayCursor(pts.length, { onSelect: (k) => onSelectDay?.(pts[k].s.date) });

  if (dates.length === 0 || pts.length === 0)
    return (
      <figure className={cs.root} aria-label={`${def.label}: no spirometry sessions in this period`}>
        <EmptyState height={Math.min(height, 120)}>No spirometry sessions in this period</EmptyState>
      </figure>
    );

  const pb = spirometry.personalBestPefLpm;
  const isPeak = metric === 'pef' || metric === 'pctPersonalBest';
  const refValue = metric === 'pctPersonalBest' ? 100 : metric === 'pef' ? pb : undefined;
  const greenAt = metric === 'pctPersonalBest' ? spirometry.greenThresholdPct : pb ? (pb * spirometry.greenThresholdPct) / 100 : undefined;
  const redAt = metric === 'pctPersonalBest' ? spirometry.redThresholdPct : pb ? (pb * spirometry.redThresholdPct) / 100 : undefined;
  const bands = showZoneBands && isPeak && greenAt != null && redAt != null;

  const vals = pts.map((p) => p.v);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (refValue != null) hi = Math.max(hi, refValue);
  if (bands && redAt != null) lo = Math.min(lo, redAt * 0.8);
  if (metric === 'ratio') hi = Math.max(hi, 100);
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
  lo = Math.max(0, lo - pad);
  hi = hi + pad;
  const tickVals = niceTicks(lo, hi, 4);
  const step = tickVals.length > 1 ? tickVals[1] - tickVals[0] : 1;
  const yLo = Math.floor(lo / step) * step;
  const yHi = Math.ceil(hi / step) * step;
  const ticks = niceTicks(yLo, yHi, 4);

  const narrow = width < 420;
  const m = { l: narrow ? 36 : 44, r: 10, t: 22, b: 22 };
  const plotH = Math.max(80, height - m.t - m.b);
  const x = bandScale(dates.length, Math.max(40, width - m.l - m.r), m.l);
  const y = (v: number) => m.t + plotH - ((v - yLo) / (yHi - yLo)) * plotH;
  const x0 = m.l;
  const x1 = width - m.r;
  const base = m.t + plotH;

  let path = '';
  pts.forEach((p, k) => {
    const joined = k > 0 && p.i - pts[k - 1].i <= 10;
    path += `${joined ? 'L' : 'M'}${x.center(p.i).toFixed(1)},${y(p.v).toFixed(1)} `;
  });

  const active = cursor.active;
  const ap = active != null ? pts[active] : undefined;
  const unreliable = pts.filter((p) => !p.s.reliable).length;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const summary =
    `${def.label} (${def.unit}), ${fmtDay(windowStart)} – ${fmtDay(windowEnd)}: ${plural(pts.length, 'session')}` +
    `${unreliable ? ` (${unreliable} low quality)` : ''}. First ${fmtVal(first.v, def)} on ${fmtDay(first.s.date)}, ` +
    `latest ${fmtVal(last.v, def)} on ${fmtDay(last.s.date)}; range ${fmtVal(Math.min(...vals), def)} – ${fmtVal(Math.max(...vals), def)}.` +
    (refValue != null ? ` Personal best ${fmtVal(refValue, def)}.` : '');

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bd = Infinity;
    pts.forEach((p, k) => {
      const d = Math.abs(x.center(p.i) - px);
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    cursor.setPointer(bd <= Math.max(40, x.band * 3) ? best : null);
  };

  const r = 4;
  return (
    <figure ref={ref} className={cs.root} aria-label={summary} role="group">
      <div
        className={`${cs.plot} ${cs.interactive}`}
        tabIndex={0}
        role="group"
        aria-label={`${def.label} sessions. Use arrow keys to move between sessions.`}
        onKeyDown={cursor.onKeyDown}
        onFocus={cursor.onFocus}
        onBlur={cursor.onBlur}
      >
        <svg
          className={cs.svg}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
          onPointerMove={onMove}
          onPointerLeave={() => cursor.setPointer(null)}
          onClick={() => {
            if (ap && onSelectDay) onSelectDay(ap.s.date);
          }}
        >
          {bands && greenAt != null && redAt != null && (
            <g data-testid="zone-bands">
              <rect x={x0} y={m.t} width={x1 - x0} height={Math.max(0, y(greenAt) - m.t)} style={{ fill: ZONE_SOFT_VAR.green }} />
              <rect
                x={x0}
                y={y(Math.min(greenAt, yHi))}
                width={x1 - x0}
                height={Math.max(0, y(Math.max(redAt, yLo)) - y(Math.min(greenAt, yHi)))}
                style={{ fill: ZONE_SOFT_VAR.yellow }}
              />
              {redAt > yLo && (
                <rect x={x0} y={y(redAt)} width={x1 - x0} height={Math.max(0, base - y(redAt))} style={{ fill: ZONE_SOFT_VAR.red }} />
              )}
            </g>
          )}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x0} x2={x1} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} style={{ stroke: 'var(--grid)' }} />
              <text className={cs.axisText} x={x0 - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {fmtNumber(t, step < 0.1 ? 2 : step < 1 ? 1 : 0)}
              </text>
            </g>
          ))}
          {bands && greenAt != null && redAt != null && !narrow && (
                <g className={cs.axisTitle} style={{ paintOrder: 'stroke', strokeWidth: 3, strokeLinejoin: 'round' }}>
                  <text x={x1 - 4} y={(m.t + y(Math.min(greenAt, yHi))) / 2} textAnchor="end" dominantBaseline="middle" style={{ stroke: ZONE_SOFT_VAR.green }}>
                    Green ≥ {spirometry.greenThresholdPct}%
                  </text>
                  {greenAt < yHi && greenAt > yLo && (
                    <text
                      x={x1 - 4}
                      y={(y(greenAt) + y(Math.max(redAt, yLo))) / 2}
                      textAnchor="end"
                      dominantBaseline="middle"
                      style={{ stroke: ZONE_SOFT_VAR.yellow }}
                    >
                      Yellow
                    </text>
                  )}
                  {redAt > yLo && redAt < yHi && (
                    <text x={x1 - 4} y={(y(redAt) + base) / 2} textAnchor="end" dominantBaseline="middle" style={{ stroke: ZONE_SOFT_VAR.red }}>
                      Red &lt; {spirometry.redThresholdPct}%
                    </text>
                  )}
                </g>
              )}
          <text className={cs.axisTitle} x={0} y={4} dominantBaseline="hanging">
            {def.label} ({def.unit})
          </text>
          <line x1={x0} x2={x1} y1={base + 0.5} y2={base + 0.5} style={{ stroke: 'var(--border-strong)' }} />

          {refValue != null && refValue >= yLo && refValue <= yHi && (
            <g data-testid="personal-best">
              <line
                x1={x0}
                x2={x1}
                y1={y(refValue)}
                y2={y(refValue)}
                style={{ stroke: 'var(--text-2)', strokeWidth: 1, strokeDasharray: '4 3' }}
              />
              <text className={cs.axisTitle} x={x0 + 4} y={y(refValue) - 4} style={{ fill: 'var(--text-2)' }}>
                Personal best{metric === 'pef' ? ` ${fmtNumber(refValue)} L/min` : ''}
                {spirometry.personalBestSource ? ` (${spirometry.personalBestSource})` : ''}
              </text>
            </g>
          )}

          {ap && (
            <line x1={x.center(ap.i)} x2={x.center(ap.i)} y1={m.t} y2={base} style={{ stroke: 'var(--text-3)', strokeWidth: 1 }} />
          )}

          <path d={path} style={{ fill: 'none', stroke: 'var(--chart-s1)', strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }} />
          {pts.map((p, k) => (
            <circle
              key={p.s.date}
              cx={x.center(p.i)}
              cy={y(p.v)}
              r={k === active ? r + 1.5 : r}
              data-date={p.s.date}
              data-reliable={p.s.reliable ? 'true' : 'false'}
              style={
                p.s.reliable
                  ? { fill: 'var(--chart-s1)', stroke: 'var(--surface)', strokeWidth: 2 }
                  : { fill: 'var(--surface)', stroke: 'var(--chart-s1)', strokeWidth: 2 }
              }
            />
          ))}
          <DateAxis dates={dates} ticks={dateTicks(dates, x.band, 56)} center={x.center} y={base + 6} x0={x0} x1={x1} />
        </svg>
        {ap && (
          <ChartTooltip x={x.center(ap.i)} y={y(ap.v)} containerWidth={width}>
            <SessionTooltip s={ap.s} metric={metric} />
          </ChartTooltip>
        )}
        <VisuallyHidden live>
          {ap && cursor.viaKeyboard
            ? `${fmtDay(ap.s.date)}: ${fmtVal(ap.v, def)}${ap.s.reliable ? '' : ', low quality'}, ${ap.s.acceptableBlows} of ${ap.s.totalBlows} blows acceptable`
            : ''}
        </VisuallyHidden>
      </div>
      <Legend
        items={[
          { kind: 'dot', color: 'var(--chart-s1)', label: 'Session (best blow)' },
          ...(unreliable ? [{ kind: 'hollowPoint' as const, color: 'var(--chart-s1)', label: 'Low quality (no accepted blow)' }] : []),
          ...(refValue != null ? [{ kind: 'dashed' as const, color: 'var(--text-2)', label: 'Personal best' }] : []),
          ...(bands
            ? [
                { kind: 'fill' as const, color: 'var(--zone-green-soft)', label: 'Green zone' },
                { kind: 'fill' as const, color: 'var(--zone-yellow-soft)', label: 'Yellow zone' },
                { kind: 'fill' as const, color: 'var(--zone-red-soft)', label: 'Red zone' },
              ]
            : []),
        ]}
      />
    </figure>
  );
}

function SessionTooltip({ s, metric }: { s: SpirometrySession; metric: SpirometryMetric }) {
  const coaching = [...new Set(s.blows.flatMap((b) => b.coaching))].slice(0, 2);
  const strong = (m: SpirometryMetric) => (m === metric ? 'var(--chart-s1)' : undefined);
  return (
    <>
      <TooltipTitle>{fmtDayLong(s.date)}</TooltipTitle>
      {s.pctPersonalBest != null && <TooltipRow value={`${s.pctPersonalBest}%`} label="of personal best" color={strong('pctPersonalBest')} />}
      <TooltipRow value={`${fmtNumber(s.bestPefLpm)} L/min`} label="peak flow" color={strong('pef')} />
      <TooltipRow value={`${fmtNumber(s.bestFev1L, 2)} L`} label="FEV1" color={strong('fev1')} />
      <TooltipRow value={`${fmtNumber(s.bestFvcL, 2)} L`} label="FVC" color={strong('fvc')} />
      <TooltipRow value={`${s.ratioPct}%`} label="FEV1/FVC" color={strong('ratio')} />
      <div className={cs.tooltipNote}>
        {s.acceptableBlows} of {s.totalBlows} blows acceptable
      </div>
      {!s.reliable && <div className={cs.tooltipWarn}>Low quality — no accepted blow</div>}
      {coaching.length > 0 && <div className={cs.tooltipNote}>Coaching: {coaching.join('; ')}</div>}
    </>
  );
}
