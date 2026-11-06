import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AnnounceProvider, HomeProvider, useOnline } from './lib/home';
import { ChatProvider, useOptionalChat } from './lib/chat';
import { clearStoredPatientId, getStoredPatientId, storePatientId } from './lib/storage';
import { Icon, type IconName } from './components/Icon';
import { ChoosePatient } from './screens/ChoosePatient';
import { Today } from './screens/Today';
import { Breathe, CheckInList, CheckInRun } from './screens/CheckIn';
import { Medicines } from './screens/Medicines';
import { Me } from './screens/Me';
import { HelpHome, HelpThread } from './screens/Help';
import { MediaScreen } from './screens/Media';
import ui from './styles/ui.module.css';
import s from './App.module.css';

const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Today', icon: 'home', end: true },
  { to: '/check-in', label: 'Check in', icon: 'clipboard' },
  { to: '/help', label: 'Help', icon: 'chat' },
  { to: '/medicines', label: 'Medicines', icon: 'pill' },
  { to: '/me', label: 'Me', icon: 'user' },
];

function Shell({ tabs = true, children }: { tabs?: boolean; children?: ReactNode }) {
  const online = useOnline();
  const unread = useOptionalChat()?.unread ?? 0;
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [pathname]);
  return (
    <div className={s.frame}>
      <div className={s.band} aria-hidden="true" />
      <header className={s.header}>
        <span className={s.wordmark}>SMART@Home</span>
        <span className={ui.demoPill}>Synthetic demo</span>
      </header>
      {!online && (
        <p className={s.offline} role="status">
          <Icon name="wifiOff" size={18} />
          You're offline. You can look around, but saving needs a connection.
        </p>
      )}
      <main className={s.main} id="main">
        {children ?? <Outlet />}
      </main>
      {tabs && (
        <nav className={s.tabbar} aria-label="Main">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => `${s.tab} ${isActive ? s.tabOn : ''}`}
              aria-label={t.to === '/help' && unread > 0 ? `${t.label}, ${unread} unread` : undefined}
            >
              <span className={s.tabIcon}>
                <Icon name={t.icon} size={24} />
                {t.to === '/help' && unread > 0 && (
                  <span className={s.badge} data-testid="help-badge">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </span>
              <span>{t.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}

function Toast({ message }: { message: string | null }) {
  return (
    <div className={s.toastRegion} aria-live="polite" role="status">
      {message && (
        <p className={s.toast}>
          <Icon name="check" size={18} />
          {message}
        </p>
      )}
    </div>
  );
}

export function App() {
  const navigate = useNavigate();
  const [patientId, setPatientId] = useState<string | null>(() => getStoredPatientId());

  const choose = useCallback(
    (id: string) => {
      storePatientId(id);
      setPatientId(id);
      navigate('/');
    },
    [navigate],
  );
  const forget = useCallback(() => {
    clearStoredPatientId();
    setPatientId(null);
    navigate('/');
  }, [navigate]);

  return (
    <AnnounceProvider render={(m) => <Toast message={m} />}>
      {!patientId ? (
        <Shell tabs={false}>
          <ChoosePatient onChoose={choose} />
        </Shell>
      ) : (
        <HomeProvider key={patientId} patientId={patientId} onUnknownPatient={forget}>
          <ChatProvider patientId={patientId}>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Today />} />
              <Route path="check-in" element={<CheckInList />} />
              <Route path="help" element={<HelpHome />} />
              <Route path="media" element={<MediaScreen />} />
              <Route path="medicines" element={<Medicines />} />
              <Route path="me" element={<Me onSwitchPatient={() => navigate('/choose')} />} />
            </Route>
            <Route element={<Shell tabs={false} />}>
              <Route path="check-in/:trackerId" element={<CheckInRun />} />
              <Route path="breathe" element={<Breathe />} />
              <Route path="help/:conversationId" element={<HelpThread />} />
              <Route path="choose" element={<ChoosePatient onChoose={choose} currentId={patientId} />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </ChatProvider>
        </HomeProvider>
      )}
    </AnnounceProvider>
  );
}
