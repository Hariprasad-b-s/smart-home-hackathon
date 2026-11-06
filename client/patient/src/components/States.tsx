import type { ApiError } from '../lib/errors';
import { Icon } from './Icon';
import ui from '../styles/ui.module.css';

export function ErrorState({ error, onRetry, title = "Couldn't load this" }: { error: ApiError | Error | string; onRetry?: () => void; title?: string }) {
  const message = typeof error === 'string' ? error : error.message;
  const offline = typeof error !== 'string' && 'offline' in error && error.offline;
  return (
    <div className={ui.error} role="alert">
      <p className={ui.errorTitle}>
        <Icon name={offline ? 'wifiOff' : 'alert'} size={20} />
        {offline ? "You're offline" : title}
      </p>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className={`${ui.btn} ${ui.small}`} onClick={onRetry}>
          <Icon name="refresh" size={18} />
          Try again
        </button>
      )}
    </div>
  );
}

export function LoadingBlocks({ label = 'Loading' }: { label?: string }) {
  return (
    <div className={ui.stack} role="status" aria-label={label}>
      <div className={ui.skeleton} style={{ height: 40, width: '60%' }} />
      <div className={ui.skeleton} style={{ height: 150 }} />
      <div className={ui.skeleton} style={{ height: 220 }} />
    </div>
  );
}
