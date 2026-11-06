// @vitest-environment jsdom
import '../test/setup';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PatientAppMedication } from '@shared/types/api';
import { mockFetch } from '../test/setup';
import { MedRow, doseSlots } from './MedRow';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const flovent: PatientAppMedication = {
  id: 'med-1',
  name: 'Flovent HFA 44 mcg',
  icon: 'Inhaler',
  howOften: 'Daily',
  regimen: '2 puffs twice daily',
  kind: 'scheduled',
  timesOfDay: ['20:00', '08:00'],
  dosesDueToday: 2,
  dosesTakenToday: 1,
  takenTimesToday: ['08:12'],
};
const albuterol: PatientAppMedication = {
  ...flovent,
  id: 'med-2',
  name: 'Albuterol HFA',
  howOften: 'As Needed',
  regimen: '2 puffs as needed',
  kind: 'asNeeded',
  timesOfDay: [],
  dosesDueToday: 0,
  dosesTakenToday: 0,
  takenTimesToday: [],
};

describe('MedRow', () => {
  it('fills scheduled slots in time order', () => {
    expect(doseSlots(flovent)).toEqual([
      { time: '08:00', takenAt: '08:12' },
      { time: '20:00', takenAt: undefined },
    ]);
  });

  it('"Mark taken" posts the dose and ignores a double tap', async () => {
    let resolve!: (r: Response) => void;
    const fn = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal('fetch', fn);
    const onTaken = vi.fn();
    render(<MedRow med={flovent} patientId="p1" today="2026-11-06" onTaken={onTaken} />);

    expect(screen.getByText(/taken at 08:12/)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Mark Flovent HFA 44 mcg 20:00 dose taken' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(btn).toBeDisabled();

    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/patients/p1/medication-administrations');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ medicationId: 'med-1', day: '2026-11-06', time: expect.stringMatching(/^\d\d:\d\d$/) });

    resolve(
      new Response(JSON.stringify({ ok: true, created: { id: 'med-1', time: '20:03', name: 'Flovent', value: 1 }, message: 'Nice!' }), {
        status: 201,
      }),
    );
    await waitFor(() => expect(onTaken).toHaveBeenCalledWith('med-1', '20:03', expect.objectContaining({ message: 'Nice!' })));
    expect(btn).not.toBeDisabled();
    // Remembered on this device for the 7-day history.
    expect(JSON.parse(window.localStorage.getItem('smart-home-patient-doses:p1')!)).toEqual({ '2026-11-06': { 'med-1': ['20:03'] } });
  });

  it('"I used it" records as-needed use', async () => {
    const { calls } = mockFetch({
      'POST /api/patients/p1/medication-administrations': { ok: true, created: { id: 'med-2', time: '14:00', name: 'Albuterol', value: 1 }, message: 'Saved' },
    });
    const onTaken = vi.fn();
    render(<MedRow med={albuterol} patientId="p1" today="2026-11-06" onTaken={onTaken} />);
    expect(screen.getByText(/Not used today/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'I used Albuterol HFA' }));
    await waitFor(() => expect(onTaken).toHaveBeenCalled());
    expect(calls[0].body).toMatchObject({ medicationId: 'med-2', day: '2026-11-06' });
  });

  it('shows an error with the server message and re-enables the button', async () => {
    mockFetch({}, {});
    render(<MedRow med={albuterol} patientId="p1" today="2026-11-06" />);
    fireEvent.click(screen.getByRole('button', { name: 'I used Albuterol HFA' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No route');
    expect(screen.getByRole('button', { name: 'I used Albuterol HFA' })).not.toBeDisabled();
  });

  it('explains offline failures in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    render(<MedRow med={albuterol} patientId="p1" today="2026-11-06" />);
    fireEvent.click(screen.getByRole('button', { name: 'I used Albuterol HFA' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("You're offline");
  });
});
