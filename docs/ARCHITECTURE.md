# SMART@Home Clinician View — Architecture

Source brief: the SMART@Home hackathon brief and one-pager (kept locally in `docs/`, not committed).

**Goal:** a clinician view a busy clinician can understand in 1–2 minutes before a visit and
use *with the patient* during it. It answers: how is the disease going, is the patient taking
the medication, how often do symptoms happen, is lung function changing. It must work for any
tracker (asthma, migraine, IBD, …) and offer different views per specialty.

All data is **synthetic**. Never add real patient data.

## Stack
- TypeScript everywhere, single npm package (`"type": "module"`), Node 26.
- Server: Express 5 run with `tsx` (port 8787).
- Client: React 19 + React Router 7 + Vite 8 (port 5173, proxies `/api`). Charts: hand-rolled SVG and/or Recharts 3.
- Tests: Vitest 5 (`npm test`). React tests use `// @vitest-environment jsdom` docblock + @testing-library/react.
- Path alias `@shared/*` → `shared/*` works in client code and tests. **Server and shared code use relative imports.**

## Layout & ownership

| Path | Owner module | Notes |
|---|---|---|
| `shared/types/*` | **Contract (lead)** | Read-only for modules. Propose changes in your final report instead of editing. |
| `shared/analytics/**` | Analytics | `index.ts` exports are a contract (signatures fixed). |
| `server/ai/**`, `server/chat/**`, `server/realtime/**` | AI & Chat | Claude integration (voice extraction, chat helper), rule-based fallback, conversations, escalation, inbox, SSE. |
| `server/**` (everything else, incl. `server/media/**`, `server/fhir/**`) | Data & API | Synthetic data generator, tracker definitions, Express API, media evidence, FHIR. |
| `client/src/components/charts/**` | Charts | `types.ts` + `index.ts` export list are a contract. |
| `client/src/styles/tokens.css` | Contract (lead) | Cincinnati Children's–inspired palette (magenta/purple/sky/lime brand band + deep blue accent). Use these CSS variables; don't hard-code colors. Never reproduce the hospital logo. |
| `client/patient/**` | Patient App | Mobile-first patient data-entry app served at `/patient/` (second Vite entry). |
| `client/**` (everything else) | App UI (clinician) | Shell, routing, pages, API client, UI primitives, specialty config. |
| `docs/` | lead | |

## Two apps, one server
- **Clinician view** `/` (`client/index.html`): read-only pre-visit summary.
- **Patient app** `/patient/` (`client/patient/index.html`): teens enter check-ins, mark doses,
  and run the (simulated) Spirobank spirometer. Writes go through `POST /api/patients/:id/…`
  in the raw document format, so the clinician view shows them on refresh. Contract:
  `shared/types/api.ts` (Patient app section).

## AI features (demo-only, synthetic data)
- Engine: Claude (`claude-opus-5-5`) via `@anthropic-ai/sdk` when Anthropic credentials are
  configured (`ANTHROPIC_API_KEY`), otherwise a deterministic rule engine. `GET /api/ai/status`.
- Voice check-in: browser speech-to-text → `POST …/voice-checkin/parse` (structured extraction,
  nothing saved) → patient reviews → normal check-in with `entryMode: 'voice'` + transcript.
- Chat helper: AI answers app/action-plan questions only; never diagnoses or changes medicines;
  escalates to the care team (`careTeamFor` in server/data/clinicians.ts) when unsure, when asked,
  or on red flags (deterministic safety screen runs before the model). Clinicians are notified
  over SSE (`GET /api/events`) and see the full chat history.
- Real deployments need a HIPAA-eligible AI setup and a BAA; never send real PHI to this demo.

## Data flow
```
RawPatientDocument (Cosmos-like JSON, messy)  +  TrackerDefinition[]
          │  server/data (synthetic generator, in-memory store)
          ▼
shared/analytics  buildPatientSummary()  ──►  PatientSummary (clean, labelled, rounded)
          │  server/app.ts  GET /api/patients/:id/summary
          ▼
client  pages compose charts + panels; specialty presets choose what to show
```

## Rules for parallel development
- Only edit files in the paths you own. If something in a contract blocks you, work around it
  locally and describe the needed change in your final report.
- Do **not** run `npm install` or edit `package.json` / `tsconfig.json` / `vite.config.ts` /
  `vitest.config.ts`. Deps available: react, react-dom, react-router-dom, recharts, express,
  date-fns, vitest, jsdom, @testing-library/react, @testing-library/jest-dom, supertest.
- Do **not** start long-running dev servers on 5173/8787 (other modules run in parallel).
  Verify with `npx tsc --noEmit -p .` (filter output to your own paths — other modules may be
  mid-edit) and `npx vitest run <your paths>`.
- Dates: patient-local `YYYY-MM-DD` strings; do date math on these strings in UTC
  (e.g. `new Date(d + 'T00:00:00Z')`) to avoid DST/timezone bugs.
- Demo "today" defaults to the real current date; server honours env `DEMO_TODAY=YYYY-MM-DD`.
- Keep every artifact inside the repo: scratch files, screenshots and logs go in `.dev/`
  (gitignored), and external tools in `tools/` (e.g. `tools/synthea/`). Don't write to `/tmp` or
  to other projects.

## Synthetic data pipeline
```
tools/synthea/*.jar ──run-synthea.sh──► server/data/synthea/output/fhir (gitignored)
        ──import.ts──► server/data/synthea/seeds.json (committed, deterministic)
        ──generate.ts──► RawPatientDocument[] (EHR background from Synthea + scripted home data)
```
`profile.ehr` carries the Synthea problem list, prescriptions, allergies and visits. The app's
medication list is derived from the patient's Synthea asthma prescriptions.

## Clinical rules (analytics)
- Asthma control uses NAEPP/EPR-3 impairment (age ≥ 12). "Symptoms despite good adherence" and
  "uncontrolled with low adherence" only fire when the patient is *not well controlled*.
- Adherence is measured only while the patient uses the app (`measuredThrough`). Not logging is
  not the same as not taking.
- Rates count from enrollment, so new patients aren't judged on a 30-day window.
- Same-day repeat check-ins: the last non-empty answer counts; checkbox answers are unioned.
