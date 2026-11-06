import { describe, expect, it } from 'vitest';
import { getMockSummary, mockSummary } from '../dev/mockData';
import { SPECIALTIES } from '../config/specialties';
import {
  defaultVisitMode,
  hiddenVisitItems,
  moveItem,
  normalizePreferences,
  packWidths,
  resolveHeadline,
  resolveLayout,
  sectionHasData,
  toDashboardLayout,
} from './prefs';

const all = () => true;

describe('resolveLayout', () => {
  it('uses the preset order and natural widths when nothing is saved', () => {
    const r = resolveLayout(SPECIALTIES.pulmonology, undefined, all);
    expect(r.map((x) => x.id)).toEqual(SPECIALTIES.pulmonology.sections);
    expect(r.find((x) => x.id === 'timeline')!.width).toBe('full');
    expect(r.every((x) => x.visible)).toBe(true);
  });

  it('applies saved order, visibility and width; ignores unknown ids and duplicates; appends missing sections', () => {
    const r = resolveLayout(
      SPECIALTIES.pulmonology,
      {
        sections: [
          { id: 'medications', visible: true, width: 'full' },
          { id: 'bogus', visible: true, width: 'half' },
          { id: 'attention', visible: false, width: 'half' },
          { id: 'medications', visible: false, width: 'half' },
        ],
        headline: [],
      },
      all,
    );
    expect(r[0]).toEqual({ id: 'medications', visible: true, width: 'full' });
    expect(r[1]).toEqual({ id: 'attention', visible: false, width: 'half' });
    expect(r.map((x) => x.id)).not.toContain('bogus');
    const rest = SPECIALTIES.pulmonology.sections.filter((x) => x !== 'medications' && x !== 'attention');
    expect(r.slice(2).map((x) => x.id)).toEqual(rest);
  });

  it('filters to sections this patient has (no lung function for migraine)', () => {
    const priya = getMockSummary('demo-priya', 30)!;
    const r = resolveLayout(SPECIALTIES.pulmonology, { sections: [{ id: 'lungFunction', visible: true, width: 'full' }], headline: [] }, (id) => sectionHasData(id, priya));
    expect(r.map((x) => x.id)).not.toContain('lungFunction');
    expect(r.map((x) => x.id)).not.toContain('actionPlan');
  });

  it('keeps saved entries for sections the current patient lacks when converting back', () => {
    const prev = { sections: [{ id: 'lungFunction', visible: false, width: 'half' as const }], headline: [] };
    const out = toDashboardLayout([{ id: 'attention', visible: true, width: 'half' }], [], prev);
    expect(out.sections.map((x) => x.id)).toEqual(['attention', 'lungFunction']);
  });
});

describe('resolveHeadline', () => {
  it('orders saved metrics first and appends the preset picks', () => {
    const { items } = resolveHeadline(SPECIALTIES.pulmonology, { sections: [], headline: [{ id: 'nightWaking', visible: false }, { id: 'stoolFrequency', visible: true }] }, mockSummary.headline);
    expect(items[0]).toMatchObject({ metric: { id: 'nightWaking' }, visible: false });
    expect(items.map((i) => i.metric.id)).not.toContain('stoolFrequency'); // patient doesn't have it
    expect(items[1].metric.id).toBe('zone');
  });
});

describe('helpers', () => {
  it('moveItem reorders and ignores out-of-range moves', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
  });
  it('packWidths widens a half-width section without a partner', () => {
    expect(packWidths([
      { id: 'attention', visible: true, width: 'half' },
      { id: 'timeline', visible: true, width: 'full' },
      { id: 'calendar', visible: true, width: 'half' },
      { id: 'medications', visible: false, width: 'half' },
      { id: 'actionPlan', visible: true, width: 'half' },
    ])).toEqual(['full', 'full', 'half', 'half', 'half']);
  });
  it('counts hidden visit items only for points the patient has', () => {
    const v = defaultVisitMode();
    v.calendar = false;
    v.points.rescue = false;
    v.points.abortive = false;
    const priya = getMockSummary('demo-priya', 30)!; // migraine only: no rescue point
    expect(hiddenVisitItems(v, priya)).toBe(2);
  });
  it('normalizePreferences fills missing visit flags', () => {
    const p = normalizePreferences({ clinicianId: 'x', layouts: {} }, 'x');
    expect(p.visitMode.calendar).toBe(true);
    expect(p.visitMode.points.checkins).toBe(true);
  });
});
