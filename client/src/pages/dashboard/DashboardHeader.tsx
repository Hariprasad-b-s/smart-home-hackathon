import type { MouseEvent } from 'react';
import type { InboxItem, PatientSummary, VisitModeVisibility } from '@shared/types';
import { Link } from 'react-router-dom';
import { exportCsvUrl, fhirBundleUrl, USE_MOCKS } from '../../api';
import { Avatar, Chip, Icon, SegmentedControl, StatusBadge, StatusIcon } from '../../components/ui';
import { SPECIALTIES, SPECIALTY_ORDER, type SpecialtyId, type SpecialtyPreset } from '../../config/specialties';
import { formatDate, formatDaysAgoLong, formatShortDate, plural, sexLabel } from '../../lib/format';
import { WINDOW_OPTIONS, type WindowDays } from '../../lib/urlState';
import { summaryDaysToCsv } from './csv';
import { EhrContext } from './EhrContext';
import { VisitButton } from './VisitButton';
import s from './Dashboard.module.css';

interface Props {
  summary: PatientSummary;
  preset: SpecialtyPreset;
  inferred: SpecialtyId;
  days: WindowDays;
  loading?: boolean;
  onDays: (d: WindowDays) => void;
  onView: (v: SpecialtyId) => void;
  onVisit: () => void;
  visibility: VisitModeVisibility;
  onSaveVisitDefault?: (v: VisitModeVisibility) => void;
  onJustThisVisit: (v: VisitModeVisibility) => void;
  /** Undefined hides the "Customize layout" button. */
  onCustomize?: () => void;
  /** Open escalated conversation for this patient, if any. */
  conversation?: InboxItem;
}

export function DashboardHeader({ summary, preset, inferred, days, loading, onDays, onView, onVisit, visibility, onSaveVisitDefault, onJustThisVisit, onCustomize, conversation }: Props) {
  const { patient, freshness, window: win } = summary;
  const sex = sexLabel(patient.sex);
  const csvName = `${patient.mrn}-${win.start}-to-${win.end}.csv`;

  const downloadMockCsv = (e: MouseEvent) => {
    if (!USE_MOCKS) return;
    e.preventDefault();
    const blob = new Blob([summaryDaysToCsv(summary)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <header className={s.header}>
      <div className={s.identity}>
        <Avatar initials={patient.initials} size={52} />
        <div className={s.identityText}>
          <h1 className={s.patientName}>{patient.displayName}</h1>
          <dl className={s.facts}>
            <div>
              <dt className="sr-only">Age</dt>
              <dd>{patient.ageYears} years</dd>
            </div>
            {sex ? (
              <div>
                <dt className="sr-only">Sex</dt>
                <dd>{sex}</dd>
              </div>
            ) : null}
            <div>
              <dt>MRN</dt>
              <dd className="num">{patient.mrn}</dd>
            </div>
            {patient.studyIds.length ? (
              <div>
                <dt>Study</dt>
                <dd>{patient.studyIds.join(', ')}</dd>
              </div>
            ) : null}
            <div>
              <dt>Enrolled</dt>
              <dd>{formatDate(patient.enrolledSince)}</dd>
            </div>
            {!patient.ehr && (patient.heightCm || patient.weightKg) ? (
              <div>
                <dt className="sr-only">Height and weight</dt>
                <dd>
                  {patient.heightCm ? `${patient.heightCm} cm` : ''}
                  {patient.heightCm && patient.weightKg ? ', ' : ''}
                  {patient.weightKg ? `${patient.weightKg} kg` : ''}
                </dd>
              </div>
            ) : null}
            {patient.careTeam ? (
              <div>
                <dt className="sr-only">Care team</dt>
                <dd>{patient.careTeam}</dd>
              </div>
            ) : null}
          </dl>
          <div className={s.conditions} aria-label="Conditions tracked">
            {patient.trackers.map((t) => (
              <Chip key={t.id} tone="accent" title={t.name}>
                {t.conditionLabel}
              </Chip>
            ))}
            {conversation ? (
              <Link
                to={`/inbox/${encodeURIComponent(conversation.conversationId)}`}
                className={`${s.convChip} ${s[`convChip_${conversation.urgency}`]} no-print`}
                data-testid="conversation-chip"
              >
                <Icon name="message" size={13} />
                {conversation.status === 'waiting' ? 'Conversation waiting' : 'Conversation open'}
                {conversation.unread ? ` (${conversation.unread} new)` : ''}
              </Link>
            ) : null}
            {patient.enrolledDays < 14 ? (
              <span data-testid="new-patient">
                <StatusBadge status="neutral" label={`New patient, ${plural(Math.max(0, patient.enrolledDays), 'day')} of data`} />
              </span>
            ) : null}
          </div>
        </div>
        <div className={`${s.freshness} ${s[`freshness_${freshness.status}`]}`} data-testid="freshness">
          <StatusIcon status={freshness.status} size={18} />
          <div>
            <div className={s.freshnessMain}>
              {freshness.lastActivityDate ? (
                <>
                  Last activity {formatDate(freshness.lastActivityDate)}
                  <span className={s.freshnessAgo}>{formatDaysAgoLong(freshness.daysSinceLastActivity)}</span>
                </>
              ) : (
                'No activity recorded yet'
              )}
            </div>
            <div className={s.freshnessSub}>
              {freshness.totalDaysTracked} days tracked in total. Counts check-ins, doses and spirometry.
            </div>
          </div>
        </div>
      </div>

      <EhrContext summary={summary} />

      <div className={`${s.controlsRow} no-print`}>
        <div className={s.controlGroup}>
          <span className={s.controlLabel} aria-hidden="true">
            Period
          </span>
          <SegmentedControl label="Time period" options={WINDOW_OPTIONS} value={days} onChange={onDays} size="sm" />
          <span className={`${s.windowDates} num`}>
            {formatShortDate(win.start)} – {formatDate(win.end)}
            {loading ? <span className={s.updating}> Updating…</span> : null}
          </span>
        </div>
        <label className={s.controlGroup}>
          <span className={s.controlLabel}>View for</span>
          <select className="select" value={preset.id} onChange={(e) => onView(e.target.value as SpecialtyId)} aria-describedby="view-desc">
            {SPECIALTY_ORDER.map((id) => (
              <option key={id} value={id}>
                {`${SPECIALTIES[id].label}${id === inferred && id !== 'all' ? ' (suggested)' : ''}`}
              </option>
            ))}
          </select>
          <span id="view-desc" className={s.viewDesc}>
            {preset.description}
          </span>
        </label>
        <div className={s.actions}>
          {onCustomize ? (
            <button type="button" className="btn" onClick={onCustomize}>
              <Icon name="edit" size={16} /> Customize layout
            </button>
          ) : null}
          <VisitButton summary={summary} visibility={visibility} onVisit={onVisit} onSaveDefault={onSaveVisitDefault} onJustThisVisit={onJustThisVisit} />
          <a className="btn" href={exportCsvUrl(patient.id, days)} download={csvName} onClick={downloadMockCsv}>
            <Icon name="download" size={16} /> Export CSV
          </a>
          <a
            className="btn"
            href={fhirBundleUrl(patient.id)}
            download={`${(patient.displayName.split(' ').pop() ?? patient.id).toLowerCase()}-fhir.json`}
            title="FHIR R4 bundle (Synthea format) for EHR or data pipelines"
            data-testid="fhir-link"
          >
            <Icon name="database" size={16} /> FHIR bundle
          </a>
          <button type="button" className="btn" onClick={() => window.print()}>
            <Icon name="printer" size={16} /> Print
          </button>
        </div>
      </div>
      <p className="print-only">
        {win.label}: {formatDate(win.start)} – {formatDate(win.end)}. View: {preset.label}. Synthetic demo data.
      </p>
    </header>
  );
}
