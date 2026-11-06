/**
 * DailyTimeline — the "context" view. Stacked rows share ONE date x-axis so a clinician can
 * see, for any single day, how the patient said they felt next to their symptoms, doses,
 * rescue use, peak flow and zone (fixes the brief's discordance problem: "Great" + wheeze
 * + 60 % PEF on the same day is visible at a glance; discordant days get a red ring).
 * Hover / keyboard focus a day → vertical guide across all rows + summary tooltip.
 */
import { useMemo, type PointerEvent, type ReactNode } from 'react';
import type { DaySummary, Severity, SpirometrySummary } from '@shared/types';
import type { DailyTimelineProps, TimelineRow } from './types';
import {
  asNeededText,
  bandScale,
  clamp,
  dateTicks,
  fmtDay,
  fmtDayLong,
  plural,
  roundedTopBar,
  SEVERITY_VAR,
  weekdayMon0,
  ZONE_SOFT_VAR,
  ZONE_VAR,
} from './chartUtils';
import {
  ChartTooltip,
  DateAxis,
  EmptyState,
  Legend,
  NoDataPattern,
  TooltipRow,
  TooltipTitle,
  useContainerWidth,
  useDayCursor,
  useSafeId,
  VisuallyHidden,
} from './chartKit';
import cs from './charts.module.css';

const DEFAULT_LABELS: Record<TimelineRow, string> = {
  feeling: 'Feeling',
  symptoms: 'Symptoms',
  scheduledDoses: 'Scheduled doses',
  asNeeded: 'As-needed uses',
  peakFlow: 'Peak flow % best',
  zone: 'Zone',
};

const ROW_HEIGHT: Record<TimelineRow, number> = {
  feeling: 28,
  symptoms: 40,
  scheduledDoses: 26,
  asNeeded: 40,
  peakFlow: 96,
  zone: 26,
};

const ROW_GAP = 8;
const AXIS_H = 22;

function wrap(text: string, maxChars: number, maxLines = 3): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

export function DailyTimeline({
  days,
  rows,
  spirometry,
  selectedDate,
  onSelectDay,
  highlightDates,
  rowLabels,
}: DailyTimelineProps) {
  const [ref, width] = useContainerWidth<HTMLDivElement>(720);
  const hatchId = useSafeId('tl-hatch');
  const n = days.length;
  const narrow = width < 480;
  const gutter = narrow ? 72 : 116;
  const padR = 6;
  const plotW = Math.max(40, width - gutter - padR);
  const x = bandScale(n, plotW, gutter);
  const dates = useMemo(() => days.map((d) => d.date), [days]);
  const highlight = useMemo(() => new Set(highlightDates ?? []), [highlightDates]);
  const labels = { ...DEFAULT_LABELS, ...rowLabels };

  const lastWithData = useMemo(() => {
    for (let i = n - 1; i >= 0; i--) if (days[i].hasData) return i;
    return n - 1;
  }, [days, n]);
  const selIdx = selectedDate ? dates.indexOf(selectedDate) : -1;
  const cursor = useDayCursor(n, {
    onSelect: (i) => onSelectDay?.(dates[i]),
    initial: () => (selIdx >= 0 ? selIdx : lastWithData),
  });

  // Row layout
  const layout = useMemo(() => {
    let y = 4;
    return rows.map((r) => {
      const top = y;
      y += ROW_HEIGHT[r] + ROW_GAP;
      return { row: r, top, h: ROW_HEIGHT[r] };
    });
  }, [rows]);
  const plotTop = layout.length ? layout[0].top : 0;
  const plotBottom = layout.length ? layout[layout.length - 1].top + layout[layout.length - 1].h : 0;
  const height = plotBottom + 6 + AXIS_H;

  const feelingLegend = useMemo(() => {
    const m = new Map<Severity, string>();
    for (const d of days) if (d.feeling?.severity != null && !m.has(d.feeling.severity)) m.set(d.feeling.severity, d.feeling.label);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [days]);

  if (n === 0 || rows.length === 0) return <EmptyState />;

  const band = x.band;
  const ticks = dateTicks(dates, band, narrow ? 48 : 56);
  const active = cursor.active;
  const green = spirometry?.greenThresholdPct ?? 80;
  const red = spirometry?.redThresholdPct ?? 50;

  const dataDays = days.filter((d) => d.hasData).length;
  const discordantDays = days.filter((d) => d.discordant).length;
  const symptomDays = days.filter((d) => d.symptomDay).length;
  const summary =
    `Daily timeline ${fmtDay(dates[0])} – ${fmtDay(dates[n - 1])}, rows: ${rows.map((r) => labels[r]).join(', ')}. ` +
    `${dataDays} of ${n} days have entries; ${plural(symptomDays, 'symptom day')}` +
    (discordantDays ? `; ${plural(discordantDays, 'day')} where feeling did not match symptoms or peak flow` : '') +
    '. Use arrow keys to move between days' +
    (onSelectDay ? ' and Enter to open a day.' : '.');

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < gutter - 4) {
      cursor.setPointer(null);
      return;
    }
    cursor.setPointer(x.indexAt(px));
  };

  const legendItems = buildLegend(rows, feelingLegend, discordantDays > 0, days);

  return (
    <figure ref={ref} className={cs.root} aria-label={summary} role="group">
      <div
        className={`${cs.plot} ${cs.interactive}`}
        tabIndex={0}
        onKeyDown={cursor.onKeyDown}
        onFocus={cursor.onFocus}
        onBlur={cursor.onBlur}
        aria-label={`Day-by-day details. Use arrow keys to move between days${onSelectDay ? ', Enter to open a day' : ''}.`}
        role="group"
      >
        <svg
          className={cs.svg}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => cursor.setPointer(null)}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - rect.left;
            if (px >= gutter - 4 && onSelectDay) onSelectDay(dates[x.indexAt(px)]);
          }}
          aria-hidden="true"
        >
          <defs>
            <NoDataPattern id={hatchId} />
          </defs>

          {/* highlight + no-data columns (behind everything) */}
          {days.map((d, i) =>
            highlight.has(d.date) ? (
              <g key={`hl${i}`} data-highlight={d.date}>
                <rect x={x.left(i)} y={plotTop - 2} width={band} height={plotBottom - plotTop + 4} style={{ fill: 'var(--accent-soft)' }} />
                <rect
                  x={x.center(i) - Math.min(band, 10) / 2}
                  y={plotBottom + 1}
                  width={Math.min(band, 10)}
                  height={3}
                  rx={1.5}
                  style={{ fill: 'var(--brand-magenta)' }}
                />
              </g>
            ) : null,
          )}
          {days.map((d, i) =>
            !d.hasData ? (
              <rect
                key={`nd${i}`}
                x={x.left(i) + (band > 4 ? 0.5 : 0)}
                y={plotTop}
                width={Math.max(0.5, band - (band > 4 ? 1 : 0))}
                height={plotBottom - plotTop}
                fill={`url(#${hatchId})`}
                opacity={0.55}
                data-nodata={d.date}
              />
            ) : null,
          )}
          {active != null && (
            <rect
              x={x.left(active)}
              y={plotTop - 2}
              width={band}
              height={plotBottom - plotTop + 4}
              style={{ fill: 'var(--accent-soft)', opacity: 0.7 }}
            />
          )}

          {/* week gridlines (Mondays) */}
          {days.map((d, i) =>
            i > 0 && weekdayMon0(d.date) === 0 ? (
              <line
                key={`w${i}`}
                x1={Math.round(x.left(i)) + 0.5}
                x2={Math.round(x.left(i)) + 0.5}
                y1={plotTop}
                y2={plotBottom}
                style={{ stroke: 'var(--grid)' }}
              />
            ) : null,
          )}

          {layout.map(({ row, top, h }, ri) => (
            <g key={row} data-row={row}>
              {ri > 0 && (
                <line x1={0} x2={width} y1={top - ROW_GAP / 2 + 0.5} y2={top - ROW_GAP / 2 + 0.5} style={{ stroke: 'var(--grid)' }} />
              )}
              <RowLabel text={labels[row]} y={top} h={h} gutter={gutter} />
              {renderRow(row, days, x, band, top, h, { green, red, gutter, spirometry })}
            </g>
          ))}

          {/* selected column */}
          {selIdx >= 0 && (
            <rect
              x={x.left(selIdx) + 0.75}
              y={plotTop - 2}
              width={Math.max(1, band - 1.5)}
              height={plotBottom - plotTop + 4}
              rx={2}
              style={{ fill: 'none', stroke: 'var(--text)', strokeWidth: 1.5 }}
            />
          )}

          {/* guide */}
          {active != null && (
            <line
              x1={x.center(active)}
              x2={x.center(active)}
              y1={plotTop - 2}
              y2={plotBottom + 2}
              style={{ stroke: 'var(--text-3)', strokeWidth: 1 }}
            />
          )}

          <line x1={gutter} x2={width - padR} y1={plotBottom + 3.5} y2={plotBottom + 3.5} style={{ stroke: 'var(--border)' }} />
          <DateAxis dates={dates} ticks={ticks} center={x.center} y={plotBottom + 8} x0={gutter} x1={width - padR} />
        </svg>

        {active != null && (
          <ChartTooltip x={x.center(active)} y={plotTop} containerWidth={width} placement="side">
            <DayTooltip day={days[active]} />
          </ChartTooltip>
        )}
        <VisuallyHidden live>{active != null && cursor.viaKeyboard ? describeDay(days[active]) : ''}</VisuallyHidden>
      </div>
      <Legend items={legendItems} />
    </figure>
  );
}

// ───────────────────────── rows ─────────────────────────

function RowLabel({ text, y, h, gutter }: { text: string; y: number; h: number; gutter: number }) {
  const lines = wrap(text, Math.floor((gutter - 20) / 6.2), h >= 36 ? 3 : 2);
  const lh = 12;
  const y0 = y + Math.max(0, (Math.min(h, 40) - lines.length * lh) / 2);
  return (
    <text className={cs.rowLabel} x={0} y={y0} dominantBaseline="hanging">
      {lines.map((l, i) => (
        <tspan key={i} x={0} dy={i === 0 ? 0 : lh}>
          {l}
        </tspan>
      ))}
    </text>
  );
}

type Scale = ReturnType<typeof bandScale>;

function renderRow(
  row: TimelineRow,
  days: DaySummary[],
  x: Scale,
  band: number,
  top: number,
  h: number,
  ctx: { green: number; red: number; gutter: number; spirometry?: SpirometrySummary },
): ReactNode {
  const gap = band > 6 ? 2 : band > 3 ? 1 : 0;
  const barW = clamp(band - gap, 0.8, 16);
  switch (row) {
    case 'feeling': {
      const r = clamp(band * 0.32, 2, 6);
      const cy = top + h / 2;
      return days.map((d, i) => {
        if (!d.feeling) return null;
        const color = d.feeling.severity != null ? SEVERITY_VAR[d.feeling.severity] : 'var(--unknown)';
        return (
          <g key={i}>
            {d.discordant && (
              <circle cx={x.center(i)} cy={cy} r={r + 2.5} style={{ fill: 'none', stroke: 'var(--concern)', strokeWidth: 1.5 }} data-discordant={d.date} />
            )}
            <circle cx={x.center(i)} cy={cy} r={r} style={{ fill: color, stroke: 'var(--surface)', strokeWidth: 1 }} />
          </g>
        );
      });
    }
    case 'symptoms':
    case 'asNeeded': {
      const val = (d: DaySummary) => (row === 'symptoms' ? d.symptoms.length : d.asNeededUses);
      const max = Math.max(3, ...days.map(val));
      const base = top + h;
      const color = row === 'symptoms' ? 'var(--chart-s2)' : 'var(--series-5)';
      return (
        <>
          <line x1={ctx.gutter} x2={x.left(days.length)} y1={base + 0.5} y2={base + 0.5} style={{ stroke: 'var(--grid)' }} />
          <text className={cs.axisText} x={ctx.gutter - 6} y={top} textAnchor="end" dominantBaseline="hanging">
            {max}
          </text>
          {days.map((d, i) => {
            const v = val(d);
            if (v <= 0) return null;
            const bh = Math.max(3, (v / max) * (h - 2));
            return (
              <path
                key={i}
                d={roundedTopBar(x.center(i) - barW / 2, base - bh, barW, bh, Math.min(3, barW / 2))}
                style={{ fill: color }}
              />
            );
          })}
        </>
      );
    }
    case 'scheduledDoses': {
      const ch = 14;
      const y = top + (h - ch) / 2;
      const w = clamp(band - gap, 1, 18);
      return days.map((d, i) => {
        if (d.scheduledDosesExpected <= 0) {
          return (
            <line
              key={i}
              x1={x.center(i) - w / 3}
              x2={x.center(i) + w / 3}
              y1={y + ch / 2}
              y2={y + ch / 2}
              style={{ stroke: 'var(--border-strong)' }}
            />
          );
        }
        const xl = x.center(i) - w / 2;
        const r = d.scheduledDosesTaken / d.scheduledDosesExpected;
        const stroke = w >= 4 ? 1.25 : 0;
        if (r >= 1) return <rect key={i} x={xl} y={y} width={w} height={ch} rx={2} style={{ fill: 'var(--chart-s1)' }} />;
        return (
          <g key={i}>
            <rect
              x={xl + stroke / 2}
              y={y + stroke / 2}
              width={Math.max(0.5, w - stroke)}
              height={ch - stroke}
              rx={2}
              style={{ fill: w >= 4 ? 'var(--surface)' : 'var(--no-data)', stroke: 'var(--chart-s1)', strokeWidth: stroke }}
            />
            {r > 0 && <rect x={xl} y={y + ch / 2} width={w} height={ch / 2} style={{ fill: 'var(--chart-s1)' }} />}
          </g>
        );
      });
    }
    case 'zone': {
      const zh = 12;
      const y = top + (h - zh) / 2;
      return days.map((d, i) =>
        d.zone ? (
          <rect key={i} x={x.left(i) + gap / 2} y={y} width={Math.max(0.8, band - gap)} height={zh} rx={band > 6 ? 2 : 0} style={{ fill: ZONE_VAR[d.zone] }} />
        ) : null,
      );
    }
    case 'peakFlow': {
      const pts = days
        .map((d, i) => ({ i, pct: d.spirometry?.pctPersonalBest, ok: d.spirometry?.acceptable ?? true, date: d.date }))
        .filter((p): p is { i: number; pct: number; ok: boolean; date: string } => p.pct != null);
      const lo = Math.min(30, ...pts.map((p) => p.pct - 5));
      const hi = Math.max(110, ...pts.map((p) => p.pct + 5));
      const y = (v: number) => top + h - ((clamp(v, lo, hi) - lo) / (hi - lo)) * h;
      const x0 = ctx.gutter;
      const x1 = x.left(days.length);
      const bandsEls = (
        <>
          <rect x={x0} y={y(hi)} width={x1 - x0} height={y(ctx.green) - y(hi)} style={{ fill: ZONE_SOFT_VAR.green }} />
          <rect x={x0} y={y(ctx.green)} width={x1 - x0} height={y(ctx.red) - y(ctx.green)} style={{ fill: ZONE_SOFT_VAR.yellow }} />
          <rect x={x0} y={y(ctx.red)} width={x1 - x0} height={y(lo) - y(ctx.red)} style={{ fill: ZONE_SOFT_VAR.red }} />
          <line x1={x0} x2={x1} y1={y(100) + 0.5} y2={y(100) + 0.5} style={{ stroke: 'var(--border-strong)' }} />
          <text className={cs.axisText} x={x1 - 3} y={y(100) - 2} textAnchor="end" style={{ fill: 'var(--text-3)' }}>
            100%
          </text>
          {[ctx.green, ctx.red].map((v) => (
            <text key={v} className={cs.axisText} x={x0 - 6} y={y(v)} textAnchor="end" dominantBaseline="middle">
              {v}%
            </text>
          ))}
        </>
      );
      if (pts.length === 0)
        return (
          <>
            {bandsEls}
            <text className={cs.axisTitle} x={(x0 + x1) / 2} y={top + h / 2} textAnchor="middle" dominantBaseline="middle">
              No peak flow readings in this period
            </text>
          </>
        );
      let path = '';
      pts.forEach((p, k) => {
        const joined = k > 0 && p.i - pts[k - 1].i <= 7;
        path += `${joined ? 'L' : 'M'}${x.center(p.i)},${y(p.pct)} `;
      });
      const r = clamp(band * 0.3, 2.5, 4);
      return (
        <>
          {bandsEls}
          <path d={path} style={{ fill: 'none', stroke: 'var(--chart-s1)', strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }} />
          {pts.map((p) => (
            <circle
              key={p.i}
              cx={x.center(p.i)}
              cy={y(p.pct)}
              r={r}
              data-reliable={p.ok ? 'true' : 'false'}
              style={
                p.ok
                  ? { fill: 'var(--chart-s1)', stroke: 'var(--surface)', strokeWidth: 1.5 }
                  : { fill: 'var(--surface)', stroke: 'var(--chart-s1)', strokeWidth: 1.5 }
              }
            />
          ))}
        </>
      );
    }
  }
}

// ───────────────────────── tooltip / a11y text ─────────────────────────

function DayTooltip({ day }: { day: DaySummary }) {
  if (!day.hasData)
    return (
      <>
        <TooltipTitle>{fmtDayLong(day.date)}</TooltipTitle>
        <TooltipRow value="No entry" label="nothing recorded" />
      </>
    );
  const an = asNeededText(day.doses, day.asNeededUses);
  const sp = day.spirometry;
  return (
    <>
      <TooltipTitle>{fmtDayLong(day.date)}</TooltipTitle>
      {day.feeling ? (
        <TooltipRow
          value={day.feeling.label}
          label={day.feeling.changedDuringDay && day.feeling.sequence?.length > 1 ? `feeling (${day.feeling.sequence.join(' → ')})` : 'feeling'}
          color={day.feeling.severity != null ? SEVERITY_VAR[day.feeling.severity] : 'var(--unknown)'}
          keyShape="dot"
        />
      ) : (
        <TooltipRow value="—" label="no feeling answer" />
      )}
      <TooltipRow
        value={day.symptoms.length ? day.symptoms.join(', ') : 'None reported'}
        label={day.symptoms.length ? undefined : 'symptoms'}
        color="var(--chart-s2)"
      />
      {day.scheduledDosesExpected > 0 && (
        <TooltipRow value={`${day.scheduledDosesTaken} of ${day.scheduledDosesExpected}`} label="scheduled doses" color="var(--chart-s1)" />
      )}
      <TooltipRow value={an ?? 'None'} label={an ? 'as needed' : 'as-needed use'} color="var(--series-5)" />
      {sp && (
        <TooltipRow
          value={sp.pctPersonalBest != null ? `${sp.pctPersonalBest}%` : `${sp.pefLpm} L/min`}
          label={
            (sp.pctPersonalBest != null ? `of best · ${sp.pefLpm} L/min` : 'peak flow') + (sp.acceptable ? '' : ' · low-quality blow')
          }
          color="var(--chart-s1)"
        />
      )}
      {day.zone && <TooltipRow value={`${cap(day.zone)} zone`} color={ZONE_VAR[day.zone]} keyShape="dot" />}
      {day.discordant && <div className={cs.tooltipWarn}>Feeling doesn’t match symptoms / peak flow</div>}
    </>
  );
}

function describeDay(d: DaySummary): string {
  if (!d.hasData) return `${fmtDay(d.date)}: no entry`;
  const parts: string[] = [];
  if (d.feeling) parts.push(`felt ${d.feeling.label.toLowerCase()}`);
  parts.push(d.symptoms.length ? d.symptoms.join(', ').toLowerCase() : 'no symptoms reported');
  if (d.scheduledDosesExpected > 0) parts.push(`${d.scheduledDosesTaken} of ${d.scheduledDosesExpected} scheduled doses`);
  const an = asNeededText(d.doses, d.asNeededUses);
  if (an) parts.push(an);
  if (d.spirometry?.pctPersonalBest != null) parts.push(`peak flow ${d.spirometry.pctPersonalBest}% of best`);
  if (d.zone) parts.push(`${d.zone} zone`);
  if (d.discordant) parts.push('feeling does not match symptoms or peak flow');
  return `${fmtDay(d.date)}: ${parts.join(', ')}`;
}

function cap(t: string) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function buildLegend(
  rows: TimelineRow[],
  feeling: [Severity, string][],
  discordant: boolean,
  days: DaySummary[],
) {
  const items: Parameters<typeof Legend>[0]['items'] = [];
  if (rows.includes('feeling')) {
    for (const [sev, label] of feeling) items.push({ kind: 'dot', color: SEVERITY_VAR[sev], label });
    if (discordant) items.push({ kind: 'ring', color: 'var(--concern)', label: 'Feeling ≠ symptoms/PEF' });
  }
  if (rows.includes('scheduledDoses')) {
    items.push({ kind: 'fill', color: 'var(--chart-s1)', label: 'All doses' });
    items.push({ kind: 'half', color: 'var(--chart-s1)', label: 'Partial' });
    items.push({ kind: 'outline', color: 'var(--chart-s1)', label: 'Missed' });
  }
  if (rows.includes('peakFlow') && days.some((d) => d.spirometry && !d.spirometry.acceptable))
    items.push({ kind: 'hollowPoint', color: 'var(--chart-s1)', label: 'Low-quality blow' });
  if (rows.includes('zone') && !rows.includes('peakFlow')) {
    items.push({ kind: 'fill', color: ZONE_VAR.green, label: 'Green' });
    items.push({ kind: 'fill', color: ZONE_VAR.yellow, label: 'Yellow' });
    items.push({ kind: 'fill', color: ZONE_VAR.red, label: 'Red' });
  }
  if (days.some((d) => !d.hasData)) items.push({ kind: 'nodata', label: 'No entry' });
  return items;
}
