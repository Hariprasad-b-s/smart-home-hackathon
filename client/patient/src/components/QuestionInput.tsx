/** Generic answer widget for every QuestionType. Values are held as AnswerValue (see lib/encode). */
import { useEffect, useId, useState } from 'react';
import type { TrackerQuestion } from '@shared/types/tracker';
import { toggleCheckbox, type AnswerValue } from '../lib/encode';
import { Icon } from './Icon';
import s from './QuestionInput.module.css';

export interface QuestionInputProps {
  question: TrackerQuestion;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
  /** Labelled-by id of the visible question heading. */
  labelId: string;
}

export function QuestionInput({ question: q, value, onChange, labelId }: QuestionInputProps) {
  switch (q.type) {
    case 'yesNo':
      return (
        <div className={s.yesNo} role="radiogroup" aria-labelledby={labelId}>
          {[
            { v: true, label: 'Yes' },
            { v: false, label: 'No' },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={value === o.v}
              className={`${s.bigChoice} ${value === o.v ? s.on : ''}`}
              onClick={() => onChange(value === o.v ? null : o.v)}
            >
              {o.label}
            </button>
          ))}
        </div>
      );
    case 'number':
      return <NumberInput q={q} value={typeof value === 'number' ? value : null} onChange={onChange} labelId={labelId} />;
    case 'faceScale':
    case 'iconChoice':
      return (
        <div className={s.tiles} role="radiogroup" aria-labelledby={labelId}>
          {(q.options ?? []).map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={value === o.value}
              className={`${s.tile} ${value === o.value ? s.on : ''}`}
              onClick={() => onChange(value === o.value ? null : o.value)}
            >
              <span className={s.tileIcon} aria-hidden="true">
                {o.icon ?? '•'}
              </span>
              <span className={s.tileLabel}>{o.label}</span>
            </button>
          ))}
        </div>
      );
    case 'singleChoice':
      return <RadioList q={q} value={typeof value === 'string' ? value : null} onChange={onChange} labelId={labelId} />;
    case 'checkbox': {
      const current = Array.isArray(value) ? value : [];
      const opts = q.options ?? [];
      return (
        <div role="group" aria-labelledby={labelId}>
          <p className={s.hint}>Pick all that apply.</p>
          <div className={s.chips}>
            {opts.map((o) => {
              const on = current.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  className={`${s.chip} ${on ? s.on : ''} ${o.isNone ? s.chipNone : ''}`}
                  onClick={() => {
                    const next = toggleCheckbox(opts, current, o.value);
                    onChange(next.length ? next : null);
                  }}
                >
                  {on && <Icon name="check" size={18} />}
                  {o.icon && <span aria-hidden="true">{o.icon}</span>}
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    case 'scale1to10': {
      const min = q.min ?? 1;
      const max = q.max ?? 10;
      const nums = Array.from({ length: max - min + 1 }, (_, i) => min + i);
      return (
        <div>
          <div className={s.scale} role="radiogroup" aria-labelledby={labelId}>
            {nums.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={value === n}
                className={`${s.scaleBtn} ${value === n ? s.on : ''}`}
                onClick={() => onChange(value === n ? null : n)}
              >
                {n}
              </button>
            ))}
          </div>
          <div className={s.scaleEnds} aria-hidden="true">
            <span>{(q.direction ?? 'higherIsWorse') === 'higherIsWorse' ? 'Not bad' : 'Low'}</span>
            <span>{(q.direction ?? 'higherIsWorse') === 'higherIsWorse' ? 'Worst' : 'High'}</span>
          </div>
        </div>
      );
    }
    case 'text':
      return (
        <textarea
          className={s.textarea}
          aria-labelledby={labelId}
          rows={5}
          maxLength={1000}
          placeholder="Type here (optional)"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'spirometry':
      // Rendered by the check-in flow (needs the device simulator).
      return null;
    default:
      return null;
  }
}

function RadioList({ q, value, onChange, labelId }: { q: TrackerQuestion; value: string | null; onChange: (v: AnswerValue) => void; labelId: string }) {
  const name = useId();
  return (
    <div className={s.radios} role="radiogroup" aria-labelledby={labelId}>
      {(q.options ?? []).map((o) => (
        <label key={o.value} className={`${s.radio} ${value === o.value ? s.on : ''}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.icon && <span aria-hidden="true">{o.icon}</span>}
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

function NumberInput({ q, value, onChange, labelId }: { q: TrackerQuestion; value: number | null; onChange: (v: AnswerValue) => void; labelId: string }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    setText((t) => (value === null ? (t.trim() === '' ? t : '') : Number(t) === value && t.trim() !== '' ? t : String(value)));
  }, [value]);
  const min = q.min;
  const max = q.max;
  const step = 1;
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const bump = (d: number) => {
    const base = value ?? (d > 0 ? (min ?? 0) - step : (min ?? 0) + step);
    const next = clamp(Math.round((base + d) * 10) / 10);
    onChange(next);
  };
  const unitId = useId();
  return (
    <div className={s.number}>
      <button
        type="button"
        className={s.stepBtn}
        onClick={() => bump(-step)}
        disabled={value !== null && min !== undefined && value <= min}
        aria-label="Less"
      >
        <Icon name="minus" size={26} />
      </button>
      <div className={s.numberField}>
        <input
          type="number"
          inputMode="decimal"
          className={s.numberInput}
          aria-labelledby={labelId}
          aria-describedby={q.unit ? unitId : undefined}
          min={min}
          max={max}
          step="any"
          value={text}
          placeholder="–"
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            if (t.trim() === '') onChange(null);
            else {
              const n = Number(t);
              if (Number.isFinite(n)) onChange(n);
            }
          }}
        />
        {q.unit && (
          <span id={unitId} className={s.unit}>
            {q.unit}
          </span>
        )}
      </div>
      <button
        type="button"
        className={s.stepBtn}
        onClick={() => bump(step)}
        disabled={value !== null && max !== undefined && value >= max}
        aria-label="More"
      >
        <Icon name="plus" size={26} />
      </button>
      {(min !== undefined || max !== undefined) && (
        <p className={s.range}>
          {min !== undefined && max !== undefined ? `${min} to ${max}` : min !== undefined ? `${min} or more` : `Up to ${max}`}
          {q.unit ? ` ${q.unit}` : ''}
        </p>
      )}
    </div>
  );
}
