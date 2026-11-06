// @vitest-environment jsdom
import '../test/setup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ClinicianProfile, RealtimeEvent } from '@shared/types';
import { getMockSummary, MOCK_TODAY } from '../dev/mockData';
import * as server from '../dev/mockMessaging';
import { defaultPreferences } from '../lib/prefs';
import { AppShell } from '../components/layout/AppShell';
import { ClinicianProvider } from '../state/ClinicianContext';
import { NotificationsProvider } from '../state/NotificationsContext';
import { ConversationPage } from './ConversationPage';
import { InboxPage } from './InboxPage';
import { PatientDashboard } from './PatientDashboard';
import { PatientsPage } from './PatientsPage';

vi.mock('../components/charts', () => import('../test/chartStubs'));

const CLINICIANS: ClinicianProfile[] = [
  { id: 'demo-pulm', displayName: 'Dr. Alex Rivera', role: 'Pediatric pulmonologist', defaultView: 'pulmonology' },
  { id: 'demo-nurse', displayName: 'Sam Lee, RN', role: 'Nurse care coordinator', defaultView: 'nursing' },
];

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onmessage: ((e: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }
  addEventListener() {}
  close() {
    this.closed = true;
  }
  emit(e: RealtimeEvent) {
    this.onmessage?.({ data: JSON.stringify(e) });
  }
}

let posts: { path: string; body: unknown }[];
let failNextPost = false;
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  window.localStorage.clear();
  posts = [];
  failNextPost = false;
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://test');
      const p = url.pathname;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (init?.method === 'POST') {
        if (failNextPost) {
          failNextPost = false;
          return json({ error: 'Server unavailable' }, 503);
        }
        posts.push({ path: p, body });
      }
      if (p === '/api/clinicians') return json(CLINICIANS);
      let m = /^\/api\/clinicians\/([^/]+)\/preferences$/.exec(p);
      if (m) return json(defaultPreferences(m[1]));
      m = /^\/api\/clinicians\/([^/]+)\/inbox$/.exec(p);
      if (m) return json(server.mockInbox(m[1]));
      m = /^\/api\/conversations\/([^/]+)(?:\/(messages|claim|close|read))?$/.exec(p);
      if (m) {
        const [, id, action] = m;
        if (!action) {
          const c = server.mockConversation(id);
          return c ? json(c) : json({ error: 'not found' }, 404);
        }
        if (action === 'messages') return json(server.mockSendMessage(id, body));
        if (action === 'claim') return json(server.mockClaim(id, body.clinicianId));
        if (action === 'close') return json(server.mockClose(id, body.by));
        return json(server.mockRead(id, body.reader));
      }
      m = /^\/api\/patients\/([^/]+)\/media$/.exec(p);
      if (m) {
        const d = url.searchParams.get('days');
        return json(server.mockMedia(m[1], d === 'all' ? 'all' : Number(d)));
      }
      m = /^\/api\/patients\/([^/]+)\/summary$/.exec(p);
      if (m) {
        const d = url.searchParams.get('days');
        const s = getMockSummary(m[1], d === 'all' ? 'all' : Number(d ?? 30));
        return s ? json(s) : json({ error: 'Patient not found' }, 404);
      }
      if (p === '/api/patients') return json({ today: MOCK_TODAY, patients: (await import('../dev/mockData')).mockPatientList.patients });
      return json({ error: 'not found' }, 404);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

let path = '';
function Where() {
  const l = useLocation();
  path = l.pathname + l.search;
  return null;
}

function renderApp(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ClinicianProvider>
        <NotificationsProvider>
          <AppShell>
            <Routes>
              <Route path="/" element={<PatientsPage />} />
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="/inbox/:conversationId" element={<ConversationPage />} />
              <Route path="/patients/:id" element={<PatientDashboard />} />
            </Routes>
            <Where />
          </AppShell>
        </NotificationsProvider>
      </ClinicianProvider>
    </MemoryRouter>,
  );
}
const stream = () => FakeEventSource.instances.filter((e) => !e.closed).at(-1)!;

describe('notifications', () => {
  it('shows the unread count and an escalation toast that opens the thread', async () => {
    renderApp('/');
    const expected = server.mockInbox('demo-pulm').filter((i) => i.status === 'waiting' || i.status === 'clinician').reduce((a, i) => a + i.unread, 0);
    expect(await screen.findByTestId('bell-count')).toHaveTextContent(String(expected));
    await waitFor(() => expect(stream().url).toBe('/api/events?clinicianId=demo-pulm'));

    stream().emit({ type: 'conversation.escalated', conversationId: 'c-jordan-1', patientId: 'demo-jordan', patientName: 'Jordan Reyes', urgency: 'urgent', topic: 'Rash after lunch' });
    const toast = await screen.findByTestId('escalation-toast');
    expect(toast).toHaveAttribute('role', 'alert');
    expect(toast).toHaveTextContent('Urgent message: Jordan Reyes');
    expect(toast).toHaveTextContent('Rash after lunch');
    fireEvent.click(within(toast).getByRole('button', { name: 'Open' }));
    expect(path).toBe('/inbox/c-jordan-1');
    expect(screen.queryByTestId('escalation-toast')).not.toBeInTheDocument();
  });

  it('reconnects the event stream when the clinician switches', async () => {
    renderApp('/');
    await screen.findByTestId('clinician-menu');
    await waitFor(() => expect(stream().url).toContain('demo-pulm'));
    const first = stream();
    fireEvent.click(screen.getByTestId('clinician-menu'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Sam Lee/ }));
    await waitFor(() => expect(stream().url).toBe('/api/events?clinicianId=demo-nurse'));
    expect(first.closed).toBe(true);
  });

  it('shows a message icon in the patient list for waiting conversations', async () => {
    renderApp('/');
    await screen.findAllByTestId('patient-row');
    await waitFor(() => expect(screen.getAllByTestId('patient-message-icon').length).toBeGreaterThan(0));
    expect(screen.getByRole('link', { name: 'Jordan Reyes has a conversation waiting' })).toBeInTheDocument();
  });
});

describe('inbox page', () => {
  it('lists waiting conversations by urgency and filters', async () => {
    renderApp('/inbox');
    await screen.findByRole('heading', { level: 1, name: 'Messages' });
    await waitFor(() => expect(screen.getAllByTestId('inbox-row').length).toBeGreaterThan(0));
    const names = () => screen.getAllByTestId('inbox-row').map((r) => within(r).getByRole('link').querySelector('strong')!.textContent);
    expect(names().slice(0, 2)).toEqual(['Jordan Reyes', 'Malik Johnson']);
    expect(screen.getAllByTestId('inbox-row')[0]).toHaveTextContent(/waiting \d/);
    fireEvent.click(screen.getByRole('tab', { name: /Closed/ }));
    expect(names()).toEqual(['Sofia Martinez']);
    fireEvent.click(screen.getByRole('tab', { name: /Mine/ }));
    expect(screen.getByText('No conversations here')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /All open/ }));
    expect(names()).toContain('Ethan Brooks');
  });
});

describe('conversation page', () => {
  it('renders AI, patient, system and safety messages with attachments, and marks read', async () => {
    renderApp('/inbox/c-jordan-1');
    await screen.findByRole('heading', { level: 1, name: 'Jordan Reyes' });
    const ai = screen.getByTestId('msg-ai');
    expect(within(ai).getByText('AI helper')).toBeInTheDocument();
    expect(screen.getAllByTestId('msg-patient').length).toBe(2);
    expect(screen.getByTestId('msg-system')).toHaveTextContent('Conversation sent to the care team');
    expect(screen.getByTestId('safety-notice')).toHaveTextContent('epinephrine');
    const thumb = await screen.findByRole('button', { name: 'Open photo: Rash on my arm after lunch' });
    fireEvent.click(thumb);
    expect(screen.getByTestId('lightbox')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId('lightbox'), { key: 'Escape' });
    expect(screen.queryByTestId('lightbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('escalation-card')).toHaveTextContent('Safety screen');
    expect(await screen.findByTestId('patient-snapshot')).toHaveTextContent('Last check-in');
    expect(screen.getByRole('link', { name: 'Open today in day view' })).toHaveAttribute('href', `/patients/demo-jordan?day=${MOCK_TODAY}`);
    await waitFor(() => expect(posts.some((x) => x.path === '/api/conversations/c-jordan-1/read' && (x.body as { reader: string }).reader === 'demo-pulm')).toBe(true));
  });

  it('sends replies with Enter (not Shift+Enter), using quick replies, and retries failures', async () => {
    renderApp('/inbox/c-jordan-1');
    await screen.findByRole('heading', { level: 1, name: 'Jordan Reyes' });
    const box = (await screen.findByRole('textbox', { name: /Reply to Jordan Reyes/ })) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: /Thanks, I’m looking at your readings now/ }));
    expect(box.value).toBe('Thanks, I’m looking at your readings now.');
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(posts.filter((x) => x.path.endsWith('/messages'))).toHaveLength(0);
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(posts.filter((x) => x.path.endsWith('/messages'))).toHaveLength(1));
    expect(posts.find((x) => x.path.endsWith('/messages'))!.body).toEqual({ author: 'clinician', clinicianId: 'demo-pulm', text: 'Thanks, I’m looking at your readings now.' });
    await waitFor(() => expect(screen.getAllByTestId('msg-clinician').at(-1)).toHaveTextContent('looking at your readings'));

    failNextPost = true;
    fireEvent.change(box, { target: { value: 'Second message' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText('Not sent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(screen.queryByTestId('pending-message')).not.toBeInTheDocument());
    expect(screen.getAllByTestId('msg-clinician').at(-1)).toHaveTextContent('Second message');
  });

  it('claims and closes a conversation with an inline confirm', async () => {
    renderApp('/inbox/c-malik-1');
    await screen.findByRole('heading', { level: 1, name: 'Malik Johnson' });
    fireEvent.click(screen.getByRole('button', { name: 'I’m on it' }));
    await waitFor(() => expect(posts.some((x) => x.path.endsWith('/claim'))).toBe(true));
    expect(posts.find((x) => x.path.endsWith('/claim'))!.body).toEqual({ clinicianId: 'demo-pulm' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'I’m on it' })).not.toBeInTheDocument());
    expect(screen.getByTestId('escalation-card')).toHaveTextContent('Claimed byYou');
    fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
    expect(screen.getByRole('group', { name: 'Confirm closing' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, close it' }));
    await waitFor(() => expect(posts.some((x) => x.path.endsWith('/close'))).toBe(true));
    expect(posts.find((x) => x.path.endsWith('/close'))!.body).toEqual({ by: 'demo-pulm' });
    expect(await screen.findByText(/This conversation is closed/)).toBeInTheDocument();
  });
});

describe('dashboard media and voice', () => {
  it('shows the photos & videos section with a keyboard lightbox and "Show this day"', async () => {
    renderApp('/patients/demo-jordan?view=pulmonology');
    await screen.findByRole('heading', { level: 1, name: 'Jordan Reyes' });
    await screen.findByRole('heading', { name: 'Photos & videos' });
    const items = await screen.findAllByTestId('media-item');
    expect(items).toHaveLength(server.mockMedia('demo-jordan', 30).length);
    expect(screen.getByText('Video', { selector: 'span' })).toBeInTheDocument();
    fireEvent.click(within(items[0]).getByRole('button'));
    const box = screen.getByTestId('lightbox');
    expect(box).toHaveTextContent(`1 of ${items.length}`);
    fireEvent.keyDown(box, { key: 'ArrowRight' });
    expect(screen.getByTestId('lightbox')).toHaveTextContent(`2 of ${items.length}`);
    fireEvent.click(screen.getByRole('button', { name: 'Show this day' }));
    expect(path).toContain('day=');
    expect(await screen.findByRole('dialog', { name: /2026/ })).toBeInTheDocument();
  });

  it('shows the conversation-waiting chip on the dashboard', async () => {
    renderApp('/patients/demo-jordan');
    await screen.findByRole('heading', { level: 1, name: 'Jordan Reyes' });
    const chip = await screen.findByTestId('conversation-chip');
    expect(chip).toHaveAttribute('href', '/inbox/c-jordan-1');
  });

  it('marks spoken check-ins with a badge and transcript, and shows the day’s media in the drawer', async () => {
    renderApp(`/patients/demo-jordan?day=${MOCK_TODAY}`);
    const dialog = await screen.findByRole('dialog');
    const badge = within(dialog).getByTestId('voice-badge');
    expect(badge).toHaveTextContent('Spoken check-in');
    expect(within(dialog).getByText('What the patient said')).toBeInTheDocument();
    expect(within(dialog).getByTestId('voice-transcript').textContent).toMatch(/feeling/);
    expect(within(dialog).getByText(/Answers were extracted automatically and confirmed by the patient/)).toBeInTheDocument();
    expect(await within(dialog).findByTestId('day-media')).toBeInTheDocument();
  });

  it('includes the media section in layout edit mode', async () => {
    renderApp('/patients/demo-jordan?view=nursing');
    await screen.findByRole('heading', { level: 1, name: 'Jordan Reyes' });
    fireEvent.click(await screen.findByRole('button', { name: /customize layout/i }));
    const frames = screen.getAllByTestId(/^edit-frame-/).map((f) => f.getAttribute('data-testid'));
    expect(frames.slice(0, 2)).toEqual(['edit-frame-attention', 'edit-frame-media']);
    expect(screen.getByRole('button', { name: 'Move Photos & videos up' })).toBeInTheDocument();
  });

  it('shows a quiet refresh pill when new media arrives for this patient', async () => {
    renderApp('/patients/demo-jordan');
    await screen.findByRole('heading', { level: 1, name: 'Jordan Reyes' });
    await waitFor(() => expect(stream()).toBeDefined());
    const m = server.mockMedia('demo-jordan', 30)[0];
    stream().emit({ type: 'media.created', patientId: 'demo-jordan', media: m });
    fireEvent.click(await screen.findByRole('button', { name: /New data, refresh/ }));
    expect(screen.queryByRole('button', { name: /New data, refresh/ })).not.toBeInTheDocument();
  });
});
