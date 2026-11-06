/** Lightweight stand-ins for the charts module so app tests don't depend on chart internals. */
import type {
  AdherenceStripProps,
  AsNeededBarsProps,
  CalendarHeatmapProps,
  DailyTimelineProps,
  QuestionWidgetProps,
  SparklineProps,
  SpirometryTrendChartProps,
  ZoneDistributionBarProps,
} from '../components/charts/types';

export function CalendarHeatmap({ days, colorBy, onSelectDay, highlightDates, size }: CalendarHeatmapProps) {
  return (
    <div data-testid="calendar" data-colorby={colorBy} data-size={size ?? 'compact'} data-highlight={(highlightDates ?? []).join(',')}>
      {days.map((d) => (
        <button key={d.date} type="button" onClick={() => onSelectDay?.(d.date)} aria-label={`day ${d.date}`}>
          {d.date.slice(8)}
        </button>
      ))}
    </div>
  );
}
export const DailyTimeline = ({ rows }: DailyTimelineProps) => <div data-testid="timeline" data-rows={rows.join(',')} />;
export const AdherenceStrip = ({ medication }: AdherenceStripProps) => <div data-testid="adherence-strip">{medication.name}</div>;
export const AsNeededBars = ({ medication }: AsNeededBarsProps) => <div data-testid="asneeded-bars">{medication.name}</div>;
export const SpirometryTrendChart = ({ metric }: SpirometryTrendChartProps) => <div data-testid="spiro-chart" data-metric={metric} />;
export const Sparkline = ({ ariaLabel }: SparklineProps) => <svg role="img" aria-label={ariaLabel} />;
export const QuestionWidget = ({ question }: QuestionWidgetProps) => <div data-testid="question-widget">{question.shortLabel}</div>;
export const ZoneDistributionBar = ({ zoneDays }: ZoneDistributionBarProps) => <div data-testid="zone-bar">{zoneDays.green}</div>;
