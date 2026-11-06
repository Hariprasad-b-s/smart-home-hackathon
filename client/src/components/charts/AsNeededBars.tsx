/**
 * AsNeededBars — "how often is quick-relief / abortive medicine used?"
 * Daily use bars on one date axis plus a "days used per week" row; for rescue inhalers
 * weeks above the 2-days/week guide are marked (▲ + text, never color alone).
 */
import { useMemo, type PointerEvent } from 'react';
import type { AsNeededBarsProps } from './types';
import { addDays, bandScale, dateTicks, fmtDay, fmtDayLong, niceTicks, plural, roundedTopBar, weekdayMon0 } from './chartUtils';
import {
  ChartTooltip,
  DateAxis,
  EmptyState,
  TooltipRow,
  TooltipTitle,
  useContainerWidth,
  useDayCursor,
  VisuallyHidden,
} from './chartKit';
import cs from './charts.module.css';

const PLOT_H = 84;
const WEEK_ROW_H = 18;
const GUIDE_DAYS_PER_WEEK = 2;

export function AsNeededBars({ medication, onSelectDay }: AsNeededBarsProps) {
  const [ref, width] = useContainerWidth<HTMLDivElement>(600);
  const daily = medication.daily;
  const n = daily.length;
  const dates = useMemo(() => daily.map((d) => d.date), [daily]);
  const cursor = useDayCursor(n, { onSelect: (i) => onSelectDay?.(dates[i]) });
  const isRescue = medication.role === 'rescue';

  const weeks = useMemo(() => {
    const out: { start: number; end: number; daysUsed: number; days: number; weekStart: string }[] = [];
    daily.forEach((d, i) => {
      const ws = addDays(d.date, -weekdayMon0(d.date));
      const last = out[out.length - 1];
      if (last && last.weekStart === ws) {
        last.end = i;
        last.days += 1;
        if (d.uses > 0) last.daysUsed += 1;
      } else out.push({ start: i, end: i, daysUsed: d.uses > 0 ? 1 : 0, days: 1, weekStart: ws });
    });
    return out;
  }, [daily]);

  if (n === 0) return <EmptyState />;

  const maxUses = Math.max(3, ...daily.map((d) => d.uses));
  const ticks = niceTicks(0, maxUses, 3).filter((t) => Number.isInteger(t));
  const yMax = Math.max(maxUses, ticks[ticks.length - 1] ?? maxUses);
  const gutter = 26;
  const padR = 4;
  const x = bandScale(n, Math.max(40, width - gutter - padR), gutter);
  const top = 8;
  const base = top + PLOT_H;
  const y = (v: number) => base - (v / yMax) * PLOT_H;
  const weekTop = base + 6;
  const axisTop = weekTop + WEEK_ROW_H + 2;
  const height = axisTop + 16;
  const band = x.band;
  const gap = band > 6 ? 2 : band > 3 ? 1 : 0;
  const bw = Math.max(0.8, Math.min(band - gap, 16));
  const active = cursor.active;
  const overWeeks = isRescue ? weeks.filter((w) => w.daysUsed > GUIDE_DAYS_PER_WEEK).length : 0;

  const summary =
    `${medication.name} (${medication.regimen.toLowerCase()}) ${fmtDay(dates[0])} – ${fmtDay(dates[n - 1])}: ` +
    `used on ${plural(medication.daysUsed, 'day')} of ${n}, ${plural(medication.totalUses, 'use')} total, ${medication.perWeek} days per week.` +
    (isRescue && overWeeks ? ` ${plural(overWeeks, 'week')} above ${GUIDE_DAYS_PER_WEEK} days per week.` : '');

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    cursor.setPointer(px < gutter ? null : x.indexAt(px));
  };

  return (
    <figure ref={ref} className={cs.root} aria-label={summary} role="group">
      <div
        className={`${cs.plot} ${cs.interactive}`}
        tabIndex={0}
        role="group"
        aria-label={`${medication.name} daily uses. Use arrow keys to move between days.`}
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
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - rect.left;
            if (onSelectDay && px >= gutter) onSelectDay(dates[x.indexAt(px)]);
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={gutter} x2={width - padR} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} style={{ stroke: 'var(--grid)' }} />
              <text className={cs.axisText} x={gutter - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {t}
              </text>
            </g>
          ))}
          {active != null && (
            <rect x={x.left(active)} y={top} width={band} height={PLOT_H} style={{ fill: 'var(--accent-soft)', opacity: 0.8 }} />
          )}
          {daily.map((d, i) =>
            d.uses > 0 ? (
              <path
                key={d.date}
                data-date={d.date}
                data-uses={d.uses}
                d={roundedTopBar(x.center(i) - bw / 2, y(d.uses), bw, base - y(d.uses), Math.min(4, bw / 2))}
                style={{ fill: 'var(--series-5)' }}
              />
            ) : null,
          )}
          <line x1={gutter} x2={width - padR} y1={base + 0.5} y2={base + 0.5} style={{ stroke: 'var(--border-strong)' }} />

          {/* days used per week */}
          {weeks.map((w) => {
            const cx = (x.left(w.start) + x.left(w.end + 1)) / 2;
            const spanW = x.left(w.end + 1) - x.left(w.start);
            const over = isRescue && w.daysUsed > GUIDE_DAYS_PER_WEEK;
            if (spanW < 18) return null;
            return (
              <g key={w.weekStart}>
                <line
                  x1={x.left(w.start) + 2}
                  x2={x.left(w.end + 1) - 2}
                  y1={weekTop + 0.5}
                  y2={weekTop + 0.5}
                  style={{ stroke: over ? 'var(--concern)' : 'var(--border)', strokeWidth: over ? 2 : 1 }}
                />
                <text
                  className={cs.axisText}
                  x={cx}
                  y={weekTop + 4}
                  textAnchor="middle"
                  dominantBaseline="hanging"
                  style={over ? { fill: 'var(--concern)', fontWeight: 700 } : undefined}
                >
                  {over ? '▲ ' : ''}
                  {spanW >= 52 ? `${w.daysUsed} d/wk` : w.daysUsed}
                </text>
              </g>
            );
          })}

          {active != null && (
            <line x1={x.center(active)} x2={x.center(active)} y1={top} y2={base} style={{ stroke: 'var(--text-3)' }} />
          )}
          <DateAxis dates={dates} ticks={dateTicks(dates, band, 56)} center={x.center} y={axisTop} x0={gutter} x1={width - padR} />
        </svg>
        {active != null && (
          <ChartTooltip x={x.center(active)} y={Math.min(y(daily[active].uses), base - 8)} containerWidth={width}>
            <TooltipTitle>{fmtDayLong(daily[active].date)}</TooltipTitle>
            <TooltipRow
              value={daily[active].uses ? plural(daily[active].uses, 'use') : 'Not used'}
              label={medication.name}
              color="var(--series-5)"
            />
          </ChartTooltip>
        )}
        <VisuallyHidden live>
          {active != null && cursor.viaKeyboard
            ? `${fmtDay(daily[active].date)}: ${daily[active].uses ? plural(daily[active].uses, 'use') : 'not used'}`
            : ''}
        </VisuallyHidden>
      </div>
      <p className={cs.caption}>
        Bars = uses per day · row below = days used each week
        {isRescue && (
          <>
            {' '}
            · Guide: quick-relief use on more than {GUIDE_DAYS_PER_WEEK} days a week can mean asthma is not well controlled
            {overWeeks ? ` (▲ ${plural(overWeeks, 'week')} above)` : ''}.
          </>
        )}
      </p>
    </figure>
  );
}
