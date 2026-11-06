/**
 * Internal building blocks shared by every chart: container-width hook (ResizeObserver
 * with a jsdom-safe fallback), keyboard/pointer "day cursor", lightweight tooltip,
 * legend swatches, empty state, SVG hatch pattern for "no data", date axis.
 * Not exported from index.ts (internal to the charts module).
 */
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { fmtDay } from './chartUtils';
import s from './charts.module.css';

// ───────────────────────── container width ─────────────────────────

const useIsoLayoutEffect = typeof window === 'undefined' ? () => {} : useLayoutEffect;

/** Width of the referenced element; falls back to `fallback` where layout is unavailable (jsdom/SSR). */
export function useContainerWidth<T extends HTMLElement = HTMLDivElement>(
  fallback = 640,
): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (w: number) => {
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) >= 1 ? Math.floor(w) : prev));
    };
    measure(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) measure(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** useId sanitized for SVG url(#id) references. */
export function useSafeId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

// ───────────────────────── day cursor (hover + keyboard) ─────────────────────────

export interface DayCursor {
  active: number | null;
  /** True when the cursor is driven by the keyboard (show a focus guide). */
  viaKeyboard: boolean;
  setPointer: (i: number | null) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onFocus: () => void;
  onBlur: () => void;
}

/**
 * Shared interaction model for strip/line charts: one focusable element; ←/→ move a
 * day, PageUp/PageDown a week, Home/End jump, Enter/Space selects, Esc clears.
 * `isStop(i)` limits keyboard stops (e.g. only days with a session).
 */
export function useDayCursor(
  n: number,
  opts: { onSelect?: (i: number) => void; initial?: () => number; isStop?: (i: number) => boolean } = {},
): DayCursor {
  const [active, setActive] = useState<number | null>(null);
  const [viaKeyboard, setViaKeyboard] = useState(false);
  const { onSelect, initial, isStop } = opts;

  const step = useCallback(
    (from: number, delta: number) => {
      let i = from;
      const dir = Math.sign(delta) || 1;
      let remaining = Math.abs(delta);
      while (remaining > 0) {
        let j = i + dir;
        while (j >= 0 && j < n && isStop && !isStop(j)) j += dir;
        if (j < 0 || j >= n) break;
        i = j;
        remaining -= 1;
      }
      return i;
    },
    [n, isStop],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (n === 0) return;
      const cur = active ?? (initial ? initial() : n - 1);
      let next: number | null = null;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = step(cur, 1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          next = step(cur, -1);
          break;
        case 'PageDown':
          next = step(cur, 7);
          break;
        case 'PageUp':
          next = step(cur, -7);
          break;
        case 'Home':
          next = step(-1, 1);
          break;
        case 'End':
          next = step(n, -1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (onSelect && cur >= 0 && cur < n) onSelect(cur);
          return;
        case 'Escape':
          setActive(null);
          return;
        default:
          return;
      }
      e.preventDefault();
      setViaKeyboard(true);
      setActive(next);
    },
    [active, n, initial, onSelect, step],
  );

  return {
    active,
    viaKeyboard,
    setPointer: (i) => {
      setViaKeyboard(false);
      setActive(i);
    },
    onKeyDown,
    onFocus: () => {
      setViaKeyboard(true);
      setActive((a) => a ?? (n > 0 ? (initial ? initial() : n - 1) : null));
    },
    onBlur: () => setActive(null),
  };
}

// ───────────────────────── tooltip ─────────────────────────

export function ChartTooltip({
  x,
  y,
  containerWidth,
  children,
  placement = 'above',
}: {
  x: number;
  y: number;
  containerWidth: number;
  children: ReactNode;
  /** above/below anchor on (x, y); side puts it beside a vertical guide at x. */
  placement?: 'above' | 'below' | 'side';
}) {
  const frac = containerWidth > 0 ? x / containerWidth : 0.5;
  let tx: string;
  let ty: string;
  if (placement === 'side') {
    tx = frac > 0.55 ? 'calc(-100% - 12px)' : '12px';
    ty = '0';
  } else {
    tx = frac < 0.25 ? '-12px' : frac > 0.75 ? 'calc(-100% + 12px)' : '-50%';
    ty = placement === 'below' ? '10px' : 'calc(-100% - 10px)';
  }
  const style: CSSProperties = { left: x, top: y, transform: `translate(${tx}, ${ty})` };
  return (
    <div className={s.tooltip} style={style} aria-hidden="true">
      {children}
    </div>
  );
}

export function TooltipTitle({ children }: { children: ReactNode }) {
  return <div className={s.tooltipTitle}>{children}</div>;
}

/** Value leads (strong), label follows (muted); optional short line key in a token color. */
export function TooltipRow({
  value,
  label,
  color,
  keyShape = 'line',
}: {
  value: ReactNode;
  label?: ReactNode;
  color?: string;
  keyShape?: 'line' | 'dot' | 'none';
}) {
  return (
    <div className={s.tooltipRow}>
      {color && keyShape !== 'none' ? (
        <span className={keyShape === 'dot' ? s.keyDot : s.keyLine} style={{ background: color }} />
      ) : (
        <span className={s.keySpacer} />
      )}
      <span className={s.tooltipValue}>{value}</span>
      {label != null && <span className={s.tooltipLabel}>{label}</span>}
    </div>
  );
}

// ───────────────────────── legend ─────────────────────────

export type SwatchKind = 'fill' | 'outline' | 'half' | 'nodata' | 'line' | 'dashed' | 'dot' | 'ring' | 'hollowPoint';

export function Swatch({ kind, color }: { kind: SwatchKind; color?: string }) {
  const style = { '--sw': color ?? 'var(--text-3)' } as CSSProperties;
  return <span className={`${s.swatch} ${s['sw_' + kind]}`} style={style} aria-hidden="true" />;
}

export function Legend({
  items,
  size = 'compact',
  className,
}: {
  items: { kind: SwatchKind; color?: string; label: ReactNode; count?: ReactNode }[];
  size?: 'compact' | 'large';
  className?: string;
}) {
  return (
    <ul className={`${s.legend} ${size === 'large' ? s.legendLarge : ''} ${className ?? ''}`}>
      {items.map((it, i) => (
        <li key={i} className={s.legendItem}>
          <Swatch kind={it.kind} color={it.color} />
          <span>{it.label}</span>
          {it.count != null && <span className={s.legendCount}>{it.count}</span>}
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────── empty / misc ─────────────────────────

export function EmptyState({ children = 'No data in this period', height }: { children?: ReactNode; height?: number }) {
  return (
    <div className={s.empty} style={height ? { minHeight: height } : undefined} role="note">
      {children}
    </div>
  );
}

export function VisuallyHidden({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <span className={s.visuallyHidden} aria-live={live ? 'polite' : undefined}>
      {children}
    </span>
  );
}

/** <defs> hatch for "no data" — never confused with a good (filled) value. */
export function NoDataPattern({ id }: { id: string }) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
      <rect width="5" height="5" style={{ fill: 'var(--no-data)' }} />
      <line x1="0" y1="0" x2="0" y2="5" style={{ stroke: 'var(--border-strong)', strokeWidth: 1.2 }} />
    </pattern>
  );
}

/** Date tick labels along the bottom of an SVG plot. */
export function DateAxis({
  dates,
  ticks,
  center,
  y,
  x0,
  x1,
}: {
  dates: string[];
  ticks: number[];
  center: (i: number) => number;
  y: number;
  x0: number;
  x1: number;
}) {
  return (
    <g className={s.axisText} aria-hidden="true">
      {ticks.map((i) => {
        const cx = center(i);
        const anchor = cx - x0 < 22 ? 'start' : x1 - cx < 22 ? 'end' : 'middle';
        const tx = anchor === 'start' ? Math.max(x0, cx - 6) : anchor === 'end' ? Math.min(x1, cx + 6) : cx;
        return (
          <text key={i} x={tx} y={y} textAnchor={anchor} dominantBaseline="hanging">
            {fmtDay(dates[i])}
          </text>
        );
      })}
    </g>
  );
}

export { s as chartStyles };
