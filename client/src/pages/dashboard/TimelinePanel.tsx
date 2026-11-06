import type { PatientSummary } from '@shared/types';
import { DailyTimeline, type TimelineRow } from '../../components/charts';
import { Icon, Panel } from '../../components/ui';
import { visibleTimelineRows, type SpecialtyPreset } from '../../config/specialties';

interface Props {
  summary: PatientSummary;
  preset: SpecialtyPreset;
  span: 1 | 2;
  selectedDate?: string;
  onSelectDay: (d: string) => void;
  highlightDates?: string[];
}

/** Symptoms, feeling, doses, rescue use, peak flow and zone on one shared date axis. */
export function TimelinePanel({ summary, preset, span, selectedDate, onSelectDay, highlightDates }: Props) {
  const rows = visibleTimelineRows(preset, summary);
  const labels: Partial<Record<TimelineRow, string>> = {};
  const prn = summary.medications.asNeeded;
  if (prn.length) labels.asNeeded = prn.length === 1 ? `${prn[0].name} uses` : `As-needed uses (${prn.map((m) => m.name).join(', ')})`;
  const sched = summary.medications.scheduled;
  if (sched.length === 1) labels.scheduledDoses = `${sched[0].name} doses`;

  return (
    <Panel
      id="timeline"
      title="Day by day, in context"
      icon={<Icon name="activity" />}
      span={span}
      subtitle="Read down a column to see how answers, medicines and readings line up on the same day."
    >
      <DailyTimeline
        days={summary.days}
        rows={rows}
        spirometry={summary.spirometry}
        selectedDate={selectedDate}
        onSelectDay={onSelectDay}
        highlightDates={highlightDates}
        rowLabels={labels}
      />
    </Panel>
  );
}
