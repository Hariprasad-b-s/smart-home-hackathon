import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAnnounce, useHome } from '../lib/home';
import { CheckInFlow } from '../components/CheckInFlow';
import { VoiceCheckIn } from '../components/VoiceCheckIn';
import { Spirometer } from '../components/Spirometer';
import { Icon } from '../components/Icon';
import { ErrorState, LoadingBlocks } from '../components/States';
import { trackerStatus } from './Today';
import ui from '../styles/ui.module.css';
import s from './screens.module.css';

export function CheckInList() {
  const { home, loading, error, reload } = useHome();
  if (!home) {
    if (error) return <ErrorState error={error} onRetry={() => reload()} />;
    return loading ? <LoadingBlocks /> : null;
  }
  return (
    <div>
      <h1 className={s.h1}>Check in</h1>
      <p className={ui.muted}>A few quick questions about today. Skip anything you don't want to answer.</p>
      <ul className={`${ui.group} ${s.block}`}>
        {home.trackers.map((t) => (
          <li key={t.definition.id}>
            <Link to={`/check-in/${encodeURIComponent(t.definition.id)}`} className={s.linkRow}>
              <span className={`${ui.iconWell} ${t.submittedToday > 0 ? s.wellDone : ''}`}>
                <Icon name={t.submittedToday > 0 ? 'check' : 'clipboard'} />
              </span>
              <span className={ui.rowBody}>
                <span className={`${ui.rowTitle} ${s.blockText}`}>{t.definition.conditionLabel}</span>
                <span className={`${ui.rowSub} ${s.blockText}`}>
                  {t.definition.questions.length} questions. {trackerStatus(t)}
                </span>
              </span>
              <Icon name="chevronRight" size={20} />
            </Link>
          </li>
        ))}
      </ul>
      {home.trackers.length === 0 && <p className={ui.note}>Your care team hasn't set up a check-in for you yet.</p>}
    </div>
  );
}

export function CheckInRun() {
  const { trackerId } = useParams();
  const navigate = useNavigate();
  const { home, loading, error, reload, patientId } = useHome();
  const [mode, setMode] = useState<'form' | 'voice' | null>(null);
  if (!home) {
    if (error) return <ErrorState error={error} onRetry={() => reload()} />;
    return loading ? <LoadingBlocks /> : null;
  }
  const t = home.trackers.find((x) => x.definition.id === trackerId);
  if (!t) {
    return (
      <div className={ui.stack}>
        <h1 className={s.h1}>Check-in not found</h1>
        <p className={ui.muted}>This check-in isn't part of your plan any more.</p>
        <Link to="/check-in" className={ui.btn}>
          See your check-ins
        </Link>
      </div>
    );
  }
  if (mode === null) {
    return (
      <div className={ui.stack}>
        <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.small} ${s.backBtn}`} onClick={() => navigate(-1)}>
          <Icon name="chevronLeft" size={20} /> Back
        </button>
        <h1 className={s.h1}>{t.definition.conditionLabel} check-in</h1>
        <p className={ui.muted}>How do you want to do it today?</p>
        <button type="button" className={s.modeCard} onClick={() => setMode('form')}>
          <span className={s.modeIcon}>
            <Icon name="clipboard" size={30} />
          </span>
          <span>
            <span className={s.modeTitle}>Answer questions</span>
            <span className={s.modeSub}>Tap through {t.definition.questions.length} quick questions.</span>
          </span>
        </button>
        <button type="button" className={s.modeCard} onClick={() => setMode('voice')}>
          <span className={`${s.modeIcon} ${s.modeIconVoice}`}>
            <Icon name="mic" size={30} />
          </span>
          <span>
            <span className={s.modeTitle}>Just talk</span>
            <span className={s.modeSub}>Feeling rough? Tell us in your own words and we'll fill in the answers for you to check.</span>
          </span>
        </button>
      </div>
    );
  }
  if (mode === 'voice') {
    return (
      <VoiceCheckIn
        tracker={t.definition}
        patientId={patientId}
        today={home.today}
        spirometer={home.spirometer}
        actionPlan={home.actionPlan}
        onExit={() => navigate('/')}
        onSubmitted={() => void reload(true)}
      />
    );
  }
  return (
    <CheckInFlow
      tracker={t.definition}
      patientId={patientId}
      today={home.today}
      spirometer={home.spirometer}
      actionPlan={home.actionPlan}
      onExit={() => navigate('/')}
      onSubmitted={() => void reload(true)}
      onSpirometrySaved={() => void reload(true)}
    />
  );
}

export function Breathe() {
  const navigate = useNavigate();
  const announce = useAnnounce();
  const { home, loading, error, reload, patientId } = useHome();
  if (!home) {
    if (error) return <ErrorState error={error} onRetry={() => reload()} />;
    return loading ? <LoadingBlocks /> : null;
  }
  if (!home.spirometer) {
    return (
      <div className={ui.stack}>
        <h1 className={s.h1}>No spirometer paired</h1>
        <p className={ui.muted}>Your care team will pair a Spirobank with your account if you need one.</p>
        <Link to="/" className={ui.btn}>
          Back to Today
        </Link>
      </div>
    );
  }
  return (
    <Spirometer
      patientId={patientId}
      today={home.today}
      device={home.spirometer}
      plan={home.actionPlan}
      completeLabel="Back to Today"
      onCancel={() => navigate('/')}
      onComplete={(r) => {
        if (r.write.message) announce(r.write.message);
        void reload(true);
        navigate('/');
      }}
    />
  );
}
