/**
 * Conversation store. Each conversation is persisted as a Synthea-style FHIR R4 Bundle
 * (type "collection") at <chatDir>/<patientId>/<conversationId>.json, written atomically
 * (temp file + rename). Everything is loaded on startup.
 *
 * `chatDir` null disables persistence; that is the default under Vitest (like the store's runtimeDir).
 *
 * Lead wiring:  resetChat()                  → POST /api/demo/reset
 *               chatFhirResources(patientId) → GET  /api/patients/:id/fhir (append to the bundle)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Conversation } from '../../shared/types/api';
import { toEntry } from '../fhir/bundle';
import { stableUuid, type FhirBundle, type FhirResource } from '../fhir/constants';
import { conversationToFhir, fhirToConversation, referencedResources } from './fhir';

export const DEFAULT_CHAT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'runtime', 'chat');
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function resolveChatDir(dir?: string | null): string | null {
  if (dir !== undefined) return dir;
  return process.env.VITEST ? null : DEFAULT_CHAT_DIR;
}

export class ChatStore {
  private readonly convs = new Map<string, Conversation>();
  private readonly patientFhirIds = new Map<string, string>();

  constructor(readonly dir: string | null) {
    if (!dir || !existsSync(dir)) return;
    for (const patientId of readdirSync(dir)) {
      const pdir = path.join(dir, patientId);
      if (!SAFE_ID.test(patientId) || !statSync(pdir).isDirectory()) continue;
      for (const f of readdirSync(pdir).filter((x) => x.endsWith('.json'))) {
        try {
          const bundle = JSON.parse(readFileSync(path.join(pdir, f), 'utf8')) as FhirBundle;
          const { conversation, patientFhirId } = fhirToConversation(bundle.entry.map((e) => e.resource));
          this.convs.set(conversation.id, conversation);
          this.patientFhirIds.set(conversation.id, patientFhirId);
        } catch (err) {
          console.warn(`[chat] Ignoring unreadable ${patientId}/${f}: ${(err as Error).message}`);
        }
      }
    }
  }

  get(id: string): Conversation | undefined {
    return this.convs.get(id);
  }

  all(): Conversation[] {
    return [...this.convs.values()];
  }

  /** Newest first (by last activity). */
  listForPatient(patientId: string): Conversation[] {
    return this.all()
      .filter((c) => c.patientId === patientId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
  }

  /** Insert or update a conversation and persist its bundle. */
  save(conversation: Conversation, patientFhirId: string): void {
    this.convs.set(conversation.id, conversation);
    this.patientFhirIds.set(conversation.id, patientFhirId);
    if (!this.dir) return;
    if (!SAFE_ID.test(conversation.patientId) || !SAFE_ID.test(conversation.id)) throw new Error('Unsafe id for chat storage');
    const pdir = path.join(this.dir, conversation.patientId);
    mkdirSync(pdir, { recursive: true });
    const file = path.join(pdir, `${conversation.id}.json`);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.bundle(conversation), null, 2) + '\n');
    renameSync(tmp, file);
  }

  bundle(conversation: Conversation): FhirBundle {
    const pfid = this.patientFhirIds.get(conversation.id) ?? conversation.patientId;
    return {
      resourceType: 'Bundle',
      id: stableUuid('smart-home', 'chat-bundle', conversation.id),
      type: 'collection',
      timestamp: conversation.updatedAt,
      entry: [...conversationToFhir(conversation, pfid), ...referencedResources([conversation])].map(toEntry),
    };
  }

  /** Chat resources for a patient's FHIR export (Device/Practitioners once, then each conversation). */
  fhirResources(patientId: string): FhirResource[] {
    const convs = this.listForPatient(patientId).reverse();
    return [
      ...referencedResources(convs),
      ...convs.flatMap((c) => conversationToFhir(c, this.patientFhirIds.get(c.id) ?? c.patientId)),
    ];
  }

  /** Drop every conversation (memory and disk). */
  clear(): void {
    this.convs.clear();
    this.patientFhirIds.clear();
    if (!this.dir || !existsSync(this.dir)) return;
    for (const patientId of readdirSync(this.dir)) {
      const pdir = path.join(this.dir, patientId);
      if (!SAFE_ID.test(patientId) || !statSync(pdir).isDirectory()) continue;
      for (const f of readdirSync(pdir)) if (f.endsWith('.json') || f.endsWith('.tmp')) rmSync(path.join(pdir, f));
      if (!readdirSync(pdir).length) rmSync(pdir, { recursive: true });
    }
  }
}

// ───────────────────────────────── Module instance (wired by the lead) ─────────────────────────────────

let active: ChatStore | null = null;
const resetHooks = new Set<() => void>();

/** Create (and make active) the chat store. Called by createChatRouter. */
export function initChatStore(dir?: string | null): ChatStore {
  active = new ChatStore(resolveChatDir(dir));
  return active;
}

export function chatStore(): ChatStore {
  return (active ??= new ChatStore(resolveChatDir()));
}

/** Extra state to clear on reset (e.g. the AI rate limiter). */
export function onChatReset(hook: () => void): void {
  resetHooks.add(hook);
}

/** Drop every conversation and escalation (memory + runtime files). Wire into POST /api/demo/reset. */
export function resetChat(): void {
  chatStore().clear();
  for (const h of resetHooks) h();
}

/** FHIR resources (Communication, Task, Basic, Device, Practitioner) for a patient's export. */
export function chatFhirResources(patientId: string): FhirResource[] {
  return chatStore().fhirResources(patientId);
}
