import type { PatientSummary } from '@shared/types';
import { Icon } from '../../components/ui';
import { formatDate, plural } from '../../lib/format';
import s from './Dashboard.module.css';

/** Loose name key: lower-cased first word ("Albuterol (Ventolin HFA)" → "albuterol"). */
export const medKey = (name: string) => name.trim().toLowerCase().split(/[\s(/,]+/)[0] ?? '';

/** App medications missing from the EHR list, and EHR medications missing from the app. */
export function medicationMismatches(appMeds: string[], ehrMeds: string[]) {
  const appKeys = new Set(appMeds.map(medKey));
  const ehrKeys = new Set(ehrMeds.map(medKey));
  return {
    appOnly: [...new Set(appMeds)].filter((m) => !ehrKeys.has(medKey(m))),
    ehrOnly: ehrMeds.filter((m) => !appKeys.has(medKey(m))),
  };
}

const SHOWN_PROBLEMS = 2;

/** EHR background from the chart (Synthea-seeded in the demo). Collapsed to one line by default. */
export function EhrContext({ summary }: { summary: PatientSummary }) {
  const { ehr, heightCm, weightKg } = summary.patient;
  if (!ehr) return null;
  const appMeds = [...summary.medications.scheduled, ...summary.medications.asNeeded].map((m) => m.name);
  const { appOnly, ehrOnly } = medicationMismatches(appMeds, ehr.medicationsOnFile);
  const ehrOnlySet = new Set(ehrOnly);
  const mismatchCount = appOnly.length + ehrOnly.length;
  const extra = ehr.problems.length - SHOWN_PROBLEMS;
  const sourceLabel = ehr.source === 'synthea' ? 'EHR background, synthetic (Synthea)' : 'EHR background, entered by care team';

  return (
    <details className={s.ehr} data-testid="ehr-context">
      <summary className={s.ehrSummary}>
        <Icon name="chevronRight" size={14} className={s.ehrChevron} />
        <span className={s.ehrLine}>
          <span>
            <span className={s.ehrKey}>Problems:</span>{' '}
            {ehr.problems.length ? ehr.problems.slice(0, SHOWN_PROBLEMS).join(', ') : 'None on file'}
            {extra > 0 ? <span className={s.ehrMore}> +{extra}</span> : null}
          </span>
          {ehr.lastClinicVisit ? (
            <span>
              <span className={s.ehrKey}>Last clinic visit</span> {formatDate(ehr.lastClinicVisit)}
            </span>
          ) : null}
          {mismatchCount ? (
            <span className={s.ehrWarn}>
              <Icon name="alertTriangle" size={13} /> {plural(mismatchCount, 'medication list difference')}
            </span>
          ) : null}
        </span>
        <span className={s.ehrSource}>{sourceLabel}</span>
      </summary>
      <div className={s.ehrBody}>
        <dl className={s.ehrGrid}>
          <div>
            <dt>Problem list</dt>
            <dd>{ehr.problems.length ? <ul>{ehr.problems.map((p) => <li key={p}>{p}</li>)}</ul> : 'None on file'}</dd>
          </div>
          <div>
            <dt>Allergies</dt>
            <dd>{ehr.allergies.length ? <ul>{ehr.allergies.map((a) => <li key={a}>{a}</li>)}</ul> : 'No known allergies'}</dd>
          </div>
          <div>
            <dt>Medications on file</dt>
            <dd>
              {ehr.medicationsOnFile.length ? (
                <ul>
                  {ehr.medicationsOnFile.map((m) => (
                    <li key={m} className={ehrOnlySet.has(m) ? s.ehrMismatch : undefined}>
                      {m}
                      {ehrOnlySet.has(m) ? <span className={s.ehrTag}> not tracked in the app</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                'None on file'
              )}
              {appOnly.length ? (
                <p className={s.ehrMismatch} data-testid="app-only-meds">
                  <Icon name="alertTriangle" size={13} /> In the app but not on the EHR list: {appOnly.join(', ')}
                </p>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Visits</dt>
            <dd>
              {ehr.lastClinicVisit ? <>Last clinic visit {formatDate(ehr.lastClinicVisit)}</> : 'No clinic visit on file'}
              {ehr.visitsLast12Months !== undefined ? <div className={s.muted}>{plural(ehr.visitsLast12Months, 'visit')} in the last 12 months</div> : null}
            </dd>
          </div>
          {heightCm || weightKg ? (
            <div>
              <dt>Height and weight</dt>
              <dd className="num">
                {heightCm ? `${heightCm} cm` : '—'}, {weightKg ? `${weightKg} kg` : '—'}
              </dd>
            </div>
          ) : null}
        </dl>
        <p className={s.muted}>Medication names are matched loosely by their first word. Confirm differences against the chart.</p>
      </div>
    </details>
  );
}
