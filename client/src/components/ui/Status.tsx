import type { Status, Trend, Zone } from '@shared/types';
import { Icon, type IconName } from './Icon';
import { STATUS_LABEL, ZONE_LABEL } from '../../lib/format';
import s from './ui.module.css';

export const STATUS_ICON: Record<Status, IconName> = {
  good: 'checkCircle',
  watch: 'alertTriangle',
  concern: 'alertOctagon',
  neutral: 'minusCircle',
  unknown: 'help',
};

export function StatusIcon({ status, size = 16 }: { status: Status; size?: number }) {
  return <Icon name={STATUS_ICON[status]} size={size} className={s[`fg_${status}`]} />;
}

/** Status pill: colour always paired with an icon and text. */
export function StatusBadge({ status, label, subtle }: { status: Status; label?: string; subtle?: boolean }) {
  return (
    <span className={`${s.badge} ${s[`badge_${status}`]} ${subtle ? s.badgeSubtle : ''}`}>
      <Icon name={STATUS_ICON[status]} size={14} />
      <span>{label ?? STATUS_LABEL[status]}</span>
    </span>
  );
}

export function ZoneBadge({ zone, suffix = ' zone', large }: { zone?: Zone; suffix?: string; large?: boolean }) {
  if (!zone) {
    return (
      <span className={`${s.zone} ${s.zone_none} ${large ? s.zoneLarge : ''}`}>
        <span className={s.zoneDot} aria-hidden="true" />
        No zone
      </span>
    );
  }
  return (
    <span className={`${s.zone} ${s[`zone_${zone}`]} ${large ? s.zoneLarge : ''}`}>
      <span className={s.zoneDot} aria-hidden="true" />
      {ZONE_LABEL[zone]}
      {suffix}
    </span>
  );
}

/** Arrow + text; colour follows clinical meaning (better / worse), not direction. */
export function TrendIndicator({ trend, compact }: { trend?: Trend; compact?: boolean }) {
  if (!trend || trend.direction === 'unknown') return null;
  const icon: IconName = trend.direction === 'up' ? 'arrowUp' : trend.direction === 'down' ? 'arrowDown' : 'arrowRight';
  const meaningWord = trend.meaning === 'better' ? 'better' : trend.meaning === 'worse' ? 'worse' : 'no clear change';
  return (
    <span className={`${s.trend} ${s[`trend_${trend.meaning}`]}`} title={`${trend.text} (${meaningWord})`}>
      <Icon name={icon} size={13} strokeWidth={2.2} />
      <span className={compact ? s.srOnly : undefined}>{trend.text}</span>
      <span className={s.srOnly}>, {meaningWord}</span>
    </span>
  );
}
