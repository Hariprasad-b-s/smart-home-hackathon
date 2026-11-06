/**
 * Photo/video evidence endpoints (see shared/types/api.ts → "AI, voice, media, chat").
 *
 * POST   /patients/:id/media?kind=&caption=&takenAt=&trackerResponseId=&conversationId=  raw body
 * GET    /patients/:id/media?days=
 * GET    /media/:mediaId/content            (HTTP Range supported)
 * DELETE /patients/:id/media/:mediaId
 */
import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { ApiError, MediaItem } from '../../shared/types/api';
import { careTeamFor } from '../data/clinicians';
import { addDays } from '../data/generate';
import type { Store } from '../data/store';
import { localNow } from '../patientApp';
import type { RealtimeHub } from '../realtime/hub';
import { ALLOWED_TYPES, baseType, MAX_CAPTION, validateUpload, type MediaKind } from './validation';

const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_REF = 100;
const err = (error: string): ApiError => ({ error });

/** Single string query param, or undefined; arrays are an error. */
function q(req: Request, name: string): string | undefined | Error {
  const v = req.query[name];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') return new Error(`Query parameter "${name}" must be given once.`);
  return v;
}

export function createMediaRouter(store: Store, hub: RealtimeHub): express.Router {
  const router = express.Router();

  // Raw body parser limited to allowed types; oversize bodies become a 400 (contract).
  const rawParser = express.raw({ type: ALLOWED_TYPES, limit: '100mb' });
  const raw = (req: Request, res: Response, next: NextFunction) =>
    rawParser(req, res, (e?: unknown) => {
      if (!e) return next();
      const status = (e as { status?: number }).status;
      if (status === 413) return void res.status(400).json(err('Upload is too large (videos ≤ 100 MB, photos ≤ 15 MB).'));
      next(e);
    });

  router.post('/patients/:id/media', raw, (req, res) => {
    const doc = store.getPatient(req.params.id as string);
    if (!doc) return void res.status(404).json(err(`Unknown patient "${req.params.id}".`));
    const params: Record<string, string | undefined> = {};
    for (const name of ['kind', 'caption', 'takenAt', 'trackerResponseId', 'conversationId']) {
      const v = q(req, name);
      if (v instanceof Error) return void res.status(400).json(err(v.message));
      params[name] = v;
    }
    const contentType = baseType(req.headers['content-type']);
    const problem = validateUpload(req.body, contentType, params.kind);
    if (problem) return void res.status(400).json(err(problem));
    const caption = params.caption?.trim();
    if (caption && caption.length > MAX_CAPTION) return void res.status(400).json(err(`caption must be at most ${MAX_CAPTION} characters.`));
    const now = localNow(store);
    let takenAt = now.ts;
    if (params.takenAt) {
      if (!LOCAL_ISO.test(params.takenAt) || Number.isNaN(Date.parse(params.takenAt))) return void res.status(400).json(err('"takenAt" must be an ISO timestamp with offset.'));
      takenAt = params.takenAt;
    }
    for (const k of ['trackerResponseId', 'conversationId']) {
      if (params[k] !== undefined && (params[k]!.length === 0 || params[k]!.length > MAX_REF)) return void res.status(400).json(err(`"${k}" must be 1–${MAX_REF} characters.`));
    }

    const bytes = req.body as Buffer;
    const id = randomUUID();
    const item: MediaItem = {
      id,
      patientId: doc.id,
      kind: params.kind as MediaKind,
      contentType,
      sizeBytes: bytes.length,
      takenAt,
      uploadedAt: now.utc,
      date: takenAt.slice(0, 10),
      url: `/api/media/${id}/content`,
    };
    if (caption) item.caption = caption;
    if (params.trackerResponseId) item.trackerResponseId = params.trackerResponseId;
    if (params.conversationId) item.conversationId = params.conversationId;

    try {
      store.media.saveBytes(item, bytes);
      store.record(doc, [{ kind: 'media', data: item }]);
    } catch (e) {
      return void res.status(500).json(err(`Failed to store upload: ${(e as Error).message}`));
    }
    hub.publish({ type: 'media.created', patientId: doc.id, media: item }, { patientId: doc.id, clinicianIds: careTeamFor(doc) });
    res.status(201).json(item);
  });

  router.get('/patients/:id/media', (req, res) => {
    const doc = store.getPatient(req.params.id as string);
    if (!doc) return void res.status(404).json(err(`Unknown patient "${req.params.id}".`));
    const days = q(req, 'days');
    if (days instanceof Error) return void res.status(400).json(err(days.message));
    let items = store.media.list(doc.id);
    if (days !== undefined && days !== '' && days !== 'all') {
      if (!/^\d+$/.test(days) || +days < 1 || +days > 730) return void res.status(400).json(err('"days" must be an integer 1–730 or "all".'));
      const from = addDays(store.today, -(+days - 1));
      items = items.filter((m) => m.date >= from && m.date <= store.today);
    }
    // Photos attached to a check-in are uploaded before the check-in exists; link them here
    // from the check-in's mediaIds so the clinician sees which check-in each belongs to.
    const owner = new Map<string, string>();
    for (const log of doc.dailyLogs) {
      for (const r of log.trackerResponses ?? []) for (const m of r.mediaIds ?? []) owner.set(m, r.id);
    }
    res.json(items.map((m) => (m.trackerResponseId || !owner.has(m.id) ? m : { ...m, trackerResponseId: owner.get(m.id) })));
  });

  router.get('/media/:mediaId/content', (req, res, next) => {
    const item = store.media.get(req.params.mediaId as string);
    if (!item) return void res.status(404).json(err('Media not found.'));
    res.set({
      'Content-Type': item.contentType,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    });
    const file = store.media.filePath(item);
    if (file) {
      res.sendFile(file, { cacheControl: false, lastModified: false, dotfiles: 'allow' }, (e) => {
        if (e && !res.headersSent) {
          res.set('Cache-Control', 'no-store');
          (e as { status?: number }).status === 404 ? res.status(404).json(err('Media file missing.')) : next(e);
        }
      });
      return;
    }
    const buf = store.media.buffer(item.id);
    if (!buf) return void res.status(404).json(err('Media file missing.'));
    res.send(buf);
  });

  router.delete('/patients/:id/media/:mediaId', (req, res) => {
    const doc = store.getPatient(req.params.id as string);
    if (!doc) return void res.status(404).json(err(`Unknown patient "${req.params.id}".`));
    if (!store.deleteMedia(doc, req.params.mediaId as string)) return void res.status(404).json(err('Media not found.'));
    res.json({ ok: true });
  });

  return router;
}
