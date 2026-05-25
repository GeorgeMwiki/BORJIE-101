/**
 * MasteryGate — progressive-disclosure render gate.
 *
 * Wraps children that should only be visible to users at a given
 * mastery level or higher. A first-time visitor sees a simplified
 * UI; an expert sees the advanced surface. The component itself
 * makes no I/O — it expects the parent (or a sibling hook call) to
 * pass in the current score.
 *
 *   <MasteryGate level="expert" score={score}>
 *     <BulkOpsToolbar />
 *   </MasteryGate>
 *
 * Locked-state behaviour:
 *   - default: render NOTHING (treat as collapsed chrome).
 *   - lockedHint?: render an inline tooltip-style hint so the user
 *     knows the feature exists and how to unlock it.
 *   - lockedFallback?: render arbitrary alternate UI in place of the
 *     gated children — overrides lockedHint.
 *
 * The hint text uses sensible defaults derived from the gate `level`
 * but can be overridden per-call via the `hintTemplate` prop. The
 * template runs through a tiny `{level}` interpolator — no full
 * template engine, deliberately, so the locale layer keeps full
 * control of phrasing.
 */

import type { CSSProperties, ReactNode } from 'react';
import type {
  MasteryLevel,
  MasteryScore,
} from '../lib/user-mastery/index.js';
import { isLevelAtLeast } from '../lib/user-mastery/index.js';

export interface MasteryGateProps {
  /** Minimum level required to see the children. */
  readonly level: MasteryLevel;
  /** The current user's score. Pass `null` to treat as still-loading. */
  readonly score: MasteryScore | null;
  readonly children: ReactNode;
  /**
   * When true (default) AND the user is below `level`, render a small
   * "Unlocks at <level> level" hint instead of nothing.
   */
  readonly lockedHint?: boolean;
  /** Custom alternate UI to render when the gate is locked. */
  readonly lockedFallback?: ReactNode;
  /**
   * Override the hint phrasing. Use `{level}` as a placeholder.
   * Defaults to "Unlocks at {level} level".
   */
  readonly hintTemplate?: string;
  /** Optional class hook for design-token wiring. */
  readonly className?: string;
  /** When `score === null` (loading) render this instead of children. */
  readonly loadingFallback?: ReactNode;
  /** Override the data-testid for the locked-state container. */
  readonly testId?: string;
}

const HINT_STYLE: CSSProperties = {
  display: 'inline-block',
  padding: '4px 8px',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  color: '#6b7280',
  background: '#f3f4f6',
  border: '1px solid #e5e7eb',
};

const DEFAULT_HINT = 'Unlocks at {level} level';

export function MasteryGate(props: MasteryGateProps): JSX.Element | null {
  const {
    level,
    score,
    children,
    lockedHint = true,
    lockedFallback,
    hintTemplate = DEFAULT_HINT,
    className,
    loadingFallback = null,
    testId,
  } = props;

  // Still loading — show optional loading fallback. Default: render
  // nothing so we never flash novice chrome to a power user.
  if (score === null) {
    return (loadingFallback as JSX.Element | null) ?? null;
  }

  if (isLevelAtLeast(score.level, level)) {
    return <>{children}</>;
  }

  // Locked — explicit fallback wins over the hint.
  if (lockedFallback !== undefined) {
    return <>{lockedFallback}</>;
  }

  if (!lockedHint) return null;

  const message = hintTemplate.replace('{level}', level);
  const resolvedTestId = testId ?? 'mastery-gate-locked';

  return (
    <span
      role="note"
      aria-live="polite"
      data-testid={resolvedTestId}
      data-mastery-locked-at={level}
      className={className}
      style={HINT_STYLE}
    >
      {message}
    </span>
  );
}
