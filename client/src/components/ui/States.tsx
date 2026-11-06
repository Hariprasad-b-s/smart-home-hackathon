import type { ReactNode } from 'react';
import { Icon } from './Icon';
import s from './ui.module.css';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className={s.state} role="status" aria-live="polite">
      <span className={s.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ title = 'Couldn’t load this data', error, onRetry }: { title?: string; error?: Error; onRetry?: () => void }) {
  return (
    <div className={`${s.state} ${s.stateError}`} role="alert">
      <Icon name="alertOctagon" size={22} />
      <div>
        <p className={s.stateTitle}>{title}</p>
        {error ? <p className={s.stateText}>{error.message}</p> : null}
      </div>
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          <Icon name="refresh" size={16} /> Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`${s.state} ${s.stateEmpty}`}>
      <Icon name="calendar" size={22} />
      <div>
        <p className={s.stateTitle}>{title}</p>
        {children ? <div className={s.stateText}>{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
