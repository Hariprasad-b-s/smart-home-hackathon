# SMART@Home — Clinician View

A clinician data view for SMART@Home (Self-Management Assistance for Recommended Treatment at Home),
built for the Cincinnati Children's Digital Health Hackathon 2026 challenge
(the hackathon brief and one-pager are not included in this repository).

It turns the raw, per-submission home-monitoring log into something a busy clinician can read in
1–2 minutes before a visit — and show the patient during it:

- **How is the disease going?** action-plan zone, symptom days, hard days, lung-function trend
- **Is the patient taking the medication?** per-medication adherence, so *"treatment not working"*
  can be told apart from *"treatment not being taken"*
- **How often do symptoms happen / how often is rescue medication used?**
- **Is lung function changing?** home spirometry as % of personal best with zone bands

It ships as **two apps on one server**:

| App | URL | Who |
|---|---|---|
| Clinician view | `/` | Care team, before and during the visit |
| Patient app | `/patient/` | Teens at home: check-ins, doses, spirometer (simulated Spirobank) |

Patient entries are stored as **Synthea-format FHIR R4** and appear in the clinician view on refresh.

> All data in this repository is **synthetic**. Never load real patient data into this app or into an AI tool.

## Quick start

```bash
npm install
npm run dev          # API on :8787 + web on :5173  → open http://localhost:5173
```

Other scripts:

| Script | What it does |
|---|---|
| `npm test` | Vitest: analytics engine, API, generator, charts, pages |
| `npm run typecheck` | `tsc --noEmit` over the whole project |
| `npm run generate` | Write the synthetic patient documents to `server/data/generated/*.json` |
| `npm run build && npm start` | Production build served by the API server on :8787 |
| `npm run e2e` | Browser test of the loop: patient check-in, dose and breathing test → FHIR store → clinician view (needs `npm start` and Chrome) |
| `npm run e2e:ai` | Browser test: spoken check-in with photo, AI helper chat → escalation → clinician notification and reply → live on the phone, plus the emergency safety screen |
| `npm run e2e:clinician` | Browser test: layout edit mode and visit-mode settings persist per clinician across patients |

`DEMO_TODAY=2026-11-06 npm run dev` pins "today" (synthetic data is generated relative to it).

## Synthetic patients (Synthea + scripted home data)

Patient data is a hybrid, because no public generator produces home-monitoring app data:

1. **EHR background from [Synthea](https://github.com/synthetichealth/synthea)**: Cincinnati
   adolescents with demographics, problem list, prescriptions (RxNorm), allergies, height/weight
   and clinic visits. `server/data/synthea/seeds.json` (≈30 KB, committed) is distilled from
   306 Synthea FHIR bundles, so the app never needs Java at runtime.
2. **Home-monitoring stream scripted per clinical story** (`server/data/generate.ts`): tracker
   check-ins, dose taps and spirometer blows. The app's medications come from each
   patient's actual Synthea prescriptions. The stories are well controlled, not taking the
   controller, taking it but not working, discordant reporter, disengaged, migraine with
   medication overuse, Crohn's flare, multi-condition, and a new patient. Patient #1 replicates
   the account shown in the brief's screenshots.

Regenerating the seeds (optional; needs Java 17+):

```bash
# jar lives in tools/synthea/ (gitignored); get it from the Synthea releases page if missing
bash server/data/synthea/run-synthea.sh     # → server/data/synthea/output/ (gitignored, ~255 MB)
npx tsx server/data/synthea/import.ts       # → server/data/synthea/seeds.json (deterministic)
```

Synthea has no migraine or IBD module. Those two patients use Synthea demographics, and their
condition and medications are added by the generator.

## What's in the view

| Area | Purpose |
|---|---|
| **Patients (triage)** | Sorted by an attention score: zone, 30-day adherence, symptom days, flags, freshness |
| **30-second strip** | Headline metrics with status, trend vs prior period, sparkline and an explanation of how each was computed |
| **What needs attention** | Clinical flags — including *symptoms despite good adherence* vs *uncontrolled with low adherence* |
| **Month at a glance** | Calendar heatmap (zone / hard days / symptoms / feeling / adherence) — usable with the patient |
| **Context timeline** | Feeling, symptoms, doses, rescue use, peak flow and zone on one shared date axis |
| **Medications** | Adherence strips per scheduled medication, as-needed use bars, archived duplicates merged |
| **Lung function** | Spirometry trend in clinical units (L, L/min, % personal best), session quality, coaching in plain English |
| **Tracker answers** | A generic widget for every question of every tracker — works for asthma, migraine, IBD, … |
| **Day drawer** | Every submission of a day, blank ones marked, and which answer was used for the day |
| **Specialty views** | Overview · Pulmonology · Primary care · Nursing · Neurology · Gastroenterology presets |
| **Visit mode** | Patient-facing, plain-language, large calendar, streaks and badges |
| **Export** | CSV with one row per day, or a full FHIR R4 bundle (Synthea format) |
| **Edit mode** | "Customize layout": reorder, hide or resize sections and headline tiles; saved per clinician and view, applied to all patients |
| **Visit-mode privacy** | "What the patient will see": toggle summary blocks and each talking point; save as default or just this visit |
| **Clinician switcher** | Demo clinicians (pulmonology, primary care, nursing, neurology), each with their own preferences |
| **Theme** | System / Light / Dark toggle |

## Patient app (`/patient/`)

Mobile-first app for the patient's phone. It covers today's action-plan zone, a generic one-question-per-screen
check-in for any tracker, one-tap "Mark taken" doses, a simulated Bluetooth Spirobank breathing
test with coaching (with a demo control for good / okay / struggling), streaks and badges. Each entry is
converted to FHIR R4 in Synthea's style:

| Entry | FHIR resource |
|---|---|
| Check-in | `QuestionnaireResponse` (one `Questionnaire` per tracker) |
| Dose | `MedicationAdministration` (RxNorm from the patient's Synthea prescription) |
| Spirometer blow | `Observation` with LOINC FEV1 / FVC / FEV1-FVC / PEF components, plus `Device` |

### Speak mode, evidence and the Help chat

- **Just talk.** For patients too unwell to tap through questions: the app first shows what to cover
  (built from the tracker's questions). The patient talks, using the browser's speech-to-text, or types if
  speech isn't available. The server fills in the check-in from the transcript, and the patient
  reviews the answers (each with confidence and a "You said: …" quote) before sending. The clinician
  sees a "Spoken check-in" badge and the transcript.
- **Photos & videos.** Attach to a check-in or chat, or upload from the Photos screen. Uploads are checked
  against the file's actual bytes, stored as FHIR `Media`, and shown in a "Photos & videos" panel and the
  day drawer on the clinician dashboard.
- **Help chat.** An AI helper answers app and action-plan questions. It never diagnoses or changes
  medicines. When it can't help, when the patient asks, or when a red flag appears, it hands off to the
  care team. Clinicians get a bell and toast notification, a **Messages** inbox sorted by urgency, the full
  chat history with a patient snapshot, and can reply. The reply appears live on the patient's phone
  (Server-Sent Events). Emergency language ("can't breathe", self-harm) bypasses the AI entirely: 911/988
  instructions plus an urgent escalation.

**AI engine.** Uses Claude (`claude-opus-5-5`, with the server-side refusal fallback enabled) when
`ANTHROPIC_API_KEY` is set, and otherwise a deterministic rule engine, so every feature works offline.
Check with `GET /api/ai/status`, or force rules with `SMART_HOME_AI=off`. **Demo only:** synthetic data,
not medical advice. A real deployment needs a HIPAA-eligible AI setup and a BAA.

Chats are stored as FHIR `Communication` + `Task` (escalation), so the FHIR export holds the entire record.

These are appended to `server/data/runtime/fhir/<patientId>.json` (gitignored) and mapped back
into the app's data format for the clinician view. `GET /api/patients/:id/fhir` returns the whole record
(Synthea EHR background plus home monitoring) and `POST /api/demo/reset` clears all entries.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```
shared/types        contracts: raw Cosmos document, tracker definitions, clinician summary, API
shared/analytics    pure functions: raw document + trackers → PatientSummary
server/             synthetic data generator (Synthea-seeded), in-memory store, Express API
client/             clinician React app: pages, presets, edit mode, chart library (/dev/charts)
client/patient/     patient React app (second Vite entry, served at /patient/)
server/fhir/        Synthea-style FHIR R4 conversion (lossless round trip with the app's data format)
scripts/            end-to-end browser tests (playwright-core + system Chrome)
docs/               hackathon brief, one-pager, architecture
tools/synthea/      local Synthea jar (gitignored)
.dev/               local screenshots and logs (gitignored)
```
