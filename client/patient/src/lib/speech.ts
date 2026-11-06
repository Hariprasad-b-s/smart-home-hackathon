/**
 * Thin wrapper around the browser Web Speech API (SpeechRecognition / webkitSpeechRecognition).
 * Continuous with interim results; restarts itself when the browser ends a session while the
 * patient is still recording (Chrome stops after silence).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/* Minimal typings: lib.dom doesn't ship SpeechRecognition. */
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  0: SpeechAlternative;
  length: number;
}
export interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
export interface SpeechErrorEvent {
  error: string;
  message?: string;
}
export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognition(): SpeechCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type SpeechState = 'idle' | 'listening' | 'paused' | 'error';

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': 'Your browser blocked the microphone. You can allow it in your browser settings, or type instead.',
  'service-not-allowed': 'Voice typing is turned off in this browser. You can type instead.',
  'audio-capture': "We couldn't find a microphone. You can type instead.",
  network: 'Voice typing needs an internet connection. You can type instead.',
};

export function useSpeech() {
  const Ctor = getSpeechRecognition();
  const [state, setState] = useState<SpeechState>('idle');
  const [finalText, setFinalText] = useState('');
  const [interim, setInterim] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const want = useRef(false);

  const ensure = useCallback(() => {
    if (!Ctor) return null;
    if (rec.current) return rec.current;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    r.onresult = (e) => {
      let fin = '';
      let tmp = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0]?.transcript ?? '';
        if (res.isFinal) fin += text;
        else tmp += text;
      }
      if (fin) setFinalText((t) => joinText(t, fin));
      setInterim(tmp);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // harmless; onend restarts
      want.current = false;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') setBlocked(true);
      setError(ERROR_TEXT[e.error] ?? 'Voice typing stopped. Try again, or type instead.');
      setState('error');
    };
    r.onend = () => {
      setInterim('');
      setSpeaking(false);
      if (want.current) {
        try {
          r.start();
        } catch {
          /* already started */
        }
      }
    };
    r.onspeechstart = () => setSpeaking(true);
    r.onspeechend = () => setSpeaking(false);
    rec.current = r;
    return r;
  }, [Ctor]);

  const start = useCallback(() => {
    const r = ensure();
    if (!r) return;
    setError(null);
    want.current = true;
    try {
      r.start();
      setState('listening');
    } catch {
      setState('listening'); // start() throws if already running
    }
  }, [ensure]);

  const pause = useCallback(() => {
    want.current = false;
    rec.current?.stop();
    setState('paused');
  }, []);

  const reset = useCallback(() => {
    want.current = false;
    rec.current?.abort();
    setFinalText('');
    setInterim('');
    setState('idle');
  }, []);

  useEffect(
    () => () => {
      want.current = false;
      rec.current?.abort();
    },
    [],
  );

  return { supported: !!Ctor, state, finalText, setFinalText, interim, speaking, error, blocked, start, pause, reset };
}

export function joinText(a: string, b: string): string {
  const x = a.trim();
  const y = b.trim();
  if (!x) return y;
  if (!y) return x;
  return `${x} ${y}`;
}
