import { describe, expect, it } from 'vitest';
import { albuterol, asthmaTracker, dose, emptyDoc, reading, spirometer, submit, TODAY } from './__fixtures__/fixtures';
import { buildPatientSummary, summaryToCsv } from './index';
import { symptomZone, worseZone } from './zones';

const defs = [asthmaTracker];

describe('spirometry', () => {
  it('uses the best ACCEPTED blow, converts L/s to L/min and humanizes device text', () => {
    const doc = emptyDoc({
      asthmaTreatmentPlan: { personalBestPeakFlow: 400, status: 'Green', expiration: '2027-01-01' },
      medicalDevices: [
        spirometer([
          reading('2026-06-24T09:31:12.120-04:00', { fev1: 2.123456, fvc: 2.9, pef: 5.0, accepted: true, quality: 'NotAcceptable', coaching: ['KeepGoingUntilCompletelyEmpty'] }),
          reading('2026-06-24T09:32:40.000-04:00', { fev1: 2.05, fvc: 3.01, pef: 6.0, accepted: true }),
          reading('2026-06-24T09:34:00.000-04:00', { fev1: 2.6, fvc: 3.3, pef: 7.0, accepted: false }),
        ]),
      ],
    });
    const s = buildPatientSummary(doc, defs, { today: TODAY });
    const sp = s.spirometry!;
    expect(sp.deviceName).toBe('MIR Spirobank Smart');
    expect(sp.sessions).toHaveLength(1);
    const sess = sp.sessions[0];
    expect(sess.bestPefLpm).toBe(360); // 6.0 L/s × 60, unaccepted 7.0 ignored
    expect(sess.bestFev1L).toBe(2.12);
    expect(sess.bestFvcL).toBe(3.01);
    expect(sess.ratioPct).toBe(73); // ratio from the best-FEV1 blow (2.123456 / 2.9)
    expect(sess.reliable).toBe(true);
    expect(sess.acceptableBlows).toBe(2);
    expect(sess.pctPersonalBest).toBe(90);
    expect(sess.zone).toBe('green');
    expect(sess.blows[0].qualityLabel).toBe('Not acceptable');
    expect(sess.blows[0].coaching).toEqual(['Keep going until completely empty']);
    expect(sp.personalBestSource).toBe('action plan');
    expect(sp.qualityPct).toBe(67);
    expect(s.dataQuality.some((n) => n.id === 'spirometry-quality-conflict')).toBe(true);
    expect(s.dataQuality.some((n) => n.id === 'spirometry-by-date')).toBe(true);
    expect(s.days.find((d) => d.date === '2026-06-24')!.spirometry).toEqual({ pefLpm: 360, fev1L: 2.12, pctPersonalBest: 90, acceptable: true });
  });

  it('falls back to all blows when none accepted and derives an observed personal best', () => {
    const doc = emptyDoc({
      medicalDevices: [
        spirometer([
          reading('2026-06-10T08:00:00.000-04:00', { fev1: 2.0, fvc: 2.5, pef: 6.0, accepted: true }),
          reading('2026-06-20T08:00:00.000-04:00', { fev1: 1.5, fvc: 2.2, pef: 4.0, accepted: false }),
          reading('2026-06-20T08:01:00.000-04:00', { fev1: 1.6, fvc: 2.3, pef: 4.5, accepted: false }),
          // A higher but unreliable reading must not become the personal best.
          reading('2026-06-25T08:00:00.000-04:00', { fev1: 2.5, fvc: 3.0, pef: 9.0, accepted: false }),
        ]),
      ],
    });
    const s = buildPatientSummary(doc, defs, { today: TODAY });
    const sp = s.spirometry!;
    expect(sp.personalBestSource).toBe('observed');
    expect(sp.personalBestPefLpm).toBe(360);
    const s20 = sp.sessions.find((x) => x.date === '2026-06-20')!;
    expect(s20.reliable).toBe(false);
    expect(s20.bestPefLpm).toBe(270);
    expect(s20.pctPersonalBest).toBe(75);
    expect(s20.zone).toBe('yellow');
    expect(s.dataQuality.some((n) => n.id === 'personal-best-observed')).toBe(true);
    expect(s.dataQuality.some((n) => n.id === 'spirometry-unreliable')).toBe(true);
  });
});

describe('zones', () => {
  it('derives the symptom zone', () => {
    expect(symptomZone({ feelingSeverity: 0, symptomCount: 0, nightWaking: false, rescueUses: 0 })).toBe('green');
    expect(symptomZone({ feelingSeverity: 1, symptomCount: 1, nightWaking: false, rescueUses: 0 })).toBe('yellow');
    expect(symptomZone({ feelingSeverity: 3, symptomCount: 2, nightWaking: false, rescueUses: 0 })).toBe('red');
    expect(symptomZone({ symptomCount: 0, nightWaking: false, rescueUses: 4 })).toBe('red');
    expect(symptomZone({ symptomCount: 0, nightWaking: false, rescueUses: 0 })).toBeUndefined();
    expect(worseZone('green', 'yellow')).toBe('yellow');
  });

  it('takes the worse of spirometry and symptom zones per day, and counts zone days', () => {
    const a = albuterol();
    const doc = emptyDoc({
      medications: [a],
      asthmaTreatmentPlan: { personalBestPeakFlow: 400, status: 'Yellow', expiration: '2026-06-15' },
      medicalDevices: [spirometer([reading('2026-06-29T08:00:00.000-04:00', { fev1: 1.2, fvc: 2.0, pef: 3.0, accepted: true })])],
    });
    submit(doc, '2026-06-29', '19:00', { 'q-feel': 'Great', 'q-sym': '["None of these "]' }); // green symptoms, PEF 180 = 45% → red
    submit(doc, '2026-06-28', '19:00', { 'q-feel': 'Good', 'q-sym': '["None of these "]', 'q-night': 'No' }); // green
    dose(doc, '2026-06-27', a, '15:00'); // rescue use only → yellow
    const s = buildPatientSummary(doc, defs, { today: TODAY });
    const zoneOf = (d: string) => s.days.find((x) => x.date === d)!.zone;
    expect(zoneOf('2026-06-29')).toBe('red');
    expect(zoneOf('2026-06-28')).toBe('green');
    expect(zoneOf('2026-06-27')).toBe('yellow');
    expect(zoneOf('2026-06-26')).toBeUndefined();
    expect(s.actionPlan!.zoneDays).toEqual({ green: 1, yellow: 1, red: 1, unknown: 27 });
    expect(s.actionPlan!.expired).toBe(true);
    expect(s.actionPlan!.expiresInDays).toBe(-15);
    expect(s.actionPlan!.currentZone).toBe('yellow');
    expect(s.actionPlan!.method).toMatch(/worse of the peak-flow zone/);
    expect(s.days.find((x) => x.date === '2026-06-29')!.discordant).toBe(true);
    const ids = s.flags.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['pef-below-red', 'zone-red-days', 'plan-expired']));
    expect(s.headline[0]).toMatchObject({ id: 'zone', value: 'Red', status: 'concern' });
  });
});

describe('multiple spirometry sessions per day', () => {
  const plan = { personalBestPeakFlow: 400, status: 'Green' as const, expiration: '2027-01-01' };
  // 81% = 5.4 L/s, < 50% PB = < 3.33 L/s
  const good = (t: string) => reading(`2026-06-30T${t}:00.000-04:00`, { fev1: 2.4, fvc: 3.0, pef: 5.4, accepted: true });
  const bad = (t: string, pef: number) => reading(`2026-06-30T${t}:00.000-04:00`, { fev1: 1.1, fvc: 2.2, pef, accepted: true });

  it('good AM + red PM → two sessions, day shows PM values and is red', () => {
    const doc = emptyDoc({ asthmaTreatmentPlan: plan, medicalDevices: [spirometer([good('08:00'), good('08:02'), bad('15:10', 3.0), bad('15:12', 3.1), bad('15:14', 2.9)])] });
    const s = buildPatientSummary(doc, defs, { today: TODAY, days: 1 });
    const sp = s.spirometry!;
    expect(sp.sessions.map((x) => [x.date, x.time, x.pctPersonalBest, x.zone])).toEqual([
      ['2026-06-30', '08:00', 81, 'green'],
      ['2026-06-30', '15:10', 47, 'red'],
    ]);
    expect(sp.latest!.time).toBe('15:10');
    expect(s.days[0].spirometry).toEqual({ pefLpm: 186, fev1L: 1.1, pctPersonalBest: 47, acceptable: true });
    expect(s.days[0].zone).toBe('red');
    expect(s.flags.some((f) => f.id === 'pef-below-red')).toBe(true);
    expect(summaryToCsv(s).split('\r\n')[1]).toContain(',red,');
  });

  it('red AM + good PM → day still red, spirometry shows the PM session', () => {
    const doc = emptyDoc({ asthmaTreatmentPlan: plan, medicalDevices: [spirometer([bad('07:30', 3.0), good('18:00')])] });
    const s = buildPatientSummary(doc, defs, { today: TODAY, days: 1 });
    expect(s.spirometry!.sessions).toHaveLength(2);
    expect(s.days[0].spirometry!.pctPersonalBest).toBe(81);
    expect(s.days[0].zone).toBe('red');
  });

  it('keeps blows 10 minutes apart in one session', () => {
    const doc = emptyDoc({ asthmaTreatmentPlan: plan, medicalDevices: [spirometer([good('08:00'), bad('08:10', 3.0), bad('08:20', 3.0)])] });
    const s = buildPatientSummary(doc, defs, { today: TODAY, days: 1 });
    expect(s.spirometry!.sessions).toHaveLength(1);
    expect(s.spirometry!.sessions[0]).toMatchObject({ time: '08:00', totalBlows: 3, bestPefLpm: 324, pctPersonalBest: 81 });
  });
});

