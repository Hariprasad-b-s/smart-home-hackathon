import { Link } from 'react-router-dom';
import type { PatientAppHome } from '@shared/types/api';
import { useAnnounce, useHome } from '../lib/home';
import { clockOf, dayLabel, greeting, shortDate } from '../lib/time';
import { BadgeList, DayStrip, StreakLine, ZoneCard } from '../components/Engagement';
import { Icon } from '../components/Icon';
import { MedRow } from '../components/MedRow';
import { ErrorState, LoadingBlocks } from '../components/States';
import ui from '../styles/ui.module.css';
import s from './screens.module.css';

export function trackerStatus(t: PatientAppHome['trackers'][number]): string {
  if (t.submittedToday > 0 && t.lastSubmittedAt) return `Checked in at ${clockOf(t.lastSubmittedAt)} · check in again`;
  if (t.submittedToday > 0) return 'Checked in today · check in again';
  return 'Not done yet today';
}

export function Today() {
  const { home, loading, error, reload, applyDose, patientId } = useHome();
  const announce = useAnnounce();

  if (!home) {
    if (error) return <ErrorState error={error} onRetry={() => reload()} />;
    return loading ? <LoadingBlocks label="Loading today" /> : null;
  }

  const latest = home.spirometer?.latest;
  const meds = home.medications;

  return (
    <div>
      <p className={s.date}>{dayLabel(home.today)}</p>
      <h1 className={s.h1}>
        {greeting()}, {home.patient.firstName}
      </h1>

      {home.actionPlan && (
        <div className={s.block}>
          <ZoneCard plan={home.actionPlan} today={home.today} latestPct={latest?.date === home.today ? latest.pctPersonalBest : undefined} />
        </div>
      )}

      <h2 className={ui.sectionTitle}>For today</h2>
      <ul className={ui.group}>
        {home.trackers.map((t) => {
          const done = t.submittedToday > 0;
          return (
            <li key={t.definition.id} className={ui.row}>
              <span className={`${ui.iconWell} ${done ? s.wellDone : ''}`}>
                <Icon name={done ? 'check' : 'clipboard'} />
              </span>
              <div className={ui.rowBody}>
                <p className={ui.rowTitle}>{t.definition.conditionLabel} check-in</p>
                <p className={ui.rowSub}>{trackerStatus(t)}</p>
              </div>
              <Link
                to={`/check-in/${encodeURIComponent(t.definition.id)}`}
                className={`${ui.btn} ${ui.small} ${done ? ui.secondary : ''}`}
                aria-label={`${done ? 'Check in again' : 'Check in'}: ${t.definition.conditionLabel}`}
              >
                Check in
              </Link>
            </li>
          );
        })}
        {home.spirometer && (
          <li className={ui.row}>
            <span className={`${ui.iconWell} ${latest?.date === home.today ? s.wellDone : ''}`}>
              <Icon name="lungs" />
            </span>
            <div className={ui.rowBody}>
              <p className={ui.rowTitle}>Do a breathing test</p>
              <p className={ui.rowSub}>
                {latest
                  ? `Last: ${latest.pefLpm} L/min${latest.pctPersonalBest !== undefined ? ` (${latest.pctPersonalBest}%)` : ''}, ${
                      latest.date === home.today ? 'today' : shortDate(latest.date)
                    }`
                  : 'Use your Spirobank'}
              </p>
            </div>
            <Link to="/breathe" className={`${ui.btn} ${ui.small} ${latest?.date === home.today ? ui.secondary : ''}`} aria-label="Do a breathing test">
              Start
            </Link>
          </li>
        )}
        <li className={ui.row}>
          <span className={ui.iconWell}>
            <Icon name="camera" />
          </span>
          <div className={ui.rowBody}>
            <p className={ui.rowTitle}>Photos &amp; videos</p>
            <p className={ui.rowSub}>Show your care team a rash, swelling or a cough</p>
          </div>
          <Link to="/media" className={`${ui.btn} ${ui.small} ${ui.secondary}`} aria-label="Add a photo or video">
            Add
          </Link>
        </li>
      </ul>

      {meds.length > 0 && (
        <>
          <h2 className={ui.sectionTitle}>Medicines</h2>
          <div className={ui.group}>
            {meds.map((m) => (
              <MedRow
                key={m.id}
                med={m}
                patientId={patientId}
                today={home.today}
                compact
                onTaken={(id, time, r) => {
                  applyDose(id, time);
                  announce(r.newBadge ? `${r.message} New badge: ${r.newBadge.label}` : r.message || 'Marked as taken');
                  void reload(true);
                }}
              />
            ))}
          </div>
        </>
      )}

      <h2 className={ui.sectionTitle}>Your streak</h2>
      <StreakLine current={home.engagement.currentStreak} longest={home.engagement.longestStreak} />
      <DayStrip days={home.last14Days} />

      <h2 className={ui.sectionTitle}>Recent badges</h2>
      <BadgeList badges={[...home.engagement.badges].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4)} />
      {home.engagement.badges.length > 4 && (
        <p className={s.cta}>
          <Link to="/me" className={s.textLink}>
            See all {home.engagement.badges.length} badges
          </Link>
        </p>
      )}
    </div>
  );
}
