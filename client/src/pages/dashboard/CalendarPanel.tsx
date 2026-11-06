import { useState } from 'react';
import type { PatientSummary } from '@shared/types';
import { CalendarHeatmap, ZoneDistributionBar, type CalendarColorBy } from '../../components/charts';
import { Icon, Panel, SegmentedControl } from '../../components/ui';
import type { SpecialtyPreset } from '../../config/specialties';
import s from './Dashboard.module.css';

const ALL_OPTIONS: { value: CalendarColorBy; label: string }[] = [
  { value: 'zone', label: 'Zone' },
  { value: 'hardDay', label: 'Hard days' },
  { value: 'symptomDay', label: 'Symptoms' },
  { value: 'feeling', label: 'Feeling' },
  { value: 'adherence', label: 'Adherence' },
];

interface Props {
  summary: PatientSummary;
  preset: SpecialtyPreset;
  span: 1 | 2;
  selectedDate?: string;
  onSelectDay: (d: string) => void;
  highlightDates?: string[];
}

export function CalendarPanel({ summary, preset, span, selectedDate, onSelectDay, highlightDates }: Props) {
  const isAsthma = summary.patient.trackers.some((t) => t.condition === 'asthma');
  const hasMeds = summary.medications.scheduled.length > 0;
  const options = ALL_OPTIONS.filter((o) => (o.value === 'zone' ? isAsthma : o.value === 'adherence' ? hasMeds : true));
  const fallback = options.some((o) => o.value === preset.calendarColorBy) ? preset.calendarColorBy : 'hardDay';
  const [colorBy, setColorBy] = useState<CalendarColorBy>(fallback);

  const days = summary.days;
  const hard = days.filter((d) => d.hardDay).length;
  const symptom = days.filter((d) => d.symptomDay).length;
  const none = days.filter((d) => !d.hasData).length;

  return (
    <Panel
      id="calendar"
      title="Month at a glance"
      icon={<Icon name="calendar" />}
      span={span}
      subtitle="Select a day to see everything recorded."
      actions={<SegmentedControl label="Colour calendar by" options={options} value={colorBy} onChange={setColorBy} size="sm" />}
    >
      <CalendarHeatmap
        days={days}
        colorBy={colorBy}
        selectedDate={selectedDate}
        onSelectDay={onSelectDay}
        highlightDates={highlightDates}
        showMarkers
      />
      <ul className={s.dayCounts}>
        <li>
          <strong className="num">{hard}</strong> hard days
        </li>
        <li>
          <strong className="num">{symptom}</strong> symptom days
        </li>
        <li>
          <strong className="num">{none}</strong> days with no entries
        </li>
      </ul>
      {isAsthma && summary.actionPlan ? (
        <div className={s.zoneBar}>
          <ZoneDistributionBar zoneDays={summary.actionPlan.zoneDays} showLegend />
        </div>
      ) : null}
    </Panel>
  );
}
