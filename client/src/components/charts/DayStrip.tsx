/**
 * DayStrip — internal one-row-per-day cell strip shared by AdherenceStrip and QuestionWidget.
 * One focusable element; ←/→ move the day cursor, Enter selects; each cell has a hover tooltip.
 * `below` renders extra SVG under the cells on the same x-scale (e.g. weekly % bars).
 */
import { useMemo, type PointerEvent, type ReactNode } from 'react';
import { bandScale, dateTicks, tint } from './chartUtils';
import {
  ChartTooltip,
  DateAxis,
  NoDataPattern,
  useContainerWidth,
  useDayCursor,
  useSafeId,
  VisuallyHidden,
} from './chartKit';
import cs from './charts.module.css';

export type StripCellKind = 'fill' | 'half' | 'outline' | 'muted' | 'nodata' | 'none';

export interface StripCell {
  date: string;
  kind: StripCellKind;
  /** CSS var() color for fill / outline. */
  color?: string;
}

export interface DayStripProps {
  cells: StripCell[];
  ariaLabel: string;
  describe: (i: number) => string;
  tooltip: (i: number) => ReactNode;
  onSelectDay?: (date: string) => void;
  cellHeight?: number;
  showAxis?: boolean;
  below?: (ctx: { x: ReturnType<typeof bandScale>; width: number; top: number }) => ReactNode;
  belowHeight?: number;
  /** Fallback width before measuring (jsdom). */
  fallbackWidth?: number;
}

export function DayStrip({
  cells,
  ariaLabel,
  describe,
  tooltip,
  onSelectDay,
  cellHeight = 18,
  showAxis = true,
  below,
  belowHeight = 0,
  fallbackWidth = 600,
}: DayStripProps) {
  const [ref, width] = useContainerWidth<HTMLDivElement>(fallbackWidth);
  const hatchId = useSafeId('strip-hatch');
  const n = cells.length;
  const x = bandScale(n, width, 0);
  const dates = useMemo(() => cells.map((c) => c.date), [cells]);
  const cursor = useDayCursor(n, { onSelect: (i) => onSelectDay?.(dates[i]) });

  const band = x.band;
  const gap = band > 6 ? 2 : band > 3 ? 1 : 0;
  const w = Math.max(0.6, band - gap);
  const thin = w < 5;
  const rx = Math.min(3, w / 4);
  const top = 2;
  const belowTop = top + cellHeight + (belowHeight ? 6 : 0);
  const axisTop = belowTop + belowHeight + 4;
  const height = axisTop + (showAxis ? 16 : 0);
  const active = cursor.active;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    cursor.setPointer(x.indexAt(e.clientX - rect.left));
  };

  return (
    <div
      ref={ref}
      className={`${cs.plot} ${cs.interactive}`}
      tabIndex={n ? 0 : -1}
      role="group"
      aria-label={ariaLabel}
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
          if (!onSelectDay || !n) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onSelectDay(dates[x.indexAt(e.clientX - rect.left)]);
        }}
      >
        <defs>
          <NoDataPattern id={hatchId} />
        </defs>
        {cells.map((c, i) => {
          const cx = x.left(i) + gap / 2;
          const color = c.color ?? 'var(--chart-s1)';
          const common = { 'data-date': c.date, 'data-kind': c.kind } as const;
          switch (c.kind) {
            case 'none':
              return null;
            case 'fill':
              return <rect key={i} {...common} x={cx} y={top} width={w} height={cellHeight} rx={rx} style={{ fill: color }} />;
            case 'muted':
              return <rect key={i} {...common} x={cx} y={top} width={w} height={cellHeight} rx={rx} style={{ fill: 'var(--no-data)' }} />;
            case 'nodata':
              return <rect key={i} {...common} x={cx} y={top} width={w} height={cellHeight} rx={rx} fill={`url(#${hatchId})`} />;
            case 'outline':
              return thin ? (
                <rect key={i} {...common} x={cx} y={top} width={w} height={cellHeight} style={{ fill: tint(color, 22) }} />
              ) : (
                <rect
                  key={i}
                  {...common}
                  x={cx + 0.65}
                  y={top + 0.65}
                  width={w - 1.3}
                  height={cellHeight - 1.3}
                  rx={rx}
                  style={{ fill: 'var(--surface)', stroke: color, strokeWidth: 1.3 }}
                />
              );
            case 'half':
              return thin ? (
                <rect key={i} {...common} x={cx} y={top} width={w} height={cellHeight} style={{ fill: tint(color, 55) }} />
              ) : (
                <g key={i} {...common}>
                  <rect
                    x={cx + 0.65}
                    y={top + 0.65}
                    width={w - 1.3}
                    height={cellHeight - 1.3}
                    rx={rx}
                    style={{ fill: 'var(--surface)', stroke: color, strokeWidth: 1.3 }}
                  />
                  <rect x={cx} y={top + cellHeight / 2} width={w} height={cellHeight / 2} rx={rx} style={{ fill: color }} />
                </g>
              );
          }
        })}
        {active != null && (
          <rect
            x={x.left(active) + gap / 2 - 1.5}
            y={top - 1.5}
            width={w + 3}
            height={cellHeight + 3}
            rx={rx + 1}
            style={{ fill: 'none', stroke: 'var(--text)', strokeWidth: 1.5 }}
          />
        )}
        {below?.({ x, width, top: belowTop })}
        {showAxis && <DateAxis dates={dates} ticks={dateTicks(dates, band, 56)} center={x.center} y={axisTop} x0={0} x1={width} />}
      </svg>
      {active != null && (
        <ChartTooltip x={x.center(active)} y={top} containerWidth={width}>
          {tooltip(active)}
        </ChartTooltip>
      )}
      <VisuallyHidden live>{active != null && cursor.viaKeyboard ? describe(active) : ''}</VisuallyHidden>
    </div>
  );
}
