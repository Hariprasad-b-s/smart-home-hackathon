// @vitest-environment jsdom
import '../test/setup';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { CreateTrackerResponseRequest, PatientAppHome } from '@shared/types/api';
import { MOCK_ASTHMA_TRACKER, MOCK_MIGRAINE_TRACKER } from '../dev/mock';
import { mockFetch } from '../test/setup';
import { CheckInFlow } from './CheckInFlow';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const plan: NonNullable<PatientAppHome['actionPlan']> = {
  zone: 'green',
  personalBestPefLpm: 400,
  greenThresholdPct: 80,
  redThresholdPct: 50,
  expired: false,
  steps: { green: ['Keep it up'], yellow: ['Use your rescue inhaler as planned'], red: ['Get help now'] },
};

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const next = () => click(/^Next/);
/** Let chained timer → effect → timer sequences (pairing, blow phases) run to completion. */
async function flushTimers(rounds = 6) {
  for (let i = 0; i < rounds; i++) await act(async () => void (await vi.advanceTimersByTimeAsync(20)));
}

describe('CheckInFlow', () => {
  it('walks every question and submits correctly encoded values', async () => {
    const { calls } = mockFetch({
      'POST /api/patients/p1/tracker-responses': {
        ok: true,
        created: {},
        message: 'Check-in saved — 7 days in a row!',
        newBadge: { name: 'TrackerBadge7', label: '7 check-ins in a row' },
        zoneToday: 'yellow',
      },
    });
    const onSubmitted = vi.fn();
    render(
      <CheckInFlow
        tracker={MOCK_ASTHMA_TRACKER}
        patientId="p1"
        today="2026-11-06"
        spirometer={{ deviceName: 'MIR Spirobank Smart', serialNumber: 'Z125775' }}
        actionPlan={plan}
        onExit={() => {}}
        onSubmitted={onSubmitted}
      />,
    );

    // 1 spirometry → skip
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'Question 1 of 8');
    expect(screen.getByRole('heading', { name: 'Do your breathing test now' })).toBeInTheDocument();
    click('Skip');
    // 2 face scale
    expect(screen.getByRole('button', { name: /^Next/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Okay/ }));
    next();
    // 3 symptoms: pick two, then None clears them
    click('Coughing');
    click('Wheezing');
    click('None of these');
    next();
    // 4 night waking: Yes; 5 missed school: No
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: 'No' }));
    next();
    // 6 rescue uses: stepper twice → 1, then type 2
    click('More');
    click('More');
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } });
    next();
    // 7 triggers: skip; 8 text
    click('Skip');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' Gym class was hard ' } });
    next();

    // Review → go back to change an answer, then return
    expect(screen.getByRole('heading', { name: 'Check your answers' })).toBeInTheDocument();
    expect(screen.getByText('None of these')).toBeInTheDocument();
    click('Send check-in');
    click(/Sending|Send check-in/); // double tap is ignored
    await screen.findByRole('heading', { name: 'Check-in sent!' });

    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('/api/patients/p1/tracker-responses');
    const body = posts[0].body as CreateTrackerResponseRequest;
    expect(body.trackerId).toBe('asthma-v3');
    expect(body.submittedAt).toMatch(/^2026-11-06T\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/);
    expect(body.responses).toEqual([
      { questionId: 'asthma-spirometer', value: null },
      { questionId: 'asthma-feeling', value: 'Okay' },
      { questionId: 'asthma-symptoms', value: '["None of these "]' },
      { questionId: 'asthma-night-waking', value: 'true' },
      { questionId: 'asthma-missed-school', value: 'false' },
      { questionId: 'asthma-rescue-uses', value: '2' },
      { questionId: 'asthma-triggers', value: null },
      { questionId: 'asthma-notes', value: 'Gym class was hard' },
    ]);

    // Celebration: message, badge and yellow-zone guidance
    expect(screen.getByText('Check-in saved — 7 days in a row!')).toBeInTheDocument();
    expect(screen.getByText('7 check-ins in a row')).toBeInTheDocument();
    expect(screen.getByText(/yellow zone today/)).toBeInTheDocument();
    expect(screen.getByText('Use your rescue inhaler as planned')).toBeInTheDocument();
    expect(screen.getByText(/Follow the plan your care team gave you/)).toBeInTheDocument();
    expect(onSubmitted).toHaveBeenCalledOnce();
  });

  it('encodes scale, iconChoice and singleChoice answers (migraine)', async () => {
    const { calls } = mockFetch({ 'POST /api/patients/p2/tracker-responses': { ok: true, created: {}, message: 'Saved' } });
    render(<CheckInFlow tracker={MOCK_MIGRAINE_TRACKER} patientId="p2" today="2026-11-06" onExit={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: '7' }));
    next();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2.5' } });
    next();
    fireEvent.click(screen.getByRole('radio', { name: 'One side' }));
    next();
    click('Screen time');
    next();
    click('Skip'); // sleep
    fireEvent.click(screen.getByRole('radio', { name: /Mostly OK/ }));
    next();
    click('Send check-in');
    await screen.findByText('Saved');
    const body = calls[0].body as CreateTrackerResponseRequest;
    expect(Object.fromEntries(body.responses.map((r) => [r.questionId, r.value]))).toEqual({
      'migraine-headache': 'true',
      'migraine-pain': '7',
      'migraine-duration': '2.5',
      'migraine-where': 'One side',
      'migraine-triggers': '["Screen time"]',
      'migraine-sleep': null,
      'migraine-feeling': 'Partly cloudy',
    });
  });

  it('links a breathing test: posts the session and stores the best blow date', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = mockFetch({
      'POST /api/patients/p1/spirometry-sessions': { ok: true, created: [], message: 'Breathing test saved', zoneToday: 'green' },
      'POST /api/patients/p1/tracker-responses': { ok: true, created: {}, message: 'Saved' },
    });
    render(
      <CheckInFlow
        tracker={{ ...MOCK_ASTHMA_TRACKER, questions: MOCK_ASTHMA_TRACKER.questions.slice(0, 1) }}
        patientId="p1"
        today="2026-11-06"
        spirometer={{ deviceName: 'MIR Spirobank Smart', serialNumber: 'Z125775' }}
        actionPlan={plan}
        onExit={() => {}}
        spiroSpeed={0.001}
      />,
    );
    click('Do your breathing test now');
    await flushTimers();
    expect(screen.getByText('Connected · SN Z125775')).toBeInTheDocument();
    for (let i = 1; i <= 3; i++) {
      click(`Start blow ${i} of 3`);
      await flushTimers();
    }
    click('See my result');
    await screen.findByText(/% of your best/);
    click('Use this in my check-in');
    // Linking moves on to the next step (here: review), showing the linked reading.
    expect(screen.getByRole('heading', { name: 'Check your answers' })).toBeInTheDocument();
    expect(screen.getByText(/^\d+ L\/min$/)).toBeInTheDocument();
    click('Send check-in');
    await screen.findByText('Saved');

    const spiro = calls.find((c) => c.url.endsWith('/spirometry-sessions'))!;
    const readings = (spiro.body as { readings: { baselineReadingDate: string; accepted: boolean; fvcPlusResults: { pef: number } }[] }).readings;
    expect(readings).toHaveLength(3);
    const pool = readings.some((r) => r.accepted) ? readings.filter((r) => r.accepted) : readings;
    const best = pool.reduce((a, b) => (b.fvcPlusResults.pef > a.fvcPlusResults.pef ? b : a));
    const check = calls.find((c) => c.url.endsWith('/tracker-responses'))!.body as CreateTrackerResponseRequest;
    expect(check.responses[0]).toEqual({ questionId: 'asthma-spirometer', value: best.baselineReadingDate });
    expect(best.baselineReadingDate.startsWith('2026-11-06T')).toBe(true);
  });

  it('shows the server error and lets the patient retry', async () => {
    let fail = true;
    const { calls } = mockFetch(
      { 'POST /api/patients/p2/tracker-responses': () => (fail ? { error: 'responses must be an array' } : { ok: true, created: {}, message: 'Saved' }) },
      { status: () => (fail ? 400 : 201) },
    );
    render(<CheckInFlow tracker={{ ...MOCK_MIGRAINE_TRACKER, questions: MOCK_MIGRAINE_TRACKER.questions.slice(0, 1) }} patientId="p2" today="2026-11-06" onExit={() => {}} />);
    click('Skip');
    click('Send check-in');
    expect(await screen.findByText('responses must be an array')).toBeInTheDocument();
    fail = false;
    click('Try sending again');
    await screen.findByText('Saved');
    expect(calls).toHaveLength(2);
  });
});
