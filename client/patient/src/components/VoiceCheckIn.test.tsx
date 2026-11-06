// @vitest-environment jsdom
import '../test/setup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CreateTrackerResponseRequest, VoiceParseResult } from '@shared/types/api';
import { MOCK_ASTHMA_TRACKER } from '../dev/mock';
import { mockFetch } from '../test/setup';
import { VoiceCheckIn } from './VoiceCheckIn';

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
  say(text: string, isFinal = true) {
    act(() => this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text }, length: 1 }] }));
  }
}

const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };

beforeEach(() => {
  FakeRecognition.instances = [];
  w.SpeechRecognition = FakeRecognition;
});
afterEach(() => {
  delete w.SpeechRecognition;
  delete w.webkitSpeechRecognition;
  vi.unstubAllGlobals();
});

const parseResult = (over: Partial<VoiceParseResult> = {}): VoiceParseResult => ({
  trackerId: 'asthma-v3',
  engine: 'rules',
  answers: [
    { questionId: 'asthma-spirometer', value: null, confidence: 'low' },
    { questionId: 'asthma-feeling', value: 'Okay', confidence: 'high', evidence: "I'm feeling okay" },
    { questionId: 'asthma-symptoms', value: '["Coughing","None of these "]'.replace(',"None of these "', ''), confidence: 'medium', evidence: "I've been coughing" },
    { questionId: 'asthma-night-waking', value: null, confidence: 'low' },
    { questionId: 'asthma-missed-school', value: 'false', confidence: 'high', evidence: 'I went to school' },
    { questionId: 'asthma-rescue-uses', value: '2', confidence: 'low', evidence: 'used my inhaler twice I think' },
    { questionId: 'asthma-triggers', value: null, confidence: 'low' },
    { questionId: 'asthma-notes', value: null, confidence: 'low' },
  ],
  unanswered: ['asthma-spirometer', 'asthma-night-waking', 'asthma-triggers', 'asthma-notes'],
  followUp: 'Tell me if asthma woke you up last night.',
  ...over,
});

const props = { tracker: MOCK_ASTHMA_TRACKER, patientId: 'p1', today: '2026-11-06', onExit: () => {} };

describe('VoiceCheckIn', () => {
  it('records, parses, pre-fills the review and submits with the voice fields', async () => {
    const parseBodies: unknown[] = [];
    const { calls } = mockFetch({
      'POST /api/patients/p1/voice-checkin/parse': (b: unknown) => {
        parseBodies.push(b);
        return parseBodies.length === 1
          ? parseResult()
          : parseResult({
              answers: parseResult().answers.map((a) =>
                a.questionId === 'asthma-night-waking' ? { ...a, value: 'false', confidence: 'high', evidence: "I didn't wake up" } : a,
              ),
              unanswered: ['asthma-spirometer', 'asthma-triggers', 'asthma-notes'],
            });
      },
      'POST /api/patients/p1/tracker-responses': { ok: true, created: {}, message: 'Check-in saved — 3 days in a row!' },
    });
    render(<VoiceCheckIn {...props} />);

    // Prompts built from the tracker
    expect(screen.getByRole('heading', { name: "Here's what to tell us" })).toBeInTheDocument();
    expect(screen.getByText("How you're feeling today")).toBeInTheDocument();
    expect(screen.getByText(/Any symptoms \(coughing, wheezing, tight chest…\)/)).toBeInTheDocument();
    expect(screen.getByText('Did you wake up at night?')).toBeInTheDocument();
    expect(screen.getByText('How many times you used your rescue inhaler')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start talking' }));
    const rec = FakeRecognition.instances[0];
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(rec.start).toHaveBeenCalledTimes(1);
    rec.say("I'm feeling okay, I've been coughing", false);
    expect(screen.getByText("I'm feeling okay, I've been coughing")).toBeInTheDocument(); // interim
    rec.say("I'm feeling okay. I've been coughing.");
    // The browser ends the session after silence: we restart while still recording.
    act(() => rec.onend?.());
    // The restart is deferred (an immediate start() inside onend can throw in Chrome).
    await waitFor(() => expect(rec.start).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Pause recording' }));
    expect(rec.stop).toHaveBeenCalled();

    const box = screen.getByLabelText('What we heard (you can fix it)') as HTMLTextAreaElement;
    expect(box.value).toBe("I'm feeling okay. I've been coughing.");
    fireEvent.change(box, { target: { value: `${box.value} I went to school.` } });
    fireEvent.click(screen.getByRole('button', { name: 'Check my answers' }));
    expect(await screen.findByRole('heading', { name: 'Check your answers' })).toBeInTheDocument();
    expect(parseBodies[0]).toEqual({ trackerId: 'asthma-v3', transcript: "I'm feeling okay. I've been coughing. I went to school." });

    // Pre-filled, with confidence chips, evidence and missing answers highlighted
    expect(screen.getByRole('radio', { name: /Okay/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: /Coughing/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('radio', { name: 'No' })[1]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('spinbutton')).toHaveValue(2);
    expect(screen.getByText('Please check')).toBeInTheDocument(); // medium
    expect(screen.getByText('Not sure, please check')).toBeInTheDocument(); // low
    expect(screen.getByText(`You said: "I've been coughing"`)).toBeInTheDocument();
    expect(screen.getAllByText('Not answered yet').length).toBe(4);
    expect(screen.getByText('Tell me if asthma woke you up last night.')).toBeInTheDocument();

    // Say more → records an addition, appends it and re-parses
    fireEvent.click(screen.getByRole('button', { name: /Say more/ }));
    const more = FakeRecognition.instances[1];
    expect(more.start).toHaveBeenCalled();
    more.say("I didn't wake up last night.");
    fireEvent.click(screen.getByRole('button', { name: 'Add and check again' }));
    await waitFor(() => expect(parseBodies).toHaveLength(2));
    expect((parseBodies[1] as { transcript: string }).transcript).toBe(
      "I'm feeling okay. I've been coughing. I went to school. I didn't wake up last night.",
    );
    await screen.findByRole('heading', { name: 'Check your answers' });
    expect(screen.getAllByText('Not answered yet').length).toBe(3);

    // Patient corrects one answer, then submits
    fireEvent.click(screen.getByRole('radio', { name: /Good/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send check-in' }));
    await screen.findByRole('heading', { name: 'Check-in sent!' });
    const post = calls.find((c) => c.url.endsWith('/tracker-responses'))!;
    const body = post.body as CreateTrackerResponseRequest;
    expect(body.entryMode).toBe('voice');
    expect(body.transcript).toBe("I'm feeling okay. I've been coughing. I went to school. I didn't wake up last night.");
    expect(body.mediaIds).toBeUndefined();
    expect(Object.fromEntries(body.responses.map((r) => [r.questionId, r.value]))).toEqual({
      'asthma-spirometer': null,
      'asthma-feeling': 'Good',
      'asthma-symptoms': '["Coughing"]',
      'asthma-night-waking': 'false',
      'asthma-missed-school': 'false',
      'asthma-rescue-uses': '2',
      'asthma-triggers': null,
      'asthma-notes': null,
    });
  });

  it('falls back to typing when speech recognition is unsupported', async () => {
    delete w.SpeechRecognition;
    mockFetch({ 'POST /api/patients/p1/voice-checkin/parse': parseResult() });
    render(<VoiceCheckIn {...props} />);
    expect(screen.getByRole('heading', { name: 'Type how today went' })).toBeInTheDocument();
    expect(screen.getByText(/Voice typing isn't available/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start talking' })).not.toBeInTheDocument();
    const box = screen.getByLabelText('What happened today');
    expect(screen.getByRole('button', { name: 'Check my answers' })).toBeDisabled();
    fireEvent.change(box, { target: { value: 'Feeling okay, coughing a bit.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check my answers' }));
    expect(await screen.findByRole('heading', { name: 'Check your answers' })).toBeInTheDocument();
  });

  it('switches to typing when the microphone is blocked', () => {
    render(<VoiceCheckIn {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start talking' }));
    act(() => FakeRecognition.instances[0].onerror?.({ error: 'not-allowed' }));
    expect(screen.getByRole('heading', { name: 'Type how today went' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Microphone access is blocked/);
  });

  it('shows the safety banner at the top of the review with call links', async () => {
    mockFetch({
      'POST /api/patients/p1/voice-checkin/parse': parseResult({
        safety: { level: 'emergency', message: 'Use your rescue inhaler now and call 911.' },
      }),
    });
    delete w.SpeechRecognition;
    render(<VoiceCheckIn {...props} />);
    fireEvent.change(screen.getByLabelText('What happened today'), { target: { value: "I can't breathe" } });
    fireEvent.click(screen.getByRole('button', { name: 'Check my answers' }));
    const alert = await screen.findByRole('alert', { name: 'Emergency' });
    expect(alert).toHaveTextContent('Use your rescue inhaler now and call 911.');
    expect(screen.getByRole('link', { name: 'Call 911' })).toHaveAttribute('href', 'tel:911');
    // Banner comes before the review heading.
    const heading = screen.getByRole('heading', { name: 'Check your answers' });
    expect(alert.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
