'use client';

/**
 * MasteryDial — SVG progress ring used by StepperBar (per step) and
 * MicroLessonCard (per concept). Independent author against the spec
 * at Docs/DESIGN/LITFIN_STEPPER_LEARNING_SPEC.md §2 (Mastery ring).
 *
 * Pure CSS / inline SVG; no framer-motion (owner-web doesn't ship it).
 * Animation handled via the design-system's `transition-all
 * duration-500` utility for the dashOffset stroke change.
 *
 * Colour ladder (Borjie navy/gold tokens, NOT LitFin copper/teal):
 *   complete  → stroke-emerald-500
 *   ≥ 50%     → stroke-warning           (gold)
 *   > 0       → stroke-warning/60
 *   = 0       → stroke-neutral-700
 *
 * `isComplete` overrides the score colour and renders a check glyph in
 * the dial centre.
 */

import type { ReactElement } from 'react';
import { cn } from '@borjie/design-system';

export interface MasteryDialProps {
  /** Normalised mastery score in [0, 1]. */
  readonly score: number;
  /** Diameter in px. Default 36, matches LitFin sidebar. */
  readonly size?: number;
  /** Ring thickness. Default 3. */
  readonly strokeWidth?: number;
  /** Flips the ring to a solid emerald + centred check. */
  readonly isComplete?: boolean;
  /** Optional className for the outer SVG (e.g. layout helpers). */
  readonly className?: string;
  /** Optional accessible label override. */
  readonly ariaLabel?: string;
}

function ringStrokeClass(score: number, isComplete: boolean): string {
  if (isComplete) return 'stroke-emerald-500';
  if (score >= 0.5) return 'stroke-warning';
  if (score > 0) return 'stroke-warning/60';
  return 'stroke-neutral-700';
}

export function MasteryDial({
  score,
  size = 36,
  strokeWidth = 3,
  isComplete = false,
  className,
  ariaLabel,
}: MasteryDialProps): ReactElement {
  const safeScore = Math.max(0, Math.min(1, score));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - safeScore);
  const ringClass = ringStrokeClass(safeScore, isComplete);
  const label =
    ariaLabel ??
    (isComplete
      ? 'Step mastered'
      : `Step mastery ${Math.round(safeScore * 100)} percent`);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('flex-shrink-0 -rotate-90', className)}
      role="img"
      aria-label={label}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        className="stroke-neutral-700/30"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        className={cn(ringClass, 'transition-all duration-500')}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
      />
      {isComplete ? (
        <g transform={`rotate(90 ${size / 2} ${size / 2})`}>
          <path
            d="M5 13l4 4L19 7"
            transform={`translate(${size / 2 - 12} ${size / 2 - 12})`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-emerald-500"
          />
        </g>
      ) : null}
    </svg>
  );
}
