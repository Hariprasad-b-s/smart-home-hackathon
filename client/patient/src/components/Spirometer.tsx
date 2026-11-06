/**
 * Simulated Bluetooth Spirobank session: search → connect → 3 coached blows → save.
 * Blows are generated client-side as RawBaselineReading and POSTed to /spirometry-sessions.
 */
import { useEffect, useRef, useState } from 'react';
import type { PatientAppHome, WriteResult } from '@shared/types/api';
import type { RawBaselineReading } from '@shared/types/raw';
import type { Zone } from '@shared/types/summary';
import { api } from '../api';
import { toApiError } from '../lib/errors';
import {
  BREATHING_MODES,
  bestBlow,
  blowTimestamp,
  generateBlow,
  pctOfBest,
  pefLpm,
  plainCoaching,
  zoneFor,
  type BreathingMode,
} from '../lib/spirometer';
import { Icon } from './Icon';
import { ZONE_TEXT, ZoneSteps } from './Engagement';
import ui from '../styles/ui.module.css';
import s from './Spirometer.module.css';

export const BLOWS_PER_SESSION = 3;

export interface SpiroResult {
  readings: RawBaselineReading[];
  best: RawBaselineReading;
  pefLpm: number;
  pctBest?: number;
  zone?: Zone;
  write: WriteResult<RawBaselineReading[]>;
}

type Phase = 'inhale' | 'blast' | 'keepGoing';
type Step =
  | { kind: 'searching' }
  | { kind: 'connected' }
  | { kind: 'blowing'; phase: Phase }
  | { kind: 'between' }
  | { kind: 'saving' }
  | { kind: 'saveError'; message: string }
  | { kind: 'result'; result: SpiroResult };

const PHASE_MS: Record<Phase, number> = { inhale: 3000, blast: 900, keepGoing: 3300 };
const PHASE_TEXT: Record<Phase, { big: string; small: string }> = {
  inhale: { big: 'Breathe in fully…', small: 'Fill your lungs all the way up. Seal your lips around the mouthpiece.' },
  blast: { big: 'BLAST out!', small: 'As hard and fast as you can.' },
  keepGoing: { big: 'Keep going…', small: 'Keep going until you are completely empty.' },
};

export function Spirometer({
  patientId,
  today,
  device,
  plan,
  onComplete,
  onCancel,
  completeLabel = 'Done',
  speed = 1,
}: {
  patientId: string;
  today: string;
  device: NonNullable<PatientAppHome['spirometer']>;
  plan?: PatientAppHome['actionPlan'];
  onComplete: (r: SpiroResult) => void;
  onCancel: () => void;
  completeLabel?: string;
  /** Time multiplier (tests use a tiny value). */
  speed?: number;
}) {
  const [step, setStep] = useState<Step>({ kind: 'searching' });
  const [mode, setMode] = useState<BreathingMode>('good');
  const [readings, setReadings] = useState<RawBaselineReading[]>([]);
  const start = useRef(new Date());
  const saving = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Pairing.
  useEffect(() => {
    if (step.kind !== 'searching') return;
    const t = setTimeout(() => setStep({ kind: 'connected' }), 1600 * speed);
    return () => clearTimeout(t);
  }, [step.kind, speed]);

  // Coached blow phases.
  const phase = step.kind === 'blowing' ? step.phase : null;
  useEffect(() => {
    if (!phase) return;
    const t = setTimeout(() => {
      if (phase === 'inhale') setStep({ kind: 'blowing', phase: 'blast' });
      else if (phase === 'blast') setStep({ kind: 'blowing', phase: 'keepGoing' });
      else {
        setReadings((rs) => [
          ...rs,
          generateBlow({
            personalBestPefLpm: plan?.personalBestPefLpm,
            mode,
            at: blowTimestamp(start.current, rs.length, today),
          }),
        ]);
        setStep({ kind: 'between' });
      }
    }, PHASE_MS[phase] * speed);
    return () => clearTimeout(t);
  }, [phase, mode, plan?.personalBestPefLpm, today, speed]);

  useEffect(() => {
    if (step.kind === 'between' || step.kind === 'result' || step.kind === 'connected') headingRef.current?.focus();
  }, [step.kind]);

  async function save(all: RawBaselineReading[]) {
    if (saving.current) return;
    saving.current = true;
    setStep({ kind: 'saving' });
    try {
      const write = await api.saveSpirometry(patientId, { readings: all });
      const best = bestBlow(all)!;
      const lpm = pefLpm(best);
      const pct = pctOfBest(lpm, plan?.personalBestPefLpm);
      const zone = write.zoneToday ?? zoneFor(pct, plan?.greenThresholdPct, plan?.redThresholdPct);
      setStep({ kind: 'result', result: { readings: all, best, pefLpm: lpm, pctBest: pct, zone, write } });
    } catch (e) {
      setStep({ kind: 'saveError', message: toApiError(e).message });
    } finally {
      saving.current = false;
    }
  }

  const last = readings[readings.length - 1];
  const blowNo = Math.min(readings.length + 1, BLOWS_PER_SESSION);

  return (
    <div className={s.wrap}>
      <div className={s.top}>
        <p className={s.device}>
          <Icon name="bluetooth" size={18} />
          {step.kind === 'searching' ? `Searching for Spirobank…` : `Connected · SN ${device.serialNumber}`}
        </p>
        <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={onCancel} aria-label="Close breathing test">
          <Icon name="close" size={20} />
        </button>
      </div>

      {step.kind === 'searching' && (
        <div className={s.center} role="status">
          <div className={s.radar} aria-hidden="true">
            <span />
            <span />
            <Icon name="bluetooth" size={34} />
          </div>
          <h2 className={s.big}>Searching for Spirobank…</h2>
          <p className={ui.muted}>Turn on your {device.deviceName} and keep it close to your phone.</p>
        </div>
      )}

      {step.kind === 'connected' && (
        <div className={s.center}>
          <div className={s.connected} aria-hidden="true">
            <Icon name="check" size={40} />
          </div>
          <h2 className={s.big} ref={headingRef} tabIndex={-1}>
            Connected
          </h2>
          <p className={ui.muted}>
            {device.deviceName}, serial {device.serialNumber}. You'll do {BLOWS_PER_SESSION} blows and we'll keep the best one.
          </p>
          <ol className={s.howTo}>
            <li>Stand up straight.</li>
            <li>Breathe in as deep as you can.</li>
            <li>Blast out hard and fast, and keep going until you're empty.</li>
          </ol>
          <button type="button" className={`${ui.btn} ${ui.block}`} onClick={() => setStep({ kind: 'blowing', phase: 'inhale' })}>
            Start blow 1 of {BLOWS_PER_SESSION}
          </button>
        </div>
      )}

      {step.kind === 'blowing' && (
        <div className={s.center}>
          <p className={s.counter}>
            Blow {blowNo} of {BLOWS_PER_SESSION}
          </p>
          <BreathRing phase={step.phase} speed={speed} />
          <div aria-live="assertive" className={s.coach}>
            <h2 className={`${s.big} ${step.phase === 'blast' ? s.blast : ''}`}>{PHASE_TEXT[step.phase].big}</h2>
            <p className={ui.muted}>{PHASE_TEXT[step.phase].small}</p>
          </div>
        </div>
      )}

      {step.kind === 'between' && last && (
        <div className={s.center}>
          <p className={s.counter}>
            Blow {readings.length} of {BLOWS_PER_SESSION}
          </p>
          <div aria-live="polite" className={s.blowResult}>
            {last.accepted ? (
              <>
                <h2 className={s.big} ref={headingRef} tabIndex={-1}>
                  Nice blow!
                </h2>
                <p className={s.blowValue}>{pefLpm(last)} L/min</p>
              </>
            ) : (
              <>
                <h2 className={s.big} ref={headingRef} tabIndex={-1}>
                  That one didn't count
                </h2>
                <p className={ui.muted}>Here's a tip for the next one:</p>
              </>
            )}
            {(last.qualityReport?.qualityIndications ?? []).length > 0 && (
              <ul className={s.tips}>
                {(last.qualityReport?.qualityIndications ?? []).map((q, i) => (
                  <li key={i}>{plainCoaching(q.messageInstructions)}</li>
                ))}
              </ul>
            )}
          </div>
          <BlowDots readings={readings} />
          {readings.length < BLOWS_PER_SESSION ? (
            <button type="button" className={`${ui.btn} ${ui.block}`} onClick={() => setStep({ kind: 'blowing', phase: 'inhale' })}>
              Start blow {readings.length + 1} of {BLOWS_PER_SESSION}
            </button>
          ) : (
            <button type="button" className={`${ui.btn} ${ui.block}`} onClick={() => save(readings)}>
              See my result
            </button>
          )}
        </div>
      )}

      {step.kind === 'saving' && (
        <div className={s.center} role="status">
          <h2 className={s.big}>Saving your test…</h2>
        </div>
      )}

      {step.kind === 'saveError' && (
        <div className={s.center}>
          <div className={ui.error} role="alert">
            <p className={ui.errorTitle}>Your test isn't saved yet</p>
            <p>{step.message}</p>
            <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => save(readings)}>
              <Icon name="refresh" size={18} /> Try again
            </button>
          </div>
        </div>
      )}

      {step.kind === 'result' && (
        <div className={s.resultWrap} aria-live="polite">
          <h2 className={s.big} ref={headingRef} tabIndex={-1}>
            Your best blow
          </h2>
          <p className={s.bestValue}>
            {step.result.pefLpm} L/min
            {step.result.pctBest !== undefined && <span className={s.bestPct}> · {step.result.pctBest}% of your best</span>}
          </p>
          {step.result.zone && (
            <div className={`${s.resultZone} ${s[`z_${step.result.zone}`]}`}>
              <p className={s.resultZoneName}>
                {ZONE_TEXT[step.result.zone].name}: {ZONE_TEXT[step.result.zone].sub.toLowerCase()}
              </p>
              <ZoneSteps zone={step.result.zone} steps={plan?.steps[step.result.zone]} />
            </div>
          )}
          {step.result.write.message && <p className={ui.muted}>{step.result.write.message}</p>}
          {step.result.write.newBadge && (
            <p className={s.newBadge}>
              <Icon name="star" size={20} /> New badge: {step.result.write.newBadge.label}
            </p>
          )}
          <button type="button" className={`${ui.btn} ${ui.block}`} onClick={() => onComplete(step.result)}>
            {completeLabel}
          </button>
        </div>
      )}

      {(step.kind === 'connected' || step.kind === 'between') && (
        <fieldset className={s.demo}>
          <legend>Demo: simulate breathing</legend>
          <div className={s.demoOptions}>
            {BREATHING_MODES.map((m) => (
              <label key={m.value} className={`${s.demoOption} ${mode === m.value ? s.demoOn : ''}`}>
                <input type="radio" name="breathing-mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} />
                {m.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

function BreathRing({ phase, speed }: { phase: Phase; speed: number }) {
  const exhaleMs = (PHASE_MS.blast + PHASE_MS.keepGoing) * speed;
  return (
    <div className={s.ringBox} aria-hidden="true">
      <svg viewBox="0 0 200 200" className={s.ring}>
        <defs>
          <linearGradient id="breath-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--brand-magenta)' }} />
            <stop offset="45%" style={{ stopColor: 'var(--brand-purple)' }} />
            <stop offset="75%" style={{ stopColor: 'var(--brand-sky)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--brand-lime)' }} />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="86" className={s.track} />
        {phase !== 'inhale' && (
          <circle
            key="exhale"
            cx="100"
            cy="100"
            r="86"
            className={s.progress}
            style={{ animationDuration: `${exhaleMs}ms` }}
            stroke="url(#breath-grad)"
          />
        )}
      </svg>
      <div
        key={phase === 'inhale' ? 'in' : 'out'}
        className={`${s.lung} ${phase === 'inhale' ? s.lungIn : s.lungOut}`}
        style={{ animationDuration: `${phase === 'inhale' ? PHASE_MS.inhale * speed : exhaleMs}ms` }}
      />
    </div>
  );
}

function BlowDots({ readings }: { readings: RawBaselineReading[] }) {
  return (
    <ol className={s.dots} aria-label="Blows so far">
      {Array.from({ length: BLOWS_PER_SESSION }, (_, i) => {
        const r = readings[i];
        return (
          <li key={i} className={`${s.dot} ${r ? (r.accepted ? s.dotOk : s.dotRedo) : ''}`}>
            {r ? (r.accepted ? <Icon name="check" size={16} /> : '!') : i + 1}
            <span className={ui.srOnly}>
              Blow {i + 1}: {r ? (r.accepted ? `${pefLpm(r)} litres per minute` : 'did not count') : 'not done yet'}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
