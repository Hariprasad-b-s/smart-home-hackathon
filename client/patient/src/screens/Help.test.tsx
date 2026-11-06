// @vitest-environment jsdom
import '../test/setup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ChatMessage, Conversation } from '@shared/types/api';
import { MOCK_CLINICIANS } from '../dev/mockAi';
import { mockHomeFor } from '../dev/mock';
import { mockFetch } from '../test/setup';
import { App } from '../App';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  close() {
    this.readyState = 2;
  }
  emit(data: unknown) {
    act(() => this.onmessage?.({ data: JSON.stringify(data) }));
  }
}

const NOW = '2026-11-06T10:00:00.000-05:00';
const m = (over: Partial<ChatMessage>): ChatMessage => ({
  id: `m-${Math.random()}`,
  conversationId: 'c1',
  author: 'patient',
  authorName: 'Jordan Reyes',
  text: '',
  createdAt: NOW,
  ...over,
});
const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  patientId: 'demo-jordan',
  patientName: 'Jordan Reyes',
  status: 'ai',
  createdAt: NOW,
  updatedAt: NOW,
  topic: 'How do I do the breathing test?',
  messages: [],
  unreadForPatient: 0,
  unreadForClinician: {},
  ...over,
});

const askedBreathing = m({ text: 'How do I do the breathing test?' });
const aiReply = m({
  author: 'ai',
  authorName: 'SMART@Home helper (AI)',
  text: 'Breathe in deep, then blast out hard.',
  suggestedActions: ['breathing_test', 'talk_to_care_team'],
});

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('smart-home-patient-id', 'demo-jordan');
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

function baseRoutes(state: { convs: Conversation[]; current?: Conversation }) {
  return {
    'GET /api/patients/demo-jordan/app/home': mockHomeFor('demo-jordan'),
    'GET /api/ai/status': { engine: 'rules', notice: 'Demo only.' },
    'GET /api/clinicians': MOCK_CLINICIANS,
    'GET /api/patients/demo-jordan/conversations': () => state.convs,
    'GET /api/conversations/c1': () => state.current,
    'POST /api/conversations/c1/read': () => ({ ...state.current!, unreadForPatient: 0 }),
  };
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

describe('Help chat', () => {
  it('a quick question starts a chat and shows the labelled AI reply', async () => {
    const state: { convs: Conversation[]; current?: Conversation } = { convs: [] };
    const started = conv({ messages: [askedBreathing, aiReply] });
    const { calls } = mockFetch({
      ...baseRoutes(state),
      'POST /api/patients/demo-jordan/conversations': () => {
        state.convs = [started];
        state.current = started;
        return started;
      },
    });
    renderAt('/help');
    expect(await screen.findByRole('heading', { name: 'Ask a quick question' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Offline helper/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'How do I do the breathing test?' }));
    await screen.findByTestId('chat-status'); // navigated into the thread
    expect(screen.getByText('Breathe in deep, then blast out hard.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/conversations'))!.body).toEqual({
      author: 'patient',
      text: 'How do I do the breathing test?',
    });
    expect(screen.getByText('SMART@Home helper · AI')).toBeInTheDocument();
    expect(screen.getByText("I'm an AI helper, not a doctor. I can't change your medicines.")).toBeInTheDocument();
    expect(screen.getByTestId('chat-status')).toHaveTextContent('Chatting with the AI helper');
    expect(screen.getByRole('button', { name: 'Do a breathing test' })).toBeInTheDocument();
  });

  it('sending shows an optimistic bubble, then the reply; failures can be retried', async () => {
    const state = { convs: [conv({ messages: [askedBreathing, aiReply] })], current: conv({ messages: [askedBreathing, aiReply] }) };
    let fail = true;
    mockFetch(
      {
        ...baseRoutes(state),
        'POST /api/conversations/c1/messages': (b: unknown) => {
          if (fail) return { error: 'Server busy' };
          const text = (b as { text: string }).text;
          state.current = conv({ messages: [askedBreathing, aiReply, m({ text }), m({ author: 'ai', authorName: 'AI', text: 'Got it, thanks!' })] });
          return state.current;
        },
      },
      { status: (k) => (k.endsWith('/messages') && fail ? 503 : 200) },
    );
    renderAt('/help/c1');
    const input = await screen.findByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Do I blow 3 times?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Not sent.')).toBeInTheDocument();
    expect(screen.getByText('Do I blow 3 times?')).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Got it, thanks!')).toBeInTheDocument();
    expect(screen.queryByText('Not sent.')).not.toBeInTheDocument();
  });

  it('"Talk to my care team" asks for confirmation, escalates and updates the banner', async () => {
    const state = { convs: [conv({ messages: [askedBreathing, aiReply] })], current: conv({ messages: [askedBreathing, aiReply] }) };
    const { calls } = mockFetch({
      ...baseRoutes(state),
      'POST /api/conversations/c1/escalate': () => {
        state.current = conv({
          status: 'waiting',
          messages: [askedBreathing, aiReply, m({ author: 'system', authorName: 'SMART@Home', text: 'Your care team has been asked to join.' })],
        });
        return state.current;
      },
    });
    renderAt('/help/c1');
    fireEvent.click((await screen.findAllByRole('button', { name: /^Talk to my care team$/ })).at(-1)!);
    const confirm = screen.getByRole('group', { name: 'Confirm talking to your care team' });
    expect(calls.some((c) => c.url.endsWith('/escalate'))).toBe(false);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, ask them' }));
    await waitFor(() =>
      expect(screen.getByTestId('chat-status')).toHaveTextContent("Waiting for your care team. They'll reply here. If it gets worse, follow your action plan or call 911."),
    );
    expect(screen.getByText('Your care team has been asked to join.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Care team asked to join/ })).toBeDisabled();
  });

  it('an SSE message event refreshes the open thread, shows the clinician and the unread badge', async () => {
    const waiting = conv({ status: 'waiting', messages: [askedBreathing, aiReply] });
    const state = { convs: [waiting], current: waiting };
    const { calls } = mockFetch(baseRoutes(state));
    renderAt('/help/c1');
    await screen.findByTestId('chat-status');
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe('/api/events?patientId=demo-jordan');

    const reply = m({ author: 'clinician', authorName: 'Sam Okafor, RN', clinicianId: 'demo-nurse', text: "Hi, it's Sam. How are you feeling?" });
    state.current = conv({ status: 'clinician', escalation: undefined, messages: [...waiting.messages, reply], unreadForPatient: 1 });
    state.convs = [state.current];
    es.emit({ type: 'message.created', conversationId: 'c1', patientId: 'demo-jordan', message: reply });

    expect(await screen.findByText("Hi, it's Sam. How are you feeling?")).toBeInTheDocument();
    expect(screen.getByText('Sam Okafor, RN · Nurse care coordinator')).toBeInTheDocument();
    expect(screen.getByTestId('chat-status')).toHaveTextContent('Sam Okafor, RN from your care team is here');
    await waitFor(() => expect(calls.some((c) => c.url === '/api/conversations/c1/read' && (c.body as { reader: string }).reader === 'patient')).toBe(true));
  });

  it('shows the unread count on the Help tab', async () => {
    const state = { convs: [conv({ unreadForPatient: 2, messages: [askedBreathing, aiReply] })] };
    mockFetch(baseRoutes(state));
    renderAt('/');
    expect(await screen.findByTestId('help-badge')).toHaveTextContent('2');
    expect(screen.getByRole('link', { name: 'Help, 2 unread' })).toBeInTheDocument();
  });
});
