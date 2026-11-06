import type { PatientAppHome } from '@shared/types/api';
import type { Zone } from '@shared/types/summary';
import { addDays, clockOf, shortDate, weekdayShort } from '../lib/time';
import { Icon } from './Icon';
import ui from '../styles/ui.module.css';
import s from './components.module.css';

export const ZONE_TEXT: Record<Zone, { name: string; sub: string }> = {
  green: { name: 'Green zone', sub: "You're doing well" },
  yellow: { name: 'Yellow zone', sub: 'Take extra care today' },
  red: { name: 'Red zone', sub: 'Get help now' },
};

export const PLAN_LINE = 'Follow the plan your care team gave you.';

export function ZoneSteps({ zone, steps }: { zone: Zone; steps?: string[] }) {
  return (
    <div className={s.zoneSteps}>
      {steps && steps.length > 0 && (
        <ul>
          {steps.map((st) => (
            <li key={st}>{st}</li>
          ))}
        </ul>
      )}
      <p className={s.planLine}>
        {zone === 'red' && 'If it is hard to breathe or talk, call 911 or your care team right away. '}
        {PLAN_LINE}
      </p>
    </div>
  );
}

export function ZoneCard({ plan, latestPct, today }: { plan: NonNullable<PatientAppHome['actionPlan']>; latestPct?: number; today: string }) {
  const zone = plan.zone;
  if (!zone) {
    return (
      <section className={`${s.zone} ${s.zoneNone}`} aria-label="Action plan">
        <p className={s.zoneName}>No zone yet today</p>
        <p className={s.zoneSub}>Do a breathing test to see which zone you're in.</p>
        <p className={s.planLine}>{PLAN_LINE}</p>
      </section>
    );
  }
  const t = ZONE_TEXT[zone];
  const asOfDay = plan.asOf?.slice(0, 10);
  const updated = plan.asOf
    ? `Updated ${asOfDay === today ? 'today' : asOfDay === addDays(today, -1) ? 'yesterday' : shortDate(asOfDay!)} at ${clockOf(plan.asOf)}`
    : null;
  const meta = [updated, latestPct !== undefined ? `${latestPct}% of your best` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <section className={`${s.zone} ${s[`zone_${zone}`]}`} aria-label={`Action plan: ${t.name}`}>
      <div className={s.zoneHead}>
        <span className={s.zoneDot} aria-hidden="true" />
        <div>
          <p className={s.zoneName}>{t.name}</p>
          <p className={s.zoneSub}>{t.sub}</p>
        </div>
      </div>
      {meta && <p className={s.zoneMeta}>{meta}</p>}
      <ZoneSteps zone={zone} steps={plan.steps[zone]} />
      {plan.expired && <p className={s.zoneMeta}>Your plan is due for a refresh. Ask your care team at your next visit.</p>}
    </section>
  );
}

const DAY_TEXT = { good: 'Good day', hard: 'Hard day', none: 'No check-in' } as const;

export function DayStrip({ days, large = false }: { days: PatientAppHome['last14Days']; large?: boolean }) {
  return (
    <div>
      <ol className={`${s.strip} ${large ? s.stripLarge : ''}`} aria-label="Last 14 days">
        {days.map((d, i) => (
          <li key={d.date} className={`${s.day} ${s[`day_${d.status}`]}`} title={`${shortDate(d.date)}: ${DAY_TEXT[d.status]}`}>
            <span className={s.dayDot}>
              {d.status === 'good' && <Icon name="check" size={large ? 16 : 12} />}
              {d.status === 'hard' && <span aria-hidden="true">!</span>}
            </span>
            {large && <span className={s.dayLabel}>{weekdayShort(d.date).slice(0, 1)}</span>}
            <span className={ui.srOnly}>
              {i === days.length - 1 ? 'Today' : shortDate(d.date)}: {DAY_TEXT[d.status]}
            </span>
          </li>
        ))}
      </ol>
      {large && (
        <p className={s.legend} aria-hidden="true">
          <span className={`${s.legendDot} ${s.day_good}`} /> Good day
          <span className={`${s.legendDot} ${s.day_hard}`} /> Hard day
          <span className={`${s.legendDot} ${s.day_none}`} /> No check-in
        </p>
      )}
    </div>
  );
}

export function StreakLine({ current, longest }: { current: number; longest: number }) {
  return (
    <div className={s.streak}>
      <span className={s.flame}>
        <Icon name="flame" size={26} />
      </span>
      <div>
        <p className={s.streakNum}>
          {current} {current === 1 ? 'day' : 'days'} in a row
        </p>
        <p className={ui.note}>
          {current === 0 ? 'Check in today to start a new streak.' : `Your longest streak is ${longest} ${longest === 1 ? 'day' : 'days'}.`}
        </p>
      </div>
    </div>
  );
}

export function BadgeList({ badges }: { badges: { name: string; label: string; date?: string }[] }) {
  if (badges.length === 0) return <p className={ui.note}>Badges show up here as you check in and take your medicines.</p>;
  return (
    <ul className={s.badges}>
      {badges.map((b, i) => (
        <li key={`${b.name}-${b.date ?? i}`} className={s.badge}>
          <span className={s.badgeIcon}>
            <Icon name="star" size={20} />
          </span>
          <span>
            <span className={s.badgeLabel}>{b.label}</span>
            {b.date && <span className={s.badgeDate}>{shortDate(b.date.slice(0, 10))}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
