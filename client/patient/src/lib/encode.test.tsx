// @vitest-environment jsdom
import '../test/setup';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TrackerQuestion } from '@shared/types/tracker';
import { QuestionInput } from '../components/QuestionInput';
import { MOCK_ASTHMA_TRACKER } from '../dev/mock';
import { buildCheckInRequest, displayAnswer, encodeAnswer, toggleCheckbox } from './encode';

const q = (over: Partial<TrackerQuestion>): TrackerQuestion => ({ id: 'q', text: 'Q?', shortLabel: 'Q', type: 'text', order: 1, ...over });
const symptoms = MOCK_ASTHMA_TRACKER.questions.find((x) => x.id === 'asthma-symptoms')!;
const faces = MOCK_ASTHMA_TRACKER.questions.find((x) => x.id === 'asthma-feeling')!;

describe('encodeAnswer', () => {
  it('yesNo → "true" / "false"', () => {
    expect(encodeAnswer(q({ type: 'yesNo' }), true)).toBe('true');
    expect(encodeAnswer(q({ type: 'yesNo' }), false)).toBe('false');
  });

  it('number and scale1to10 → decimal strings', () => {
    expect(encodeAnswer(q({ type: 'number' }), 3)).toBe('3');
    expect(encodeAnswer(q({ type: 'number' }), 2.5)).toBe('2.5');
    expect(encodeAnswer(q({ type: 'number' }), 0)).toBe('0');
    expect(encodeAnswer(q({ type: 'scale1to10' }), 7)).toBe('7');
    expect(encodeAnswer(q({ type: 'number' }), NaN)).toBeNull();
  });

  it('faceScale / iconChoice / singleChoice → option.value verbatim', () => {
    expect(encodeAnswer(faces, 'Great')).toBe('Great');
    const icon = q({ type: 'iconChoice', options: [{ value: 'Partly cloudy', label: 'Mostly OK', icon: '⛅' }] });
    expect(encodeAnswer(icon, 'Partly cloudy')).toBe('Partly cloudy');
    const single = q({ type: 'singleChoice', options: [{ value: ' One side ', label: 'One side' }] });
    expect(encodeAnswer(single, ' One side ')).toBe(' One side ');
  });

  it('checkbox → JSON array of option values, keeping "None of these " whitespace', () => {
    expect(encodeAnswer(symptoms, ['None of these '])).toBe('["None of these "]');
    // Stored in option order regardless of tap order.
    expect(encodeAnswer(symptoms, ['Tight Chest', 'Coughing'])).toBe('["Coughing","Tight Chest"]');
    expect(encodeAnswer(symptoms, [])).toBeNull();
  });

  it('spirometry → baselineReadingDate of the linked blow', () => {
    const iso = '2026-11-06T09:31:12.120-05:00';
    expect(encodeAnswer(q({ type: 'spirometry' }), iso)).toBe(iso);
    expect(encodeAnswer(q({ type: 'spirometry' }), '')).toBeNull();
  });

  it('text → trimmed free text, blank = skipped', () => {
    expect(encodeAnswer(q({ type: 'text' }), '  felt fine  ')).toBe('felt fine');
    expect(encodeAnswer(q({ type: 'text' }), '   ')).toBeNull();
  });

  it('skipped answers encode as null for every type', () => {
    for (const type of ['yesNo', 'number', 'faceScale', 'iconChoice', 'checkbox', 'singleChoice', 'scale1to10', 'spirometry', 'text'] as const) {
      expect(encodeAnswer(q({ type }), undefined)).toBeNull();
      expect(encodeAnswer(q({ type }), null)).toBeNull();
    }
  });
});

describe('toggleCheckbox', () => {
  const opts = symptoms.options!;
  it('picking an isNone option clears the others', () => {
    expect(toggleCheckbox(opts, ['Coughing', 'Wheezing'], 'None of these ')).toEqual(['None of these ']);
  });
  it('picking a symptom clears the isNone option', () => {
    expect(toggleCheckbox(opts, ['None of these '], 'Coughing')).toEqual(['Coughing']);
  });
  it('tapping a selected option deselects it', () => {
    expect(toggleCheckbox(opts, ['Coughing', 'Wheezing'], 'Coughing')).toEqual(['Wheezing']);
  });
});

describe('buildCheckInRequest', () => {
  it('includes every question in order, skipped = null, and out-of-range numbers are dropped', () => {
    const body = buildCheckInRequest(
      MOCK_ASTHMA_TRACKER,
      { 'asthma-feeling': 'Okay', 'asthma-symptoms': ['None of these '], 'asthma-night-waking': false, 'asthma-rescue-uses': 99 },
      '2026-11-06T09:00:00.000-05:00',
    );
    expect(body.trackerId).toBe('asthma-v3');
    expect(body.submittedAt).toBe('2026-11-06T09:00:00.000-05:00');
    expect(body.responses.map((r) => r.questionId)).toEqual(MOCK_ASTHMA_TRACKER.questions.map((x) => x.id));
    const v = Object.fromEntries(body.responses.map((r) => [r.questionId, r.value]));
    expect(v['asthma-spirometer']).toBeNull();
    expect(v['asthma-feeling']).toBe('Okay');
    expect(v['asthma-symptoms']).toBe('["None of these "]');
    expect(v['asthma-night-waking']).toBe('false');
    expect(v['asthma-rescue-uses']).toBeNull(); // max is 12
  });

  it('displays answers in plain words for review', () => {
    expect(displayAnswer(symptoms, ['None of these '])).toBe('None of these');
    expect(displayAnswer(q({ type: 'yesNo' }), true)).toBe('Yes');
    expect(displayAnswer(q({ type: 'number', unit: 'times' }), 2)).toBe('2 times');
    expect(displayAnswer(q({ type: 'text' }), undefined)).toBe('Skipped');
  });
});

describe('QuestionInput checkbox chips', () => {
  it('isNone chip clears the other chips', () => {
    const onChange = vi.fn();
    const { rerender } = render(<QuestionInput question={symptoms} value={['Coughing', 'Wheezing']} onChange={onChange} labelId="x" />);
    fireEvent.click(screen.getByRole('button', { name: 'None of these' }));
    expect(onChange).toHaveBeenLastCalledWith(['None of these ']);
    rerender(<QuestionInput question={symptoms} value={['None of these ']} onChange={onChange} labelId="x" />);
    expect(screen.getByRole('button', { name: /None of these/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Wheezing' }));
    expect(onChange).toHaveBeenLastCalledWith(['Wheezing']);
  });

  it('number stepper respects min/max', () => {
    const onChange = vi.fn();
    const rescue = MOCK_ASTHMA_TRACKER.questions.find((x) => x.id === 'asthma-rescue-uses')!;
    const { rerender } = render(<QuestionInput question={rescue} value={undefined} onChange={onChange} labelId="x" />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(onChange).toHaveBeenLastCalledWith(0);
    rerender(<QuestionInput question={rescue} value={12} onChange={onChange} labelId="x" />);
    expect(screen.getByRole('button', { name: 'More' })).toBeDisabled();
    expect(screen.getByText('times')).toBeInTheDocument();
  });
});
