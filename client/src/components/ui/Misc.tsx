import type { ReactNode } from 'react';
import s from './ui.module.css';

export function Avatar({ initials, size = 36 }: { initials: string; size?: number }) {
  return (
    <span className={s.avatar} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {initials}
    </span>
  );
}

export function Chip({ children, tone = 'default', title }: { children: ReactNode; tone?: 'default' | 'accent' | 'purple' | 'magenta' | 'muted'; title?: string }) {
  return (
    <span className={`${s.chip} ${s[`chip_${tone}`]}`} title={title}>
      {children}
    </span>
  );
}

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
}

/** Radio-group styled as a segmented control (arrow keys move, like native radios). */
export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
  size = 'md',
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  const name = `seg-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <fieldset className={`${s.segmented} ${size === 'sm' ? s.segmentedSm : ''}`}>
      <legend className={s.srOnly}>{label}</legend>
      {options.map((o) => (
        <label key={String(o.value)} className={`${s.segment} ${o.value === value ? s.segmentOn : ''}`}>
          <input
            type="radio"
            name={name}
            value={String(o.value)}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Dashboard panel with a heading row. `id` is used for in-page links and print. */
export function Panel({
  id,
  title,
  icon,
  actions,
  children,
  span = 1,
  className,
  subtitle,
}: {
  id: string;
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  span?: 1 | 2;
  className?: string;
  subtitle?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`${s.panel} ${span === 2 ? s.panelWide : ''} ${className ?? ''}`}>
      <header className={s.panelHead}>
        <div className={s.panelTitleWrap}>
          {icon ? <span className={s.panelIcon}>{icon}</span> : null}
          <div>
            <h2 id={`${id}-title`} className={s.panelTitle}>
              {title}
            </h2>
            {subtitle ? <p className={s.panelSub}>{subtitle}</p> : null}
          </div>
        </div>
        {actions ? <div className={`${s.panelActions} no-print`}>{actions}</div> : null}
      </header>
      <div className={s.panelBody}>{children}</div>
    </section>
  );
}
