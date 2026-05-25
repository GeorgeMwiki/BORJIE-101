'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';

interface VirtualListProps<T> {
  readonly items: ReadonlyArray<T>;
  readonly rowHeight: number;
  readonly height: number;
  readonly render: (item: T, index: number) => ReactNode;
  readonly overscan?: number;
  readonly ariaLabel: string;
}

/**
 * Tiny windowed list — keeps the decision-log and audit-log viewers
 * responsive even with tens of thousands of rows without pulling in
 * react-virtual. Renders [start, end) absolutely-positioned children
 * over a spacer whose height matches the full row count.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  height,
  render,
  overscan = 6,
  ariaLabel,
}: VirtualListProps<T>): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const onScroll = useCallback(() => {
    if (ref.current) setScrollTop(ref.current.scrollTop);
  }, []);

  const total = items.length;
  const visibleCount = Math.ceil(height / rowHeight);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(total, start + visibleCount + overscan * 2);
  const offsetY = start * rowHeight;
  const slice = items.slice(start, end);

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      role="list"
      aria-label={ariaLabel}
      className="relative overflow-auto rounded-lg border border-border bg-surface"
      style={{ height }}
    >
      <div style={{ height: total * rowHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: offsetY, left: 0, right: 0 }}>
          {slice.map((item, i) => (
            <div role="listitem" key={start + i} style={{ height: rowHeight }} className="border-b border-border last:border-0">
              {render(item, start + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
