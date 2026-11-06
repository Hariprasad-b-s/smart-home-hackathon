/**
 * ZoneDistributionBar — 100 % stacked green / yellow / red / unknown days in the window.
 * Segments are separated by a 2px surface gap; "unknown" uses the hatched no-data fill so
 * it never reads as a zone. Counts + plain-language labels in the legend.
 */
import { useState } from 'react';
import type { ZoneDistributionBarProps } from './types';
import { plural, ZONE_VAR } from './chartUtils';
import { ChartTooltip, EmptyState, Legend, TooltipRow, useContainerWidth } from './chartKit';
import cs from './charts.module.css';
import s from './ZoneDistributionBar.module.css';

const SEGMENTS = [
  { key: 'green', color: ZONE_VAR.green, label: 'Green', plain: 'Green · doing well' },
  { key: 'yellow', color: ZONE_VAR.yellow, label: 'Yellow', plain: 'Yellow · caution' },
  { key: 'red', color: ZONE_VAR.red, label: 'Red', plain: 'Red · get help' },
  { key: 'unknown', color: undefined, label: 'Unknown', plain: 'No zone / no entry' },
] as const;

export function ZoneDistributionBar({ zoneDays, showLegend = true }: ZoneDistributionBarProps) {
  const [ref, width] = useContainerWidth<HTMLDivElement>(400);
  const [hover, setHover] = useState<{ key: string; x: number } | null>(null);
  const total = zoneDays.green + zoneDays.yellow + zoneDays.red + zoneDays.unknown;
  if (total === 0) return <EmptyState>No zone data in this period</EmptyState>;

  const pct = (n: number) => Math.round((n / total) * 100);
  const segs = SEGMENTS.map((g) => ({ ...g, n: zoneDays[g.key] })).filter((g) => g.n > 0);
  const summary = `Action plan zones over ${plural(total, 'day')}: ${SEGMENTS.map((g) => `${zoneDays[g.key]} ${g.label.toLowerCase()}`).join(', ')}.`;
  const hovered = hover ? segs.find((g) => g.key === hover.key) : undefined;

  return (
    <figure ref={ref} className={cs.root}>
      <div className={s.bar} role="img" aria-label={summary}>
        {segs.map((g) => (
          <div
            key={g.key}
            className={`${s.seg} ${g.key === 'unknown' ? s.unknown : ''}`}
            style={{ flexGrow: g.n, background: g.color }}
            data-zone={g.key}
            data-count={g.n}
            onPointerEnter={(e) => {
              const root = ref.current?.getBoundingClientRect();
              const r = e.currentTarget.getBoundingClientRect();
              setHover({ key: g.key, x: root ? r.left - root.left + r.width / 2 : 0 });
            }}
            onPointerLeave={() => setHover(null)}
          />
        ))}
      </div>
      {hovered && hover && (
        <ChartTooltip x={hover.x} y={0} containerWidth={width}>
          <TooltipRow value={plural(hovered.n, 'day')} label={`${hovered.plain} (${pct(hovered.n)}%)`} color={hovered.color ?? 'var(--unknown)'} keyShape="dot" />
        </ChartTooltip>
      )}
      {showLegend && (
        <Legend
          items={SEGMENTS.map((g) => ({
            kind: g.color ? ('fill' as const) : ('nodata' as const),
            color: g.color,
            label: g.plain,
            count: `${zoneDays[g.key]} d · ${pct(zoneDays[g.key])}%`,
          }))}
        />
      )}
    </figure>
  );
}
