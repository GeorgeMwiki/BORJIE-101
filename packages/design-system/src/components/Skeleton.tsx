import * as React from 'react';
import { cn } from '../lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional - renders as circle when true */
  circle?: boolean;
  /**
   * Optional, single-locale busy-state label resolved by the caller. When
   * provided, the block becomes a `role="status"` live region announcing this
   * text; otherwise the block is purely decorative (`aria-hidden`) and is
   * skipped by screen readers. Defaulting to decorative avoids announcing a
   * hardcoded English "Loading" on a non-English surface (zero-mix canon) and
   * avoids a chorus of repeated announcements from multi-block layouts — the
   * container can opt into ONE localized busy region instead.
   */
  label?: string;
}

function Skeleton({ className, circle, label, ...props }: SkeletonProps) {
  const a11y = label
    ? ({ role: 'status', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const);
  return (
    <div
      {...a11y}
      className={cn(
        'animate-pulse rounded-md bg-muted',
        circle && 'rounded-full aspect-square',
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
