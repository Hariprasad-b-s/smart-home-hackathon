// @vitest-environment jsdom
import '../test/setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { PatientListItem } from '@shared/types';
import { mockPatientList } from '../dev/mockData';
import { filterAndSortPatients, needsAttention } from '../lib/triage';
import { PatientTriage } from './PatientsPage';

const patients = mockPatientList.patients;

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

function renderTriage(list: PatientListItem[] = patients) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<PatientTriage patients={list} today="2026-11-05" />} />
        <Route path="/patients/:id" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('triage list logic', () => {
  it('sorts by attention score, highest first', () => {
    const rows = filterAndSortPatients(patients, { query: '', condition: '', sort: 'attention' });
    const scores = rows.map((p) => p.attentionScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
  it('filters by search text and condition', () => {
    expect(filterAndSortPatients(patients, { query: 'jordan', condition: '', sort: 'attention' }).map((p) => p.id)).toEqual(['demo-jordan']);
    expect(filterAndSortPatients(patients, { query: 'DEMO-000203', condition: '', sort: 'name' }).map((p) => p.id)).toEqual(['demo-ethan']);
    const migraine = filterAndSortPatients(patients, { query: '', condition: 'migraine', sort: 'name' });
    expect(migraine.every((p) => p.trackers.some((t) => t.condition === 'migraine'))).toBe(true);
    expect(migraine.length).toBe(2);
  });
  it('sorts stale patients first and lowest adherence first', () => {
    expect(filterAndSortPatients(patients, { query: '', condition: '', sort: 'lastActivity' })[0].id).toBe('demo-ava');
    const adh = filterAndSortPatients(patients, { query: '', condition: '', sort: 'adherence' }).map((p) => p.adherencePct30d ?? 999);
    expect(adh).toEqual([...adh].sort((a, b) => a - b));
  });
});

describe('PatientTriage', () => {
  it('renders rows in attention order with a summary strip', () => {
    renderTriage();
    const rows = screen.getAllByTestId('patient-row');
    expect(rows).toHaveLength(patients.length);
    const top = [...patients].sort((a, b) => b.attentionScore - a.attentionScore)[0];
    expect(within(rows[0]).getByText(top.displayName)).toBeInTheDocument();
    const count = patients.filter(needsAttention).length;
    expect(screen.getByRole('region', { name: 'Panel summary' })).toHaveTextContent(new RegExp(`${count} patients? needs? attention`));
    expect(screen.getAllByText('137 d ago').length).toBeGreaterThan(0);
  });
  it('filters with the search box and condition select', () => {
    renderTriage();
    fireEvent.change(screen.getByRole('searchbox', { name: /search patients/i }), { target: { value: 'priya' } });
    expect(screen.getAllByTestId('patient-row')).toHaveLength(1);
    fireEvent.change(screen.getByRole('searchbox', { name: /search patients/i }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox', { name: /condition/i }), { target: { value: 'ibd' } });
    const rows = screen.getAllByTestId('patient-row');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('Ethan Brooks')).toBeInTheDocument();
  });
  it('shows an empty state with a clear button', () => {
    renderTriage();
    fireEvent.change(screen.getByRole('searchbox', { name: /search patients/i }), { target: { value: 'zzz' } });
    expect(screen.getByText('No patients match')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getAllByTestId('patient-row')).toHaveLength(patients.length);
  });
  it('opens the dashboard on row click', () => {
    renderTriage();
    fireEvent.click(screen.getAllByTestId('patient-row')[0]);
    expect(screen.getByTestId('where').textContent).toMatch(/^\/patients\//);
  });
});
