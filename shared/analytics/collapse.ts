/**
 * Collapses the many tracker submissions of a day into one value per question:
 *  - the LAST non-empty answer (by local submission time) wins,
 *  - except checkbox questions, which are the UNION over the day.
 * Blank submissions (no non-empty answers) are kept for display but supply nothing.
 */
import type { ISODate, RawPatientDocument } from '../types/raw';
import type { Severity, TrackerDefinition, TrackerQuestion } from '../types/tracker';
import { localDateOf, localTimeOf } from './dates';
import { decodeAnswer, displayDecoded, type Decoded } from './decode';

export interface CollapsedAnswer {
  trackerId: string;
  question: TrackerQuestion;
  value: Decoded;
  /** Local "HH:mm" of the (last) submission that supplied the value. */
  time: string;
  /** Categorical: the answer changed between submissions of the same day. */
  changedDuringDay: boolean;
  /** Categorical: label with the highest severity seen this day. */
  worstLabel?: string;
  worstSeverity?: Severity;
  /** Categorical: every non-empty answer of the day in time order. */
  sequence?: { time: string; label: string }[];
}

export interface SubmissionInfo {
  responseId: string;
  trackerId: string;
  submittedAt: string;
  time: string;
  blank: boolean;
  usedForDay: boolean;
  answers: { questionId: string; shortLabel: string; display: string }[];
  entryMode?: 'form' | 'voice';
  transcript?: string;
  mediaIds?: string[];
}

export interface CollapsedDay {
  date: ISODate;
  /** Sorted by local submission time. */
  submissions: SubmissionInfo[];
  /** trackerId → questionId → collapsed answer. */
  answers: Map<string, Map<string, CollapsedAnswer>>;
  nonBlankCount: number;
  blankCount: number;
}

export interface CollapseResult {
  days: Map<ISODate, CollapsedDay>;
  /** "trackerId/questionId" pairs seen in data but not in any definition. */
  unknownQuestions: Map<string, { count: number; dates: Set<ISODate> }>;
  /** Tracker ids with submissions but no definition. */
  unknownTrackers: Set<string>;
}

interface PendingSub {
  date: ISODate;
  sortKey: string;
  info: SubmissionInfo;
  decoded: { q: TrackerQuestion; d: Decoded }[];
}

export function collapseTrackerResponses(
  doc: RawPatientDocument,
  defs: Map<string, TrackerDefinition>,
): CollapseResult {
  const unknownQuestions: CollapseResult['unknownQuestions'] = new Map();
  const unknownTrackers = new Set<string>();
  const byDate = new Map<ISODate, PendingSub[]>();

  for (const log of doc.dailyLogs ?? []) {
    for (const r of log?.trackerResponses ?? []) {
      if (!r) continue;
      const date = localDateOf(r.submittedAt) ?? localDateOf(log.day);
      if (!date) continue;
      const def = defs.get(r.trackerId);
      if (!def) unknownTrackers.add(r.trackerId);
      const qById = new Map((def?.questions ?? []).map((q) => [q.id, q]));
      // Within one submission a repeated question id: last one wins.
      const perQ = new Map<string, { q: TrackerQuestion; d: Decoded }>();
      for (const a of r.responses ?? []) {
        if (!a) continue;
        const q = qById.get(a.questionId);
        if (!q) {
          if (def) {
            const k = `${r.trackerId}/${a.questionId}`;
            const u = unknownQuestions.get(k) ?? { count: 0, dates: new Set<ISODate>() };
            u.count++;
            u.dates.add(date);
            unknownQuestions.set(k, u);
          }
          continue;
        }
        const d = decodeAnswer(q, a.value);
        if (d) perQ.set(q.id, { q, d });
        else perQ.delete(q.id);
      }
      const decoded = [...perQ.values()].sort((a, b) => a.q.order - b.q.order);
      const time = localTimeOf(r.submittedAt);
      const info: SubmissionInfo = {
        responseId: r.id,
        trackerId: r.trackerId,
        submittedAt: r.submittedAt,
        time,
        blank: decoded.length === 0,
        usedForDay: false,
        answers: decoded.map(({ q, d }) => ({ questionId: q.id, shortLabel: q.shortLabel, display: displayDecoded(d) })),
      };
      if (r.entryMode === 'voice') info.entryMode = 'voice';
      if (typeof r.transcript === 'string' && r.transcript.trim()) info.transcript = r.transcript.trim();
      if (Array.isArray(r.mediaIds) && r.mediaIds.length) info.mediaIds = [...r.mediaIds];
      const sortKey = typeof r.submittedAt === 'string' && r.submittedAt.length >= 16 ? r.submittedAt.slice(0, 23) : `${date}T${time}`;
      const list = byDate.get(date) ?? [];
      list.push({ date, sortKey, info, decoded });
      byDate.set(date, list);
    }
  }

  const days = new Map<ISODate, CollapsedDay>();
  for (const [date, subs] of byDate) {
    subs.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.info.responseId.localeCompare(b.info.responseId)));
    const answers = new Map<string, Map<string, CollapsedAnswer>>();
    // Which submissions (by index) supplied each final value.
    const suppliers = new Map<string, Set<number>>();
    const choiceSeen = new Map<string, Set<string>>();

    subs.forEach((s, idx) => {
      const tmap = answers.get(s.info.trackerId) ?? new Map<string, CollapsedAnswer>();
      answers.set(s.info.trackerId, tmap);
      for (const { q, d } of s.decoded) {
        const key = `${s.info.trackerId}\u0000${q.id}`;
        const prev = tmap.get(q.id);
        if (d.kind === 'multi') {
          const items = prev && prev.value.kind === 'multi' ? [...prev.value.items] : [];
          for (const it of d.items) if (!items.includes(it)) items.push(it);
          const noneSelected = (prev?.value.kind === 'multi' && prev.value.noneSelected) || d.noneSelected;
          tmap.set(q.id, {
            trackerId: s.info.trackerId,
            question: q,
            value: { kind: 'multi', items, noneSelected },
            time: s.info.time,
            changedDuringDay: false,
          });
          const set = suppliers.get(key) ?? new Set<number>();
          set.add(idx);
          suppliers.set(key, set);
        } else {
          const entry: CollapsedAnswer = {
            trackerId: s.info.trackerId,
            question: q,
            value: d,
            time: s.info.time,
            changedDuringDay: false,
            worstLabel: prev?.worstLabel,
            worstSeverity: prev?.worstSeverity,
          };
          if (d.kind === 'choice') {
            entry.sequence = [...(prev?.sequence ?? []), { time: s.info.time, label: d.label }];
            const seen = choiceSeen.get(key) ?? new Set<string>();
            seen.add(d.label);
            choiceSeen.set(key, seen);
            entry.changedDuringDay = seen.size > 1;
            if (d.severity !== undefined && (entry.worstSeverity === undefined || d.severity > entry.worstSeverity)) {
              entry.worstSeverity = d.severity;
              entry.worstLabel = d.label;
            }
          }
          tmap.set(q.id, entry);
          suppliers.set(key, new Set([idx]));
        }
      }
    });

    const used = new Set<number>();
    for (const set of suppliers.values()) for (const i of set) used.add(i);
    subs.forEach((s, i) => {
      s.info.usedForDay = used.has(i);
    });
    const nonBlankCount = subs.filter((s) => !s.info.blank).length;
    days.set(date, {
      date,
      submissions: subs.map((s) => s.info),
      answers,
      nonBlankCount,
      blankCount: subs.length - nonBlankCount,
    });
  }
  return { days, unknownQuestions, unknownTrackers };
}
