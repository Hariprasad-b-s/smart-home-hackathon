/**
 * End-to-end loop: patient enters data on the phone app → stored as Synthea-style FHIR →
 * visible in the clinician view.
 *
 * Needs the production server running (`npm run build && npm start`) and Google Chrome
 * installed (driven via playwright-core, no browser download). Resets demo data before and
 * after. Usage: `npm run e2e` (BASE_URL defaults to http://localhost:8787).
 */
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const SHOTS = '.dev/screenshots/e2e';
const PATIENT = 'Annabel Swaniawski';
mkdirSync(SHOTS, { recursive: true });

const api = async (path, init) => {
  const res = await fetch(BASE + path, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
};
const step = (msg) => console.log(`\n▶ ${msg}`);
const ok = (msg) => console.log(`  ✓ ${msg}`);

await api('/api/demo/reset', { method: 'POST' });
const { patients, today } = await api('/api/patients');
const patient = patients.find((p) => p.displayName === PATIENT);
assert.ok(patient, `${PATIENT} not found`);
const before = await api(`/api/patients/${patient.id}/summary?days=1`);
const dayBefore = before.days.at(-1);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  phone.on('pageerror', (e) => errors.push(String(e)));

  step('Patient app: choose patient');
  await phone.goto(`${BASE}/patient/`);
  await phone.getByText(PATIENT).click();
  await phone.getByText('For today').waitFor();
  ok('Today screen loaded');

  step('Check-in: feeling Bad, wheezing + tight chest, woke at night');
  await phone.getByRole('link', { name: 'Check in' }).first().click();
  await phone.getByText('Answer questions').click();
  await phone.getByRole('button', { name: 'Skip' }).click(); // spirometer prompt (done separately below)
  await phone.getByRole('radio', { name: /Bad/ }).check();
  await phone.getByRole('button', { name: 'Next' }).click();
  await phone.getByRole('button', { name: 'Wheezing' }).click();
  await phone.getByRole('button', { name: 'Tight chest' }).click();
  await phone.getByRole('button', { name: 'Next' }).click();
  await phone.getByRole('radio', { name: /Yes/ }).check();
  await phone.getByRole('button', { name: 'Next' }).click();
  for (let i = 0; i < 3; i++) await phone.getByRole('button', { name: 'Skip' }).click();
  await phone.screenshot({ path: `${SHOTS}/1-review.png` });
  await phone.getByRole('button', { name: 'Send check-in' }).click();
  await phone.getByText(/Check-in saved/).waitFor();
  await phone.screenshot({ path: `${SHOTS}/2-saved.png` });
  ok('check-in saved');

  step('Medicines: mark the evening controller dose taken');
  await phone.goto(`${BASE}/patient/`);
  await phone.getByText('For today').waitFor();
  await phone.getByRole('button', { name: /mark .*taken/i }).first().click();
  await phone.getByText(/taken at/).nth(1).waitFor();
  ok('dose marked');

  step('Breathing test: simulate "Struggling" (3 coached blows)');
  await phone.getByRole('link', { name: /Start|breathing/ }).first().click();
  await phone.getByText(/Connected/).first().waitFor({ timeout: 15000 });
  await phone.getByRole('radio', { name: 'Struggling' }).check();
  for (let n = 1; n <= 3; n++) {
    await phone.getByRole('button', { name: `Start blow ${n} of 3` }).click({ timeout: 30000 });
  }
  await phone.getByRole('button', { name: 'See my result' }).click({ timeout: 30000 });
  await phone.getByText('Your best blow').waitFor({ timeout: 15000 });
  await phone.screenshot({ path: `${SHOTS}/3-breathing-result.png`, fullPage: true });
  ok('spirometry saved');

  step('FHIR store: entries written in Synthea format');
  const bundle = JSON.parse(readFileSync(`server/data/runtime/fhir/${patient.id}.json`, 'utf8'));
  const types = bundle.entry.map((e) => e.resource.resourceType);
  assert.equal(bundle.resourceType, 'Bundle');
  assert.ok(types.includes('QuestionnaireResponse'), 'QuestionnaireResponse missing');
  assert.ok(types.includes('MedicationAdministration'), 'MedicationAdministration missing');
  assert.ok(types.filter((t) => t === 'Observation').length >= 3, 'spirometry Observations missing');
  const qr = bundle.entry.find((e) => e.resource.resourceType === 'QuestionnaireResponse').resource;
  assert.match(qr.questionnaire, /Questionnaire\/asthma-v3$/);
  ok(`bundle has ${types.length} resources: ${[...new Set(types)].join(', ')}`);

  step('Clinician view: today reflects the new data');
  const after = await api(`/api/patients/${patient.id}/summary?days=1`);
  const day = after.days.at(-1);
  assert.equal(day.date, today);
  assert.equal(day.feeling.label, 'Bad');
  assert.ok(day.symptoms.includes('Wheezing') && day.symptoms.includes('Tight chest'), `symptoms: ${day.symptoms}`);
  assert.equal(day.roleValues.nightWaking, true);
  assert.ok(day.scheduledDosesTaken > dayBefore.scheduledDosesTaken, 'dose not counted');
  assert.ok(day.spirometry.pctPersonalBest < 50, `pct PB ${day.spirometry.pctPersonalBest}`);
  assert.equal(day.zone, 'red');
  ok(`feeling ${day.feeling.sequence.join(' → ')}, symptoms ${day.symptoms.join(', ')}, ` +
    `doses ${day.scheduledDosesTaken}/${day.scheduledDosesExpected}, PEF ${day.spirometry.pctPersonalBest}% → ${day.zone} zone`);

  const desk = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  desk.on('pageerror', (e) => errors.push(String(e)));
  await desk.goto(`${BASE}/patients/${patient.id}?day=${today}`);
  await desk.getByRole('dialog').getByText('Wheezing').first().waitFor({ timeout: 15000 });
  await desk.screenshot({ path: `${SHOTS}/4-clinician-day-drawer.png` });
  ok('day drawer shows the new check-in');

  const home = await api(`/api/patients/${patient.id}/app/home`);
  assert.equal(home.actionPlan.zone, 'red');
  ok('patient app home now shows red zone');

  assert.deepEqual(errors, [], `page errors: ${errors.join('\n')}`);
  console.log(`\nE2E LOOP PASSED — screenshots in ${SHOTS}/`);
} finally {
  await browser.close();
  await api('/api/demo/reset', { method: 'POST' });
}
