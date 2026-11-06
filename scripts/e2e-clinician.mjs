/**
 * End-to-end: clinician customizations are saved per clinician and apply to every patient.
 *  1. Edit mode: move "Medications" to the top and hide "Tracker answers" for Pulmonology.
 *  2. A different asthma patient opens with that layout; another clinician still sees the preset.
 *  3. Visit mode: hide the calendar and the rescue-inhaler talking point (saved as default);
 *     visit mode for another patient respects it.
 * Needs the production server (`npm run build && npm start`) and Google Chrome. Resets demo
 * data before and after. Usage: `npm run e2e:clinician`.
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

await api('/api/demo/reset', { method: 'POST' });
const { patients } = await api('/api/patients');
const byName = (n) => patients.find((p) => p.displayName.startsWith(n));
const annabel = byName('Annabel');
const guillermina = byName('Guillermina');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  // Section order = order of the edit-mode "Move <section> up" buttons.
  const sectionOrder = async () =>
    (await page.getByRole('button', { name: /^Move .+ up$/ }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))))
      .map((l) => l.replace(/^Move | up$/g, ''));
  const open = async (p) => {
    await page.goto(`${BASE}/patients/${p.id}`);
    await page.getByRole('heading', { name: p.displayName }).waitFor();
  };

  step('Edit mode (Dr. Alex Rivera, Pulmonology): move Medications to top, hide Tracker answers');
  await open(annabel);
  await page.getByRole('button', { name: 'Customize layout' }).click();
  const initial = await sectionOrder();
  const meds = initial.find((s) => /medic/i.test(s));
  const trackers = initial.find((s) => /tracker/i.test(s));
  assert.ok(meds && trackers, `sections: ${initial}`);
  for (let i = initial.indexOf(meds); i > 0; i--) await page.getByRole('button', { name: `Move ${meds} up` }).click();
  await page.getByRole('button', { name: `Hide ${trackers}` }).last().click();
  const edited = await sectionOrder();
  assert.equal(edited[0], meds);
  await page.screenshot({ path: `${SHOTS}/5-edit-mode.png` });
  await page.getByRole('button', { name: 'Done' }).click();
  ok(`order now: ${edited.join(' → ')}`);

  const prefs = await api('/api/clinicians/demo-pulm/preferences');
  const layout = prefs.layouts.pulmonology;
  assert.ok(layout, 'pulmonology layout not saved');
  assert.equal(layout.sections.find((s) => !s.visible)?.id !== undefined, true, 'hidden section not saved');
  ok(`saved on server: ${layout.sections.map((s) => s.id + (s.visible ? '' : ' (hidden)')).join(', ')}`);

  step('Another patient opens with the same layout');
  await open(guillermina);
  await page.getByRole('button', { name: 'Customize layout' }).click();
  const other = await sectionOrder();
  assert.equal(other[0], meds, `Guillermina first section: ${other[0]}`);
  await page.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await page.getByRole('heading', { name: /^Tracker answers/ }).count(), 0, 'hidden section still rendered');
  ok(`${guillermina.displayName}: ${meds} first, ${trackers} hidden`);

  step('A different clinician (nurse) is unaffected');
  await page.getByRole('button', { name: /Signed in as/ }).click();
  await page.getByRole('menuitemradio', { name: /Jamie Okonkwo/ }).or(page.getByRole('menuitem', { name: /Jamie Okonkwo/ })).or(page.getByRole('option', { name: /Jamie Okonkwo/ })).first().click();
  await open(annabel);
  const nursePrefs = await api('/api/clinicians/demo-nurse/preferences');
  assert.deepEqual(nursePrefs.layouts, {});
  ok('nurse has no custom layout; preset in use');
  await page.getByRole('button', { name: /Signed in as/ }).click();
  await page.getByRole('menuitemradio', { name: /Alex Rivera/ }).or(page.getByRole('menuitem', { name: /Alex Rivera/ })).or(page.getByRole('option', { name: /Alex Rivera/ })).first().click();

  step('Visit mode: hide calendar + rescue-inhaler point, save as default');
  await open(annabel);
  await page.getByRole('button', { name: 'Choose what the patient will see' }).click();
  await page.getByRole('checkbox', { name: /^Calendar/ }).uncheck();
  await page.getByRole('checkbox', { name: /^Rescue inhaler use/ }).uncheck();
  await page.getByRole('button', { name: 'Save as my default' }).click();
  await page.waitForTimeout(800);
  const saved = await api('/api/clinicians/demo-pulm/preferences');
  assert.equal(saved.visitMode.calendar, false);
  assert.equal(saved.visitMode.points.rescue, false);
  ok('visit-mode defaults saved');

  await open(guillermina);
  await page.getByRole('button', { name: /^Visit mode/ }).click();
  await page.getByRole('button', { name: /Exit visit mode/ }).first().waitFor();
  const text = await page.locator('main').innerText();
  assert.ok(!/days at a glance/i.test(text), 'calendar still visible in visit mode');
  assert.ok(!/rescue inhaler on/i.test(text), 'rescue point still visible in visit mode');
  assert.ok(/You took your controller/i.test(text), 'other points missing');
  await page.screenshot({ path: `${SHOTS}/6-visit-mode-filtered.png`, fullPage: true });
  ok(`${guillermina.displayName}'s visit mode hides calendar and rescue point, keeps the rest`);

  assert.deepEqual(errors, [], `page errors: ${errors.join('\n')}`);
  console.log(`\nE2E CLINICIAN PASSED — screenshots in ${SHOTS}/`);
} finally {
  await browser.close();
  await api('/api/demo/reset', { method: 'POST' });
}
