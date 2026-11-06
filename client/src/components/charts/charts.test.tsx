// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  AdherenceStrip,
  AsNeededBars,
  CalendarHeatmap,
  DailyTimeline,
  QuestionWidget,
  Sparkline,
  SpirometryTrendChart,
  ZoneDistributionBar,
} from './index';
import ChartGallery from './ChartGallery';
import { makeAsthmaFixture, makeEmptyFixture, makeMigraineFixture } from './__fixtures__/fixtures';
import { dateTicks, fmtDay, niceTicks, dateRange } from './chartUtils';

const rich = makeAsthmaFixture({ days: 30, density: 'rich' });
const sparse = makeAsthmaFixture({ days: 90, density: 'sparse', seed: 11 });
const empty = makeEmptyFixture({ days: 30 });
const migraine = makeMigraineFixture({ days: 30 });

describe('fixtures', () => {
  it('produce one DaySummary per window day and consistent zone counts', () => {
    expect(rich.days).toHaveLength(30);
    expect(sparse.days).toHaveLength(90);
    const z = rich.zoneDays!;
    expect(z.green + z.yellow + z.red + z.unknown).toBe(30);
    expect(rich.days.some((d) => !d.hasData)).toBe(true);
    expect(rich.days.some((d) => d.discordant)).toBe(true);
    expect(rich.spirometry!.sessions.some((s) => !s.reliable)).toBe(true);
    const kinds = new Set(rich.questions.map((q) => q.kind));
    expect([...kinds].sort()).toEqual(['boolean', 'categorical', 'multi', 'numeric', 'text']);
  });
});

describe('chartUtils', () => {
  it('formats dates as "Mar 4" using UTC math', () => {
    expect(fmtDay('2026-03-04')).toBe('Mar 4');
    expect(dateRange('2026-03-28', '2026-04-02')).toHaveLength(6);
  });
  it('builds nice ticks and spaced date ticks', () => {
    expect(niceTicks(0, 10, 4)).toEqual([0, 2.5, 5, 7.5, 10]);
    const dates = dateRange('2026-10-01', '2026-10-30');
    const t = dateTicks(dates, 4, 52);
    expect(t.length).toBeGreaterThan(1);
    expect(t.length).toBeLessThan(8);
  });
});

describe('CalendarHeatmap', () => {
  it('renders one button per day with descriptive aria-labels', () => {
    const { container } = render(<CalendarHeatmap days={rich.days} colorBy="zone" />);
    const cells = container.querySelectorAll('button[data-date]');
    expect(cells).toHaveLength(30);
    const last = rich.days[29];
    const btn = container.querySelector(`button[data-date="${last.date}"]`)!;
    expect(btn.getAttribute('aria-label')).toMatch(new RegExp(`^${fmtDay(last.date)}: `));
    // Group label summarises counts
    expect(screen.getByRole('group', { name: /colored by action-plan zone/ })).toBeTruthy();
  });

  it('never colors no-data days as good', () => {
    const { container } = render(<CalendarHeatmap days={rich.days} colorBy="hardDay" />);
    for (const d of rich.days.filter((x) => !x.hasData)) {
      const el = container.querySelector(`button[data-date="${d.date}"]`)!;
      expect(el.getAttribute('data-category')).toBe('nodata');
      expect(el.getAttribute('aria-label')).toContain('no entry');
    }
  });

  it('fires onSelectDay on click and moves focus with arrow keys', () => {
    const onSelect = vi.fn();
    const { container } = render(<CalendarHeatmap days={rich.days} colorBy="feeling" onSelectDay={onSelect} />);
    const d = rich.days[10].date;
    const btn = container.querySelector<HTMLButtonElement>(`button[data-date="${d}"]`)!;
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledWith(d);
    btn.focus();
    fireEvent.keyDown(btn, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('data-date')).toBe(rich.days[11].date);
    // only one tab stop (roving tabindex)
    expect(container.querySelectorAll('button[data-date][tabindex="0"]')).toHaveLength(1);
  });

  it('shows markers, large plain-language legend and selection state', () => {
    const { container } = render(
      <CalendarHeatmap days={rich.days} colorBy="hardDay" size="large" showMarkers selectedDate={rich.days[5].date} onSelectDay={() => {}} />,
    );
    const usedDays = rich.days.filter((d) => d.asNeededUses > 0).length;
    expect(container.querySelectorAll('[data-marker="asNeeded"]')).toHaveLength(usedDays);
    const missed = rich.days.filter((d) => d.scheduledDosesTaken < d.scheduledDosesExpected).length;
    expect(container.querySelectorAll('[data-marker="missed"]')).toHaveLength(missed);
    expect(screen.getByText('Hard day')).toBeTruthy();
    expect(screen.getByText('No entry')).toBeTruthy();
    expect(container.querySelector(`button[data-date="${rich.days[5].date}"]`)!.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders the empty state with no days', () => {
    render(<CalendarHeatmap days={[]} colorBy="zone" />);
    expect(screen.getByText('No data in this period')).toBeTruthy();
  });
});

describe('DailyTimeline', () => {
  const rows = ['feeling', 'symptoms', 'scheduledDoses', 'asNeeded', 'peakFlow', 'zone'] as const;

  it('stacks the requested rows and hatches no-data days', () => {
    const { container } = render(<DailyTimeline days={rich.days} rows={[...rows]} spirometry={rich.spirometry} />);
    expect(container.querySelectorAll('g[data-row]')).toHaveLength(rows.length);
    expect(container.querySelectorAll('[data-nodata]')).toHaveLength(rich.days.filter((d) => !d.hasData).length);
    expect(container.querySelectorAll('[data-discordant]')).toHaveLength(rich.days.filter((d) => d.discordant && d.feeling).length);
    expect(screen.getByRole('group', { name: /^Daily timeline/ })).toBeTruthy();
  });

  it('applies row label overrides', () => {
    render(<DailyTimeline days={migraine.days} rows={['asNeeded']} rowLabels={{ asNeeded: 'Excedrin uses' }} />);
    expect(screen.getByText(/Excedrin/)).toBeTruthy();
  });

  it('selects days by keyboard and click', () => {
    const onSelect = vi.fn();
    render(<DailyTimeline days={rich.days} rows={['feeling', 'zone']} onSelectDay={onSelect} />);
    const focusable = screen.getByRole('group', { name: /Day-by-day details/ });
    fireEvent.focus(focusable);
    const lastData = [...rich.days].reverse().find((d) => d.hasData)!;
    fireEvent.keyDown(focusable, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(lastData.date);
    fireEvent.keyDown(focusable, { key: 'Home' });
    fireEvent.keyDown(focusable, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(rich.days[0].date);
    const svg = focusable.querySelector('svg')!;
    fireEvent.click(svg, { clientX: 10_000 });
    expect(onSelect).toHaveBeenLastCalledWith(rich.days[29].date);
  });

  it('empty state', () => {
    render(<DailyTimeline days={[]} rows={['feeling']} />);
    expect(screen.getByText('No data in this period')).toBeTruthy();
  });
});

describe('AdherenceStrip', () => {
  const med = rich.scheduled[0];
  it('renders a cell per day plus weekly bars and a summary', () => {
    const { container } = render(<AdherenceStrip medication={med} />);
    expect(container.querySelectorAll('[data-kind]')).toHaveLength(med.daily.length);
    expect(container.querySelectorAll('[data-week]').length).toBeGreaterThan(3);
    expect(screen.getByRole('group', { name: new RegExp(`${med.adherencePct}% of doses marked taken`) })).toBeTruthy();
    const full = med.daily.filter((d) => d.taken >= d.expected).length;
    expect(container.querySelectorAll('[data-kind="fill"]')).toHaveLength(full);
  });
  it('hides weekly bars and selects via keyboard', () => {
    const onSelect = vi.fn();
    const { container } = render(<AdherenceStrip medication={med} showWeekly={false} onSelectDay={onSelect} />);
    expect(container.querySelector('[data-testid="weekly-bars"]')).toBeNull();
    const g = container.querySelector('[tabindex="0"]')!;
    fireEvent.focus(g);
    fireEvent.keyDown(g, { key: 'ArrowLeft' });
    fireEvent.keyDown(g, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(med.daily[med.daily.length - 2].date);
  });
  it('renders days after measuredThrough as no data, not missed', () => {
    const through = med.daily[24].date;
    const { container } = render(<AdherenceStrip medication={{ ...med, measuredThrough: through }} />);
    const after = med.daily.slice(25);
    for (const d of after) expect(container.querySelector(`[data-date="${d.date}"]`)!.getAttribute('data-kind')).toBe('nodata');
    expect(screen.getByText('Not measured (no app use)')).toBeTruthy();
    expect(screen.getByRole('group', { name: new RegExp(`Not measured after ${fmtDay(through)}`) })).toBeTruthy();
  });
  it('empty daily', () => {
    render(<AdherenceStrip medication={{ ...med, daily: [], weekly: [] }} />);
    expect(screen.getByText(/No doses scheduled/)).toBeTruthy();
  });
});

describe('AsNeededBars', () => {
  it('draws one bar per day with use', () => {
    const med = rich.asNeeded[0];
    const { container } = render(<AsNeededBars medication={med} />);
    expect(container.querySelectorAll('path[data-uses]')).toHaveLength(med.daily.filter((d) => d.uses > 0).length);
    expect(screen.getByRole('group', { name: new RegExp(`used on ${med.daysUsed} day`) })).toBeTruthy();
    expect(screen.getByText(/more than 2 days a week/)).toBeTruthy();
  });
  it('abortive meds omit the asthma guide', () => {
    render(<AsNeededBars medication={migraine.asNeeded[0]} />);
    expect(screen.queryByText(/more than 2 days a week/)).toBeNull();
  });
});

describe('SpirometryTrendChart', () => {
  const sp = rich.spirometry!;
  it('plots each session with hollow markers for unreliable ones and zone bands', () => {
    const { container } = render(
      <SpirometryTrendChart spirometry={sp} metric="pctPersonalBest" showZoneBands windowStart={rich.window.start} windowEnd={rich.window.end} />,
    );
    expect(container.querySelectorAll('circle[data-date]')).toHaveLength(sp.sessions.length);
    expect(container.querySelectorAll('circle[data-reliable="false"]')).toHaveLength(sp.sessions.filter((s) => !s.reliable).length);
    expect(container.querySelector('[data-testid="zone-bands"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="personal-best"]')).not.toBeNull();
    expect(screen.getByText(/Peak flow, % of personal best \(%\)/)).toBeTruthy();
  });
  it('no zone bands for FEV1 and units in label', () => {
    const { container } = render(
      <SpirometryTrendChart spirometry={sp} metric="fev1" showZoneBands windowStart={rich.window.start} windowEnd={rich.window.end} />,
    );
    expect(container.querySelector('[data-testid="zone-bands"]')).toBeNull();
    expect(screen.getByText('FEV1 (L)')).toBeTruthy();
  });
  it('keyboard selects sessions', () => {
    const onSelect = vi.fn();
    render(
      <SpirometryTrendChart spirometry={sp} metric="pef" windowStart={rich.window.start} windowEnd={rich.window.end} onSelectDay={onSelect} />,
    );
    const g = screen.getByRole('group', { name: /sessions\. Use arrow keys/ });
    fireEvent.focus(g);
    fireEvent.keyDown(g, { key: 'Home' });
    fireEvent.keyDown(g, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(sp.sessions[0].date);
  });
  it('empty sessions', () => {
    render(
      <SpirometryTrendChart spirometry={empty.spirometry!} metric="pef" windowStart={empty.window.start} windowEnd={empty.window.end} />,
    );
    expect(screen.getByText('No spirometry sessions in this period')).toBeTruthy();
  });
});

describe('Sparkline', () => {
  it('splits the line at nulls and marks the last point', () => {
    const pts = [1, 2, null, 3, 4, null, 5].map((v, i) => ({ date: `2026-10-0${i + 1}`, value: v }));
    const { container } = render(<Sparkline points={pts} width={100} ariaLabel="Test trend" />);
    expect(screen.getByRole('img', { name: 'Test trend' })).toBeTruthy();
    expect(container.querySelectorAll('path')).toHaveLength(2);
    expect(container.querySelector('[data-last="true"]')).not.toBeNull();
  });
  it('renders empty without crashing', () => {
    render(<Sparkline points={[]} ariaLabel="Empty" />);
    expect(screen.getByRole('img', { name: 'Empty' })).toBeTruthy();
  });
});

describe('QuestionWidget', () => {
  it.each([...rich.questions, ...migraine.questions].map((q) => [q.kind + ':' + q.questionId, q] as const))(
    'renders %s with answered count',
    (_name, q) => {
      const { container } = render(<QuestionWidget question={q} />);
      expect(container.querySelector(`figure[data-kind="${q.kind}"]`)).not.toBeNull();
      expect(screen.getByText(`answered ${q.answeredDays} of ${q.windowDays} days`)).toBeTruthy();
      expect(screen.getByTitle(q.text)).toBeTruthy();
    },
  );

  it('numeric shows concern line and stats', () => {
    const pain = migraine.questions.find((q) => q.kind === 'numeric' && q.questionId === 'm-pain')!;
    const { container } = render(<QuestionWidget question={pain} />);
    expect(container.querySelector('[data-testid="concern-line"]')).not.toBeNull();
    expect(screen.getByText('Days ≥ 7 (dashed line)')).toBeTruthy();
  });

  it('multi folds long item lists', () => {
    const trig = migraine.questions.find((q) => q.kind === 'multi')!;
    const { container } = render(<QuestionWidget question={trig} compact />);
    expect(container.querySelectorAll('li[data-item]').length).toBeLessThanOrEqual(5);
  });

  it('categorical strip selects a day', () => {
    const onSelect = vi.fn();
    const feel = rich.questions.find((q) => q.kind === 'categorical')!;
    render(<QuestionWidget question={feel} onSelectDay={onSelect} />);
    const g = screen.getByRole('group', { name: /Feeling by day/ });
    fireEvent.focus(g);
    fireEvent.keyDown(g, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(rich.window.end);
    expect(screen.getByRole('img', { name: /Feeling distribution/ })).toBeTruthy();
  });

  it('text lists recent answers; empty question shows empty state', () => {
    const notes = rich.questions.find((q) => q.kind === 'text')!;
    if (notes.kind !== 'text') throw new Error('expected text');
    const onSelect = vi.fn();
    render(<QuestionWidget question={notes} onSelectDay={onSelect} />);
    if (notes.recent.length) {
      fireEvent.click(screen.getAllByRole('button', { name: /^Open / })[0]);
      expect(onSelect).toHaveBeenCalledWith(notes.recent[0].date);
    }
    const emptyQ = empty.questions.find((q) => q.kind === 'boolean')!;
    const { container } = render(<QuestionWidget question={emptyQ} />);
    expect(within(container).getByText('No answers in this period')).toBeTruthy();
  });
});

describe('ZoneDistributionBar', () => {
  it('summarises counts and renders segments', () => {
    const z = rich.zoneDays!;
    const { container } = render(<ZoneDistributionBar zoneDays={z} />);
    expect(screen.getByRole('img', { name: new RegExp(`${z.green} green, ${z.yellow} yellow, ${z.red} red`) })).toBeTruthy();
    expect(container.querySelectorAll('[data-zone]')).toHaveLength(Object.values(z).filter((n) => n > 0).length);
    expect(screen.getByText('Green · doing well')).toBeTruthy();
  });
  it('empty', () => {
    render(<ZoneDistributionBar zoneDays={{ green: 0, yellow: 0, red: 0, unknown: 0 }} />);
    expect(screen.getByText('No zone data in this period')).toBeTruthy();
  });
});

describe('ChartGallery', () => {
  it('renders every chart without throwing', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ChartGallery />);
    expect(screen.getByText('Chart gallery')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Migraine (non-asthma)' }));
    fireEvent.click(screen.getByRole('radio', { name: 'No entries' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Asthma · 90 d · sparse' }));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
