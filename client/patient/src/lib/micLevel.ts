/**
 * Live microphone level (0–1) while `active`, via getUserMedia + an AnalyserNode. Lets the patient
 * see that sound is reaching the browser, and gives a precise diagnosis when it isn't (blocked by
 * the browser or the OS, no device, or a muted / wrong input that only delivers silence).
 */
import { useEffect, useRef, useState } from 'react';

export type MicProblem = 'blocked' | 'no-device' | 'silent' | 'unavailable' | null;

const SILENCE_LEVEL = 0.01;
const SILENCE_MS = 4000;

export function useMicLevel(active: boolean): { level: number; problem: MicProblem } {
  const [level, setLevel] = useState(0);
  const [problem, setProblem] = useState<MicProblem>(null);
  const raf = useRef(0);

  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    const AC = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (window.isSecureContext === false || !md?.getUserMedia || !AC) {
      setProblem('unavailable');
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    setProblem(null);

    md.getUserMedia({ audio: true })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        ctx = new AC();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        let lastSound = performance.now();
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += ((v - 128) / 128) ** 2;
          const rms = Math.sqrt(sum / buf.length);
          const now = performance.now();
          if (rms > SILENCE_LEVEL) lastSound = now;
          setLevel(Math.min(1, rms * 4));
          setProblem(now - lastSound > SILENCE_MS ? 'silent' : null);
          raf.current = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const name = e instanceof DOMException ? e.name : '';
        setProblem(name === 'NotAllowedError' || name === 'SecurityError' ? 'blocked' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'no-device' : 'unavailable');
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf.current);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => undefined);
      setLevel(0);
    };
  }, [active]);

  return { level, problem };
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);

export function micProblemText(p: MicProblem): string | null {
  switch (p) {
    case 'blocked':
      return isMac
        ? 'Your Mac or browser is blocking the microphone. Allow it from the lock icon in the address bar, and in System Settings → Privacy & Security → Microphone.'
        : 'The microphone is blocked. Allow it from the lock icon in the address bar and in your device settings.';
    case 'no-device':
      return 'No microphone found. Plug one in or pick one in your system sound settings.';
    case 'silent':
      return isMac
        ? 'Your microphone is sending silence. Check the input device (System Settings → Sound → Input) and that it isn’t muted.'
        : 'Your microphone is sending silence. Check the input device and that it isn’t muted.';
    default:
      return null;
  }
}
