import { describe, expect, it } from 'vitest';
import { createAiEngine } from './engine';

const fake = { createMessage: async () => { throw new Error('unused'); } } as never;

describe('AI engine configuration', () => {
  it('defaults to Claude Sonnet 5.5 at medium effort', () => {
    const e = createAiEngine({ env: {}, client: fake });
    expect(e.model).toBe('claude-sonnet-5-5');
    expect(e.effort).toBe('medium');
    expect(e.status()).toMatchObject({ engine: 'claude', model: 'claude-sonnet-5-5' });
  });
  it('honours SMART_HOME_AI_MODEL / SMART_HOME_AI_EFFORT and ignores invalid effort', () => {
    expect(createAiEngine({ env: { SMART_HOME_AI_MODEL: 'claude-opus-5-5', SMART_HOME_AI_EFFORT: 'LOW' }, client: fake })).toMatchObject({ model: 'claude-opus-5-5', effort: 'low' });
    expect(createAiEngine({ env: { SMART_HOME_AI_EFFORT: 'turbo' }, client: fake }).effort).toBe('medium');
  });
  it('falls back to rules without credentials or when forced off', () => {
    expect(createAiEngine({ env: {} }).status().engine).toBe('rules');
    expect(createAiEngine({ env: { ANTHROPIC_API_KEY: 'x', SMART_HOME_AI: 'off' } }).status().engine).toBe('rules');
  });
});
