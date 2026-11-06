import { useState, type DragEvent } from 'react';

/**
 * Native HTML5 drag-and-drop reordering for a list. `itemProps(index, axis)` goes on each
 * draggable item; `indicator(index)` says where the drop line should be drawn.
 */
export function useDragReorder(onMove: (from: number, to: number) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [over, setOver] = useState<{ index: number; after: boolean } | null>(null);

  const reset = () => {
    setDragIndex(null);
    setOver(null);
  };
  const isAfter = (e: DragEvent<HTMLElement>, axis: 'x' | 'y') => {
    const r = e.currentTarget.getBoundingClientRect();
    return axis === 'x' ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
  };

  const itemProps = (index: number, axis: 'x' | 'y' = 'y') => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      setDragIndex(index);
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', String(index));
      } catch {
        /* some browsers restrict setData */
      }
    },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragIndex === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const after = isAfter(e, axis);
      setOver((o) => (o && o.index === index && o.after === after ? o : { index, after }));
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o?.index === index ? null : o));
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      if (dragIndex === null) return;
      let to = isAfter(e, axis) ? index + 1 : index;
      if (dragIndex < to) to -= 1;
      if (to !== dragIndex) onMove(dragIndex, to);
      reset();
    },
    onDragEnd: reset,
  });

  const indicator = (index: number): 'before' | 'after' | null =>
    over && over.index === index && dragIndex !== null && dragIndex !== index ? (over.after ? 'after' : 'before') : null;

  return { itemProps, indicator, dragIndex };
}
