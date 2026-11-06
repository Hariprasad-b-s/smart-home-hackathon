import { describe, expect, it } from 'vitest';
import { mockSummary, getMockSummary } from '../dev/mockData';
import {
  inferSpecialty,
  makeConditionFilter,
  resolveSpecialty,
  selectHeadline,
  SPECIALTIES,
  visibleSections,
  visibleTimelineRows,
} from './specialties';

describe('specialty inference', () => {
  it('maps a single specialty condition to that specialty', () => {
    expect(inferSpecialty(['migraine'])).toBe('neurology');
    expect(inferSpecialty(['asthma'])).toBe('pulmonology');
    expect(inferSpecialty(['ibd'])).toBe('gastroenterology');
    expect(inferSpecialty(['asthma', 'general'])).toBe('pulmonology');
  });
  it('uses Overview for several conditions or unknown ones', () => {
    expect(inferSpecialty(['asthma', 'migraine'])).toBe('all');
    expect(inferSpecialty([])).toBe('all');
    expect(inferSpecialty(['diabetes'])).toBe('all');
  });
  it('lets the URL choice win over inference, and ignores invalid views', () => {
    expect(resolveSpecialty('nursing', ['migraine']).id).toBe('nursing');
    expect(resolveSpecialty(null, ['migraine']).id).toBe('neurology');
    expect(resolveSpecialty('bogus', ['migraine']).id).toBe('neurology');
  });
});

describe('preset selection', () => {
  it('orders headline metrics by the preset and drops missing ones', () => {
    const { metrics, fellBack } = selectHeadline(SPECIALTIES.pulmonology, mockSummary.headline);
    expect(fellBack).toBe(false);
    const ids = metrics.map((m) => m.id);
    expect(ids[0]).toBe('zone');
    expect(ids).toEqual(SPECIALTIES.pulmonology.headline!.filter((id) => mockSummary.headline.some((m) => m.id === id)));
  });
  it('Overview keeps the summary order', () => {
    const { metrics } = selectHeadline(SPECIALTIES.all, mockSummary.headline);
    expect(metrics.map((m) => m.id)).toEqual(mockSummary.headline.slice(0, 8).map((m) => m.id));
  });
  it('falls back when a preset matches nothing the patient has', () => {
    const gi = selectHeadline(SPECIALTIES.gastroenterology, mockSummary.headline.filter((m) => m.id === 'zone' || m.id === 'lungFunction'));
    expect(gi.fellBack).toBe(true);
    expect(gi.metrics.length).toBeGreaterThan(0);
  });
  it('filters cards by emphasised condition, but shows everything when the patient has none of them', () => {
    const neuro = makeConditionFilter(SPECIALTIES.neurology, ['asthma', 'migraine']);
    expect(neuro('migraine')).toBe(true);
    expect(neuro('asthma')).toBe(false);
    expect(neuro(undefined)).toBe(true);
    const neuroAsthmaOnly = makeConditionFilter(SPECIALTIES.neurology, ['asthma']);
    expect(neuroAsthmaOnly('asthma')).toBe(true);
  });
  it('hides sections and timeline rows without data', () => {
    const migraineOnly = getMockSummary('demo-priya', 30)!;
    expect(visibleSections(SPECIALTIES.all, migraineOnly)).not.toContain('lungFunction');
    expect(visibleSections(SPECIALTIES.all, migraineOnly)).not.toContain('actionPlan');
    expect(visibleTimelineRows(SPECIALTIES.all, migraineOnly)).not.toContain('peakFlow');
    expect(visibleSections(SPECIALTIES.pulmonology, mockSummary)[0]).toBe('lungFunction');
  });
});
