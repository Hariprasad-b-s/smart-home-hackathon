import { useId, useState } from 'react';
import type { AiStatus, SafetyNotice } from '@shared/types/api';
import { Icon } from './Icon';
import s from './Safety.module.css';

/** Emergency / urgent notice with one-tap call links. Always rendered at the top of its screen. */
export function SafetyBanner({ notice }: { notice: SafetyNotice }) {
  const emergency = notice.level === 'emergency';
  const mentions988 = /\b988\b/.test(notice.message);
  const mentions911 = emergency || /\b911\b/.test(notice.message);
  return (
    <section className={`${s.safety} ${emergency ? s.emergency : s.urgent}`} role="alert" aria-label={emergency ? 'Emergency' : 'Important'}>
      <p className={s.title}>
        <Icon name="alert" size={24} />
        {emergency ? 'Get help now' : 'Please take care'}
      </p>
      <p className={s.message}>{notice.message}</p>
      {(mentions911 || mentions988) && (
        <div className={s.actions}>
          {mentions911 && (
            <a className={`${s.call} ${s.primary}`} href="tel:911">
              Call 911
            </a>
          )}
          {mentions988 && (
            <>
              <a className={s.call} href="tel:988">
                Call 988
              </a>
              <a className={s.call} href="sms:988">
                Text 988
              </a>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Subtle "AI helper (demo)" / "Offline helper" chip with the notice in a popover. */
export function AiStatusChip({ status }: { status: AiStatus | null }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const label = status?.engine === 'claude' ? 'AI helper (demo)' : 'Offline helper';
  const notice =
    status?.notice ??
    'This demo helper uses made-up data only. It is not a doctor and can make mistakes. Check answers with your care team.';
  return (
    <span className={s.chipWrap}>
      <button type="button" className={s.chip} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className={s.dot} aria-hidden="true" />
        {label}
        <Icon name="help" size={15} />
      </button>
      {open && (
        <span id={id} role="note" className={s.popover}>
          {notice}
          {status?.engine === 'rules' && ' Right now answers come from simple built-in rules, not an AI model.'}
        </span>
      )}
    </span>
  );
}
