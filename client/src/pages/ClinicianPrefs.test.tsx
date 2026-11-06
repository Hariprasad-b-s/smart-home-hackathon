// @vitest-environment jsdom
import '../test/setup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ClinicianPreferences, ClinicianProfile } from '@shared/types';
import { getMockSummary } from '../dev/mockData';
import { defaultPreferences, defaultVisitMode } from '../lib/prefs';
import { AppShell } from '../components/layout/AppShell';
import { CLINICIAN_STORAGE_KEY, ClinicianProvider, useClinicianPrefs } from '../state/ClinicianContext';
import { VisitMode } from './dashboard/VisitMode';
import { PatientDashboard } from './PatientDashboard';

vi.mock('../components/charts', () => import('../test/chartStubs'));

const CLINICIANS: ClinicianProfile[] = [
  { id: 'demo-pulm', displayName: 'Dr. Alex Rivera', role: 'Pediatric pulmonologist', defaultView: 'pulmonology' },
  { id: 'demo-neuro', displayName: 'Dr. Priya Shah', role: 'Pediatric neurologist', defaultView: 'neurology' },
];

let store: Record<string, ClinicianPreferences>;
let puts: { id: string; body: ClinicianPreferences }[];
let failPut = false;

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  window.localStorage.clear();
  store = {};
  puts = [];
  failPut = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://test');
      const path = url.pathname;
      if (path === '/api/clinicians') return json(CLINICIANS);
      const pm = /^\/api\/clinicians\/([^/]+)\/preferences$/.exec(path);
      if (pm) {
        const id = pm[1];
        if (init?.method === 'PUT') {
          if (failPut) return json({ error: 'Disk full' }, 500);
          const body = JSON.parse(String(init.body)) as ClinicianPreferences;
          puts.push({ id, body });
          store[id] = body;
          return json(body);
        }
        return json(store[id] ?? defaultPreferences(id));
      }
      const sm = /^\/api\/patients\/([^/]+)\/summary$/.exec(path);
      if (sm) {
        const days = url.searchParams.get('days');
        const s = getMockSummary(sm[1], days === 'all' ? 'all' : Number(days ?? 30));
        return s ? json(s) : json({ error: 'Patient not found' }, 404);
      }
      return json({ error: 'not found' }, 404);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderApp(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ClinicianProvider>
        <AppShell>
          <Routes>
            <Route path="/patients/:id" element={<PatientDashboard />} />
          </Routes>
        </AppShell>
      </ClinicianProvider>
    </MemoryRouter>,
  );
}

const viewSelect = () => screen.getByRole('combobox', { name: /view for/i }) as HTMLSelectElement;
async function ready(name: RegExp | string) {
  await screen.findByRole('heading', { level: 1, name });
  await screen.findByTestId('clinician-menu');
}

describe('clinician identity', () => {
  it('uses the clinician default view when the URL has none, but an explicit view param wins', async () => {
    const { unmount } = renderApp('/patients/demo-jordan');
    await ready('Jordan Reyes');
    await waitFor(() => expect(viewSelect().value).toBe('pulmonology'));
    unmount();
    renderApp('/patients/demo-jordan?view=nursing');
    await ready('Jordan Reyes');
    expect(viewSelect().value).toBe('nursing');
  });

  it('switching clinician loads that clinician’s preferences and remembers the choice', async () => {
    store['demo-neuro'] = { ...defaultPreferences('demo-neuro'), visitMode: { ...defaultVisitMode(), calendar: false } };
    renderApp('/patients/demo-jordan');
    await ready('Jordan Reyes');
    expect(screen.getByRole('button', { name: /^Visit mode$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('clinician-menu'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Dr. Priya Shah/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Visit mode\s*1 hidden/ })).toBeInTheDocument());
    expect(window.localStorage.getItem(CLINICIAN_STORAGE_KEY)).toBe('demo-neuro');
    expect(viewSelect().value).toBe('neurology');
  });
});

describe('layout edit mode', () => {
  it('moves, hides and resizes sections, announces moves, and saves on Done', async () => {
    renderApp('/patients/demo-jordan?view=pulmonology');
    await ready('Jordan Reyes');
    fireEvent.click(screen.getByRole('button', { name: /customize layout/i }));
    expect(screen.getByRole('region', { name: 'Layout editing' })).toHaveTextContent('Editing layout for Pulmonology · applies to all your patients');

    const frames = () => screen.getAllByTestId(/^edit-frame-/).map((f) => f.getAttribute('data-testid')!.replace('edit-frame-', ''));
    expect(frames()[0]).toBe('lungFunction');
    const n = frames().length;
    fireEvent.click(screen.getByRole('button', { name: 'Move Lung function down' }));
    expect(frames().slice(0, 2)).toEqual(['attention', 'lungFunction']);
    expect(screen.getByTestId('layout-announcer')).toHaveTextContent(`Lung function moved to position 2 of ${n}`);
    expect(screen.getByRole('button', { name: 'Move Lung function down' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Move What needs attention up' }));
    expect(frames()[0]).toBe('attention');
    fireEvent.click(screen.getByRole('button', { name: 'Move What needs attention down' }));

    fireEvent.click(screen.getByRole('button', { name: 'Hide What needs attention' }));
    expect(within(screen.getByTestId('edit-frame-attention')).getByText(/Hidden\. It won’t appear/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Medications: full width' }));
    fireEvent.click(screen.getByRole('button', { name: /Hide Night waking/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const layout = puts[0].body.layouts.pulmonology;
    expect(layout.sections.slice(0, 2).map((x) => x.id)).toEqual(['lungFunction', 'attention']);
    expect(layout.sections.find((x) => x.id === 'attention')!.visible).toBe(false);
    expect(layout.sections.find((x) => x.id === 'medications')!.width).toBe('full');
    expect(layout.headline.find((x) => x.id === 'nightWaking')!.visible).toBe(false);
    expect(screen.queryByRole('region', { name: 'Layout editing' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('section-attention')).not.toBeInTheDocument();
    expect(screen.queryByTestId('metric-nightWaking')).not.toBeInTheDocument();
  });

  it('applies the saved layout to other patients, and Reset deletes the view layout', async () => {
    store['demo-pulm'] = {
      ...defaultPreferences('demo-pulm'),
      layouts: { pulmonology: { sections: [{ id: 'medications', visible: true, width: 'full' }, { id: 'calendar', visible: false, width: 'half' }], headline: [] } },
    };
    renderApp('/patients/demo-malik');
    await ready('Malik Johnson');
    await waitFor(() => expect(screen.queryByTestId('section-calendar')).not.toBeInTheDocument());
    const order = screen.getAllByTestId(/^section-/).map((el) => el.getAttribute('data-testid'));
    expect(order[0]).toBe('section-medications');

    fireEvent.click(screen.getByRole('button', { name: /customize layout/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body.layouts.pulmonology).toBeUndefined();
    expect(await screen.findByTestId('section-calendar')).toBeInTheDocument();
  });

  it('Cancel discards unsaved changes without saving', async () => {
    renderApp('/patients/demo-jordan?view=pulmonology');
    await ready('Jordan Reyes');
    fireEvent.click(screen.getByRole('button', { name: /customize layout/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide What needs attention' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('section-attention')).toBeInTheDocument();
    expect(puts).toHaveLength(0);
  });

  it('rolls back and shows a toast when saving fails', async () => {
    failPut = true;
    renderApp('/patients/demo-jordan?view=pulmonology');
    await ready('Jordan Reyes');
    fireEvent.click(screen.getByRole('button', { name: /customize layout/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide What needs attention' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText(/Couldn’t save your preferences/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('section-attention')).toBeInTheDocument());
  });
});

describe('visit-mode visibility', () => {
  it('"Just this visit" hides parts without saving; exiting keeps the defaults', async () => {
    renderApp('/patients/demo-jordan');
    await ready('Jordan Reyes');
    fireEvent.click(screen.getByRole('button', { name: 'Choose what the patient will see' }));
    const dialog = screen.getByRole('dialog', { name: 'What the patient will see' });
    const rescueText = getMockSummary('demo-jordan', 30)!.patientFacing.points.find((p) => p.key === 'rescue')!.text;
    expect(within(dialog).getByText(rescueText)).toBeInTheDocument(); // live preview
    expect(within(dialog).getByRole('checkbox', { name: /Missed school/ })).not.toBeDisabled();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /^Calendar/ }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Rescue inhaler use/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Just this visit' }));

    expect(await screen.findByRole('heading', { level: 1, name: /Hi Jordan/ })).toBeInTheDocument();
    expect(screen.queryByTestId('calendar')).not.toBeInTheDocument();
    expect(screen.queryByText(rescueText)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose what the patient will see' })).not.toBeInTheDocument();
    expect(puts).toHaveLength(0);

    fireEvent.click(screen.getAllByRole('button', { name: /exit visit mode/i })[0]);
    await screen.findByRole('heading', { level: 1, name: 'Jordan Reyes' });
    expect(screen.getByRole('button', { name: /^Visit mode$/ })).toBeInTheDocument();
  });

  it('"Save as my default" PUTs and the headline sentence disappears', async () => {
    renderApp('/patients/demo-jordan');
    await ready('Jordan Reyes');
    fireEvent.click(screen.getByRole('button', { name: 'Choose what the patient will see' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Headline sentence/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save as my default' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body.visitMode.headline).toBe(false);
    expect(screen.getByRole('button', { name: /Visit mode\s*1 hidden/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Visit mode\s*1 hidden/ }));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/^Hi Jordan\.$/);
  });

  it('marks talking points this patient lacks as unavailable', async () => {
    renderApp('/patients/demo-priya');
    await ready('Priya Natarajan');
    fireEvent.click(screen.getByRole('button', { name: 'Choose what the patient will see' }));
    const rescue = screen.getByRole('checkbox', { name: /Rescue inhaler use/ });
    expect(rescue).toBeDisabled();
    expect(rescue.closest('label')).toHaveTextContent('Not available for this patient');
  });

  it('shows a walkthrough card when everything is hidden', () => {
    const v = defaultVisitMode();
    v.headline = v.dayCounts = v.calendar = v.achievements = false;
    for (const k of Object.keys(v.points) as (keyof typeof v.points)[]) v.points[k] = false;
    render(<VisitMode summary={getMockSummary('demo-jordan', 30)!} visibility={v} onExit={() => {}} />);
    expect(screen.getByTestId('visit-walkthrough')).toHaveTextContent('Your care team will walk you through today’s visit');
    expect(screen.queryByTestId('calendar')).not.toBeInTheDocument();
  });
});

describe('useClinicianPrefs debounce', () => {
  function Probe() {
    const { updatePrefs, clinician } = useClinicianPrefs();
    return (
      <button type="button" disabled={!clinician} onClick={() => updatePrefs((p) => ({ ...p, visitMode: { ...p.visitMode, calendar: !p.visitMode.calendar } }))}>
        toggle
      </button>
    );
  }
  it('coalesces rapid updates into one PUT', async () => {
    render(
      <ClinicianProvider>
        <Probe />
      </ClinicianProvider>,
    );
    const btn = await screen.findByRole('button', { name: 'toggle' });
    await waitFor(() => expect(btn).not.toBeDisabled());
    await new Promise((r) => setTimeout(r, 20));
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(puts).toHaveLength(0);
    await waitFor(() => expect(puts).toHaveLength(1), { timeout: 2000 });
    expect(puts[0].body.visitMode.calendar).toBe(false);
  });
});
