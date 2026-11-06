import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { DashboardLayout, MediaItem, PatientSummary, VisitModeVisibility } from '@shared/types';
import { ApiRequestError, fetchPatientMedia, fetchPatientSummary, useApi } from '../api';
import { EmptyState, ErrorState, Icon, LoadingState } from '../components/ui';
import {
  inferSpecialty,
  isSpecialtyId,
  makeConditionFilter,
  resolveSpecialty,
  type SectionId,
  type SpecialtyId,
  type SpecialtyPreset,
} from '../config/specialties';
import {
  moveItem,
  packWidths,
  resolveHeadline,
  resolveLayout,
  sectionHasData,
  SECTION_LABEL,
  toDashboardLayout,
  type ResolvedMetric,
} from '../lib/prefs';
import { useDragReorder } from '../lib/useDragReorder';
import { useClinicianPrefs } from '../state/ClinicianContext';
import { isOpenStatus, useNotifications } from '../state/NotificationsContext';
import { MediaPanel } from './dashboard/MediaPanel';
import { EditBanner, SectionEditFrame } from './dashboard/LayoutEditor';
import { parseDashboardState, patchDashboardParams, type WindowDays } from '../lib/urlState';
import { formatDate, formatDaysAgoLong } from '../lib/format';
import { DashboardHeader } from './dashboard/DashboardHeader';
import { HeadlineStrip } from './dashboard/HeadlineStrip';
import { AttentionPanel } from './dashboard/AttentionPanel';
import { CalendarPanel } from './dashboard/CalendarPanel';
import { TimelinePanel } from './dashboard/TimelinePanel';
import { MedicationsPanel } from './dashboard/MedicationsPanel';
import { LungFunctionPanel } from './dashboard/LungFunctionPanel';
import { ActionPlanPanel } from './dashboard/ActionPlanPanel';
import { TrackersPanel } from './dashboard/TrackersPanel';
import { DayDrawer } from './dashboard/DayDrawer';
import { DataNotes } from './dashboard/DataNotes';
import { VisitMode } from './dashboard/VisitMode';
import s from './dashboard/Dashboard.module.css';

export function PatientDashboard() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const state = parseDashboardState(params);
  const { data, error, loading, reload } = useApi((signal) => fetchPatientSummary(id, state.days, signal), [id, state.days]);
  const mediaApi = useApi((signal) => fetchPatientMedia(id, state.days, signal), [id, state.days]);
  const media: MediaItem[] | null | undefined = mediaApi.error ? null : mediaApi.data;
  const { subscribe } = useNotifications();
  const [hasNewData, setHasNewData] = useState(false);

  // New check-ins / media for this patient: offer a quiet refresh instead of reloading.
  useEffect(() => {
    setHasNewData(false);
    return subscribe((e) => {
      if ((e.type === 'media.created' || e.type === 'checkin.created') && e.patientId === id) setHasNewData(true);
    });
  }, [subscribe, id]);
  const reloadMedia = mediaApi.reload;
  const refreshNew = useCallback(() => {
    setHasNewData(false);
    reload();
    reloadMedia();
  }, [reload, reloadMedia]);

  const update = useCallback(
    (patch: Parameters<typeof patchDashboardParams>[1], replace = false) => setParams((prev) => patchDashboardParams(prev, patch), { replace }),
    [setParams],
  );

  if (error && !data) {
    const notFound = error instanceof ApiRequestError && error.status === 404;
    return notFound ? (
      <EmptyState title="Patient not found" action={<Link className="btn" to="/">Back to patients</Link>}>
        No patient with id “{id}”. The link may be out of date.
      </EmptyState>
    ) : (
      <ErrorState title="Couldn’t load this patient’s summary" error={error} onRetry={reload} />
    );
  }
  if (!data) return <LoadingState label="Building the summary…" />;
  // Avoid flashing another patient's data while switching patients.
  if (data.patient.id !== id && loading) return <LoadingState label="Building the summary…" />;

  return (
    <DashboardView
      summary={data}
      loading={loading}
      error={error}
      onRetry={reload}
      urlState={state}
      update={update}
      media={media}
      hasNewData={hasNewData}
      onRefreshNewData={refreshNew}
    />
  );
}

export interface DashboardViewProps {
  summary: PatientSummary;
  loading?: boolean;
  error?: Error;
  onRetry?: () => void;
  urlState: ReturnType<typeof parseDashboardState>;
  update: (patch: Partial<{ days: WindowDays; view: SpecialtyId | null; mode: 'clinic' | 'visit'; day: string | null }>, replace?: boolean) => void;
  /** Patient media for the window: undefined while loading, null when it failed. */
  media?: MediaItem[] | null;
  hasNewData?: boolean;
  onRefreshNewData?: () => void;
}

export function DashboardView({ summary, loading, error, onRetry, urlState, update, media, hasNewData, onRefreshNewData }: DashboardViewProps) {
  const ctx = useClinicianPrefs();
  const { inbox } = useNotifications();
  const openConversation = inbox.find((i) => i.patientId === summary.patient.id && isOpenStatus(i.status));
  const { clinician, prefs, editSession } = ctx;
  const conditions = summary.patient.trackers.map((t) => t.condition);
  const preset = resolveSpecialty(urlState.view, conditions, clinician?.defaultView);
  const inferred: SpecialtyId = isSpecialtyId(clinician?.defaultView) ? clinician.defaultView : inferSpecialty(conditions);
  const [highlight, setHighlight] = useState<string[] | undefined>(undefined);
  const [visitOverride, setVisitOverride] = useState<VisitModeVisibility | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const focusAfterMove = useRef<string | null>(null);

  // Expand every <details> for printing, then restore.
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      opened = [...document.querySelectorAll<HTMLDetailsElement>('main details:not([open])')];
      opened.forEach((d) => (d.open = true));
    };
    const after = () => opened.forEach((d) => (d.open = false));
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  // Keep keyboard focus on the move button that was used, after the item moves.
  useEffect(() => {
    const key = focusAfterMove.current;
    if (!key) return;
    focusAfterMove.current = null;
    const [id, dir] = key.split(':');
    const el =
      document.querySelector<HTMLButtonElement>(`[data-focus-key="${id}:${dir}"]:not(:disabled)`) ??
      document.querySelector<HTMLButtonElement>(`[data-focus-key="${id}:${dir === 'up' ? 'down' : 'up'}"]`);
    el?.focus();
  });

  const selectDay = useCallback((date: string) => update({ day: date }), [update]);

  const emptyWindow = summary.freshness.activeDaysInWindow === 0;
  const saved = prefs.layouts[preset.id];
  const isAvailable = (id: SectionId) => sectionHasData(id, summary) && (!emptyWindow || id === 'attention' || id === 'actionPlan');
  const resolvedSections = resolveLayout(preset, saved, isAvailable);
  const resolvedHeadline = resolveHeadline(preset, saved, summary.headline);
  const editing = !!editSession && editSession.viewId === preset.id && editSession.patientId === summary.patient.id;
  const stale = !!editSession && !editing;
  const metricById = new Map(summary.headline.map((m) => [m.id, m]));
  const sections = editing ? editSession.draft.sections : resolvedSections;
  const headlineItems: ResolvedMetric[] = editing
    ? editSession.draft.headline.flatMap((h) => {
        const metric = metricById.get(h.id);
        return metric ? [{ metric, visible: h.visible }] : [];
      })
    : resolvedHeadline.items;
  const visibility = visitOverride ?? prefs.visitMode;

  const draftFor = (layout: DashboardLayout | undefined) => ({
    sections: resolveLayout(preset, layout, isAvailable),
    headline: resolveHeadline(preset, layout, summary.headline).items.map((i) => ({ id: i.metric.id, visible: i.visible })),
  });
  const startEditing = () => ctx.startEdit({ viewId: preset.id, viewLabel: preset.label, patientId: summary.patient.id, draft: draftFor(saved) });
  const keepEditing = () => {
    if (!editSession) return;
    const carried = toDashboardLayout(editSession.draft.sections, editSession.draft.headline, saved);
    ctx.startEdit({ viewId: preset.id, viewLabel: preset.label, patientId: summary.patient.id, draft: draftFor(carried) }, true);
  };

  const moveSection = (from: number, to: number) => {
    if (!editing || to < 0 || to >= sections.length) return;
    const id = sections[from].id;
    ctx.updateDraft((d) => ({ ...d, sections: moveItem(d.sections, from, to) }));
    setAnnouncement(`${SECTION_LABEL[id]} moved to position ${to + 1} of ${sections.length}`);
    focusAfterMove.current = `${id}:${to < from ? 'up' : 'down'}`;
  };
  const toggleSection = (i: number) => {
    const sec = sections[i];
    ctx.updateDraft((d) => ({ ...d, sections: d.sections.map((x, j) => (j === i ? { ...x, visible: !x.visible } : x)) }));
    setAnnouncement(`${SECTION_LABEL[sec.id]} ${sec.visible ? 'hidden' : 'shown'}`);
  };
  const toggleWidth = (i: number) => {
    const sec = sections[i];
    ctx.updateDraft((d) => ({ ...d, sections: d.sections.map((x, j) => (j === i ? { ...x, width: x.width === 'full' ? 'half' : 'full' } : x)) }));
    setAnnouncement(`${SECTION_LABEL[sec.id]} set to ${sec.width === 'full' ? 'half' : 'full'} width`);
  };
  const moveMetric = (from: number, to: number) => {
    if (!editing || to < 0 || to >= headlineItems.length) return;
    const m = headlineItems[from].metric;
    ctx.updateDraft((d) => ({ ...d, headline: moveItem(d.headline, from, to) }));
    setAnnouncement(`${m.label} moved to position ${to + 1} of ${headlineItems.length}`);
    focusAfterMove.current = `metric-${m.id}:${to < from ? 'up' : 'down'}`;
  };
  const toggleMetric = (i: number) => {
    const item = headlineItems[i];
    ctx.updateDraft((d) => ({ ...d, headline: d.headline.map((h, j) => (j === i ? { ...h, visible: !h.visible } : h)) }));
    setAnnouncement(`${item.metric.label} ${item.visible ? 'hidden' : 'shown'}`);
  };
  const dnd = useDragReorder(moveSection);

  if (urlState.mode === 'visit') {
    return (
      <VisitMode
        summary={summary}
        visibility={visibility}
        onExit={() => {
          setVisitOverride(null);
          update({ mode: 'clinic' });
        }}
      />
    );
  }

  const displayWidths = packWidths(sections);

  return (
    <div className={s.dashboard}>
      <DashboardHeader
        summary={summary}
        preset={preset}
        inferred={inferred}
        days={urlState.days}
        loading={loading}
        onDays={(days) => update({ days })}
        onView={(view) => update({ view })}
        onVisit={() => update({ mode: 'visit', day: null })}
        visibility={visibility}
        onSaveVisitDefault={clinician ? (v) => ctx.updatePrefs((p) => ({ ...p, visitMode: v }), { immediate: true }) : undefined}
        onJustThisVisit={(v) => {
          setVisitOverride(v);
          update({ mode: 'visit', day: null });
        }}
        onCustomize={clinician && !emptyWindow && !editSession ? startEditing : undefined}
        conversation={openConversation}
      />
      {hasNewData ? (
        <div className={`${s.newData} no-print`} role="status">
          <button type="button" className={s.newDataPill} onClick={onRefreshNewData}>
            <Icon name="refresh" size={14} /> New data, refresh
          </button>
        </div>
      ) : null}
      {error ? <ErrorState title="Couldn’t refresh this summary; showing the last loaded data" error={error} onRetry={onRetry} /> : null}

      {stale && editSession ? (
        <div className={`${s.staleBanner} no-print`} role="region" aria-label="Unsaved layout changes">
          <p>
            You have unsaved layout changes for the <strong>{editSession.viewLabel}</strong> view
            {editSession.patientId !== summary.patient.id ? ', made on another patient' : ''}. Save them before continuing?
          </p>
          <button type="button" className="btn btn-primary" onClick={() => ctx.endEdit(true)}>
            Save changes
          </button>
          <button type="button" className="btn" onClick={() => ctx.endEdit(false)}>
            Discard
          </button>
          {editSession.viewId === preset.id ? (
            <button type="button" className="btn btn-ghost" onClick={keepEditing}>
              Keep editing here
            </button>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <EditBanner
          viewLabel={preset.label}
          announcement={announcement}
          hasSaved={!!saved}
          onDone={() => {
            ctx.endEdit(true);
            setAnnouncement('');
          }}
          onCancel={() => {
            ctx.endEdit(false);
            setAnnouncement('');
          }}
          onReset={() => {
            ctx.resetLayout(preset.id);
            setAnnouncement('');
          }}
        />
      ) : null}

      {emptyWindow ? (
        <EmptyState
          title={`No entries in ${summary.window.label.toLowerCase()}`}
          action={
            urlState.days !== 'all' ? (
              <button type="button" className="btn btn-primary" onClick={() => update({ days: 'all' })}>
                Show all time
              </button>
            ) : undefined
          }
        >
          {summary.freshness.lastActivityDate
            ? `Last activity was on ${formatDate(summary.freshness.lastActivityDate)} (${formatDaysAgoLong(summary.freshness.daysSinceLastActivity)}).`
            : 'This patient has not recorded any activity yet.'}
        </EmptyState>
      ) : (
        <HeadlineStrip
          summary={summary}
          preset={preset}
          items={headlineItems}
          fellBack={resolvedHeadline.fellBack}
          editing={editing}
          onMove={moveMetric}
          onToggle={toggleMetric}
        />
      )}

      <div className={s.grid}>
        {sections.map((sec, i) => {
          const panel = (
            <SectionSwitch
              id={sec.id}
              span={sec.width === 'full' ? 2 : 1}
              summary={summary}
              preset={preset}
              highlight={highlight}
              setHighlight={setHighlight}
              selectedDate={urlState.day ?? undefined}
              onSelectDay={selectDay}
              media={media}
            />
          );
          if (editing) {
            return (
              <SectionEditFrame
                key={sec.id}
                section={sec}
                index={i}
                count={sections.length}
                dragProps={dnd.itemProps(i, sec.width === 'half' ? 'x' : 'y')}
                indicator={dnd.indicator(i)}
                onMove={moveSection}
                onToggleVisible={toggleSection}
                onToggleWidth={toggleWidth}
              >
                {panel}
              </SectionEditFrame>
            );
          }
          if (!sec.visible) return null;
          return (
            <div key={`${sec.id}-${preset.id}`} className={displayWidths[i] === 'full' ? s.cellFull : s.cellHalf} data-testid={`section-${sec.id}`}>
              {panel}
            </div>
          );
        })}
      </div>

      <DataNotes summary={summary} />

      {urlState.day && !editing ? (
        <DayDrawer
          summary={summary}
          date={urlState.day}
          onClose={() => update({ day: null })}
          onNavigate={(date) => update({ day: date }, true)}
          media={media ?? undefined}
        />
      ) : null}
    </div>
  );
}

interface SectionProps {
  id: SectionId;
  span: 1 | 2;
  summary: PatientSummary;
  preset: SpecialtyPreset;
  highlight?: string[];
  setHighlight: (d: string[] | undefined) => void;
  selectedDate?: string;
  onSelectDay: (d: string) => void;
  media?: MediaItem[] | null;
}

function SectionSwitch({ id, span, summary, preset, highlight, setHighlight, selectedDate, onSelectDay, media }: SectionProps) {
  const conditionFilter = useMemo(
    () => makeConditionFilter(preset, summary.patient.trackers.map((t) => t.condition)),
    [preset, summary.patient.trackers],
  );
  const common = { summary, span, selectedDate, onSelectDay };
  switch (id) {
    case 'attention':
      return <AttentionPanel summary={summary} span={span} onHighlight={setHighlight} />;
    case 'calendar':
      return <CalendarPanel {...common} preset={preset} highlightDates={highlight} />;
    case 'timeline':
      return <TimelinePanel {...common} preset={preset} highlightDates={highlight} />;
    case 'medications':
      return <MedicationsPanel {...common} conditionFilter={conditionFilter} />;
    case 'lungFunction':
      return <LungFunctionPanel {...common} />;
    case 'actionPlan':
      return <ActionPlanPanel summary={summary} span={span} />;
    case 'trackers':
      return <TrackersPanel {...common} conditionFilter={conditionFilter} />;
    case 'media':
      return <MediaPanel media={media} span={span} onSelectDay={onSelectDay} />;
  }
}
