/**
 * Skeleton — token-driven loading placeholders (LitFin polish bar).
 *
 * Two animation styles, both reduced-motion-safe:
 *   - `pulse`   (default) — the calm opacity breathe (`animate-pulse`).
 *   - `shimmer` — a copper-tinted sweep driven by the shared `shimmer`
 *     keyframe + `--gradient-primary` / muted stops. Under
 *     `prefers-reduced-motion: reduce` the global rule in globals.css
 *     freezes every animation to ~0ms, so shimmer degrades to a static
 *     tinted block automatically — no per-component media query needed.
 *
 * A11y register: a bare Skeleton is DECORATIVE (`aria-hidden`) so a
 * screen reader is not spammed with a chorus of "loading" from a
 * multi-block layout, and so no hardcoded-English "Loading" leaks onto a
 * non-English surface (zero-mix canon). A caller that wants ONE announced
 * busy region passes a single, already-localized `label` — that block
 * becomes a polite `role="status"` live region. Copy is ALWAYS caller-
 * supplied; this file ships zero user-facing strings.
 *
 * Shaped variants (SkeletonText / SkeletonAvatar / SkeletonCard /
 * SkeletonTableRow) compose the base block into the common shapes so a
 * loading state matches the real content silhouette, not a grey slab.
 */
import * as React from 'react';
import { cn } from '../lib/utils';

type SkeletonAnimation = 'pulse' | 'shimmer';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Renders as a perfect circle (avatar / icon placeholder). */
  circle?: boolean;
  /** Animation style. Defaults to the calm opacity pulse. */
  animation?: SkeletonAnimation;
  /**
   * Optional, single-locale busy-state label resolved by the caller.
   * When provided the block becomes a polite `role="status"` live region
   * announcing this text; otherwise it is decorative (`aria-hidden`).
   * Never pass a hardcoded string — resolve via the i18n layer.
   */
  label?: string;
}

/** Shared surface + animation classes for every skeleton shape. */
function skeletonBase(animation: SkeletonAnimation, circle?: boolean): string {
  return cn(
    'rounded-md bg-muted',
    // Shimmer: a moving copper-tinted highlight over the muted base. The
    // gradient uses theme tokens (muted stops + a signal-tinted crest) and
    // the shared `shimmer` keyframe. Reduced-motion freezes it globally.
    animation === 'shimmer'
      ? 'bg-[length:200%_100%] bg-gradient-to-r from-muted via-signal-100/60 to-muted animate-shimmer'
      : 'animate-pulse',
    circle && 'aspect-square rounded-full',
  );
}

function a11yProps(label?: string) {
  return label
    ? ({ role: 'status', 'aria-label': label, 'aria-live': 'polite' } as const)
    : ({ 'aria-hidden': true } as const);
}

/** Base skeleton block. Size it with className (`h-4 w-48`). */
function Skeleton({ className, circle, animation = 'pulse', label, ...props }: SkeletonProps) {
  return (
    <div
      {...a11yProps(label)}
      className={cn(skeletonBase(animation, circle), className)}
      {...props}
    />
  );
}

export interface SkeletonTextProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of text lines to render. */
  lines?: number;
  animation?: SkeletonAnimation;
  /** Optional caller-localized busy label for the whole block. */
  label?: string;
}

/**
 * SkeletonText — a stack of line placeholders. The final line is short
 * (60% width) to mimic a ragged paragraph end.
 */
function SkeletonText({
  lines = 3,
  animation = 'pulse',
  label,
  className,
  ...props
}: SkeletonTextProps) {
  const count = Math.max(1, lines);
  return (
    <div
      {...a11yProps(label)}
      className={cn('flex flex-col gap-2.5', className)}
      {...props}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={cn(
            skeletonBase(animation),
            'h-3.5',
            i === count - 1 && count > 1 ? 'w-3/5' : 'w-full',
          )}
        />
      ))}
    </div>
  );
}

export interface SkeletonAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Diameter token: sm 32px, md 40px, lg 56px. */
  size?: 'sm' | 'md' | 'lg';
  animation?: SkeletonAnimation;
  label?: string;
}

const avatarSizes: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
};

/** SkeletonAvatar — a circular placeholder for a profile / logo. */
function SkeletonAvatar({
  size = 'md',
  animation = 'pulse',
  label,
  className,
  ...props
}: SkeletonAvatarProps) {
  return (
    <div
      {...a11yProps(label)}
      className={cn(skeletonBase(animation, true), avatarSizes[size], className)}
      {...props}
    />
  );
}

export interface SkeletonCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Show the leading avatar block. */
  media?: boolean;
  /** Text lines under the header. */
  lines?: number;
  animation?: SkeletonAnimation;
  label?: string;
}

/**
 * SkeletonCard — a card silhouette: optional avatar + title/subtitle
 * header, then a body of text lines. Matches the real card layout so the
 * swap-in doesn't jump.
 */
function SkeletonCard({
  media = true,
  lines = 3,
  animation = 'pulse',
  label,
  className,
  ...props
}: SkeletonCardProps) {
  return (
    <div
      {...a11yProps(label)}
      className={cn(
        'rounded-lg border border-border bg-card p-4 shadow-sm',
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-3" aria-hidden="true">
        {media ? <SkeletonAvatar size="md" animation={animation} /> : null}
        <div className="flex flex-1 flex-col gap-2">
          <div className={cn(skeletonBase(animation), 'h-4 w-1/2')} />
          <div className={cn(skeletonBase(animation), 'h-3 w-1/3')} />
        </div>
      </div>
      <div className="mt-4" aria-hidden="true">
        <SkeletonText lines={lines} animation={animation} />
      </div>
    </div>
  );
}

export interface SkeletonTableRowProps
  extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Number of cells in the row. */
  columns?: number;
  animation?: SkeletonAnimation;
}

/**
 * SkeletonTableRow — a `<tr>` of cell placeholders for table loading
 * states. Renders semantic `<td>`s so it drops into a real `<tbody>`.
 * Always decorative; announce the busy state once at the table level.
 */
function SkeletonTableRow({
  columns = 4,
  animation = 'pulse',
  className,
  ...props
}: SkeletonTableRowProps) {
  const count = Math.max(1, columns);
  return (
    <tr aria-hidden="true" className={className} {...props}>
      {Array.from({ length: count }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className={cn(
              skeletonBase(animation),
              'h-3.5',
              i === 0 ? 'w-3/4' : 'w-1/2',
            )}
          />
        </td>
      ))}
    </tr>
  );
}

export {
  Skeleton,
  SkeletonText,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonTableRow,
};
