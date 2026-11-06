import { useEffect, useId, useRef, useState } from 'react';
import type { PatientFacingPointKey, PatientSummary, VisitModeVisibility } from '@shared/types';
import { Icon } from '../../components/ui';
import { POINT_KEYS, POINT_LABEL, availablePointKeys, hiddenVisitItems } from '../../lib/prefs';
import s from './VisitButton.module.css';

interface Props {
  summary: PatientSummary;
  /** Effective visibility (this-visit override, else the clinician default). */
  visibility: VisitModeVisibility;
  onVisit: () => void;
  /** Undefined when no clinician is signed in (nothing to save to). */
  onSaveDefault?: (v: VisitModeVisibility) => void;
  onJustThisVisit: (v: VisitModeVisibility) => void;
}

const SUMMARY_ITEMS: { key: 'headline' | 'dayCounts' | 'calendar' | 'achievements'; label: string; hint: string }[] = [
  { key: 'headline', label: 'Headline sentence', hint: 'The “you had N good days and M hard days” sentence' },
  { key: 'dayCounts', label: 'Good and hard day counts', hint: 'The three large number cards' },
  { key: 'calendar', label: 'Calendar', hint: 'Large calendar of good and hard days' },
  { key: 'achievements', label: 'Achievements', hint: 'Streaks and badges' },
];

/** Split button: enter visit mode, or choose what the patient will see first. */
export function VisitButton({ summary, visibility, onVisit, onSaveDefault, onJustThisVisit }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<VisitModeVisibility>(visibility);
  const wrapRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const hidden = hiddenVisitItems(visibility, summary);
  const available = new Set(availablePointKeys(summary));
  const pointText = (k: PatientFacingPointKey) => summary.patientFacing.points.find((p) => p.key === k)?.text;

  useEffect(() => {
    if (!open) return;
    setDraft(visibility);
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    wrapRef.current?.querySelector<HTMLElement>('[role="dialog"] input')?.focus();
    return () => document.removeEventListener('mousedown', onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    caretRef.current?.focus();
  };
  const setSummaryItem = (k: (typeof SUMMARY_ITEMS)[number]['key'], v: boolean) => setDraft((d) => ({ ...d, [k]: v }));
  const setPoint = (k: PatientFacingPointKey, v: boolean) => setDraft((d) => ({ ...d, points: { ...d.points, [k]: v } }));

  return (
    <div className={s.wrap} ref={wrapRef}>
      <div className={s.split}>
        <button type="button" className={`btn btn-primary ${s.main}`} onClick={onVisit}>
          <Icon name="presentation" size={16} /> Visit mode
          {hidden ? <span className={s.hint}>{hidden} hidden</span> : null}
        </button>
        <button
          ref={caretRef}
          type="button"
          className={`btn btn-primary ${s.caret}`}
          aria-label="Choose what the patient will see"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="chevronDown" size={16} />
        </button>
      </div>
      {open ? (
        <div
          id={dialogId}
          role="dialog"
          aria-label="What the patient will see"
          className={s.pop}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
        >
          <h2 className={s.title}>What the patient will see</h2>
          <fieldset className={s.group}>
            <legend>Summary</legend>
            {SUMMARY_ITEMS.map((it) => (
              <label key={it.key} className={s.row}>
                <input type="checkbox" checked={draft[it.key]} onChange={(e) => setSummaryItem(it.key, e.target.checked)} />
                <span>
                  <span className={s.label}>{it.label}</span>
                  <span className={s.preview}>{it.key === 'headline' ? summary.patientFacing.headline : it.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset className={s.group}>
            <legend>Talking points</legend>
            {POINT_KEYS.map((k) => {
              const has = available.has(k);
              return (
                <label key={k} className={`${s.row} ${has ? '' : s.disabled}`}>
                  <input type="checkbox" disabled={!has} checked={has && draft.points[k] !== false} onChange={(e) => setPoint(k, e.target.checked)} />
                  <span>
                    <span className={s.label}>{POINT_LABEL[k]}</span>
                    <span className={s.preview}>{has ? pointText(k) : 'Not available for this patient'}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <div className={s.footer}>
            {onSaveDefault ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onSaveDefault(draft);
                  close();
                }}
              >
                Save as my default
              </button>
            ) : null}
            <button
              type="button"
              className="btn"
              onClick={() => {
                setOpen(false);
                onJustThisVisit(draft);
              }}
            >
              Just this visit
            </button>
            <button type="button" className="btn btn-ghost" onClick={close}>
              Cancel
            </button>
          </div>
          <p className={s.note}>
            {onSaveDefault ? '“Save as my default” applies to all your patients. “Just this visit” starts visit mode with these choices for this patient only.' : '“Just this visit” starts visit mode with these choices for this patient only.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}
