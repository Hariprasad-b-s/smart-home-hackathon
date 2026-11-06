/**
 * Claude engine for the SMART@Home AI features (demo only, synthetic data).
 *
 * - A real Anthropic client is created only when ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is set
 *   and SMART_HOME_AI is not "off". Otherwise every feature uses the deterministic rule engine.
 * - The client is injected behind a tiny interface so tests use a fake (tests never hit the network).
 * - Every call goes through `callClaude`, which adds the server-side refusal fallback, checks
 *   stop_reason before content is read, and turns ANY failure into `null` (caller falls back to rules).
 * - A per-patient rate limit (20 calls / 10 min) protects spend.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AiStatus } from '../../shared/types/api';

/** Default model and effort; override with SMART_HOME_AI_MODEL / SMART_HOME_AI_EFFORT. */
export const CLAUDE_MODEL = 'claude-sonnet-5-5';
export const CLAUDE_EFFORT: AiEffort = 'medium';
export type AiEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: AiEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const AI_NOTICE = 'Demo AI on synthetic data. Not for real patient information. Not medical advice.';
/** Server-side refusal fallback ("default" routing by refusal category). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
export type BetaCreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** The only surface of the SDK the AI module uses (inject a fake in tests). */
export interface ClaudeClient {
  createMessage(params: BetaCreateParams): Promise<BetaMessage>;
}

/** Wrap a real SDK client. */
export function sdkClaudeClient(client: Anthropic): ClaudeClient {
  return { createMessage: (params) => client.beta.messages.create(params) };
}

export interface RateLimiter {
  /** Consume one AI call for this patient; false when over the limit. */
  take(patientId: string): boolean;
  reset(): void;
}

export function createRateLimiter(limit = 20, windowMs = 10 * 60 * 1000, now: () => number = Date.now): RateLimiter {
  const calls = new Map<string, number[]>();
  return {
    take(patientId) {
      const t = now();
      const recent = (calls.get(patientId) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= limit) {
        calls.set(patientId, recent);
        return false;
      }
      recent.push(t);
      calls.set(patientId, recent);
      return true;
    },
    reset: () => calls.clear(),
  };
}

export interface AiEngine {
  /** null → rule engine only. */
  client: ClaudeClient | null;
  model: string;
  /** output_config.effort for every request (chat and voice). */
  effort: AiEffort;
  limiter: RateLimiter;
  status(): AiStatus;
}

export interface AiEngineOptions {
  /** Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Inject a client (tests). `null` forces rules. Undefined → build from env. */
  client?: ClaudeClient | null;
  limiter?: RateLimiter;
}

export function hasCredentials(env: Record<string, string | undefined>): boolean {
  return !!(env.ANTHROPIC_API_KEY?.trim() || env.ANTHROPIC_AUTH_TOKEN?.trim());
}

export function createAiEngine(opts: AiEngineOptions = {}): AiEngine {
  const env = opts.env ?? process.env;
  let client: ClaudeClient | null = null;
  if (env.SMART_HOME_AI?.trim().toLowerCase() === 'off') client = null;
  else if (opts.client !== undefined) client = opts.client;
  else if (hasCredentials(env)) {
    const apiKey = env.ANTHROPIC_API_KEY?.trim() || null;
    const authToken = env.ANTHROPIC_AUTH_TOKEN?.trim() || null;
    client = sdkClaudeClient(new Anthropic({ apiKey, authToken, timeout: 30_000, maxRetries: 1 }));
  }
  const model = env.SMART_HOME_AI_MODEL?.trim() || CLAUDE_MODEL;
  const wanted = env.SMART_HOME_AI_EFFORT?.trim().toLowerCase() as AiEffort | undefined;
  const effort: AiEffort = wanted && EFFORTS.includes(wanted) ? wanted : CLAUDE_EFFORT;
  return {
    client,
    model,
    effort,
    limiter: opts.limiter ?? createRateLimiter(),
    status: () => (client ? { engine: 'claude', model, notice: AI_NOTICE } : { engine: 'rules', notice: AI_NOTICE }),
  };
}

export type ClaudeOutcome =
  | { ok: true; message: BetaMessage }
  | { ok: false; reason: 'no-client' | 'rate-limited' | 'refusal' | 'max-tokens' | 'error' };

/**
 * One Claude call with the refusal fallback opt-in. Never throws.
 * `params` must not carry `betas` / `fallbacks`; they are added here.
 */
export async function callClaude(engine: AiEngine, patientId: string, params: BetaCreateParams, label: string): Promise<ClaudeOutcome> {
  if (!engine.client) return { ok: false, reason: 'no-client' };
  if (!engine.limiter.take(patientId)) return { ok: false, reason: 'rate-limited' };
  try {
    const message = await engine.client.createMessage({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' });
    if (message.stop_reason === 'refusal') {
      console.warn(`[ai:${label}] Claude declined (category ${message.stop_details?.category ?? 'unknown'}); using rules.`);
      return { ok: false, reason: 'refusal' };
    }
    if (message.stop_reason === 'max_tokens') {
      console.warn(`[ai:${label}] Claude hit max_tokens; using rules.`);
      return { ok: false, reason: 'max-tokens' };
    }
    return { ok: true, message };
  } catch (err) {
    // Typed SDK errors, most specific first (APIConnectionError is a subclass of APIError in TS).
    if (err instanceof Anthropic.AuthenticationError) console.warn(`[ai:${label}] Invalid Anthropic credentials; using rules.`);
    else if (err instanceof Anthropic.RateLimitError) console.warn(`[ai:${label}] Anthropic rate limit; using rules.`);
    else if (err instanceof Anthropic.BadRequestError) console.warn(`[ai:${label}] Bad request: ${err.message}`);
    else if (err instanceof Anthropic.APIConnectionTimeoutError) console.warn(`[ai:${label}] Anthropic request timed out; using rules.`);
    else if (err instanceof Anthropic.APIConnectionError) console.warn(`[ai:${label}] Network error reaching Anthropic; using rules.`);
    else if (err instanceof Anthropic.APIError) console.warn(`[ai:${label}] Anthropic API error ${err.status}: ${err.message}`);
    else console.warn(`[ai:${label}] Unexpected AI error: ${(err as Error)?.message ?? String(err)}`);
    return { ok: false, reason: 'error' };
  }
}

/** Concatenated text blocks of a response. */
export function responseText(message: BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

export const RATE_LIMIT_NOTE = "(I'm using quick built-in answers for a few minutes because there have been lots of messages.)";
