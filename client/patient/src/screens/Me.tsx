import { ThemeToggle } from '../../../src/components/ui/ThemeToggle';
import { useTheme } from '../../../src/lib/theme';
import { Link } from 'react-router-dom';
import { useHome } from '../lib/home';
import { BadgeList, DayStrip, StreakLine } from '../components/Engagement';
import { Icon } from '../components/Icon';
import { ErrorState, LoadingBlocks } from '../components/States';
import ui from '../styles/ui.module.css';
import s from './screens.module.css';

const THEME_NAME = { system: 'Same as my phone', light: 'Light', dark: 'Dark' } as const;

export function Me({ onSwitchPatient }: { onSwitchPatient: () => void }) {
  const { home, loading, error, reload } = useHome();
  const [theme] = useTheme();

  if (!home) {
    if (error) return <ErrorState error={error} onRetry={() => reload()} />;
    return loading ? <LoadingBlocks /> : null;
  }
  const { patient, engagement } = home;
  const badges = [...engagement.badges].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div>
      <div className={s.profile}>
        <span className={`${s.avatar} ${s.avatarLarge}`} aria-hidden="true">
          {patient.initials}
        </span>
        <div>
          <h1 className={s.h1}>{patient.displayName}</h1>
          <p className={ui.muted}>
            {patient.ageYears} years old
            {patient.conditions.length > 0 && ` · ${patient.conditions.map((c) => c.conditionLabel).join(', ')}`}
          </p>
        </div>
      </div>

      <h2 className={ui.sectionTitle}>Streaks</h2>
      <StreakLine current={engagement.currentStreak} longest={engagement.longestStreak} />
      <div className={s.stats}>
        <div className={s.stat}>
          <span className={s.statNum}>{engagement.currentStreak}</span>
          <span className={s.statLabel}>Current streak</span>
        </div>
        <div className={s.stat}>
          <span className={s.statNum}>{engagement.longestStreak}</span>
          <span className={s.statLabel}>Longest streak</span>
        </div>
        <div className={s.stat}>
          <span className={s.statNum}>{engagement.badges.length}</span>
          <span className={s.statLabel}>Badges</span>
        </div>
      </div>

      <h2 className={ui.sectionTitle}>Last 14 days</h2>
      <DayStrip days={home.last14Days} large />

      <h2 className={ui.sectionTitle}>Your badges</h2>
      <p className={`${ui.note} ${s.lead}`}>Every check-in and every dose you mark counts. Nice work showing up for yourself.</p>
      <BadgeList badges={badges} />

      <h2 className={ui.sectionTitle}>Settings</h2>
      <div className={ui.group}>
        <div className={`${ui.row} ${s.themeRow}`}>
          <div className={ui.rowBody}>
            <p className={ui.rowTitle}>Theme</p>
            <p className={ui.rowSub}>{THEME_NAME[theme]}</p>
          </div>
          <ThemeToggle className={s.theme} />
        </div>
        <Link to="/media" className={s.settingBtn}>
          <span className={ui.iconWell}>
            <Icon name="camera" />
          </span>
          <span className={ui.rowBody}>
            <span className={`${ui.rowTitle} ${s.blockText}`}>Photos &amp; videos</span>
            <span className={`${ui.rowSub} ${s.blockText}`}>Only your care team can see these</span>
          </span>
          <Icon name="chevronRight" size={20} />
        </Link>
        <button type="button" className={s.settingBtn} onClick={onSwitchPatient}>
          <span className={ui.iconWell}>
            <Icon name="swap" />
          </span>
          <span className={ui.rowBody}>
            <span className={`${ui.rowTitle} ${s.blockText}`}>Switch patient</span>
            <span className={`${ui.rowSub} ${s.blockText}`}>Demo only: pick a different made-up patient</span>
          </span>
          <Icon name="chevronRight" size={20} />
        </button>
      </div>
      <p className={`${ui.note} ${s.footnote}`}>
        SMART@Home demo. Everything here is synthetic. It doesn't replace advice from your care team.
      </p>
    </div>
  );
}
