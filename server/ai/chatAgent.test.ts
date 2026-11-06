import { describe, expect, it } from 'vitest';
import type { Conversation } from '../../shared/types/api';
import { createStore } from '../data/store';
import { TRACKER_IDS } from '../data/trackers';
import { replyToPatient, ruleReply } from './chatAgent';
import { buildChatContext } from './context';
import { RATE_LIMIT_NOTE } from './engine';
import { fakeClient, fakeEngine, fakeMessage } from './testUtils';

const store = createStore({ today: '2026-11-06' });
const doc = store.listPatients().find((p) => p.trackers.some((t) => t.trackerId === TRACKER_IDS.asthma && t.active))!;
const ctx = buildChatContext(doc, store.trackers, store.today);

function conv(...texts: string[]): Conversation {
  return {
    id: 'c1',
    patientId: doc.id,
    patientName: 'Test',
    status: 'ai',
    createdAt: '2026-11-06T10:00:00.000Z',
    updatedAt: '2026-11-06T10:00:00.000Z',
    topic: '',
    messages: texts.map((text, i) => ({
      id: `m${i}`,
      conversationId: 'c1',
      author: i % 2 === 0 ? 'patient' : 'ai',
      authorName: i % 2 === 0 ? 'Pat' : 'SMART@Home helper (AI)',
      text,
      createdAt: '2026-11-06T10:00:00.000Z',
    })),
    unreadForPatient: 0,
    unreadForClinician: {},
  };
}

describe('chat context', () => {
  it('is compact and built from the summary + home payload', () => {
    expect(ctx.firstName).toBe(doc.profile.firstName);
    expect(ctx.conditions).toContain('Asthma');
    expect(ctx.scheduledMeds.length + ctx.asNeededMeds.length).toBeGreaterThan(0);
    expect(ctx.allPlanSteps?.red.length).toBeGreaterThan(0);
  });
});

describe('replyToPatient with Claude (fake client)', () => {
  it('normal answer: request shape and text reply', async () => {
    const client = fakeClient(fakeMessage([{ type: 'text', text: 'Tap Check in on the home screen, then answer a few questions.' }]));
    const reply = await replyToPatient(conv('hi', 'Hi! How can I help?', 'how do I do a check in?'), ctx, fakeEngine(client));
    expect(reply.engine).toBe('claude');
    expect(reply.text).toMatch(/Check in/);
    expect(reply.escalate).toBeUndefined();
    expect(reply.suggestedActions).toContain('check_in');

    const req = client.calls[0] as unknown as Record<string, any>;
    expect(req.model).toBe('claude-opus-5-5');
    expect(req.output_config).toEqual({ effort: 'low' });
    expect(req.thinking).toEqual({ type: 'adaptive' });
    expect(req.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(req.fallbacks).toBe('default');
    expect(req.tool_choice).toEqual({ type: 'auto' });
    expect(req.tools[0].name).toBe('escalate_to_care_team');
    expect(req.tools[0].strict).toBe(true);
    expect(req.tools[0].input_schema.additionalProperties).toBe(false);
    expect(req.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(req.system[0].text).not.toContain(doc.profile.firstName); // stable prompt, no patient data
    // One self-contained user turn: context, history, latest message.
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe('user');
    expect(req.messages[0].content).toContain('<patient_context>');
    expect(req.messages[0].content).toContain(`First name: ${doc.profile.firstName}`);
    expect(req.messages[0].content).toContain('Helper (AI): Hi! How can I help?');
    expect(req.messages[0].content).toMatch(/<latest_patient_message>\nhow do I do a check in\?/);
  });

  it('tool-use escalation', async () => {
    const client = fakeClient(
      fakeMessage(
        [
          { type: 'text', text: "That's a question for your care team. I'm sharing this chat with them now." },
          {
            type: 'tool_use',
            id: 'tu1',
            name: 'escalate_to_care_team',
            input: { reason: 'Asks about taking extra puffs', urgency: 'soon', summary_for_clinician: 'Patient asks whether to take 4 extra puffs.' },
          },
        ],
        'tool_use',
      ),
    );
    const reply = await replyToPatient(conv('can I take 4 extra puffs of my inhaler?'), ctx, fakeEngine(client));
    expect(reply.engine).toBe('claude');
    expect(reply.escalate).toEqual({ reason: 'Asks about taking extra puffs', urgency: 'soon', summary: 'Patient asks whether to take 4 extra puffs.' });
    expect(reply.text).toMatch(/care team/);
    expect(reply.suggestedActions ?? []).not.toContain('talk_to_care_team');
  });

  it('refusal falls back to rules', async () => {
    const client = fakeClient(fakeMessage([], 'refusal', { stop_details: { type: 'refusal', category: 'general_harms' } }));
    const reply = await replyToPatient(conv('what zone am I in?'), ctx, fakeEngine(client));
    expect(client.calls).toHaveLength(1);
    expect(reply.engine).toBe('rules');
    expect(reply.text).toMatch(/zone/i);
  });

  it('API errors and empty replies fall back to rules', async () => {
    const a = await replyToPatient(conv('what are my medicines?'), ctx, fakeEngine(fakeClient(new Error('boom'))));
    expect(a.engine).toBe('rules');
    const b = await replyToPatient(conv('what are my medicines?'), ctx, fakeEngine(fakeClient(fakeMessage([]))));
    expect(b.engine).toBe('rules');
    expect(b.suggestedActions).toEqual(['medicines']);
  });

  it('safety short-circuits before the model', async () => {
    const client = fakeClient(); // would throw if called
    const reply = await replyToPatient(conv("I can't breathe and my inhaler isn't helping"), ctx, fakeEngine(client));
    expect(client.calls).toHaveLength(0);
    expect(reply.safety?.level).toBe('emergency');
    expect(reply.escalate?.urgency).toBe('urgent');
    expect(reply.text).toMatch(/911/);
  });

  it('rate limit → rules plus a friendly note', async () => {
    const engine = fakeEngine(fakeClient());
    for (let i = 0; i < 20; i++) engine.limiter.take(doc.id);
    const reply = await replyToPatient(conv('hello'), ctx, engine);
    expect(reply.engine).toBe('rules');
    expect(reply.text).toContain(RATE_LIMIT_NOTE);
  });
});

describe('rule engine intents', () => {
  it('zone uses the patient’s own plan steps', () => {
    const r = ruleReply('what zone am I in', { ...ctx, zone: 'yellow', planSteps: ['Use your rescue inhaler the way your action plan says.'] });
    expect(r.text).toMatch(/Yellow zone/);
    expect(r.text).toMatch(/rescue inhaler the way your action plan says/);
    expect(r.escalate).toBeUndefined();
  });
  it('breathing test how-to', () => expect(ruleReply('how do I do the breathing test?', ctx).suggestedActions).toEqual(['breathing_test']));
  it('check-in how-to', () => expect(ruleReply('how do i check in', ctx).suggestedActions).toEqual(['check_in']));
  it('marking doses', () => expect(ruleReply('how do I mark my inhaler as taken', ctx).suggestedActions).toEqual(['medicines']));
  it('medicine list', () => {
    const r = ruleReply('what are my medicines?', ctx);
    expect(r.text).toContain(ctx.scheduledMeds[0]?.name ?? ctx.asNeededMeds[0].name);
    expect(r.escalate).toBeUndefined();
  });
  it('greeting and thanks', () => {
    expect(ruleReply('hey', ctx).text).toMatch(/AI assistant/);
    expect(ruleReply('thanks!', ctx).text).toMatch(/welcome/);
  });
  it('says it is an AI when asked', () => expect(ruleReply('are you a real person?', ctx).text).toMatch(/AI assistant, not a person/));
  it('asking for a person escalates', () => expect(ruleReply('can I talk to a nurse', ctx).escalate?.urgency).toBe('routine'));
  it('dose questions escalate and never give dosing advice', () => {
    const r = ruleReply('should I take extra puffs of albuterol?', ctx);
    expect(r.escalate).toBeDefined();
    expect(r.text).toMatch(/can’t give advice about medicine doses/);
    expect(r.text).not.toMatch(/\btake \d|\bpuffs every\b/);
  });
  it('side effects escalate soon', () => expect(ruleReply('my inhaler makes me shaky, side effects?', ctx).escalate?.urgency).toBe('soon'));
  it('worsening symptoms escalate soon', () => expect(ruleReply('my cough is getting worse', ctx).escalate?.urgency).toBe('soon'));
  it('unknown questions offer the care team', () => {
    const r = ruleReply('what is the capital of France', ctx);
    expect(r.escalate).toBeUndefined();
    expect(r.suggestedActions).toEqual(['talk_to_care_team']);
  });
});
