/**
 * CalendarHeatmap — "how many days this month were hard?"
 * Month grids (Mon–Sun columns), one block per month in the window. Cells are real
 * <button>s (roving tabindex, arrow keys move by day/week) so the calendar is fully
 * keyboard-accessible. Three visually distinct states are never confused:
 *   value (solid fill) · logged-but-no-answer (outline) · no entry (hatched).
 */
import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { DaySummary, Severity } from '@shared/types';
import type { CalendarColorBy, CalendarHeatmapProps } from './types';
import {
  addDays,
  asNeededText,
  dayOfMonth,
  fmtDay,
  fmtDayLong,
  fmtMonth,
  plural,
  SEVERITY_VAR,
  tint,
  weekdayMon0,
  ZONE_VAR,
} from './chartUtils';
import { ChartTooltip, EmptyState, Legend, TooltipRow, TooltipTitle, useContainerWidth, type SwatchKind } from './chartKit';
import cs from './charts.module.css';
import s from './CalendarHeatmap.module.css';

type CellStyle = 'fill' | 'outline' | 'half' | 'nodata' | 'empty';

interface Category {
  key: string;
  style: CellStyle;
  color?: string;
  /** Phrase used in aria-labels / tooltips ("yellow zone"). */
  phrase: string;
  /** Legend text, compact and plain-language (visit mode). */
  legend: string;
  legendLarge: string;
  /** Concerning state — gets a non-color "!" badge in large mode. */
  alert?: boolean;
  order: number;
}

const NO_ENTRY: Category = {
  key: 'nodata',
  style: 'nodata',
  phrase: 'no entry',
  legend: 'No entry',
  legendLarge: 'No entry',
  order: 90,
};

const NO_ANSWER: Category = {
  key: 'noanswer',
  style: 'empty',
  phrase: 'no answers logged',
  legend: 'No answers',
  legendLarge: 'Logged, no answers',
  order: 80,
};

function answeredDay(d: DaySummary): boolean {
  return d.submissionCount - d.blankSubmissionCount > 0;
}

function categorize(d: DaySummary, colorBy: CalendarColorBy, feelingLabels: Map<Severity, string>): Category {
  if (colorBy === 'adherence') {
    if (d.scheduledDosesExpected <= 0)
      return { key: 'none', style: 'empty', phrase: 'no doses expected', legend: 'None expected', legendLarge: 'No doses due', order: 4 };
    const r = d.scheduledDosesTaken / d.scheduledDosesExpected;
    if (r >= 1)
      return { key: 'all', style: 'fill', color: 'var(--chart-s1)', phrase: 'all doses taken', legend: 'All doses', legendLarge: 'All doses taken', order: 1 };
    if (r > 0)
      return { key: 'some', style: 'half', color: 'var(--chart-s1)', phrase: 'some doses taken', legend: 'Some doses', legendLarge: 'Some doses taken', order: 2, alert: true };
    return { key: 'missed', style: 'outline', color: 'var(--chart-s1)', phrase: 'no doses marked taken', legend: 'No doses', legendLarge: 'No doses taken', order: 3, alert: true };
  }
  if (!d.hasData) return NO_ENTRY;
  switch (colorBy) {
    case 'zone':
      if (d.zone === 'green')
        return { key: 'green', style: 'fill', color: ZONE_VAR.green, phrase: 'green zone', legend: 'Green', legendLarge: 'Green zone · doing well', order: 1 };
      if (d.zone === 'yellow')
        return { key: 'yellow', style: 'fill', color: ZONE_VAR.yellow, phrase: 'yellow zone', legend: 'Yellow', legendLarge: 'Yellow zone · caution', order: 2, alert: true };
      if (d.zone === 'red')
        return { key: 'red', style: 'fill', color: ZONE_VAR.red, phrase: 'red zone', legend: 'Red', legendLarge: 'Red zone · get help', order: 3, alert: true };
      return { key: 'nozone', style: 'fill', color: 'var(--unknown)', phrase: 'zone not determined', legend: 'No zone', legendLarge: 'Logged, zone unknown', order: 4 };
    case 'hardDay':
      if (d.hardDay)
        return { key: 'hard', style: 'fill', color: 'var(--concern)', phrase: 'hard day', legend: 'Hard day', legendLarge: 'Hard day', order: 2, alert: true };
      if (!answeredDay(d) && !d.zone) return NO_ANSWER;
      return { key: 'good', style: 'fill', color: 'var(--zone-green)', phrase: 'good day', legend: 'Good day', legendLarge: 'Good day', order: 1 };
    case 'symptomDay':
      if (d.symptomDay)
        return { key: 'sym', style: 'fill', color: 'var(--watch)', phrase: 'symptom day', legend: 'Symptoms', legendLarge: 'Had symptoms', order: 2, alert: true };
      if (!answeredDay(d)) return NO_ANSWER;
      return { key: 'nosym', style: 'fill', color: 'var(--zone-green)', phrase: 'no symptoms', legend: 'No symptoms', legendLarge: 'No symptoms', order: 1 };
    case 'feeling': {
      const f = d.feeling;
      if (!f) return NO_ANSWER;
      if (f.severity == null)
        return { key: 'unrated', style: 'fill', color: 'var(--unknown)', phrase: `felt ${f.label.toLowerCase()}`, legend: 'Unrated', legendLarge: 'Answer not rated', order: 5 };
      const name = feelingLabels.get(f.severity) ?? f.label;
      return {
        key: `sev${f.severity}`,
        style: 'fill',
        color: SEVERITY_VAR[f.severity],
        phrase: `felt ${f.label.toLowerCase()}`,
        legend: name,
        legendLarge: `Felt ${name.toLowerCase()}`,
        order: f.severity,
        alert: f.severity >= 2,
      };
    }
  }
  return NO_ENTRY;
}

function swatchFor(c: Category): SwatchKind {
  return c.style === 'empty' ? 'outline' : c.style;
}

function describeDay(d: DaySummary, cat: Category, colorBy: CalendarColorBy): string {
  const parts: string[] = [cat.phrase];
  if (d.hasData) {
    if (colorBy !== 'feeling' && d.feeling) parts.push(`felt ${d.feeling.label.toLowerCase()}`);
    if (d.symptoms.length) parts.push(d.symptoms.map((x) => x.toLowerCase()).join(', '));
    const an = asNeededText(d.doses, d.asNeededUses);
    if (an) parts.push(an);
    if (colorBy !== 'adherence' && d.scheduledDosesExpected > 0 && d.scheduledDosesTaken < d.scheduledDosesExpected)
      parts.push(`${d.scheduledDosesTaken} of ${d.scheduledDosesExpected} scheduled doses`);
    if (d.discordant) parts.push('feeling does not match symptoms or peak flow');
  }
  return `${fmtDay(d.date)}: ${parts.join(', ')}`;
}

interface MonthBlock {
  key: string; // YYYY-MM
  leading: number; // blank cells before day 1 of the month
  /** Every calendar day of the month; `day` undefined when outside the window. */
  cells: { date: string; day?: DaySummary; index?: number }[];
}

/** Compact mode drops week rows that contain no in-window day (saves vertical space). */
function hiddenWeek(m: MonthBlock, slot: number): boolean {
  const row = Math.floor(slot / 7);
  for (let k = row * 7 - m.leading; k < row * 7 - m.leading + 7; k++) if (m.cells[k]?.day) return false;
  return true;
}

function buildMonths(days: DaySummary[]): MonthBlock[] {
  const byDate = new Map(days.map((d, i) => [d.date, i]));
  const months: MonthBlock[] = [];
  const seen = new Set<string>();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    if (seen.has(key)) continue;
    seen.add(key);
    const first = `${key}-01`;
    const cells: MonthBlock['cells'] = [];
    for (let cur = first; cur.slice(0, 7) === key; cur = addDays(cur, 1)) {
      const idx = byDate.get(cur);
      cells.push({ date: cur, day: idx != null ? days[idx] : undefined, index: idx });
    }
    months.push({ key, leading: weekdayMon0(first), cells });
  }
  return months;
}

export function CalendarHeatmap({
  days,
  colorBy,
  selectedDate,
  onSelectDay,
  highlightDates,
  size = 'compact',
  showMarkers = false,
}: CalendarHeatmapProps) {
  const [rootRef, width] = useContainerWidth<HTMLDivElement>(640);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [hover, setHover] = useState<{ date: string; x: number; y: number } | null>(null);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const large = size === 'large';

  const feelingLabels = useMemo(() => {
    const m = new Map<Severity, string>();
    for (const d of days) if (d.feeling?.severity != null && !m.has(d.feeling.severity)) m.set(d.feeling.severity, d.feeling.label);
    return m;
  }, [days]);

  const cats = useMemo(() => days.map((d) => categorize(d, colorBy, feelingLabels)), [days, colorBy, feelingLabels]);
  const months = useMemo(() => buildMonths(days), [days]);
  const highlight = useMemo(() => new Set(highlightDates ?? []), [highlightDates]);
  const indexOf = useMemo(() => new Map(days.map((d, i) => [d.date, i])), [days]);

  const legendItems = useMemo(() => {
    const counts = new Map<string, { cat: Category; n: number }>();
    for (const c of cats) {
      const e = counts.get(c.key);
      if (e) e.n += 1;
      else counts.set(c.key, { cat: c, n: 1 });
    }
    return [...counts.values()]
      .sort((a, b) => a.cat.order - b.cat.order)
      .map(({ cat, n }) => ({
        kind: swatchFor(cat),
        color: cat.color,
        label: large ? cat.legendLarge : cat.legend,
        count: large ? plural(n, 'day') : n,
        key: cat.key,
        n,
      }));
  }, [cats, large]);

  if (days.length === 0) return <EmptyState />;

  const summary = `Calendar of ${plural(days.length, 'day')} (${fmtDay(days[0].date)} – ${fmtDay(
    days[days.length - 1].date,
  )}) colored by ${colorLabel(colorBy)}: ${legendItems.map((l) => `${l.n} ${(l.label as string).toLowerCase()}`).join(', ')}.`;

  const defaultTab =
    (selectedDate && indexOf.has(selectedDate) && selectedDate) ||
    [...days].reverse().find((d) => d.hasData)?.date ||
    days[days.length - 1].date;
  const tabDate = focusDate && indexOf.has(focusDate) ? focusDate : defaultTab;

  const showTip = (date: string, el: HTMLElement) => {
    const root = rootRef.current;
    if (!root) return;
    const rb = root.getBoundingClientRect();
    const cb = el.getBoundingClientRect();
    setHover({ date, x: cb.left - rb.left + cb.width / 2, y: cb.top - rb.top });
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let target: string | undefined;
    if (e.key in delta) target = addDays(date, delta[e.key]);
    else if (e.key === 'Home') target = days[0].date;
    else if (e.key === 'End') target = days[days.length - 1].date;
    else if (e.key === 'Escape') {
      setHover(null);
      return;
    } else return;
    e.preventDefault();
    if (!indexOf.has(target)) return;
    setFocusDate(target);
    const btn = buttons.current.get(target);
    btn?.focus();
  };

  const hoverDay = hover ? days[indexOf.get(hover.date) ?? -1] : undefined;
  const hoverCat = hover ? cats[indexOf.get(hover.date) ?? -1] : undefined;

  return (
    <figure
      ref={rootRef}
      className={`${cs.root} ${s.calendar} ${large ? s.large : s.compact}`}
      role="group"
      aria-label={summary}
    >
      <div className={s.months}>
        {months.map((m) => (
          <div key={m.key} className={s.month}>
            <div className={s.monthTitle} aria-hidden="true">
              {fmtMonth(m.key)}
            </div>
            <div className={s.grid} role="presentation">
              {(large ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']).map((w, i) => (
                <div key={i} className={s.weekday} aria-hidden="true">
                  {w}
                </div>
              ))}
              {Array.from({ length: m.leading }, (_, i) => (
                <div key={`l${i}`} className={s.blank} aria-hidden="true" />
              )).filter((_, i) => large || !hiddenWeek(m, i))}
              {m.cells.map(({ date, day, index }, ci) => {
                if (!large && hiddenWeek(m, m.leading + ci)) return null;
                if (!day || index == null)
                  return (
                    <div key={date} className={`${s.blank} ${s.outside}`} aria-hidden="true">
                      {large && <span className={s.outsideNum}>{dayOfMonth(date)}</span>}
                    </div>
                  );
                const cat = cats[index];
                const selected = selectedDate === date;
                const hl = highlight.has(date);
                const missed =
                  showMarkers && day.scheduledDosesExpected > 0 && day.scheduledDosesTaken < day.scheduledDosesExpected && colorBy !== 'adherence';
                const used = showMarkers && day.asNeededUses > 0;
                const style = { '--cell': cat.color ?? 'var(--border-strong)', '--cell-tint': tint(cat.color ?? 'var(--border-strong)', 18) } as CSSProperties;
                const label = describeDay(day, cat, colorBy) + (selected ? ' (selected)' : '') + (hl ? ' (flagged)' : '');
                return (
                  <button
                    key={date}
                    ref={(el) => {
                      if (el) buttons.current.set(date, el);
                      else buttons.current.delete(date);
                    }}
                    type="button"
                    className={`${s.cell} ${s['st_' + cat.style]} ${selected ? s.selected : ''} ${hl ? s.highlighted : ''} ${
                      onSelectDay ? '' : s.static
                    }`}
                    style={style}
                    tabIndex={date === tabDate ? 0 : -1}
                    aria-label={label}
                    aria-pressed={onSelectDay ? selected : undefined}
                    data-date={date}
                    data-category={cat.key}
                    onClick={() => onSelectDay?.(date)}
                    onKeyDown={(e) => onKey(e, date)}
                    onFocus={(e) => {
                      setFocusDate(date);
                      showTip(date, e.currentTarget);
                    }}
                    onBlur={() => setHover(null)}
                    onPointerEnter={(e) => showTip(date, e.currentTarget)}
                    onPointerLeave={() => setHover(null)}
                  >
                    {large && <span className={s.dayNum}>{dayOfMonth(date)}</span>}
                    {large && cat.alert && (
                      <span className={s.alert} aria-hidden="true">
                        !
                      </span>
                    )}
                    {used && <span className={s.markerDot} aria-hidden="true" data-marker="asNeeded" />}
                    {missed && <span className={s.markerRing} aria-hidden="true" data-marker="missed" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <Legend
        size={size}
        items={[
          ...legendItems,
          ...(showMarkers
            ? [
                { kind: 'dot' as const, color: 'var(--text)', label: large ? 'Used quick-relief medicine' : 'As-needed med used' },
                ...(colorBy !== 'adherence'
                  ? [{ kind: 'ring' as const, color: 'var(--text)', label: large ? 'Missed a daily dose' : 'Scheduled dose missed' }]
                  : []),
              ]
            : []),
        ]}
      />

      {hover && hoverDay && hoverCat && (
        <ChartTooltip x={hover.x} y={hover.y} containerWidth={width}>
          <TooltipTitle>{fmtDayLong(hoverDay.date)}</TooltipTitle>
          <TooltipRow value={capitalize(hoverCat.phrase)} color={hoverCat.color} keyShape="dot" />
          {hoverDay.hasData && <DayDetails day={hoverDay} />}
        </ChartTooltip>
      )}
    </figure>
  );
}

function DayDetails({ day }: { day: DaySummary }) {
  const an = asNeededText(day.doses, day.asNeededUses);
  return (
    <>
      {day.feeling && (
        <TooltipRow
          value={day.feeling.label}
          label={day.feeling.changedDuringDay && day.feeling.sequence?.length > 1 ? `feeling (${day.feeling.sequence.join(' → ')})` : 'feeling'}
          color={day.feeling.severity != null ? SEVERITY_VAR[day.feeling.severity] : 'var(--unknown)'}
          keyShape="dot"
        />
      )}
      {day.symptoms.length > 0 && <TooltipRow value={day.symptoms.join(', ')} />}
      {day.scheduledDosesExpected > 0 && (
        <TooltipRow value={`${day.scheduledDosesTaken} of ${day.scheduledDosesExpected}`} label="scheduled doses" />
      )}
      {an && <TooltipRow value={an} label="as needed" />}
      {day.spirometry?.pctPersonalBest != null && (
        <TooltipRow value={`${day.spirometry.pctPersonalBest}%`} label={`of best peak flow (${day.spirometry.pefLpm} L/min)`} />
      )}
      {day.discordant && <div className={cs.tooltipWarn}>Feeling doesn’t match symptoms / peak flow</div>}
    </>
  );
}

function capitalize(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function colorLabel(c: CalendarColorBy): string {
  return { zone: 'action-plan zone', hardDay: 'hard vs good days', symptomDay: 'symptom days', feeling: 'feeling', adherence: 'scheduled doses taken' }[c];
}
