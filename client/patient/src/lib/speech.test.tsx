// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SPEECH_HINT, useSpeech, type SpeechRecognitionLike } from './speech';

class FakeRecognition implements SpeechRecognitionLike {
  static last: FakeRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: SpeechRecognitionLike['onresult'] = null;
  onerror: SpeechRecognitionLike['onerror'] = null;
  onend: SpeechRecognitionLike['onend'] = null;
  onspeechstart: SpeechRecognitionLike['onspeechstart'] = null;
  onspeechend: SpeechRecognitionLike['onspeechend'] = null;
  starts = 0;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.starts += 1;
  }
  stop() {}
  abort() {}
}

beforeEach(() => {
  vi.useFakeTimers();
  (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition;
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe('useSpeech', () => {
  it('shows a hint after repeated silence instead of "Listening…" forever, and clears it on speech', () => {
    const { result } = renderHook(() => useSpeech());
    act(() => result.current.start());
    const r = FakeRecognition.last!;
    act(() => {
      r.onerror?.({ error: 'no-speech' });
      r.onend?.();
      vi.advanceTimersByTime(200);
    });
    expect(result.current.hint).toBeNull();
    act(() => {
      r.onerror?.({ error: 'no-speech' });
      r.onend?.();
      vi.advanceTimersByTime(200);
    });
    expect(result.current.hint).toBe(NO_SPEECH_HINT);
    expect(result.current.state).toBe('listening');
    expect(r.starts).toBe(3); // initial + two delayed restarts
    act(() => r.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'I feel okay' }, length: 1 }] }));
    expect(result.current.hint).toBeNull();
    expect(result.current.finalText).toBe('I feel okay');
  });

  it('explains a blocked speech service (network error) instead of blaming the internet connection', () => {
    const { result } = renderHook(() => useSpeech());
    act(() => result.current.start());
    act(() => FakeRecognition.last!.onerror?.({ error: 'network' }));
    expect(result.current.state).toBe('error');
    expect(result.current.errorCode).toBe('network');
    expect(result.current.blocked).toBe(true);
    expect(result.current.error).toMatch(/Chrome|Edge|Safari/);
    expect(result.current.error).not.toMatch(/internet connection/);
  });

  it('gives OS-level guidance when the microphone is not allowed', () => {
    const { result } = renderHook(() => useSpeech());
    act(() => result.current.start());
    act(() => FakeRecognition.last!.onerror?.({ error: 'not-allowed' }));
    expect(result.current.error).toMatch(/lock icon/);
  });

  it('retries a restart that throws, then gives up to "paused"', () => {
    const { result } = renderHook(() => useSpeech());
    act(() => result.current.start());
    const r = FakeRecognition.last!;
    r.start = () => {
      throw new Error('InvalidStateError');
    };
    act(() => {
      r.onend?.();
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.state).toBe('paused');
  });
});

describe('insecure context', () => {
  it('explains that voice needs https or localhost (e.g. a phone opening the LAN IP over http)', () => {
    const orig = window.isSecureContext;
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    try {
      const { result } = renderHook(() => useSpeech());
      act(() => result.current.start());
      expect(result.current.errorCode).toBe('insecure-context');
      expect(result.current.error).toMatch(/https/);
      expect(FakeRecognition.last?.starts ?? 0).toBe(0);
    } finally {
      Object.defineProperty(window, 'isSecureContext', { value: orig, configurable: true });
    }
  });
});
