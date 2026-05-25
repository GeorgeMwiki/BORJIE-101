import * as React from 'react';
import { cn } from '../lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional - renders as circle when true */
  circle?: boolean;
}

function Skeleton({ className, circle, ...props }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
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
