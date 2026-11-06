// @vitest-environment jsdom
import './test/setup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { mockHomeFor, mockPatientList } from './dev/mock';
import { mockFetch } from './test/setup';
import { App } from './App';

const KEY = 'smart-home-patient-id';

function routes() {
  return {
    'GET /api/patients': mockPatientList(),
    'GET /api/patients/demo-jordan/app/home': mockHomeFor('demo-jordan'),
    'GET /api/patients/demo-maya/app/home': mockHomeFor('demo-maya'),
  };
}

const renderApp = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('patient app', () => {
  it('asks who is using the app, then remembers the choice', async () => {
    mockFetch(routes());
    const { unmount } = renderApp();
    expect(screen.getByRole('heading', { name: 'Demo: choose a patient' })).toBeInTheDocument();
    expect(screen.getByText('Synthetic demo')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Jordan Reyes/ }));
    expect(window.localStorage.getItem(KEY)).toBe('demo-jordan');
    expect(await screen.findByRole('heading', { name: /, Jordan$/ })).toBeInTheDocument();
    unmount();

    // Next visit goes straight to Today.
    renderApp();
    expect(await screen.findByRole('heading', { name: /, Jordan$/ })).toBeInTheDocument();
    expect(screen.queryByText('Demo: choose a patient')).not.toBeInTheDocument();
  });

  it('renders the Today screen: zone, trackers, medicines, spirometer, streak and badges', async () => {
    window.localStorage.setItem(KEY, 'demo-jordan');
    mockFetch(routes());
    renderApp();
    await screen.findByRole('heading', { name: /, Jordan$/ });
    expect(screen.getByText('Green zone')).toBeInTheDocument();
    expect(screen.getByText('Follow the plan your care team gave you.')).toBeInTheDocument();
    expect(screen.getByText('Asthma check-in')).toBeInTheDocument();
    expect(screen.getByText('Do a breathing test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark Flovent HFA 44 mcg 20:00 dose taken' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I used Albuterol HFA' })).toBeInTheDocument();
    expect(screen.getByText('6 days in a row')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Last 14 days' }).children).toHaveLength(14);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const tab of ['Today', 'Check in', 'Medicines', 'Me']) expect(within(nav).getByRole('link', { name: tab })).toBeInTheDocument();
  });

  it('keeps working when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    mockFetch(routes());
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /Maya Chen/ }));
    expect(await screen.findByRole('heading', { name: /, Maya$/ })).toBeInTheDocument();
    expect(screen.getByText(/Checked in at 07:41 · check in again/)).toBeInTheDocument();
  });

  it('"Switch patient" in Me goes back to the patient list', async () => {
    window.localStorage.setItem(KEY, 'demo-maya');
    mockFetch(routes());
    renderApp('/me');
    fireEvent.click(await screen.findByRole('button', { name: /Switch patient/ }));
    expect(await screen.findByRole('heading', { name: 'Demo: choose a patient' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Jordan Reyes/ }));
    expect(window.localStorage.getItem(KEY)).toBe('demo-jordan');
    expect(await screen.findByRole('heading', { name: /, Jordan$/ })).toBeInTheDocument();
  });

  it('shows a retry when home fails to load', async () => {
    window.localStorage.setItem(KEY, 'demo-jordan');
    let fail = true;
    mockFetch({ 'GET /api/patients/demo-jordan/app/home': () => (fail ? { error: 'Server is restarting' } : mockHomeFor('demo-jordan')) }, { status: () => (fail ? 503 : 200) });
    renderApp();
    expect(await screen.findByText('Server is restarting')).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByRole('heading', { name: /, Jordan$/ })).toBeInTheDocument();
  });

  it('forgets an unknown patient (e.g. after a demo reset)', async () => {
    window.localStorage.setItem(KEY, 'gone');
    mockFetch(routes());
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Demo: choose a patient' })).toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
