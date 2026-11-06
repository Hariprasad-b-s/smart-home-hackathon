/**
 * End-to-end: speak-mode check-in with photo evidence, AI helper chat → escalation → clinician
 * notification, inbox, reply → live reply on the patient's phone, and the emergency safety screen.
 * Runs with whichever AI engine the server reports (Claude with credentials, else the rule engine).
 * Needs the production server (`npm run build && npm start`) and Google Chrome. Resets demo data
 * before and after. Usage: `npm run e2e:ai`.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const SHOTS = '.dev/screenshots/e2e';
mkdirSync(SHOTS, { recursive: true });
const api = async (path, init) => {
  const res = await fetch(BASE + path, init);
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
};
const step = (msg) => console.log(`\n▶ ${msg}`);
const ok = (msg) => console.log(`  ✓ ${msg}`);
// 1×1 PNG (valid magic bytes for the server's content sniffing).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

await api('/api/demo/reset', { method: 'POST' });
const ai = await api('/api/ai/status');
console.log(`AI engine: ${ai.engine}${ai.model ? ` (${ai.model})` : ''}`);
const { patients, today } = await api('/api/patients');
const patient = patients.find((p) => p.displayName === 'Annabel Swaniawski');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  phone.on('pageerror', (e) => errors.push(`phone: ${e}`));
  await phone.goto(`${BASE}/patient/`);
  await phone.getByText(patient.displayName).click();
  await phone.getByText('For today').waitFor();

  step('Speak mode: patient says how they feel (typed fallback — headless Chrome has no microphone)');
  const said =
    "I'm feeling bad today. I've been wheezing and my chest feels tight. I woke up last night coughing. " +
    "I didn't miss school. I used my rescue inhaler three times.";
  await phone.goto(`${BASE}/patient/check-in/asthma-v3`);
  await phone.getByText('Just talk').click();
  await phone.getByRole('button', { name: 'Type it instead' }).click();
  await phone.locator('textarea').first().fill(said);
  await phone.getByRole('button', { name: 'Check my answers' }).click();
  await phone.getByText('Check your answers').waitFor({ timeout: 30000 });
  assert.equal(await phone.getByRole('radio', { name: /Bad/ }).isChecked(), true, 'feeling not pre-filled');
  ok('answers extracted from speech and pre-filled for review');
  await phone.getByRole('button', { name: 'Exercise' }).click(); // answer the follow-up manually

  step('Attach a photo as evidence');
  await phone.getByRole('button', { name: 'Add photo or video' }).click();
  await phone.locator('[data-testid="media-library"]').setInputFiles({ name: 'arm.png', mimeType: 'image/png', buffer: PNG });
  await phone.getByLabel(/What does this show/i).fill('Red patch on my arm after using the new spacer');
  await phone.getByRole('button', { name: 'Send photo' }).click();
  await phone.getByRole('list', { name: 'Attached photos and videos' }).getByRole('img').waitFor();
  await phone.screenshot({ path: `${SHOTS}/7-voice-review.png` });
  await phone.getByRole('button', { name: 'Send check-in' }).click();
  await phone.getByText(/saved|sent/i).first().waitFor();
  ok('voice check-in with photo sent');

  const day = (await api(`/api/patients/${patient.id}/summary?days=1`)).days.at(-1);
  const voice = day.submissions.find((s) => s.entryMode === 'voice');
  assert.ok(voice, 'no voice submission in clinician summary');
  assert.match(voice.transcript, /wheezing/);
  assert.equal(voice.mediaIds.length, 1);
  assert.ok(day.symptoms.includes('Wheezing') && day.roleValues.nightWaking === true && day.roleValues.rescueMedUse === 3);
  const media = await api(`/api/patients/${patient.id}/media`);
  assert.equal(media[0].trackerResponseId, voice.responseId);
  ok(`clinician summary: spoken check-in with transcript, ${day.symptoms.join(', ')}, rescue ×3, photo linked`);

  step('Help chat: AI helper answers, then patient asks for the care team');
  const desk = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  desk.on('pageerror', (e) => errors.push(`desk: ${e}`));
  await desk.goto(`${BASE}/`); // Dr. Alex Rivera (pulmonology) — on Annabel's care team
  await desk.getByRole('heading', { name: 'Patients' }).waitFor();

  await phone.goto(`${BASE}/patient/help`);
  await phone.getByRole('button', { name: 'How do I do the breathing test?' }).click();
  await phone.getByText(/helper/i).first().waitFor();
  await phone.locator('[class*="bubble"], [data-author="ai"]').last().waitFor().catch(() => undefined);
  await phone.waitForTimeout(500);
  const thread1 = await phone.locator('main').innerText();
  assert.match(thread1, /breath|blow|spirometer/i, 'AI helper did not answer the breathing-test question');
  ok('AI helper answered');
  await phone.getByRole('button', { name: 'Talk to my care team' }).click();
  await phone.getByRole('button', { name: 'Yes, ask them' }).click();
  await phone.getByText(/Waiting for your care team/i).waitFor();
  ok('escalated: "Waiting for your care team"');

  step('Clinician: notification → inbox → full history → claim → reply');
  await desk.getByRole('button', { name: /Notifications, \d+ unread/ }).waitFor({ timeout: 25000 });
  ok('bell shows unread notification');
  await desk.goto(`${BASE}/inbox`);
  await desk.getByText(patient.displayName).first().click();
  await desk.getByPlaceholder(/Write a reply/).waitFor();
  const history = await desk.locator('main').innerText();
  assert.match(history, /breathing test/i, 'patient question missing from clinician view');
  assert.match(history, /AI helper/i, 'AI messages not labelled for clinician');
  await desk.getByRole('button', { name: /on it/ }).click();
  await desk.getByPlaceholder(/Write a reply/).fill('Hi Annabel, Dr. Rivera here. I can see your spoken check-in and photo. Please do a breathing test now and I will call you.');
  await desk.keyboard.press('Enter');
  await desk.getByText(/Dr\. Rivera here/).first().waitFor();
  await desk.screenshot({ path: `${SHOTS}/8-clinician-conversation.png` });
  ok('clinician claimed and replied');

  await phone.getByText(/Dr\. Rivera here/).waitFor({ timeout: 25000 });
  await phone.screenshot({ path: `${SHOTS}/9-patient-sees-reply.png` });
  ok('reply appeared live on the patient\'s phone');

  step('Safety: emergency language bypasses the AI and alerts the care team');
  await phone.goto(`${BASE}/patient/help`);
  await phone.getByLabel('Message', { exact: true }).fill("I can't breathe and my lips look blue");
  await phone.getByRole('button', { name: 'Send message' }).click();
  await phone.locator('a[href="tel:911"]').first().waitFor({ timeout: 15000 });
  await phone.screenshot({ path: `${SHOTS}/10-safety.png` });
  const convs = await api(`/api/patients/${patient.id}/conversations`);
  const emergency = convs.find((c) => c.messages.some((m) => m.safety?.level === 'emergency'));
  assert.ok(emergency, 'no conversation carries the emergency safety notice');
  assert.equal(emergency.escalation?.urgency, 'urgent', `emergency escalation urgency: ${emergency.escalation?.urgency}`);
  const inbox = await api('/api/clinicians/demo-pulm/inbox');
  assert.equal(inbox[0].conversationId, emergency.id, 'emergency is not at the top of the inbox');
  ok('911 card shown; urgent escalation at the top of the clinician inbox');

  step('FHIR: chat and evidence stored in Synthea format');
  const bundle = await api(`/api/patients/${patient.id}/fhir`);
  const types = new Set(bundle.entry.map((e) => e.resource.resourceType));
  for (const t of ['Communication', 'Task', 'Media', 'QuestionnaireResponse']) assert.ok(types.has(t), `${t} missing from FHIR export`);
  ok(`export includes ${[...types].sort().join(', ')}`);

  assert.deepEqual(errors, [], `page errors:\n${errors.join('\n')}`);
  console.log(`\nE2E AI PASSED (${ai.engine}) — screenshots in ${SHOTS}/`);
} finally {
  await browser.close();
  await api('/api/demo/reset', { method: 'POST' });
}
