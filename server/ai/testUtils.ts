/** Test helpers: a fake Claude client (tests never touch the network). */
import { createAiEngine, type AiEngine, type BetaCreateParams, type BetaMessage, type ClaudeClient } from './engine';

export type FakeContent = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown };

export function fakeMessage(content: FakeContent[], stop_reason = 'end_turn', extra: Record<string, unknown> = {}): BetaMessage {
  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 10 },
    ...extra,
  } as unknown as BetaMessage;
}

export interface FakeClient extends ClaudeClient {
  calls: BetaCreateParams[];
}

/** Each call shifts the next response (or throws it if it's an Error). */
export function fakeClient(...responses: (BetaMessage | Error)[]): FakeClient {
  const calls: BetaCreateParams[] = [];
  return {
    calls,
    async createMessage(params) {
      calls.push(params);
      const next = responses.shift();
      if (!next) throw new Error('fake client: no response queued');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

export function fakeEngine(client: ClaudeClient | null): AiEngine {
  return createAiEngine({ env: {}, client });
}
