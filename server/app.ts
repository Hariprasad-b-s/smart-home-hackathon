/**
 * Express 5 app implementing the HTTP contract in shared/types/api.ts.
 * No `listen` here — see server/index.ts — so tests can drive it with supertest.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createChatRouter } from './chat/routes';
import { chatFhirResources, resetChat } from './chat/store';
import { toEntry } from './fhir/bundle';
import { createMediaRouter } from './media/routes';
import { createRealtimeHub, type RealtimeHub } from './realtime/hub';
import express, { type NextFunction, type Request, type Response } from 'express';
import { buildPatientListItem, buildPatientSummary, summaryToCsv } from '../shared/analytics';
import type { ApiError, HealthResponse, PatientListResponse } from '../shared/types/api';
import type { SummaryOptions } from '../shared/types/summary';
import { careTeamFor, CLINICIANS, validatePreferences } from './data/clinicians';
import type { Store } from './data/store';
import { patientBundle } from './fhir/bundle';
import { questionnaireBundle } from './fhir/questionnaires';
import { buildPatientAppHome, postMedicationDose, postSpirometrySession, postTrackerResponse, type HandlerResult } from './patientApp';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type ParsedWindow = { ok: true; days: number | 'all'; end: string } | { ok: false; error: string };

function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Validate `days` (1–730 or "all", default 30) and `end` (YYYY-MM-DD, default today). */
export function parseWindow(query: Request['query'], today: string): ParsedWindow {
  const rawDays = query.days;
  const rawEnd = query.end;
  if (Array.isArray(rawDays) || (rawDays !== undefined && typeof rawDays !== 'string')) {
    return { ok: false, error: 'Query parameter "days" must be given once.' };
  }
  if (Array.isArray(rawEnd) || (rawEnd !== undefined && typeof rawEnd !== 'string')) {
    return { ok: false, error: 'Query parameter "end" must be given once.' };
  }
  let days: number | 'all' = 30;
  if (rawDays !== undefined && rawDays !== '') {
    if (rawDays === 'all') days = 'all';
    else if (/^\d+$/.test(rawDays) && +rawDays >= 1 && +rawDays <= 730) days = +rawDays;
    else return { ok: false, error: `Invalid "days": expected an integer 1–730 or "all", got "${rawDays}".` };
  }
  let end = today;
  if (rawEnd !== undefined && rawEnd !== '') {
    if (!isValidIsoDate(rawEnd)) return { ok: false, error: `Invalid "end": expected YYYY-MM-DD, got "${rawEnd}".` };
    end = rawEnd;
  }
  return { ok: true, days, end };
}

const errorBody = (error: string): ApiError => ({ error });
const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface AppOptions {
  /** When set (production), serve this built client directory with an SPA fallback. */
  staticDir?: string;
  /** Realtime hub (injectable for tests). */
  hub?: RealtimeHub;
}

export function createApp(store: Store, opts: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  const api = express.Router();
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '256kb' }));
  const hub = opts.hub ?? createRealtimeHub();

  api.get('/health', (_req, res) => {
    const body: HealthResponse = { ok: true, patients: store.listPatients().length, today: store.today };
    res.json(body);
  });

  api.get('/trackers', (_req, res) => {
    res.json(store.trackers);
  });

  api.get('/patients', (_req, res) => {
    try {
      const patients = store
        .listPatients()
        .map((doc) => buildPatientListItem(doc, store.trackers, store.today))
        .sort((a, b) => (b.attentionScore ?? 0) - (a.attentionScore ?? 0));
      const body: PatientListResponse = { today: store.today, patients };
      res.json(body);
    } catch (e) {
      res.status(500).json(errorBody(`Failed to build patient list: ${errMessage(e)}`));
    }
  });

  api.get('/patients/:id/summary', (req, res) => {
    const doc = store.getPatient(req.params.id);
    if (!doc) return void res.status(404).json(errorBody(`Unknown patient "${req.params.id}".`));
    const w = parseWindow(req.query, store.today);
    if (!w.ok) return void res.status(400).json(errorBody(w.error));
    try {
      const opts: SummaryOptions = { days: w.days, end: w.end, today: store.today };
      res.json(buildPatientSummary(doc, store.trackers, opts));
    } catch (e) {
      res.status(500).json(errorBody(`Failed to build summary: ${errMessage(e)}`));
    }
  });

  api.get('/patients/:id/raw', (req, res) => {
    const doc = store.getPatient(req.params.id);
    if (!doc) return void res.status(404).json(errorBody(`Unknown patient "${req.params.id}".`));
    res.json(doc);
  });

  api.get('/patients/:id/export.csv', (req, res) => {
    const doc = store.getPatient(req.params.id);
    if (!doc) return void res.status(404).json(errorBody(`Unknown patient "${req.params.id}".`));
    const w = parseWindow(req.query, store.today);
    if (!w.ok) return void res.status(400).json(errorBody(w.error));
    let csv: string;
    try {
      const summary = buildPatientSummary(doc, store.trackers, { days: w.days, end: w.end, today: store.today });
      csv = summaryToCsv(summary);
    } catch (e) {
      return void res.status(500).json(errorBody(`Failed to export CSV: ${errMessage(e)}`));
    }
    const last = doc.profile.lastName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'patient';
    const daysPart = w.days === 'all' ? 'all' : `${w.days}d`;
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${last}-${daysPart}-${w.end}.csv"`);
    res.send(csv);
  });

  // ── Patient app ──────────────────────────────────────────────────────────
  api.get('/patients/:id/app/home', (req, res) => {
    const doc = store.getPatient(req.params.id);
    if (!doc) return void res.status(404).json(errorBody(`Unknown patient "${req.params.id}".`));
    try {
      res.json(buildPatientAppHome(doc, store.trackers, store.today));
    } catch (e) {
      res.status(500).json(errorBody(`Failed to build home: ${errMessage(e)}`));
    }
  });

  const write =
    (
      handler: (s: Store, doc: NonNullable<ReturnType<Store['getPatient']>>, body: unknown) => HandlerResult,
      onCreated?: (doc: NonNullable<ReturnType<Store['getPatient']>>) => void,
    ) =>
    (req: Request, res: Response) => {
      const doc = store.getPatient(String(req.params.id));
      if (!doc) return void res.status(404).json(errorBody(`Unknown patient "${req.params.id}".`));
      if (!req.is('application/json')) return void res.status(400).json(errorBody('Body must be JSON (Content-Type: application/json).'));
      try {
        const out = handler(store, doc, req.body);
        res.status(out.status).json(out.body);
        if (out.status === 201) onCreated?.(doc);
      } catch (e) {
        res.status(500).json(errorBody(`Write failed: ${errMessage(e)}`));
      }
    };
  api.post(
    '/patients/:id/tracker-responses',
    write(postTrackerResponse, (doc) => hub.publish({ type: 'checkin.created', patientId: doc.id }, { patientId: doc.id, clinicianIds: careTeamFor(doc) })),
  );
  api.post('/patients/:id/medication-administrations', write(postMedicationDose));
  api.post('/patients/:id/spirometry-sessions', write(postSpirometrySession));

  api.post('/demo/reset', (_req, res) => {
    store.reset();
    resetChat();
    res.json({ ok: true });
  });

  // ── Clinician preferences ────────────────────────────────────────────────
  api.get('/clinicians', (_req, res) => {
    res.json(CLINICIANS);
  });
  api.get('/clinicians/:clinicianId/preferences', (req, res) => {
    const id = req.params.clinicianId;
    if (!CLINICIANS.some((c) => c.id === id)) return void res.status(404).json(errorBody(`Unknown clinician "${id}".`));
    res.json(store.clinicianPrefs.get(id));
  });
  api.put('/clinicians/:clinicianId/preferences', (req, res) => {
    const id = req.params.clinicianId;
    if (!CLINICIANS.some((c) => c.id === id)) return void res.status(404).json(errorBody(`Unknown clinician "${id}".`));
    if (!req.is('application/json')) return void res.status(400).json(errorBody('Body must be JSON (Content-Type: application/json).'));
    const prefs = validatePreferences(req.body, id);
    if (typeof prefs === 'string') return void res.status(400).json(errorBody(prefs));
    prefs.updatedAt = store.now().toISOString();
    res.json(store.clinicianPrefs.put(prefs));
  });

  // ── FHIR ─────────────────────────────────────────────────────────────────
  api.get('/patients/:id/fhir', (req, res) => {
    const doc = store.getPatient(req.params.id);
    if (!doc) return void res.status(404).json(errorBody(`Unknown patient "${req.params.id}".`));
    const bundle = patientBundle(doc, store.trackers, store.today, store.media.list(doc.id));
    // Chat history and escalations (Communication / Task) from the AI & Chat module.
    bundle.entry.push(...chatFhirResources(doc.id).map(toEntry));
    res.type('application/fhir+json').send(JSON.stringify(bundle));
  });
  api.get('/fhir/Questionnaire', (_req, res) => {
    res.type('application/fhir+json').send(JSON.stringify(questionnaireBundle(store.trackers)));
  });

  // Feature modules (each owns its own router file).
  api.use(createMediaRouter(store, hub));
  api.use(createChatRouter(store, hub));

  // Unknown /api routes → JSON 404.
  api.use((req, res) => {
    res.status(404).json(errorBody(`Not found: ${req.method} ${req.baseUrl}${req.path}`));
  });

  app.use('/api', api);

  if (opts.staticDir) {
    const dir = path.resolve(opts.staticDir);
    const clinicianHtml = path.join(dir, 'index.html');
    const patientHtml = path.join(dir, 'patient', 'index.html');
    app.use(express.static(dir, { index: false }));
    // SPA fallbacks: /patient and /patient/* → patient app; every other non-/api GET → clinician view.
    app.use((req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path === '/api' || req.path.startsWith('/api/')) return next();
      const html = req.path === '/patient' || req.path.startsWith('/patient/') ? patientHtml : clinicianHtml;
      if (!existsSync(html)) return void res.status(404).type('text/plain').send('Client not built. Run `npm run build`.');
      res.sendFile(html);
    });
  }

  app.use(jsonErrorHandler);
  return app;
}

/** JSON error handler; mount last (after any static / SPA handlers). */
export function jsonErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return next(err);
  const status =
    typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number'
      ? (err as { status: number }).status
      : 500;
  res.status(status >= 400 && status < 600 ? status : 500).json(errorBody(status >= 500 ? `Internal error: ${errMessage(err)}` : errMessage(err)));
}
