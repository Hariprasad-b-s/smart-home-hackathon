import type { ReactNode } from 'react';
import { NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { USE_MOCKS } from '../../api/client';
import { ThemeToggle } from '../ui/ThemeToggle';
import { ClinicianMenu } from './ClinicianMenu';
import { NotificationBell } from './NotificationBell';
import { useNotifications } from '../../state/NotificationsContext';
import { useClinicianPrefs } from '../../state/ClinicianContext';
import s from './AppShell.module.css';

const TABS = [
  { to: '/', label: 'Patients', end: true },
  { to: '/inbox', label: 'Messages', end: false },
  { to: '/trackers', label: 'Trackers', end: false },
  { to: '/studies', label: 'Studies', end: false },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const visit = params.get('mode') === 'visit' && pathname.startsWith('/patients/');
  const { unreadCount } = useNotifications();

  return (
    <div className={`${s.shell} ${visit ? s.visit : ''}`}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className={s.bar}>
        <div className={s.band} aria-hidden="true" />
        <div className={s.barInner}>
          <NavLink to="/" className={s.wordmark} aria-label="SMART@Home Clinician View, patient list">
            <span className={s.wordmarkName}>SMART@Home</span>
            <span className={s.wordmarkSep} aria-hidden="true" />
            <span className={s.wordmarkSub}>{visit ? 'Your check-in summary' : 'Clinician View'}</span>
          </NavLink>
          {!visit ? (
            <nav aria-label="Main" className={`${s.nav} no-print`}>
              {TABS.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  end={t.end}
                  className={({ isActive }) => `${s.tab} ${isActive || (t.to === '/' && pathname.startsWith('/patients')) ? s.tabOn : ''}`}
                >
                  {t.label}
                  {t.to === '/inbox' && unreadCount ? (
                    <span className={s.tabBadge} aria-label={`${unreadCount} unread`}>
                      {unreadCount}
                    </span>
                  ) : null}
                </NavLink>
              ))}
            </nav>
          ) : null}
          <div className={s.barEnd}>
            <span className={s.demo} title="All patients and values in this app are made up for demonstration.">
              Synthetic demo data{USE_MOCKS ? ' (offline mocks)' : ''}
            </span>
            <ThemeToggle />
            {!visit ? <NotificationBell /> : null}
            {!visit ? <ClinicianMenu /> : null}
          </div>
        </div>
      </header>
      <main id="main" className={s.main} tabIndex={-1}>
        {!pathname.startsWith('/patients/') ? <PendingLayoutBanner /> : null}
        {children}
      </main>
    </div>
  );
}

/** Unsaved layout edits carried away from the dashboard: offer to save or discard. */
function PendingLayoutBanner() {
  const { editSession, endEdit } = useClinicianPrefs();
  if (!editSession) return null;
  return (
    <div className={`${s.pending} no-print`} role="region" aria-label="Unsaved layout changes">
      <span>
        You have unsaved layout changes for the <strong>{editSession.viewLabel}</strong> view.
      </span>
      <button type="button" className="btn btn-primary" onClick={() => endEdit(true)}>
        Save changes
      </button>
      <button type="button" className="btn" onClick={() => endEdit(false)}>
        Discard
      </button>
    </div>
  );
}
