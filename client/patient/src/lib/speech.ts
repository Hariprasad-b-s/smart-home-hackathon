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

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
const OS_MIC_TIP = isMac
  ? ' On a Mac, also check System Settings → Privacy & Security → Microphone and turn your browser on.'
  : ' Also check that your device lets this browser use the microphone.';

/** Brave and some other Chromium browsers expose the API but block Google's speech service. */
function browserNote(): string {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { brave?: unknown }) : undefined;
  if (nav?.brave) return 'Brave blocks voice typing.';
  return 'This browser could not reach its voice-typing service (Brave, Arc and some other browsers block it).';
}

function errorText(code: string): string {
  switch (code) {
    case 'not-allowed':
      return `Microphone access is blocked for this site. Allow it from the lock icon in the address bar, then try again.${OS_MIC_TIP}`;
    case 'service-not-allowed':
      return 'Voice typing is turned off in this browser. In Safari, turn on Dictation (System Settings → Keyboard → Dictation). Or type instead.';
    case 'audio-capture':
      return `We couldn't use a microphone. Check that one is connected and selected.${OS_MIC_TIP}`;
    case 'network':
      return `${browserNote()} Try Google Chrome, Microsoft Edge or Safari, or type instead.`;
    case 'insecure-context':
      return 'Voice typing only works on a secure page (https:// or localhost). Open the app at an https address, or type instead.';
    case 'language-not-supported':
      return 'Voice typing does not support your browser language. Type instead, or switch the browser language to English.';
    default:
      return 'Voice typing stopped. Try again, or type instead.';
  }
}

/** Shown while listening when the browser keeps hearing nothing. */
export const NO_SPEECH_HINT = `We can't hear you yet. Speak a little closer, and check the right microphone is selected.${OS_MIC_TIP}`;

export function useSpeech() {
  const Ctor = getSpeechRecognition();
  const [state, setState] = useState<SpeechState>('idle');
  const [finalText, setFinalText] = useState('');
  const [interim, setInterim] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  /** Raw SpeechRecognition error code (for diagnostics). */
  const [errorCode, setErrorCode] = useState<string | null>(null);
  /** Set after repeated silence with no words recognised. */
  const [hint, setHint] = useState<string | null>(null);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const want = useRef(false);
  const silentSessions = useRef(0);

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
      if (fin || tmp) {
        silentSessions.current = 0;
        setHint(null);
      }
    };
    r.onerror = (e) => {
      if (e.error === 'aborted') return;
      if (e.error === 'no-speech') {
        // Chrome ends the session after a few seconds of silence; onend restarts it. If that keeps
        // happening, no sound is reaching the browser: say so instead of "Listening…" forever.
        silentSessions.current += 1;
        if (silentSessions.current >= 2) setHint(NO_SPEECH_HINT);
        return;
      }
      want.current = false;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture' || e.error === 'network') setBlocked(true);
      setErrorCode(e.error);
      setError(errorText(e.error));
      setState('error');
    };
    r.onend = () => {
      setInterim('');
      setSpeaking(false);
      if (!want.current) return;
      // Restart after a short delay: an immediate start() inside onend can throw InvalidStateError.
      const restart = (attempt: number) => {
        if (!want.current) return;
        try {
          r.start();
        } catch {
          if (attempt < 3) window.setTimeout(() => restart(attempt + 1), 400);
          else {
            want.current = false;
            setState('paused');
          }
        }
      };
      window.setTimeout(() => restart(1), 150);
    };
    r.onspeechstart = () => setSpeaking(true);
    r.onspeechend = () => setSpeaking(false);
    rec.current = r;
    return r;
  }, [Ctor]);

  const start = useCallback(() => {
    const r = ensure();
    if (!r) return;
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      // Browsers refuse the microphone on plain-http pages other than localhost (e.g. a phone on the LAN IP).
      setErrorCode('insecure-context');
      setError(errorText('insecure-context'));
      setBlocked(true);
      setState('error');
      return;
    }
    setError(null);
    setErrorCode(null);
    setHint(null);
    silentSessions.current = 0;
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
    setHint(null);
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

  return { supported: !!Ctor, state, finalText, setFinalText, interim, speaking, error, errorCode, hint, blocked, start, pause, reset };
}

export function joinText(a: string, b: string): string {
  const x = a.trim();
  const y = b.trim();
  if (!x) return y;
  if (!y) return x;
  return `${x} ${y}`;
}
