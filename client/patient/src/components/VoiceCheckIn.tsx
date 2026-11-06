/**
 * Speak mode: "Here's what to tell us" → talk (or type) → edit transcript → AI/rules extraction
 * (POST voice-checkin/parse, nothing saved) → review every answer → submit as entryMode 'voice'.
 */
import { useEffect, useRef, useState } from 'react';
import type { MediaItem, PatientAppHome, VoiceParseResult, WriteResult } from '@shared/types/api';
import type { RawTrackerResponse } from '@shared/types/raw';
import type { TrackerDefinition } from '@shared/types/tracker';
import { api } from '../api';
import { toApiError } from '../lib/errors';
import { buildCheckInRequest, decodeAnswer, isAnswered, numberError, sortedQuestions, type Answers, type AnswerValue } from '../lib/encode';
import { exampleSentence, speakPrompts } from '../lib/prompts';
import { joinText, useSpeech } from '../lib/speech';
import { localIso } from '../lib/time';
import { useOptionalChat } from '../lib/chat';
import { Celebration } from './CheckInFlow';
import { Icon } from './Icon';
import { MediaPicker, MediaThumbs } from './MediaPicker';
import { QuestionInput } from './QuestionInput';
import { AiStatusChip, SafetyBanner } from './Safety';
import { Spirometer } from './Spirometer';
import ui from '../styles/ui.module.css';
import s from './VoiceCheckIn.module.css';

type Phase = 'talk' | 'parsing' | 'review';

export interface VoiceCheckInProps {
  tracker: TrackerDefinition;
  patientId: string;
  today: string;
  spirometer?: PatientAppHome['spirometer'];
  actionPlan?: PatientAppHome['actionPlan'];
  onExit: () => void;
  onSubmitted?: (r: WriteResult<RawTrackerResponse>) => void;
}

export function VoiceCheckIn({ tracker, patientId, today, spirometer, actionPlan, onExit, onSubmitted }: VoiceCheckInProps) {
  const speech = useSpeech();
  const aiStatus = useOptionalChat()?.aiStatus ?? null;
  const [typing, setTyping] = useState(!speech.supported);
  const [phase, setPhase] = useState<Phase>('talk');
  const [parsed, setParsed] = useState<VoiceParseResult | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<WriteResult<RawTrackerResponse> | null>(null);
  const [spiroFor, setSpiroFor] = useState<string | null>(null);
  const inflight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const questions = sortedQuestions(tracker);
  const transcript = speech.finalText;

  useEffect(() => {
    if (speech.blocked) setTyping(true);
  }, [speech.blocked]);
  useEffect(() => {
    headingRef.current?.focus();
  }, [phase]);

  async function analyze(text: string, keepTouched = false) {
    if (!text.trim() || inflight.current) return;
    inflight.current = true;
    if (speech.state === 'listening') speech.pause();
    setError(null);
    setPhase('parsing');
    try {
      const r = await api.parseVoice(patientId, { trackerId: tracker.id, transcript: text.trim().slice(0, 4000) });
      setParsed(r);
      setAnswers((prev) => {
        const next: Answers = keepTouched ? { ...prev } : {};
        for (const q of questions) {
          if (keepTouched && touched.has(q.id)) continue;
          const a = r.answers.find((x) => x.questionId === q.id);
          const v = decodeAnswer(q, a?.value);
          if (v !== undefined || !keepTouched) next[q.id] = v;
        }
        return next;
      });
      setPhase('review');
    } catch (e) {
      setError(toApiError(e).message);
      setPhase(parsed ? 'review' : 'talk');
    } finally {
      inflight.current = false;
    }
  }

  async function submit() {
    if (inflight.current) return;
    inflight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const body = buildCheckInRequest(tracker, answers, localIso(new Date(), today), {
        entryMode: 'voice',
        transcript,
        mediaIds: media.map((m) => m.id),
      });
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

  const spiroQ = spiroFor ? questions.find((q) => q.id === spiroFor) : undefined;
  if (spiroQ && spirometer) {
    return (
      <Spirometer
        patientId={patientId}
        today={today}
        device={spirometer}
        plan={actionPlan}
        completeLabel="Use this in my check-in"
        onCancel={() => setSpiroFor(null)}
        onComplete={(r) => {
          setAnswers((a) => ({ ...a, [spiroQ.id]: r.best.baselineReadingDate }));
          setTouched((t) => new Set(t).add(spiroQ.id));
          setSpiroFor(null);
        }}
      />
    );
  }

  const header = (
    <div className={s.top}>
      <button
        type="button"
        className={`${ui.btn} ${ui.ghost} ${ui.small}`}
        onClick={() => (phase === 'review' ? setPhase('talk') : onExit())}
      >
        <Icon name="chevronLeft" size={20} />
        {phase === 'review' ? 'Back' : 'Cancel'}
      </button>
      <AiStatusChip status={aiStatus} />
    </div>
  );

  if (phase === 'parsing') {
    return (
      <div className={s.wrap}>
        {header}
        <div className={s.parsing} role="status">
          <span className={s.spinner} aria-hidden="true" />
          <h1 className={s.h1} ref={headingRef} tabIndex={-1}>
            Reading what you said…
          </h1>
          <p className={ui.muted}>This takes a few seconds.</p>
        </div>
      </div>
    );
  }

  if (phase === 'review' && parsed) {
    const unanswered = questions.filter((q) => !isAnswered(q, answers[q.id]));
    return (
      <div className={s.wrap}>
        {header}
        {parsed.safety && <SafetyBanner notice={parsed.safety} />}
        <h1 className={s.h1} ref={headingRef} tabIndex={-1}>
          Check your answers
        </h1>
        <p className={ui.muted}>We filled these in from what you said. Fix anything that's wrong.</p>
        {unanswered.length > 0 && (
          <SayMore
            followUp={parsed.followUp}
            count={unanswered.length}
            typingOnly={typing || !speech.supported}
            onAdd={(extra) => {
              const combined = joinText(transcript, extra);
              speech.setFinalText(combined);
              void analyze(combined, true);
            }}
          />
        )}
        <ol className={s.review}>
          {questions.map((q) => {
            const meta = parsed.answers.find((a) => a.questionId === q.id);
            const answered = isAnswered(q, answers[q.id]);
            const numErr = numberError(q, answers[q.id]);
            const set = (v: AnswerValue) => {
              setAnswers((a) => ({ ...a, [q.id]: v }));
              setTouched((t) => new Set(t).add(q.id));
            };
            return (
              <li key={q.id} className={`${s.item} ${answered ? '' : s.missing}`}>
                <div className={s.itemHead}>
                  <h2 id={`vq-${q.id}`} className={s.qText}>
                    {q.type === 'spirometry' ? 'Breathing test' : q.text}
                  </h2>
                  {answered && meta && meta.confidence !== 'high' && !touched.has(q.id) && (
                    <span className={`${s.conf} ${meta.confidence === 'low' ? s.confLow : ''}`}>
                      {meta.confidence === 'low' ? 'Not sure, please check' : 'Please check'}
                    </span>
                  )}
                  {!answered && <span className={`${s.conf} ${s.confMissing}`}>Not answered yet</span>}
                </div>
                {answered && meta?.evidence && !touched.has(q.id) && <p className={s.evidence}>You said: "{meta.evidence}"</p>}
                {q.type === 'spirometry' ? (
                  answered ? (
                    <p className={s.linked}>
                      <Icon name="check" size={18} /> Breathing test linked
                    </p>
                  ) : spirometer ? (
                    <button type="button" className={`${ui.btn} ${ui.secondary} ${ui.small}`} onClick={() => setSpiroFor(q.id)}>
                      <Icon name="lungs" size={18} /> Do your breathing test now
                    </button>
                  ) : (
                    <p className={ui.note}>No spirometer paired. You can leave this one.</p>
                  )
                ) : (
                  <QuestionInput question={q} value={answers[q.id]} onChange={set} labelId={`vq-${q.id}`} />
                )}
                {numErr && (
                  <p className={ui.inlineError} role="alert">
                    {numErr}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <section className={s.attach}>
          <h2 className={s.qText}>Photos or videos</h2>
          <MediaThumbs items={media} onRemove={(id) => setMedia((m) => m.filter((x) => x.id !== id))} />
          {media.length < 10 && <MediaPicker patientId={patientId} onUploaded={(m) => setMedia((l) => [...l, m])} />}
        </section>
        {error && (
          <div className={ui.error} role="alert">
            <p className={ui.errorTitle}>Your check-in isn't sent yet</p>
            <p>{error}</p>
          </div>
        )}
        <div className={s.actions}>
          <button type="button" className={`${ui.btn} ${ui.block}`} onClick={submit} disabled={submitting}>
            {submitting ? 'Sending…' : error ? 'Try sending again' : 'Send check-in'}
          </button>
        </div>
      </div>
    );
  }

  // ── Talk / type ─────────────────────────────────────────────────────────────
  const prompts = speakPrompts(tracker);
  const listening = speech.state === 'listening';
  return (
    <div className={s.wrap}>
      {header}
      <h1 className={s.h1} ref={headingRef} tabIndex={-1}>
        {typing ? 'Type how today went' : 'Just talk'}
      </h1>
      <section className={s.prompts} aria-labelledby="tell-us">
        <h2 id="tell-us" className={s.promptsTitle}>
          Here's what to tell us
        </h2>
        <ul>
          {prompts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className={s.example}>For example: {exampleSentence(tracker)}</p>
      </section>

      {!typing && (
        <div className={s.recorder}>
          <button
            type="button"
            className={`${s.mic} ${listening ? s.micOn : ''} ${listening && speech.speaking ? s.micLoud : ''}`}
            onClick={listening ? speech.pause : speech.start}
            aria-pressed={listening}
            aria-label={listening ? 'Pause recording' : transcript ? 'Keep talking' : 'Start talking'}
          >
            <span className={s.ring} aria-hidden="true" />
            <Icon name={listening ? 'pause' : 'mic'} size={40} />
          </button>
          <p className={s.micLabel} aria-live="polite">
            {listening ? "Listening… tap to pause" : transcript ? 'Paused. Tap to keep talking' : 'Tap the microphone and start talking'}
          </p>
          {speech.error && (
            <p className={ui.inlineError} role="alert">
              {speech.error}
            </p>
          )}
        </div>
      )}
      {typing && !speech.supported && <p className={ui.note}>Voice typing isn't available in this browser, so you can type instead.</p>}
      {typing && speech.blocked && speech.error && (
        <p className={ui.inlineError} role="alert">
          {speech.error}
        </p>
      )}

      <label htmlFor="voice-transcript" className={s.transcriptLabel}>
        {typing ? 'What happened today' : 'What we heard (you can fix it)'}
      </label>
      <textarea
        id="voice-transcript"
        className={s.transcript}
        rows={typing ? 7 : 5}
        maxLength={4000}
        value={transcript}
        onChange={(e) => speech.setFinalText(e.target.value)}
        placeholder={typing ? 'For example: I felt okay, coughed a bit, went to school…' : 'Your words show up here as you talk.'}
      />
      {listening && speech.interim && (
        <p className={s.interim} aria-live="off">
          {speech.interim}
        </p>
      )}
      <div className={s.tools}>
        {!typing && transcript && (
          <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={speech.reset}>
            Start over
          </button>
        )}
        {!typing && (
          <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={() => (speech.state === 'listening' && speech.pause(), setTyping(true))}>
            <Icon name="keyboard" size={18} /> Type it instead
          </button>
        )}
        {typing && speech.supported && !speech.blocked && (
          <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={() => setTyping(false)}>
            <Icon name="mic" size={18} /> Talk instead
          </button>
        )}
      </div>
      {error && (
        <div className={ui.error} role="alert">
          <p>{error}</p>
        </div>
      )}
      <div className={s.actions}>
        <button type="button" className={`${ui.btn} ${ui.block}`} onClick={() => analyze(transcript)} disabled={!transcript.trim()}>
          Check my answers
        </button>
      </div>
    </div>
  );
}

/** Unanswered questions: show the follow-up and let the patient add more by voice (or typing). */
function SayMore({ followUp, count, typingOnly, onAdd }: { followUp?: string; count: number; typingOnly: boolean; onAdd: (text: string) => void }) {
  const more = useSpeech();
  const [open, setOpen] = useState(false);
  const listening = more.state === 'listening';
  return (
    <section className={s.sayMore} aria-label="Missing answers">
      <p className={s.sayMoreText}>
        <Icon name="help" size={20} />
        {followUp || `We still need ${count} ${count === 1 ? 'answer' : 'answers'}. Tell us a bit more, or fill them in below.`}
      </p>
      {!open ? (
        <button
          type="button"
          className={`${ui.btn} ${ui.secondary} ${ui.small}`}
          onClick={() => {
            setOpen(true);
            if (!typingOnly) more.start();
          }}
        >
          <Icon name={typingOnly ? 'keyboard' : 'mic'} size={18} /> Say more
        </button>
      ) : (
        <div className={s.moreBox}>
          {!typingOnly && (
            <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.small}`} onClick={listening ? more.pause : more.start} aria-pressed={listening}>
              <Icon name={listening ? 'pause' : 'mic'} size={18} /> {listening ? 'Pause' : 'Keep talking'}
            </button>
          )}
          <textarea
            aria-label="What else do you want to add?"
            className={s.transcript}
            rows={3}
            value={more.finalText}
            onChange={(e) => more.setFinalText(e.target.value)}
            placeholder="Add anything we missed"
          />
          {listening && more.interim && <p className={s.interim}>{more.interim}</p>}
          <button
            type="button"
            className={`${ui.btn} ${ui.small}`}
            disabled={!more.finalText.trim()}
            onClick={() => {
              const t = more.finalText;
              more.reset();
              setOpen(false);
              onAdd(t);
            }}
          >
            Add and check again
          </button>
        </div>
      )}
    </section>
  );
}
