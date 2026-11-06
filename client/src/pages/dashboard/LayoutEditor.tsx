import type { ReactNode } from 'react';
import { Icon } from '../../components/ui';
import type { SectionId } from '../../config/specialties';
import { SECTION_LABEL, type ResolvedSection } from '../../lib/prefs';
import s from './LayoutEditor.module.css';

export function EditBanner({
  viewLabel,
  announcement,
  onDone,
  onReset,
  onCancel,
  hasSaved,
}: {
  viewLabel: string;
  announcement: string;
  onDone: () => void;
  onReset: () => void;
  onCancel: () => void;
  hasSaved: boolean;
}) {
  return (
    <div className={`${s.banner} no-print`} role="region" aria-label="Layout editing">
      <Icon name="edit" size={16} />
      <p className={s.bannerText}>
        Editing layout for <strong>{viewLabel}</strong>
        <span className={s.bannerScope}> · applies to all your patients</span>
      </p>
      <div className={s.bannerActions}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={onReset} disabled={!hasSaved} title={hasSaved ? undefined : 'Already using the default layout'}>
          Reset to default
        </button>
        <button type="button" className="btn btn-primary" onClick={onDone}>
          Done
        </button>
      </div>
      <p className="sr-only" aria-live="assertive" data-testid="layout-announcer">
        {announcement}
      </p>
    </div>
  );
}

interface FrameProps {
  section: ResolvedSection;
  index: number;
  count: number;
  dragProps: Record<string, unknown>;
  indicator: 'before' | 'after' | null;
  onMove: (from: number, to: number) => void;
  onToggleVisible: (index: number) => void;
  onToggleWidth: (index: number) => void;
  children: ReactNode;
}

/** Edit-mode wrapper: handle, move up/down, show/hide, width. Panel content is inert. */
export function SectionEditFrame({ section, index, count, dragProps, indicator, onMove, onToggleVisible, onToggleWidth, children }: FrameProps) {
  const label = SECTION_LABEL[section.id as SectionId];
  const axisClass = section.width === 'half' ? s.axisX : s.axisY;
  return (
    <div
      className={`${s.frame} ${section.width === 'full' ? s.full : s.half} ${section.visible ? '' : s.hidden} ${indicator ? s[`drop_${indicator}`] : ''} ${axisClass}`}
      data-testid={`edit-frame-${section.id}`}
      {...dragProps}
    >
      <div className={`${s.bar} no-print`}>
        <span className={s.handle} title="Drag to reorder" aria-hidden="true">
          <Icon name="grip" size={18} strokeWidth={3} />
        </span>
        <span className={s.title}>
          {label}
          <span className={s.pos}>
            {' '}
            {index + 1} of {count}
          </span>
        </span>
        <div className={s.tools} role="group" aria-label={`${label} layout`}>
          <button type="button" className={s.tool} aria-label={`Move ${label} up`} data-focus-key={`${section.id}:up`} disabled={index === 0} onClick={() => onMove(index, index - 1)}>
            <Icon name="arrowUp" size={15} />
          </button>
          <button
            type="button"
            className={s.tool}
            aria-label={`Move ${label} down`}
            data-focus-key={`${section.id}:down`}
            disabled={index === count - 1}
            onClick={() => onMove(index, index + 1)}
          >
            <Icon name="arrowDown" size={15} />
          </button>
          <button type="button" className={s.tool} aria-pressed={section.width === 'full'} aria-label={`${label}: full width`} title="Full width / half width" onClick={() => onToggleWidth(index)}>
            <Icon name="columns" size={15} />
            <span className={s.toolText}>{section.width === 'full' ? 'Full' : 'Half'}</span>
          </button>
          <button type="button" className={s.tool} aria-pressed={!section.visible} aria-label={`Hide ${label}`} onClick={() => onToggleVisible(index)}>
            <Icon name={section.visible ? 'eye' : 'eyeOff'} size={15} />
            <span className={s.toolText}>{section.visible ? 'Shown' : 'Hidden'}</span>
          </button>
        </div>
      </div>
      {section.visible ? (
        <div className={s.content} inert>
          {children}
        </div>
      ) : (
        <p className={s.placeholder}>Hidden. It won’t appear on your dashboard until you show it again.</p>
      )}
    </div>
  );
}
