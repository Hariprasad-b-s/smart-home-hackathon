/**
 * Dev script (not a test): prints headline + flags for every generated patient.
 * Run: npx tsx shared/analytics/__fixtures__/probe.ts [YYYY-MM-DD]
 */
import { generatePatients } from '../../../server/data/generate';
import { TRACKERS } from '../../../server/data/trackers';
import { buildPatientSummary } from '../index';

const today = process.argv[2] ?? '2026-11-06';
for (const d of generatePatients({ today })) {
  const s = buildPatientSummary(d, TRACKERS, { today });
  console.log(`\n## ${s.patient.displayName} (${s.patient.trackers.map((t) => t.condition).join('+')}) enrolledDays=${s.patient.enrolledDays}`);
  console.log('  headline:', s.headline.map((h) => `${h.id}=${h.value}[${h.status}]`).join(' | '));
  const zone = s.headline.find((h) => h.id === 'zone');
  if (zone) console.log('  zone detail:', zone.detail);
  if (s.spirometry) {
    const multi = s.spirometry.sessions.filter((x, i, a) => a.some((y, j) => j !== i && y.date === x.date)).length;
    console.log(`  spirometry: ${s.spirometry.sessionsInWindow} sessions in window (${multi} on multi-session days), latest ${s.spirometry.latest?.date} ${s.spirometry.latest?.time ?? ''}`);
  }
  for (const f of s.flags) console.log(`  ${f.severity.padEnd(6)} ${f.title} — ${f.detail}`);
}
