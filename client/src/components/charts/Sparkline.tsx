/**
 * Sparkline — tiny inline trend. Gaps where value is null (never interpolated across
 * missing days), isolated points drawn as dots, last point emphasised with a dot.
 * Static (role="img"); the caller's label/value carries the number.
 */
import { useMemo } from 'react';
import type { SparklineProps } from './types';
import { STATUS_VAR } from './chartUtils';
import { useContainerWidth } from './chartKit';
import cs from './charts.module.css';

export function Sparkline({ points, status = 'neutral', width, height = 28, ariaLabel }: SparklineProps) {
  const [ref, measured] = useContainerWidth<HTMLSpanElement>(width ?? 120);
  const w = width ?? measured;
  const color = STATUS_VAR[status];
  const pad = 3.5;

  const geom = useMemo(() => {
    const vals = points.map((p) => p.value).filter((v): v is number => v != null && isFinite(v));
    if (vals.length === 0) return null;
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (hi === lo) {
      lo -= 1;
      hi += 1;
    }
    const n = points.length;
    const xs = (i: number) => (n <= 1 ? w / 2 : pad + (i / (n - 1)) * (w - pad * 2));
    const ys = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2);
    const segments: string[] = [];
    const singles: { x: number; y: number }[] = [];
    let cur: { x: number; y: number }[] = [];
    const flush = () => {
      if (cur.length === 1) singles.push(cur[0]);
      else if (cur.length > 1) segments.push(cur.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
      cur = [];
    };
    points.forEach((p, i) => {
      if (p.value == null || !isFinite(p.value)) flush();
      else cur.push({ x: xs(i), y: ys(p.value) });
    });
    flush();
    let lastIdx = -1;
    for (let i = n - 1; i >= 0; i--)
      if (points[i].value != null) {
        lastIdx = i;
        break;
      }
    const last = lastIdx >= 0 ? { x: xs(lastIdx), y: ys(points[lastIdx].value as number) } : null;
    return { segments, singles, last };
  }, [points, w, height]);

  return (
    <span
      ref={ref}
      className={cs.root}
      style={{ display: width ? 'inline-block' : 'block', width: width ?? '100%', height, verticalAlign: 'middle', lineHeight: 0 }}
    >
      <svg role="img" aria-label={ariaLabel} width={w} height={height} viewBox={`0 0 ${w} ${height}`} className={cs.svg}>
        {geom ? (
          <>
            {geom.segments.map((d, i) => (
              <path key={i} d={d} style={{ fill: 'none', stroke: color, strokeWidth: 1.75, strokeLinejoin: 'round', strokeLinecap: 'round' }} />
            ))}
            {geom.singles.map((p, i) => (
              <circle key={`s${i}`} cx={p.x} cy={p.y} r={1.5} style={{ fill: color }} />
            ))}
            {geom.last && (
              <circle cx={geom.last.x} cy={geom.last.y} r={2.75} style={{ fill: color, stroke: 'var(--surface)', strokeWidth: 1.5 }} data-last="true" />
            )}
          </>
        ) : (
          <line x1={pad} x2={w - pad} y1={height / 2} y2={height / 2} style={{ stroke: 'var(--border)', strokeDasharray: '2 3' }} />
        )}
      </svg>
    </span>
  );
}
