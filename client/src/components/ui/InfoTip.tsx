import { useId, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import s from './ui.module.css';

/** Small "how was this computed" tip. Opens on hover, focus or click; Esc closes. */
export function InfoTip({ label = 'How this is calculated', children }: { label?: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className={s.tipWrap}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={s.tipButton}
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      >
        <Icon name="info" size={14} />
      </button>
      <span id={id} role="tooltip" className={`${s.tip} ${open ? s.tipOpen : ''}`}>
        {children}
      </span>
    </span>
  );
}
