// @vitest-environment jsdom
import '../test/setup';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { getMockSummary, mockSummary } from '../dev/mockData';
import { medicationMismatches, medKey } from './dashboard/EhrContext';
import { MedicationsPanel } from './dashboard/MedicationsPanel';
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

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/patients/:id" element={<PatientDashboard />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EHR context (item 1)', () => {
  it('matches medication names loosely by first word', () => {
    expect(medKey('Albuterol (Ventolin HFA)')).toBe('albuterol');
    const r = medicationMismatches(['Albuterol', 'Dulera'], ['Albuterol (Ventolin HFA)', 'Flovent HFA 44 mcg inhaler']);
    expect(r.appOnly).toEqual(['Dulera']);
    expect(r.ehrOnly).toEqual(['Flovent HFA 44 mcg inhaler']);
  });

  it('shows a one-line summary that expands to problems, allergies, meds and mismatches', async () => {
    renderAt('/patients/demo-jordan');
    const block = await screen.findByTestId('ehr-context');
    const summary = block.querySelector('summary')!;
    expect(summary).toHaveTextContent('Problems: Childhood asthma, Allergic rhinitis +2');
    expect(summary).toHaveTextContent('Last clinic visit Nov 9, 2025');
    expect(summary).toHaveTextContent(/synthetic \(Synthea\)/);
    expect(block).not.toHaveAttribute('open');
    fireEvent.click(summary);
    expect(within(block).getByText('Peanuts')).toBeInTheDocument();
    expect(within(block).getByText('Epinephrine auto-injector')).toBeInTheDocument();
    expect(within(block).getByText(/3 visits in the last 12 months/)).toBeInTheDocument();
    expect(within(block).getByText(/158 cm, 49.5 kg/)).toBeInTheDocument();
    // Dulera is tracked in the app but the chart lists Flovent.
    expect(within(block).getByTestId('app-only-meds')).toHaveTextContent('Dulera');
    expect(within(block).getByText('Flovent HFA 44 mcg inhaler').closest('li')).toHaveTextContent('not tracked in the app');
  });

  it('is hidden in visit mode', async () => {
    renderAt('/patients/demo-jordan?mode=visit');
    await screen.findByRole('heading', { level: 1, name: /Hi Jordan/ });
    expect(screen.queryByTestId('ehr-context')).not.toBeInTheDocument();
  });

  it('flags new patients with fewer than 14 days of data', async () => {
    renderAt('/patients/demo-maya');
    expect(await screen.findByTestId('new-patient')).toHaveTextContent('New patient, 9 days of data');
    renderAt('/patients/demo-jordan');
    await screen.findAllByRole('heading', { level: 1 });
    expect(screen.getAllByTestId('new-patient')).toHaveLength(1);
  });
});

describe('feeling sequence in the day drawer (item 4)', () => {
  it('shows "Bad → Great" style changes when the sequence has several entries', async () => {
    const day = mockSummary.days.find((d) => (d.feeling?.sequence.length ?? 0) > 1)!;
    expect(day).toBeDefined();
    renderAt(`/patients/demo-jordan?day=${day.date}`);
    const dialog = await screen.findByRole('dialog');
    const seq = within(dialog).getByTestId('feeling-sequence');
    for (const label of day.feeling!.sequence) expect(seq).toHaveTextContent(label);
    expect(seq.textContent).toMatch(/then/);
  });
});

describe('medication cards (item 6)', () => {
  it('shows "Measured through" in watch colour when the patient stopped logging', async () => {
    renderAt('/patients/demo-lily');
    const note = await screen.findByTestId('measured-through');
    expect(note).toHaveTextContent('Measured through Oct 30: no app activity since');
  });

  it('shows "No data" instead of 0% when adherence is null', () => {
    const ava = getMockSummary('demo-ava', 30)!;
    expect(ava.medications.scheduled[0].adherencePct).toBeNull();
    render(<MedicationsPanel summary={ava} span={1} onSelectDay={() => {}} conditionFilter={() => true} />);
    const card = screen.getByTestId('med-scheduled');
    expect(card).toHaveTextContent('No data');
    expect(card).not.toHaveTextContent('0%');
    expect(within(card).getByTestId('measured-through')).toHaveTextContent('Measured through Jun 21');
  });
});

describe('FHIR bundle link', () => {
  it('links to the FHIR endpoint with a lastname download name', async () => {
    renderAt('/patients/demo-jordan');
    const link = await screen.findByTestId('fhir-link');
    expect(link).toHaveAttribute('href', '/api/patients/demo-jordan/fhir');
    expect(link).toHaveAttribute('download', 'reyes-fhir.json');
    expect(link).toHaveAttribute('title', 'FHIR R4 bundle (Synthea format) for EHR or data pipelines');
  });
  it('is not shown in visit mode', async () => {
    renderAt('/patients/demo-jordan?mode=visit');
    await screen.findByRole('heading', { level: 1, name: /Hi Jordan/ });
    expect(screen.queryByTestId('fhir-link')).not.toBeInTheDocument();
  });
});
