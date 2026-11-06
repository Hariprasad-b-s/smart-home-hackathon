import { useId } from 'react';
import { useTheme, type ThemePreference } from '../../lib/theme';
import { Icon, type IconName } from './Icon';
import s from './ThemeToggle.module.css';

const OPTIONS: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

/** Compact System / Light / Dark radio group (native radios: arrow keys move, Space selects). */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const name = `color-theme-${useId()}`;
  return (
    <fieldset className={`${s.toggle} ${className ?? ''}`} data-testid="theme-toggle">
      <legend className={s.srOnly}>Color theme</legend>
      {OPTIONS.map((o) => (
        <label key={o.value} className={`${s.option} ${theme === o.value ? s.on : ''}`} title={`${o.label} theme`}>
          <input type="radio" name={name} value={o.value} checked={theme === o.value} onChange={() => setTheme(o.value)} />
          <span className={s.face}>
            <Icon name={o.icon} size={15} />
            <span className={s.srOnly}>{o.label}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
