/**
 * 7-day medicine history. Past days come from the raw document (GET /raw) when available;
 * if that fails we fall back to doses marked on this device (localStorage). Today always
 * comes from the home payload, which already includes anything just marked.
 */
import type { PatientAppMedication } from '@shared/types/api';
import type { HHmm, ISODate, RawPatientDocument } from '@shared/types/raw';
import { readJson, safeSet } from './storage';
import { addDays } from './time';

/** day → medicationId → times marked */
export type DoseLog = Record<ISODate, Record<string, HHmm[]>>;

const logKey = (patientId: string) => `smart-home-patient-doses:${patientId}`;

export function readLocalLog(patientId: string): DoseLog {
  const v = readJson<unknown>(logKey(patientId), {});
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as DoseLog) : {};
}

export function recordLocalDose(patientId: string, day: ISODate, medicationId: string, time: HHmm): void {
  const log = readLocalLog(patientId);
  const dayLog = (log[day] ??= {});
  (dayLog[medicationId] ??= []).push(time);
  // Keep the last 14 days only.
  const cutoff = addDays(day, -14);
  for (const d of Object.keys(log)) if (d < cutoff) delete log[d];
  safeSet(logKey(patientId), JSON.stringify(log));
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** Count doses per day per app medication from the raw document (archived duplicates matched by name). */
export function logFromRaw(raw: RawPatientDocument, meds: PatientAppMedication[], from: ISODate, to: ISODate): DoseLog {
  const rawNames = new Map(raw.medications?.map((m) => [m.id, norm(m.name)]) ?? []);
  const byName = new Map(meds.map((m) => [norm(m.name), m.id]));
  const ids = new Set(meds.map((m) => m.id));
  const out: DoseLog = {};
  for (const log of raw.dailyLogs ?? []) {
    if (!log?.day || log.day < from || log.day > to) continue;
    for (const a of log.medicationAdministrations ?? []) {
      const medId = ids.has(a.id) ? a.id : byName.get(rawNames.get(a.id) ?? norm(a.name));
      if (!medId) continue;
      ((out[log.day] ??= {})[medId] ??= []).push(a.time);
    }
  }
  return out;
}

export type DayCell = 'taken' | 'some' | 'missed' | 'pending' | 'none';

export interface HistoryRow {
  med: PatientAppMedication;
  cells: { day: ISODate; taken: number; due: number; state: DayCell }[];
}

/** Daily doses expected for a scheduled med (weekly meds aren't expected on a fixed day). */
export function dailyDue(med: PatientAppMedication): number {
  if (med.kind !== 'scheduled' || med.howOften !== 'Daily') return 0;
  return med.timesOfDay.length || med.dosesDueToday;
}

export function buildHistory(meds: PatientAppMedication[], today: ISODate, past: DoseLog, days = 7): HistoryRow[] {
  const dayList = Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
  return meds.map((med) => ({
    med,
    cells: dayList.map((day) => {
      const isToday = day === today;
      const taken = isToday ? med.dosesTakenToday : (past[day]?.[med.id]?.length ?? 0);
      const due = isToday ? (med.kind === 'scheduled' ? med.dosesDueToday : 0) : dailyDue(med);
      let state: DayCell;
      if (due === 0) state = taken > 0 ? 'taken' : 'none';
      else if (taken >= due) state = 'taken';
      else if (isToday) state = 'pending';
      else state = taken > 0 ? 'some' : 'missed';
      return { day, taken, due, state };
    }),
  }));
}
