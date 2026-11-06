import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useClinicianPrefs } from '../../state/ClinicianContext';
import { Avatar } from '../ui/Misc';
import { Icon } from '../ui/Icon';
import s from './ClinicianMenu.module.css';

const initialsOf = (name: string) =>
  name
    .replace(/^(Dr\.?|Mr\.?|Ms\.?|Mrs\.?)\s+/i, '')
    .replace(/,.*$/, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('');

/** "Signed in as" demo identity switcher. */
export function ClinicianMenu() {
  const { clinicians, clinician, setClinicianId } = useClinicianPrefs();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    wrapRef.current?.querySelector<HTMLElement>('[aria-checked="true"], [role="menuitemradio"]')?.focus();
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!clinician) return null;

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(wrapRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items[next]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className={`${s.wrap} no-print`} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={s.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        data-testid="clinician-menu"
      >
        <Avatar initials={initialsOf(clinician.displayName)} size={28} />
        <span className={s.who}>
          <span className="sr-only">Signed in as </span>
          <span className={s.name}>{clinician.displayName}</span>
          <span className={s.role}>{clinician.role}</span>
        </span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label="Switch clinician" className={s.menu} onKeyDown={onMenuKey}>
          <p className={s.menuTitle}>Switch clinician (demo)</p>
          {clinicians.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitemradio"
              aria-checked={c.id === clinician.id}
              className={s.item}
              onClick={() => {
                setClinicianId(c.id);
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              <Avatar initials={initialsOf(c.displayName)} size={26} />
              <span className={s.itemText}>
                <span className={s.name}>{c.displayName}</span>
                <span className={s.role}>{c.role}</span>
              </span>
              {c.id === clinician.id ? <Icon name="check" size={16} /> : null}
            </button>
          ))}
          <p className={s.note}>Each clinician keeps their own layouts and visit-mode choices.</p>
        </div>
      ) : null}
    </div>
  );
}
