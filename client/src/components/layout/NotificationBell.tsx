import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { URGENCY_LABEL, useNotifications } from '../../state/NotificationsContext';
import { useClinicianPrefs } from '../../state/ClinicianContext';
import { Icon } from '../ui/Icon';
import { sortInbox, waitingLabel } from '../../lib/inbox';
import s from './NotificationBell.module.css';

export function NotificationBell() {
  const { clinician } = useClinicianPrefs();
  const { inbox, unreadCount, desktopAlerts, enableDesktopAlerts, disableDesktopAlerts } = useNotifications();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    wrapRef.current?.querySelector<HTMLElement>('[data-menu] a, [data-menu] button')?.focus();
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!clinician) return null;
  const latest = sortInbox(inbox).slice(0, 5);
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className={`${s.wrap} no-print`} ref={wrapRef} onKeyDown={(e) => e.key === 'Escape' && open && close()}>
      <button
        ref={buttonRef}
        type="button"
        className={s.bell}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        data-testid="bell"
      >
        <Icon name="bell" size={18} />
        {unreadCount ? (
          <span className={s.count} data-testid="bell-count">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div id={menuId} className={s.menu} data-menu>
          <p className={s.title}>Messages from patients</p>
          {latest.length === 0 ? <p className={s.empty}>No escalated conversations.</p> : null}
          <ul className={s.list}>
            {latest.map((i) => (
              <li key={i.conversationId}>
                <Link to={`/inbox/${encodeURIComponent(i.conversationId)}`} className={s.item} onClick={() => setOpen(false)}>
                  <span className={`${s.dot} ${s[`dot_${i.urgency}`]}`} aria-hidden="true" />
                  <span className={s.itemText}>
                    <span className={s.itemTop}>
                      <strong>{i.patientName}</strong>
                      <span className={s.meta}>
                        {URGENCY_LABEL[i.urgency]}
                        {i.status === 'closed' ? ', closed' : `, ${waitingLabel(i)}`}
                      </span>
                    </span>
                    <span className={s.topic}>{i.topic}</span>
                  </span>
                  {i.unread && i.status !== 'closed' ? <span className={s.unread}>{i.unread}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
          <div className={s.footer}>
            <Link to="/inbox" className="btn" onClick={() => setOpen(false)}>
              Open inbox
            </Link>
            {desktopAlerts === 'off' ? (
              <button type="button" className="btn btn-ghost" onClick={enableDesktopAlerts}>
                Enable desktop alerts
              </button>
            ) : desktopAlerts === 'on' ? (
              <button type="button" className="btn btn-ghost" onClick={disableDesktopAlerts}>
                Turn off desktop alerts
              </button>
            ) : desktopAlerts === 'denied' ? (
              <span className={s.meta}>Desktop alerts are blocked in browser settings.</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
