/**
 * Demo clinicians (fictional) and their saved dashboard / visit-mode preferences.
 * Preferences persist in server/data/runtime/clinicians/<clinicianId>.json (gitignored).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClinicianPreferences, ClinicianProfile, DashboardLayout, VisitModeVisibility } from '../../shared/types/api';
import type { HeadlineMetricId, PatientFacingPointKey } from '../../shared/types/summary';

export const DEFAULT_CLINICIANS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runtime', 'clinicians');

/** Fictional demo clinicians — no real people. */
export const CLINICIANS: ClinicianProfile[] = [
  { id: 'demo-pulm', displayName: 'Dr. Alex Rivera', role: 'Pediatric pulmonologist', defaultView: 'pulmonology' },
  { id: 'demo-pcp', displayName: 'Dr. Priya Castellano', role: 'Primary care pediatrician', defaultView: 'primaryCare' },
  { id: 'demo-nurse', displayName: 'Jamie Okonkwo, RN', role: 'Asthma nurse educator', defaultView: 'nursing' },
  { id: 'demo-neuro', displayName: 'Dr. Morgan Lindgren', role: 'Pediatric neurologist', defaultView: 'neurology' },
];

/**
 * Care team for a patient (CONTRACT used by chat escalation and media notifications):
 * asthma → pulmonologist + nurse educator; migraine → neurologist; anything else (IBD, …) →
 * primary care. The nurse educator is always included as the first responder.
 */
export function careTeamFor(doc: { trackers: { trackerId: string; active: boolean }[] }): string[] {
  const ids = new Set<string>(['demo-nurse']);
  for (const t of doc.trackers) {
    if (!t.active) continue;
    if (t.trackerId.startsWith('asthma')) ids.add('demo-pulm');
    else if (t.trackerId.startsWith('migraine')) ids.add('demo-neuro');
    else ids.add('demo-pcp');
  }
  return [...ids];
}

export const POINT_KEYS: PatientFacingPointKey[] = ['medication', 'rescue', 'abortive', 'lungFunction', 'symptoms', 'school', 'checkins'];
const VISIT_FLAGS = ['headline', 'dayCounts', 'calendar', 'achievements'] as const;
const MAX_ITEMS = 50;
const MAX_VIEWS = 50;
const MAX_ID = 64;

export function defaultVisitMode(): VisitModeVisibility {
  return {
    headline: true,
    dayCounts: true,
    calendar: true,
    achievements: true,
    points: Object.fromEntries(POINT_KEYS.map((k) => [k, true])) as Record<PatientFacingPointKey, boolean>,
  };
}

export function defaultPreferences(clinicianId: string): ClinicianPreferences {
  return { clinicianId, layouts: {}, visitMode: defaultVisitMode() };
}

/** Saved (possibly older-shaped) preferences merged over current defaults: new keys default to true. */
export function mergeWithDefaults(clinicianId: string, saved: Partial<ClinicianPreferences> | undefined): ClinicianPreferences {
  const d = defaultPreferences(clinicianId);
  if (!saved) return d;
  const vm = (saved.visitMode ?? {}) as Partial<VisitModeVisibility>;
  const out: ClinicianPreferences = {
    clinicianId,
    layouts: saved.layouts && typeof saved.layouts === 'object' ? saved.layouts : {},
    visitMode: { ...d.visitMode, ...vm, points: { ...d.visitMode.points, ...(vm.points ?? {}) } },
  };
  if (saved.updatedAt) out.updatedAt = saved.updatedAt;
  return out;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const extraKeys = (o: Record<string, unknown>, allowed: string[]) => Object.keys(o).filter((k) => !allowed.includes(k));

function validateItems(arr: unknown, where: string, withWidth: boolean): string | null {
  if (!Array.isArray(arr)) return `${where} must be an array.`;
  if (arr.length > MAX_ITEMS) return `${where} has more than ${MAX_ITEMS} entries.`;
  const seen = new Set<string>();
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    const at = `${where}[${i}]`;
    if (!isObj(it)) return `${at} must be an object.`;
    const extra = extraKeys(it, withWidth ? ['id', 'visible', 'width'] : ['id', 'visible']);
    if (extra.length) return `${at} has unknown field(s): ${extra.join(', ')}.`;
    if (typeof it.id !== 'string' || !it.id.trim() || it.id.length > MAX_ID) return `${at}.id must be a non-empty string (≤ ${MAX_ID} chars).`;
    if (seen.has(it.id)) return `${where} has a duplicate id "${it.id}".`;
    seen.add(it.id);
    if (typeof it.visible !== 'boolean') return `${at}.visible must be a boolean.`;
    if (withWidth && it.width !== 'full' && it.width !== 'half') return `${at}.width must be "full" or "half".`;
  }
  return null;
}

/** Strict validation of a PUT body. Returns the normalized preferences or an error message. */
export function validatePreferences(body: unknown, clinicianId: string): ClinicianPreferences | string {
  if (!isObj(body)) return 'Body must be a JSON object.';
  const extra = extraKeys(body, ['clinicianId', 'updatedAt', 'layouts', 'visitMode']);
  if (extra.length) return `Unknown field(s): ${extra.join(', ')}.`;
  if (body.clinicianId !== clinicianId) return `clinicianId must be "${clinicianId}" (matching the URL).`;

  if (!isObj(body.layouts)) return 'layouts must be an object of view id → layout.';
  const views = Object.entries(body.layouts);
  if (views.length > MAX_VIEWS) return `layouts has more than ${MAX_VIEWS} views.`;
  const layouts: Record<string, DashboardLayout> = {};
  for (const [view, layout] of views) {
    if (!view.trim() || view.length > MAX_ID) return `layouts has an invalid view id "${view}".`;
    if (!isObj(layout)) return `layouts.${view} must be an object.`;
    const lx = extraKeys(layout, ['sections', 'headline']);
    if (lx.length) return `layouts.${view} has unknown field(s): ${lx.join(', ')}.`;
    const err = validateItems(layout.sections, `layouts.${view}.sections`, true) ?? validateItems(layout.headline, `layouts.${view}.headline`, false);
    if (err) return err;
    layouts[view] = {
      sections: (layout.sections as DashboardLayout['sections']).map(({ id, visible, width }) => ({ id, visible, width })),
      headline: (layout.headline as { id: string; visible: boolean }[]).map(({ id, visible }) => ({ id: id as HeadlineMetricId, visible })),
    };
  }

  if (!isObj(body.visitMode)) return 'visitMode must be an object.';
  const vm = body.visitMode;
  const vx = extraKeys(vm, [...VISIT_FLAGS, 'points']);
  if (vx.length) return `visitMode has unknown field(s): ${vx.join(', ')}.`;
  for (const k of VISIT_FLAGS) if (vm[k] !== undefined && typeof vm[k] !== 'boolean') return `visitMode.${k} must be a boolean.`;
  if (vm.points !== undefined) {
    if (!isObj(vm.points)) return 'visitMode.points must be an object.';
    for (const [k, v] of Object.entries(vm.points)) {
      if (!POINT_KEYS.includes(k as PatientFacingPointKey)) return `visitMode.points has unknown key "${k}" (expected ${POINT_KEYS.join(', ')}).`;
      if (typeof v !== 'boolean') return `visitMode.points.${k} must be a boolean.`;
    }
  }
  return mergeWithDefaults(clinicianId, { layouts, visitMode: vm as unknown as VisitModeVisibility });
}

/** File-backed (or in-memory when `dir` is null) preference store. */
export class ClinicianPrefsStore {
  private readonly saved = new Map<string, Partial<ClinicianPreferences>>();

  constructor(readonly dir: string | null) {
    if (!dir || !existsSync(dir)) return;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      try {
        this.saved.set(f.slice(0, -5), JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
      } catch (err) {
        console.warn(`[clinicians] Ignoring unreadable ${f}: ${(err as Error).message}`);
      }
    }
  }

  get(clinicianId: string): ClinicianPreferences {
    return mergeWithDefaults(clinicianId, this.saved.get(clinicianId));
  }

  put(prefs: ClinicianPreferences): ClinicianPreferences {
    this.saved.set(prefs.clinicianId, prefs);
    if (this.dir) {
      mkdirSync(this.dir, { recursive: true });
      const file = path.join(this.dir, `${prefs.clinicianId}.json`);
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, JSON.stringify(prefs, null, 2) + '\n');
      renameSync(tmp, file);
    }
    return this.get(prefs.clinicianId);
  }

  clear(): void {
    this.saved.clear();
    if (!this.dir || !existsSync(this.dir)) return;
    for (const f of readdirSync(this.dir)) if (f.endsWith('.json') || f.endsWith('.tmp')) rmSync(path.join(this.dir, f));
  }
}
