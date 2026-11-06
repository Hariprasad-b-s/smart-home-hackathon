/**
 * CHART COMPONENT PROPS — CONTRACT between the charts module and the app/pages module.
 * Charts take normalized summary types directly; they never fetch data.
 * Every chart must: render an accessible <figure>/role="img" with an aria-label summary,
 * handle empty data with a quiet "No data in this period" state, size to its container
 * width (responsive), and use only colors from styles/tokens.css (CSS variables).
 */
import type {
  AsNeededMedicationSummary,
  DaySummary,
  QuestionSummary,
  ScheduledMedicationSummary,
  SpirometrySummary,
  ActionPlanSummary,
} from '@shared/types';

export type CalendarColorBy = 'zone' | 'hardDay' | 'symptomDay' | 'feeling' | 'adherence';

export interface CalendarHeatmapProps {
  days: DaySummary[];
  colorBy: CalendarColorBy;
  /** Month-grid calendar (weeks as rows, Mon–Sun columns), one block per month. */
  selectedDate?: string;
  onSelectDay?: (date: string) => void;
  /** Dates to outline (e.g. dates referenced by a hovered flag). */
  highlightDates?: string[];
  /** 'large' = visit-mode size with day numbers & legend in plain language. */
  size?: 'compact' | 'large';
  /** Show small markers in cells: dot = as-needed med used, hollow ring = scheduled dose missed. */
  showMarkers?: boolean;
}

export type TimelineRow = 'feeling' | 'symptoms' | 'scheduledDoses' | 'asNeeded' | 'peakFlow' | 'zone';

export interface DailyTimelineProps {
  days: DaySummary[];
  /** Rows to stack, top → bottom, all sharing one date x-axis (the "context" view). */
  rows: TimelineRow[];
  /** For peakFlow row zone bands (green ≥ green%, yellow, red < red%). */
  spirometry?: SpirometrySummary;
  selectedDate?: string;
  onSelectDay?: (date: string) => void;
  highlightDates?: string[];
  /** Labels for the rows if the tracker isn't asthma, e.g. { asNeeded: 'Excedrin uses' }. */
  rowLabels?: Partial<Record<TimelineRow, string>>;
}

export interface AdherenceStripProps {
  medication: ScheduledMedicationSummary;
  /** Daily cells (taken / expected) plus a weekly % bar row underneath. */
  showWeekly?: boolean;
  onSelectDay?: (date: string) => void;
}

export interface AsNeededBarsProps {
  medication: AsNeededMedicationSummary;
  onSelectDay?: (date: string) => void;
}

export type SpirometryMetric = 'pef' | 'pctPersonalBest' | 'fev1' | 'fvc' | 'ratio';

export interface SpirometryTrendChartProps {
  spirometry: SpirometrySummary;
  metric: SpirometryMetric;
  /** Shade green/yellow/red bands when metric is pef or pctPersonalBest. */
  showZoneBands?: boolean;
  /** Window bounds so the x-axis matches other charts even with sparse sessions. */
  windowStart: string;
  windowEnd: string;
  onSelectDay?: (date: string) => void;
  height?: number;
}

export interface SparklineProps {
  points: { date: string; value: number | null }[];
  /** Colors the line by status variable; default neutral. */
  status?: 'good' | 'watch' | 'concern' | 'neutral' | 'unknown';
  width?: number;
  height?: number;
  ariaLabel: string;
}

export interface QuestionWidgetProps {
  /** Generic renderer for ANY tracker question — picks a visualization by `question.kind`:
   *  categorical → 100% stacked distribution bar + per-day severity strip
   *  multi       → horizontal frequency bars (days with item / answered days)
   *  numeric     → line/dot chart with concern threshold line + stats row
   *  boolean     → yes-day strip + "N of M days" figure
   *  text        → list of recent answers */
  question: QuestionSummary;
  onSelectDay?: (date: string) => void;
  compact?: boolean;
}

export interface ZoneDistributionBarProps {
  zoneDays: ActionPlanSummary['zoneDays'];
  /** Show counts + plain-language labels underneath. */
  showLegend?: boolean;
}
