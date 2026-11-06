/**
 * Photo/video evidence storage: bytes on disk under server/data/runtime/media/<patientId>/<id>.<ext>
 * (or in memory when `dir` is null) plus an in-memory registry of MediaItems. The registry is
 * rebuilt on startup from the FHIR Media resources in each patient's runtime bundle.
 */
import { existsSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MediaItem } from '../../shared/types/api';
import { EXTENSION } from './validation';

export const DEFAULT_MEDIA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'runtime', 'media');

interface MediaRecord {
  item: MediaItem;
  deleted: boolean;
}

export class MediaStore {
  private readonly records = new Map<string, MediaRecord>();
  private readonly memory = new Map<string, Buffer>();

  constructor(readonly dir: string | null) {}

  register(item: MediaItem, deleted = false): void {
    this.records.set(item.id, { item, deleted });
  }

  /** Active (non-deleted) item by id. */
  get(id: string): MediaItem | undefined {
    const r = this.records.get(id);
    return r && !r.deleted ? r.item : undefined;
  }

  /** Active items of a patient, newest first. */
  list(patientId: string): MediaItem[] {
    return [...this.records.values()]
      .filter((r) => !r.deleted && r.item.patientId === patientId)
      .map((r) => r.item)
      .sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt) || b.uploadedAt.localeCompare(a.uploadedAt));
  }

  filePath(item: MediaItem): string | null {
    if (!this.dir) return null;
    return path.resolve(this.dir, item.patientId, `${item.id}.${EXTENSION[item.contentType] ?? 'bin'}`);
  }

  /** In-memory bytes (only when persistence is disabled). */
  buffer(id: string): Buffer | undefined {
    return this.memory.get(id);
  }

  /** Write the bytes atomically (temp file + rename). */
  saveBytes(item: MediaItem, bytes: Buffer): void {
    const file = this.filePath(item);
    if (!file) {
      this.memory.set(item.id, bytes);
      return;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, file);
  }

  /** Delete the bytes and mark the item deleted. */
  remove(id: string): void {
    const r = this.records.get(id);
    if (!r) return;
    r.deleted = true;
    this.memory.delete(id);
    const file = this.filePath(r.item);
    if (file && existsSync(file)) unlinkSync(file);
  }

  /** Forget the registry (files stay) — used before replaying FHIR bundles. */
  resetRegistry(): void {
    this.records.clear();
  }

  /** Remove every item and file (demo reset). */
  clearAll(): void {
    this.records.clear();
    this.memory.clear();
    if (this.dir && existsSync(this.dir)) rmSync(this.dir, { recursive: true, force: true });
  }
}
