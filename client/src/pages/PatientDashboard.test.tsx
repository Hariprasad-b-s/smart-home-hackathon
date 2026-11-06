// @vitest-environment jsdom
import '../test/setup';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { getMockSummary, mockSummary } from '../dev/mockData';
import { cleanDisplay } from './dashboard/DayDrawer';
import { PatientDashboard } from './PatientDashboard';

vi.mock('../components/charts', () => import('../test/chartStubs'));
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    fetchPatientSummary: vi.fn(async (id: string, days: number | 'all') => {
      const s = getMockSummary(id, days);
      if (!s) throw new actual.ApiRequestError('Patient not found', 404);
      return s;
    }),
  };
});

let lastSearch = '';
function SearchSpy() {
  lastSearch = useLocation().search;
  return null;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/patients/:id"
          element={
            <>
              <PatientDashboard />
              <SearchSpy />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PatientDashboard', () => {
  it('renders header, freshness, headline metrics and flags from the summary', async () => {
    renderAt('/patients/demo-jordan');
    expect(await screen.findByRole('heading', { level: 1, name: 'Jordan Reyes' })).toBeInTheDocument();
    expect(screen.getByText(mockSummary.patient.mrn)).toBeInTheDocument();
    expect(screen.getByTestId('freshness')).toHaveTextContent(/Last activity Nov 5, 2026/);
    // Asthma + migraine → Overview preset → every headline metric up to 8, summary order.
    const first = mockSummary.headline[0];
    expect(screen.getByTestId(`metric-${first.id}`)).toHaveTextContent(first.value);
    expect(screen.getByRole('heading', { name: 'What needs attention' })).toBeInTheDocument();
    for (const f of mockSummary.flags) expect(screen.getByText(f.title)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /lung function/i })).toBeInTheDocument();
    expect(screen.getByText(/Synthetic demo data\. No real patient information/)).toBeInTheDocument();
  });

  it('applies the specialty preset from the URL (metric order and sections)', async () => {
    renderAt('/patients/demo-jordan?view=neurology');
    await screen.findByRole('heading', { level: 1, name: 'Jordan Reyes' });
    const tiles = screen.getAllByTestId(/^metric-/).map((el) => el.getAttribute('data-testid'));
    expect(tiles[0]).toBe('metric-headacheDays');
    expect(tiles).not.toContain('metric-zone');
    expect(screen.queryByRole('heading', { name: /lung function/i })).not.toBeInTheDocument();
    // Neurology emphasises migraine: asthma meds hidden behind a toggle.
    expect(screen.queryByText('Dulera', { selector: 'h3 *, h3' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /for other conditions/i }).length).toBeGreaterThan(0);
  });

  it('changing the view selector updates the URL', async () => {
    renderAt('/patients/demo-jordan');
    await screen.findByRole('heading', { level: 1, name: 'Jordan Reyes' });
    fireEvent.change(screen.getByRole('combobox', { name: /view for/i }), { target: { value: 'pulmonology' } });
    expect(lastSearch).toContain('view=pulmonology');
    expect(screen.getAllByTestId(/^metric-/)[0]).toHaveAttribute('data-testid', 'metric-zone');
  });

  it('highlights flag dates on the calendar', async () => {
    renderAt('/patients/demo-jordan');
    await screen.findByRole('heading', { level: 1, name: 'Jordan Reyes' });
    const flag = mockSummary.flags.find((f) => f.dates?.length)!;
    const btn = screen.getAllByRole('button', { name: /on charts/ })[0];
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('calendar').getAttribute('data-highlight')).toBe(flag.dates!.join(','));
  });

  it('opens the day drawer from a chart click and closes on Escape', async () => {
    renderAt('/patients/demo-jordan');
    await screen.findByRole('heading', { level: 1, name: 'Jordan Reyes' });
    const day = [...mockSummary.days].reverse().find((d) => d.submissions.length > 1 && d.symptoms.length)!;
    fireEvent.click(within(screen.getByTestId('calendar')).getByRole('button', { name: `day ${day.date}` }));
    expect(lastSearch).toContain(`day=${day.date}`);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /close day details/i })).toHaveFocus();
    for (const sym of day.symptoms) expect(within(dialog).getAllByText(sym).length).toBeGreaterThan(0);
    expect(dialog.textContent).not.toMatch(/\["/);
    expect(within(dialog).getAllByTestId('submission')).toHaveLength(day.submissions.length);
    expect(within(dialog).getAllByText('Used for the day').length).toBeGreaterThan(0);
    act(() => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(lastSearch).not.toContain('day=');
  });

  it('day drawer prev/next walks through days', async () => {
    const day = mockSummary.days[10];
    renderAt(`/patients/demo-jordan?day=${day.date}`);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /next day/i }));
    expect(lastSearch).toContain(`day=${mockSummary.days[11].date}`);
  });

  it('visit mode hides clinical detail and can be exited', async () => {
    renderAt('/patients/demo-jordan?mode=visit');
    expect(await screen.findByRole('heading', { level: 1, name: /Hi Jordan/ })).toBeInTheDocument();
    expect(screen.queryByText(mockSummary.patient.mrn)).not.toBeInTheDocument();
    expect(screen.queryByText('What needs attention')).not.toBeInTheDocument();
    expect(screen.getByTestId('calendar')).toHaveAttribute('data-colorby', 'hardDay');
    expect(screen.getByTestId('calendar')).toHaveAttribute('data-size', 'large');
    fireEvent.click(screen.getAllByRole('button', { name: /exit visit mode/i })[0]);
    expect(lastSearch).not.toContain('mode=visit');
    expect(await screen.findByRole('heading', { name: 'What needs attention' })).toBeInTheDocument();
  });

  it('shows an empty-window state with "Show all time" for an inactive patient', async () => {
    renderAt('/patients/demo-ava');
    expect(await screen.findByText(/No entries in last 30 days/)).toBeInTheDocument();
    expect(screen.getAllByText(/137 days ago/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show all time' }));
    expect(lastSearch).toContain('days=all');
    await waitFor(() => expect(screen.queryByText(/No entries in/)).not.toBeInTheDocument());
  });

  it('shows not-found for unknown patients', async () => {
    renderAt('/patients/nobody');
    expect(await screen.findByText('Patient not found')).toBeInTheDocument();
  });
});

describe('cleanDisplay', () => {
  it('turns JSON lists into plain text', () => {
    expect(cleanDisplay('["Coughing","Tight Chest"]')).toBe('Coughing, Tight Chest');
    expect(cleanDisplay('["None of these "]')).toBe('None of these');
    expect(cleanDisplay('Great')).toBe('Great');
  });
});
