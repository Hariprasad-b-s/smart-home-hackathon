/**
 * One question per screen → review → submit → celebration. Works for any tracker: each
 * question renders a generic widget for its type, and answers are encoded via lib/encode.
 */
import { useEffect, useRef, useState } from 'react';
import type { MediaItem, PatientAppHome, WriteResult } from '@shared/types/api';
import type { RawTrackerResponse } from '@shared/types/raw';
import type { TrackerDefinition } from '@shared/types/tracker';
import { api } from '../api';
import { toApiError } from '../lib/errors';
import { buildCheckInRequest, displayAnswer, isAnswered, numberError, sortedQuestions, type Answers, type AnswerValue } from '../lib/encode';
import { localIso } from '../lib/time';
import { Icon } from './Icon';
import { QuestionInput } from './QuestionInput';
import { Spirometer, type SpiroResult } from './Spirometer';
import { MediaPicker, MediaThumbs } from './MediaPicker';
import { ZONE_TEXT, ZoneSteps } from './Engagement';
import ui from '../styles/ui.module.css';
import s from './CheckInFlow.module.css';

export interface CheckInFlowProps {
  tracker: TrackerDefinition;
  patientId: string;
  today: string;
  spirometer?: PatientAppHome['spirometer'];
  actionPlan?: PatientAppHome['actionPlan'];
  onExit: () => void;
  /** Called after a successful submit (e.g. to refresh home data). */
  onSubmitted?: (result: WriteResult<RawTrackerResponse>) => void;
  /** Called after a breathing test is saved from inside the flow. */
  onSpirometrySaved?: () => void;
  spiroSpeed?: number;
}

export function CheckInFlow({ tracker, patientId, today, spirometer, actionPlan, onExit, onSubmitted, onSpirometrySaved, spiroSpeed }: CheckInFlowProps) {
  const questions = sortedQuestions(tracker);
  const [step, setStep] = useState(0); // questions.length = review
  const [answers, setAnswers] = useState<Answers>({});
  const [linked, setLinked] = useState<SpiroResult | null>(null);
  const [device, setDevice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WriteResult<RawTrackerResponse> | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const inflight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const total = questions.length;
  const isReview = step >= total;
  const q = isReview ? null : questions[step];

  useEffect(() => {
    headingRef.current?.focus();
  }, [step, device, result]);

  const set = (id: string, v: AnswerValue) => setAnswers((a) => ({ ...a, [id]: v }));
  const next = () => setStep((n) => Math.min(n + 1, total));
  const back = () => (step === 0 ? onExit() : setStep((n) => n - 1));
  const skip = () => {
    if (q) set(q.id, null);
    if (q?.type === 'spirometry') setLinked(null);
    next();
  };

  async function submit() {
    if (inflight.current) return;
    inflight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const body = buildCheckInRequest(tracker, answers, localIso(new Date(), today), { entryMode: 'form', mediaIds: media.map((m) => m.id) });
      const r = await api.submitCheckIn(patientId, body);
      setResult(r);
      onSubmitted?.(r);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      inflight.current = false;
      setSubmitting(false);
    }
  }

  if (result) return <Celebration result={result} actionPlan={actionPlan} onExit={onExit} />;

  // ── Device flow inside the spirometry question ─────────────────────────────
  if (device && q?.type === 'spirometry' && spirometer) {
    return (
      <Spirometer
        patientId={patientId}
        today={today}
        device={spirometer}
        plan={actionPlan}
        speed={spiroSpeed}
        completeLabel="Use this in my check-in"
        onCancel={() => setDevice(false)}
        onComplete={(r) => {
          setLinked(r);
          set(q.id, r.best.baselineReadingDate);
          setDevice(false);
          onSpirometrySaved?.();
          next();
        }}
      />
    );
  }

  const answered = q ? isAnswered(q, answers[q.id]) : false;
  const numErr = q ? numberError(q, answers[q.id]) : null;
  const pct = Math.round(((isReview ? total : step) / total) * 100);

  return (
    <div className={s.flow}>
      <div className={s.top}>
        <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={back}>
          <Icon name="chevronLeft" size={20} />
          {step === 0 ? 'Cancel' : 'Back'}
        </button>
        <span className={s.trackerName}>{tracker.conditionLabel} check-in</span>
        <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={onExit} aria-label="Close check-in">
          <Icon name="close" size={20} />
        </button>
      </div>
      <div
        className={s.progress}
        role="progressbar"
        aria-label={isReview ? 'Review your answers' : `Question ${step + 1} of ${total}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span style={{ width: `${pct}%` }} />
      </div>

      {q && (
        <section className={s.question} key={q.id}>
          <p className={s.count}>
            Question {step + 1} of {total}
          </p>
          <h1 id={`q-${q.id}`} className={s.qText} ref={headingRef} tabIndex={-1}>
            {q.type === 'spirometry' ? 'Do your breathing test now' : q.text}
          </h1>
          {q.type === 'spirometry' ? (
            <div className={s.spiro}>
              <p className={ui.muted}>{q.text}. It takes about a minute: 3 big blows into your Spirobank.</p>
              {linked ? (
                <p className={s.linked}>
                  <Icon name="check" size={20} /> Breathing test linked: {linked.pefLpm} L/min
                  {linked.pctBest !== undefined ? ` (${linked.pctBest}% of your best)` : ''}
                </p>
              ) : null}
              {spirometer ? (
                <button type="button" className={`${ui.btn} ${linked ? ui.secondary : ''} ${ui.block}`} onClick={() => setDevice(true)}>
                  <Icon name="lungs" size={20} />
                  {linked ? 'Do it again' : 'Do your breathing test now'}
                </button>
              ) : (
                <p className={ui.note}>No spirometer is paired with your account, so you can skip this one.</p>
              )}
            </div>
          ) : (
            <QuestionInput question={q} value={answers[q.id]} onChange={(v) => set(q.id, v)} labelId={`q-${q.id}`} />
          )}
          {numErr && (
            <p className={ui.inlineError} role="alert">
              {numErr}
            </p>
          )}
        </section>
      )}

      {isReview && (
        <section className={s.question}>
          <h1 className={s.qText} ref={headingRef} tabIndex={-1}>
            Check your answers
          </h1>
          <ul className={`${ui.group} ${s.review}`}>
            {questions.map((qq, i) => {
              const shown = numberError(qq, answers[qq.id]) ? 'Skipped' : displayAnswer(qq, answers[qq.id]);
              return (
                <li key={qq.id}>
                  <button type="button" className={s.reviewRow} onClick={() => setStep(i)}>
                    <span className={s.reviewQ}>{qq.shortLabel}</span>
                    <span className={`${s.reviewA} ${shown === 'Skipped' ? s.skipped : ''}`}>
                      {qq.type === 'spirometry' && linked ? `${linked.pefLpm} L/min` : shown}
                    </span>
                    <span className={ui.srOnly}>Change answer</span>
                    <Icon name="chevronRight" size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className={s.attach}>
            <MediaThumbs items={media} onRemove={(id) => setMedia((m) => m.filter((x) => x.id !== id))} />
            {media.length < 10 && <MediaPicker patientId={patientId} onUploaded={(m) => setMedia((list) => [...list, m])} />}
          </div>
          {error && (
            <div className={ui.error} role="alert">
              <p className={ui.errorTitle}>Your check-in isn't sent yet</p>
              <p>{error}</p>
            </div>
          )}
        </section>
      )}

      <div className={s.actions}>
        {isReview ? (
          <button type="button" className={`${ui.btn} ${ui.block}`} onClick={submit} disabled={submitting}>
            {submitting ? 'Sending…' : error ? 'Try sending again' : 'Send check-in'}
          </button>
        ) : (
          <>
            <button type="button" className={`${ui.btn} ${ui.ghost}`} onClick={skip}>
              Skip
            </button>
            <button type="button" className={`${ui.btn} ${s.next}`} onClick={next} disabled={!answered || !!numErr}>
              Next
              <Icon name="chevronRight" size={20} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** "Check-in sent!" screen: server message, new badge, zone guidance for yellow/red. */
export function Celebration({
  result,
  actionPlan,
  onExit,
}: {
  result: WriteResult<RawTrackerResponse>;
  actionPlan?: PatientAppHome['actionPlan'];
  onExit: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const zone = result.zoneToday;
  return (
    <div className={s.done}>
      <div className={s.burst} aria-hidden="true">
        <Icon name="check" size={56} />
      </div>
      <div aria-live="polite" className={s.doneText}>
        <h1 className={s.doneTitle} ref={headingRef} tabIndex={-1}>
          Check-in sent!
        </h1>
        <p className={s.doneMsg}>{result.message}</p>
      </div>
      {result.newBadge && (
        <div className={s.badge}>
          <span className={s.badgeIcon}>
            <Icon name="star" size={28} />
          </span>
          <div>
            <p className={s.badgeKicker}>New badge earned</p>
            <p className={s.badgeName}>{result.newBadge.label}</p>
          </div>
        </div>
      )}
      {(zone === 'yellow' || zone === 'red') && (
        <div className={`${s.zone} ${s[`z_${zone}`]}`} role="alert">
          <p className={s.zoneName}>You're in the {ZONE_TEXT[zone].name.toLowerCase()} today</p>
          <ZoneSteps zone={zone} steps={actionPlan?.steps[zone]} />
        </div>
      )}
      <button type="button" className={`${ui.btn} ${ui.block}`} onClick={onExit}>
        Back to Today
      </button>
    </div>
  );
}
