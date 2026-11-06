import { useState } from 'react';
import type { ClinicalFlag, FlagCategory, PatientSummary } from '@shared/types';
import { Chip, Icon, Panel, StatusIcon, type IconName } from '../../components/ui';
import { conditionLabel, plural } from '../../lib/format';
import s from './Dashboard.module.css';

const CATEGORY: Record<FlagCategory, { icon: IconName; label: string }> = {
  adherence: { icon: 'pill', label: 'Adherence' },
  symptoms: { icon: 'activity', label: 'Symptoms' },
  lungFunction: { icon: 'lungs', label: 'Lung function' },
  actionPlan: { icon: 'clipboard', label: 'Action plan' },
  engagement: { icon: 'clock', label: 'Engagement' },
  discordance: { icon: 'shuffle', label: 'Mixed signals' },
  dataQuality: { icon: 'database', label: 'Data quality' },
};

const GROUPS: { severity: ClinicalFlag['severity']; label: string; status: 'concern' | 'watch' | 'neutral' }[] = [
  { severity: 'high', label: 'High', status: 'concern' },
  { severity: 'medium', label: 'Medium', status: 'watch' },
  { severity: 'low', label: 'Low', status: 'neutral' },
];

/** "What needs attention" — flags grouped by severity; hover/focus highlights their dates. */
export function AttentionPanel({ summary, span, onHighlight }: { summary: PatientSummary; span: 1 | 2; onHighlight: (d: string[] | undefined) => void }) {
  const [pinned, setPinned] = useState<string | null>(null);
  const flags = summary.flags;
  const pinnedFlag = flags.find((f) => f.id === pinned);

  const preview = (f?: ClinicalFlag) => onHighlight(f?.dates?.length ? f.dates : pinnedFlag?.dates);
  const clear = () => onHighlight(pinnedFlag?.dates);
  const togglePin = (f: ClinicalFlag) => {
    const next = pinned === f.id ? null : f.id;
    setPinned(next);
    onHighlight(next ? f.dates : undefined);
  };

  return (
    <Panel
      id="attention"
      title="What needs attention"
      icon={<Icon name="flag" />}
      span={span}
      subtitle={flags.length ? `${plural(flags.length, 'item')} in ${summary.window.label.toLowerCase()}` : undefined}
    >
      {flags.length === 0 ? (
        <p className={s.allClear}>
          <StatusIcon status="good" /> Nothing flagged in this period.
        </p>
      ) : (
        GROUPS.map((g) => {
          const items = flags.filter((f) => f.severity === g.severity);
          if (!items.length) return null;
          return (
            <div key={g.severity} className={s.flagGroup}>
              <h3 className={`${s.flagGroupTitle} ${s[`fg_${g.status}`]}`}>
                <StatusIcon status={g.status} size={15} /> {g.label} <span className={s.count}>{items.length}</span>
              </h3>
              <ul className={s.flagList}>
                {items.map((f) => {
                  const cat = CATEGORY[f.category];
                  const n = f.dates?.length ?? 0;
                  return (
                    <li
                      key={f.id}
                      className={`${s.flag} ${s[`flag_${f.severity}`]} ${pinned === f.id ? s.flagPinned : ''}`}
                      onMouseEnter={() => preview(f)}
                      onMouseLeave={clear}
                      data-testid="flag"
                    >
                      <span className={s.flagIcon} title={cat.label}>
                        <Icon name={cat.icon} size={16} />
                        <span className="sr-only">{cat.label}</span>
                      </span>
                      <div className={s.flagBody}>
                        <p className={s.flagTitle}>{f.title}</p>
                        <p className={s.flagDetail}>{f.detail}</p>
                        <div className={s.flagMeta}>
                          {f.condition && f.condition !== 'general' ? <Chip tone="muted">{conditionLabel(f.condition)}</Chip> : null}
                          {n > 0 ? (
                            <button
                              type="button"
                              className={`${s.linkBtn} no-print`}
                              aria-pressed={pinned === f.id}
                              onFocus={() => preview(f)}
                              onBlur={clear}
                              onClick={() => togglePin(f)}
                            >
                              <Icon name="calendar" size={13} />
                              {pinned === f.id ? `Showing ${plural(n, 'day')} on charts` : `Show ${plural(n, 'day')} on charts`}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}
    </Panel>
  );
}
