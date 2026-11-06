/**
 * AdherenceStrip — "is the patient taking the scheduled medicine?"
 * Daily cells: filled = all doses taken · half = partial · outline = none marked taken ·
 * gray = no dose expected. Weekly % bars below with an 80 % reference line.
 * The header ("Dulera · 2 puffs twice daily · 64%") is rendered by the caller.
 */
import { useMemo } from 'react';
import type { AdherenceStripProps } from './types';
import { addDays, fmtDay, fmtDayLong, plural, roundedTopBar, tint } from './chartUtils';
import { EmptyState, Legend, TooltipRow, TooltipTitle } from './chartKit';
import { DayStrip, type StripCell } from './DayStrip';
import cs from './charts.module.css';

const WEEKLY_H = 46;
const GOAL = 80;

export function AdherenceStrip({ medication, showWeekly = true, onSelectDay }: AdherenceStripProps) {
  const daily = medication.daily;
  const through = medication.measuredThrough;
  /** Days after `measuredThrough` are not measured (patient stopped logging) — not "missed". */
  const unmeasured = (date: string) => through != null && date > through;
  const cells = useMemo<StripCell[]>(
    () =>
      daily.map((d) => ({
        date: d.date,
        color: 'var(--chart-s1)',
        kind:
          through != null && d.date > through
            ? 'nodata'
            : d.expected <= 0
              ? 'muted'
              : d.taken >= d.expected
                ? 'fill'
                : d.taken > 0
                  ? 'half'
                  : 'outline',
      })),
    [daily, through],
  );
  const indexOf = useMemo(() => new Map(daily.map((d, i) => [d.date, i])), [daily]);

  if (daily.length === 0) return <EmptyState>No doses scheduled in this period</EmptyState>;

  const measured = daily.filter((d) => !unmeasured(d.date));
  const full = measured.filter((d) => d.expected > 0 && d.taken >= d.expected).length;
  const partial = measured.filter((d) => d.expected > 0 && d.taken > 0 && d.taken < d.expected).length;
  const missed = measured.filter((d) => d.expected > 0 && d.taken === 0).length;
  const notExpected = measured.filter((d) => d.expected <= 0).length;
  const notMeasured = daily.length - measured.length;
  const pctText = medication.adherencePct == null ? 'no doses expected' : `${medication.adherencePct}% of doses marked taken`;
  const weeklyText = medication.weekly
    .filter((w) => w.pct != null)
    .map((w) => `week of ${fmtDay(w.weekStart)} ${w.pct}%`)
    .join(', ');
  const summary =
    `${medication.name} adherence ${fmtDay(daily[0].date)} – ${fmtDay(daily[daily.length - 1].date)}: ${pctText} ` +
    `(${medication.dosesTaken} of ${medication.dosesExpected}). ${plural(full, 'day')} all doses, ${plural(partial, 'day')} partial, ` +
    `${plural(missed, 'day')} none marked taken.` +
    (notMeasured && through ? ` Not measured after ${fmtDay(through)} (no app activity; ${plural(notMeasured, 'day')}).` : '') +
    (showWeekly && weeklyText ? ` Weekly: ${weeklyText}.` : '');

  const describe = (i: number) => {
    const d = daily[i];
    if (unmeasured(d.date)) return `${fmtDay(d.date)}: not measured, no app activity`;
    if (d.expected <= 0) return `${fmtDay(d.date)}: no dose expected`;
    return `${fmtDay(d.date)}: ${d.taken} of ${d.expected} doses taken`;
  };

  return (
    <figure className={cs.root} aria-label={summary} role="group">
      <DayStrip
        cells={cells}
        ariaLabel={`${medication.name} daily doses. Use arrow keys to move between days${onSelectDay ? ', Enter to open a day' : ''}.`}
        describe={describe}
        onSelectDay={onSelectDay}
        tooltip={(i) => {
          const d = daily[i];
          return (
            <>
              <TooltipTitle>{fmtDayLong(d.date)}</TooltipTitle>
              {unmeasured(d.date) ? (
                <TooltipRow value="Not measured" label="no app activity after this point" />
              ) : d.expected > 0 ? (
                <TooltipRow
                  value={`${d.taken} of ${d.expected}`}
                  label={d.taken >= d.expected ? 'doses · all taken' : d.taken > 0 ? 'doses · partial' : 'doses · none marked taken'}
                  color="var(--chart-s1)"
                />
              ) : (
                <TooltipRow value="No dose expected" />
              )}
            </>
          );
        }}
        belowHeight={showWeekly ? WEEKLY_H : 0}
        below={
          showWeekly
            ? ({ x, width, top }) => {
                const h = WEEKLY_H - 14;
                const base = top + WEEKLY_H;
                const yGoal = base - (GOAL / 100) * h;
                return (
                  <g data-testid="weekly-bars">
                    <line x1={0} x2={width} y1={base + 0.5} y2={base + 0.5} style={{ stroke: 'var(--grid)' }} />
                    {medication.weekly.map((wk) => {
                      // Clamp the ISO week to the window.
                      let first = -1;
                      let last = -1;
                      for (let k = 0; k < 7; k++) {
                        const idx = indexOf.get(addDays(wk.weekStart, k));
                        if (idx == null) continue;
                        if (first < 0) first = idx;
                        last = idx;
                      }
                      if (first < 0) return null;
                      const spanL = x.left(first);
                      const spanW = x.left(last + 1) - spanL;
                      const bw = Math.max(2, Math.min(spanW - 4, 28));
                      const bx = spanL + (spanW - bw) / 2;
                      const cx = spanL + spanW / 2;
                      if (wk.pct == null)
                        return (
                          <text key={wk.weekStart} className={cs.axisText} x={cx} y={base - 4} textAnchor="middle">
                            —
                          </text>
                        );
                      const bh = Math.max(wk.pct > 0 ? 2 : 0, (Math.min(wk.pct, 100) / 100) * h);
                      return (
                        <g key={wk.weekStart} data-week={wk.weekStart} data-pct={wk.pct}>
                          <path
                            d={roundedTopBar(bx, base - bh, bw, bh, 3)}
                            style={{ fill: wk.pct >= GOAL ? 'var(--chart-s1)' : tint('var(--chart-s1)', 45) }}
                          />
                          {spanW >= 26 && (
                            <text className={cs.axisText} x={cx} y={base - bh - 3} textAnchor="middle" style={{ fill: 'var(--text-2)' }}>
                              {wk.pct}%
                            </text>
                          )}
                        </g>
                      );
                    })}
                    <line x1={0} x2={width} y1={yGoal + 0.5} y2={yGoal + 0.5} style={{ stroke: 'var(--text-3)', strokeWidth: 1 }} />
                  </g>
                );
              }
            : undefined
        }
      />
      <Legend
        items={[
          { kind: 'fill', color: 'var(--chart-s1)', label: 'All taken', count: full },
          ...(partial ? [{ kind: 'half' as const, color: 'var(--chart-s1)', label: 'Partial', count: partial }] : []),
          { kind: 'outline', color: 'var(--chart-s1)', label: 'None marked', count: missed },
          ...(notExpected ? [{ kind: 'fill' as const, color: 'var(--no-data)', label: 'Not expected', count: notExpected }] : []),
          ...(notMeasured ? [{ kind: 'nodata' as const, label: 'Not measured (no app use)', count: notMeasured }] : []),
          ...(showWeekly ? [{ kind: 'line' as const, color: 'var(--text-3)', label: `Weekly % (line = ${GOAL}% goal)` }] : []),
        ]}
      />
    </figure>
  );
}
