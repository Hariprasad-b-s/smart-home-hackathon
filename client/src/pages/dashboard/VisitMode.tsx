import { useEffect, useRef } from 'react';
import type { PatientSummary, VisitModeVisibility } from '@shared/types';
import { defaultVisitMode } from '../../lib/prefs';
import { CalendarHeatmap } from '../../components/charts';
import { Icon } from '../../components/ui';
import { formatDate } from '../../lib/format';
import s from './VisitMode.module.css';

/**
 * Patient-facing view for use during the visit: calm, large, plain language,
 * celebrates what went well. No MRN, no flags, no clinical jargon.
 */
export function VisitMode({ summary, onExit, visibility = defaultVisitMode() }: { summary: PatientSummary; onExit: () => void; visibility?: VisitModeVisibility }) {
  const pf = summary.patientFacing;
  const v = visibility;
  const points = pf.points.filter((p) => v.points[p.key] !== false);
  const nothing = !v.headline && !v.dayCounts && !v.calendar && !v.achievements && points.length === 0;
  const firstName = summary.patient.displayName.split(' ')[0];
  const exitRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const wins: { icon: 'star' | 'heart' | 'sparkle'; text: string }[] = [];
  for (const m of summary.medications.scheduled) {
    if (m.currentStreakDays >= 2) wins.push({ icon: 'star', text: `${m.currentStreakDays} days in a row with every ${m.name} dose` });
  }
  if (summary.engagement.currentLoggingStreak >= 2) wins.push({ icon: 'heart', text: `${summary.engagement.currentLoggingStreak}-day check-in streak right now` });
  if (summary.engagement.longestLoggingStreak >= 3 && summary.engagement.longestLoggingStreak !== summary.engagement.currentLoggingStreak)
    wins.push({ icon: 'heart', text: `Best check-in streak: ${summary.engagement.longestLoggingStreak} days` });

  const badges = [...summary.engagement.badges].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);

  return (
    <div className={s.visit}>
      <div className={s.top}>
        <p className={s.period}>
          {summary.window.label}, {formatDate(summary.window.start)} to {formatDate(summary.window.end)}
        </p>
        <button ref={exitRef} type="button" className={`btn ${s.exit}`} onClick={onExit}>
          <Icon name="logout" size={18} /> Exit visit mode
        </button>
      </div>

      <h1 ref={headingRef} tabIndex={-1} className={s.hello}>
        Hi {firstName}.{v.headline ? ` ${pf.headline}` : ''}
      </h1>

      {nothing ? (
        <section className={`${s.card} ${s.walkthrough}`} data-testid="visit-walkthrough">
          <h2 className={s.h2}>Your care team will walk you through today’s visit</h2>
          <p className={s.gentle}>Thanks for checking in with SMART@Home. Every entry helps us understand how you’re doing.</p>
        </section>
      ) : null}

      {v.dayCounts ? (
      <ul className={s.counts} aria-label="Your days">
        <li className={s.countGood}>
          <span className={s.countNum}>{pf.goodDays}</span>
          <span className={s.countLabel}>good days</span>
        </li>
        <li className={s.countHard}>
          <span className={s.countNum}>{pf.hardDays}</span>
          <span className={s.countLabel}>hard days</span>
        </li>
        <li className={s.countNone}>
          <span className={s.countNum}>{pf.noDataDays}</span>
          <span className={s.countLabel}>days with nothing recorded</span>
        </li>
      </ul>
      ) : null}

      {v.calendar ? (
      <section className={s.calendar} aria-labelledby="visit-cal-title">
        <h2 id="visit-cal-title" className={s.h2}>
          Your days at a glance
        </h2>
        <CalendarHeatmap days={summary.days} colorBy="hardDay" size="large" />
      </section>
      ) : null}

      <div className={s.columns}>
        {points.length ? (
          <section aria-labelledby="visit-points-title" className={s.card}>
            <h2 id="visit-points-title" className={s.h2}>
              What your check-ins show
            </h2>
            <ul className={s.points}>
              {points.map((p) => (
                <li key={p.key}>{p.text}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {v.achievements ? (
        <section aria-labelledby="visit-wins-title" className={`${s.card} ${s.winsCard}`}>
          <h2 id="visit-wins-title" className={s.h2}>
            Things to be proud of
          </h2>
          {wins.length || badges.length ? (
            <ul className={s.wins}>
              {wins.map((w) => (
                <li key={w.text}>
                  <Icon name={w.icon} size={22} /> {w.text}
                </li>
              ))}
              {badges.map((b) => (
                <li key={`${b.name}-${b.date}`}>
                  <Icon name="sparkle" size={22} /> Earned “{b.label}” on {formatDate(b.date)}
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.gentle}>Every check-in helps us understand how you’re doing. Let’s pick a time of day that works for you.</p>
          )}
        </section>
        ) : null}
      </div>

      <div className={s.bottom}>
        <button type="button" className={`btn ${s.exit}`} onClick={onExit}>
          <Icon name="logout" size={18} /> Exit visit mode
        </button>
      </div>
    </div>
  );
}
