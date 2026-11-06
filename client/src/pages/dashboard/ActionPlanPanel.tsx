import type { PatientSummary, Status } from '@shared/types';
import { ZoneDistributionBar } from '../../components/charts';
import { Icon, Panel, StatusBadge, ZoneBadge } from '../../components/ui';
import { datePart, formatDate } from '../../lib/format';
import s from './Dashboard.module.css';

/** Is the patient following the plan, and is the plan itself current? */
export function ActionPlanPanel({ summary, span }: { summary: PatientSummary; span: 1 | 2 }) {
  const ap = summary.actionPlan!;
  const today = summary.today;
  const retest = datePart(ap.retestDueAt);
  const retestOverdue = !!retest && retest < today;

  let expiry: { status: Status; text: string };
  if (!ap.expiresOn) expiry = { status: 'unknown', text: 'No expiry date on file' };
  else if (ap.expired) expiry = { status: 'concern', text: `Expired on ${formatDate(ap.expiresOn)}` };
  else if ((ap.expiresInDays ?? 999) <= 30) expiry = { status: 'watch', text: `Expires in ${ap.expiresInDays} days (${formatDate(ap.expiresOn)})` };
  else expiry = { status: 'good', text: `Valid until ${formatDate(ap.expiresOn)}` };

  const total = ap.zoneDays.green + ap.zoneDays.yellow + ap.zoneDays.red;

  return (
    <Panel id="action-plan" title="Asthma action plan" icon={<Icon name="clipboard" />} span={span}>
      <div className={s.planTop}>
        <div>
          <p className={s.planLabel}>Zone shown in the app</p>
          <ZoneBadge zone={ap.currentZone} large />
          {ap.currentZoneAsOf ? <p className={s.muted}>as of {formatDate(datePart(ap.currentZoneAsOf))}</p> : null}
        </div>
        <dl className={s.planFacts}>
          <div>
            <dt>Plan</dt>
            <dd>
              <StatusBadge status={expiry.status} label={expiry.text} />
            </dd>
          </div>
          <div>
            <dt>Spirometry retest</dt>
            <dd>
              {retest ? (
                <StatusBadge status={retestOverdue ? 'watch' : 'neutral'} label={`${retestOverdue ? 'Overdue since' : 'Due'} ${formatDate(retest)}`} subtle={!retestOverdue} />
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
      </div>
      <h3 className={s.subTitle}>Daily zones in this period</h3>
      <p className={s.muted}>
        {total} of {summary.window.days} days had enough data to assign a zone.
      </p>
      <ZoneDistributionBar zoneDays={ap.zoneDays} showLegend />
      <p className={s.method}>
        <Icon name="info" size={14} /> {ap.method}
      </p>
    </Panel>
  );
}
