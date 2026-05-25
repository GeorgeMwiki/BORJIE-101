/**
 * ProactiveHint — surfaces brain-driven hints when Theory-of-Mind
 * detects the user is stuck, frustrated, confused, or anxious.
 *
 * Sits as a sibling concept to `DegradedBanner`: renders an inline
 * yellow callout above the current assistant message when ANY hint's
 * trigger threshold is met against the live affective profile.
 *
 * Examples wired by callers:
 *   - frustration >= 0.5 -> "Want to chat with a human?"
 *   - comprehension <= 0.4 -> "Want this explained in simpler terms?"
 *   - anxiety >= 0.6     -> "Your data is safe."
 *   - idle (no signal)   -> Allows time-based prompts via parent
 *
 * Dismissals are remembered for 24h via localStorage so a user who
 * waves a hint away does not see it again on the same browser. The
 * key format `proactive-hint-dismissed:<id>` makes it easy to clear
 * in dev tools and avoids collisions with other UI state.
 *
 * When a hint's `action.emit` is set, clicking the action button
 * dispatches `proactive-hint:action` on `window` with detail
 * `{ id, action }` — so consumers (customer-app, owner-portal) can
 * wire CTAs without prop-drilling. This mirrors the dopamine event
 * pattern already used elsewhere in chat-ui.
 *
 * Inline styles (not Tailwind) — same rationale as DegradedBanner:
 * chat-ui ships into Vite SPAs without a global Tailwind layer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type { AffectiveProfile } from '../hooks/useAffectiveProfile';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Which axis of the affective profile a hint binds to. `idle` is a
 * sentinel for time-based prompts driven by parent components (the
 * threshold is ignored when trigger === 'idle' — instead the hint
 * renders whenever the parent supplies it).
 */
export type HintTrigger =
  | 'frustration'
  | 'comprehension'
  | 'anxiety'
  | 'idle';

export interface HintAction {
  readonly label: string;
  /** Open as a link when set (relative or absolute URL). */
  readonly href?: string;
  /**
   * Dispatch as a custom event on click. When set, the click handler
   * fires a CustomEvent `proactive-hint:action` whose detail is
   * `{ id, action: emit }`. Mutually compatible with `href` — if both
   * are present the link still navigates but the event fires first.
   *
   * SECURITY: `emit` is dev-defined (it comes from a HintCandidate that
   * the brain emits, not from end-user input) so XSS risk is nil. But
   * consumers wiring `addEventListener('proactive-hint:action', ...)`
   * MUST NOT `eval()` or `Function()` the `detail.action` string. Treat
   * the string as a static identifier you switch/case on; never as code
   * to interpret.
   */
  readonly emit?: string;
}

export interface HintCandidate {
  readonly id: string;
  readonly trigger: HintTrigger;
  /**
   * Threshold compared against `profile[trigger]`:
   *   - `frustration`, `anxiety`, `urgency`: triggers when value >= threshold
   *   - `comprehension`, `trust`: triggers when value <= threshold
   *   - `idle`: threshold ignored, always considered triggered
   */
  readonly threshold: number;
  readonly title: string;
  readonly body: string;
  readonly action?: HintAction;
}

export interface ProactiveHintProps {
  readonly profile: AffectiveProfile | null;
  readonly hints: ReadonlyArray<HintCandidate>;
  readonly onDismiss?: (id: string) => void;
  readonly onActionClick?: (id: string) => void;
  /**
   * Storage TTL for dismissed-hint memory. Default 24h. Set to 0 to
   * disable persistence entirely (tests + privacy-mode consumers).
   */
  readonly dismissTtlMs?: number;
  /**
   * Storage seam — defaults to `window.localStorage`. Tests inject a
   * Map-backed fake so they can run in jsdom without bleeding state.
   */
  readonly storage?: HintStorage;
  /**
   * Clock injection for tests. Default `Date.now`.
   */
  readonly now?: () => number;
  /** Optional className for the outer container. */
  readonly className?: string;
  /** Optional inline-style override merged into the outer container. */
  readonly style?: CSSProperties;
  /**
   * Optional override for the dismiss button aria-label (i18n).
   * Consumer apps should pass a localised string.
   */
  readonly dismissAriaLabel?: string;
}

/**
 * Minimal Storage-like contract — a subset of `window.localStorage` so
 * tests can inject a Map without faking the full API.
 */
export interface HintStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const STORAGE_KEY_PREFIX = 'proactive-hint-dismissed:';
const ACTION_EVENT_NAME = 'proactive-hint:action';

// ---------------------------------------------------------------------------
// Pure helpers (exported for test reuse)
// ---------------------------------------------------------------------------

/**
 * Resolve which (if any) hint should currently render. Returns the
 * FIRST hint in `hints` whose threshold is met — caller is responsible
 * for ordering by priority. Returns null when the profile is missing
 * or no thresholds fire.
 */
export function selectHint(
  profile: AffectiveProfile | null,
  hints: ReadonlyArray<HintCandidate>,
  dismissed: ReadonlySet<string>,
): HintCandidate | null {
  if (!hints || hints.length === 0) return null;
  for (const hint of hints) {
    if (dismissed.has(hint.id)) continue;
    if (matchesThreshold(profile, hint)) return hint;
  }
  return null;
}

/**
 * Does this hint's trigger axis fire against the provided profile?
 * `idle` hints always fire (parent controls supply). Comprehension /
 * trust are "lower-is-bad" so we use <=; frustration / anxiety /
 * urgency are "higher-is-bad" so we use >=.
 */
export function matchesThreshold(
  profile: AffectiveProfile | null,
  hint: HintCandidate,
): boolean {
  if (hint.trigger === 'idle') return true;
  if (!profile) return false;
  switch (hint.trigger) {
    case 'frustration':
      return profile.frustration >= hint.threshold;
    case 'anxiety':
      return profile.anxiety >= hint.threshold;
    case 'comprehension':
      return profile.comprehension <= hint.threshold;
    default:
      return false;
  }
}

/**
 * Storage-key for a given hint id.
 */
export function storageKeyFor(id: string): string {
  return `${STORAGE_KEY_PREFIX}${id}`;
}

/**
 * Read the dismissed-hint set from storage, dropping entries whose
 * TTL has expired. Pure for test reuse.
 */
export function readDismissed(
  hints: ReadonlyArray<HintCandidate>,
  storage: HintStorage | null,
  ttlMs: number,
  now: () => number,
): Set<string> {
  const out = new Set<string>();
  if (!storage || ttlMs <= 0) return out;
  for (const hint of hints) {
    const raw = storage.getItem(storageKeyFor(hint.id));
    if (!raw) continue;
    const at = Number.parseInt(raw, 10);
    if (Number.isNaN(at)) {
      storage.removeItem(storageKeyFor(hint.id));
      continue;
    }
    if (now() - at > ttlMs) {
      storage.removeItem(storageKeyFor(hint.id));
      continue;
    }
    out.add(hint.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getDefaultStorage(): HintStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    const ls = window.localStorage;
    // Touch to surface SecurityError early (private mode, etc.).
    ls.getItem(STORAGE_KEY_PREFIX);
    return ls;
  } catch {
    return null;
  }
}

function dispatchActionEvent(id: string, emit: string): void {
  if (typeof window === 'undefined') return;
  const ev = new CustomEvent(ACTION_EVENT_NAME, {
    detail: { id, action: emit },
  });
  window.dispatchEvent(ev);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #fbbf24',
    background: '#fffbeb',
    color: '#92400e',
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: 13,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
  } satisfies CSSProperties,
  icon: {
    flex: '0 0 16px',
    width: 16,
    height: 16,
    marginTop: 2,
    color: '#b45309',
  } satisfies CSSProperties,
  title: {
    fontWeight: 600,
    color: '#7c2d12',
    margin: 0,
  } satisfies CSSProperties,
  body: {
    margin: 0,
    color: '#92400e',
    fontSize: 12,
  } satisfies CSSProperties,
  actionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  } satisfies CSSProperties,
  actionButton: {
    appearance: 'none',
    border: '1px solid #f59e0b',
    background: '#fde68a',
    color: '#7c2d12',
    padding: '6px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 500,
    fontSize: 12,
    outlineOffset: 2,
  } satisfies CSSProperties,
  actionLink: {
    color: '#7c2d12',
    fontSize: 12,
    fontWeight: 500,
    textDecoration: 'underline',
  } satisfies CSSProperties,
  dismissButton: {
    appearance: 'none',
    background: 'transparent',
    border: 0,
    color: '#92400e',
    cursor: 'pointer',
    padding: 4,
    marginLeft: 'auto',
    borderRadius: 4,
    lineHeight: 0,
    outlineOffset: 2,
  } satisfies CSSProperties,
};

function HintGlyph(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={styles.icon}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function DismissGlyph(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="6" y1="18" x2="18" y2="6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProactiveHint({
  profile,
  hints,
  onDismiss,
  onActionClick,
  dismissTtlMs = DEFAULT_DISMISS_TTL_MS,
  storage,
  now = Date.now,
  className,
  style,
  dismissAriaLabel = 'Dismiss hint',
}: ProactiveHintProps): JSX.Element | null {
  const effectiveStorage = useMemo<HintStorage | null>(
    () => (storage === undefined ? getDefaultStorage() : storage),
    [storage],
  );

  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    readDismissed(hints, effectiveStorage, dismissTtlMs, now),
  );

  // If the consumer changes the hint list (e.g. localisation), re-read
  // storage so stale dismissals from a previous hint set don't bleed in.
  useEffect(() => {
    const next = readDismissed(hints, effectiveStorage, dismissTtlMs, now);
    setDismissed((prev) => (setsEqual(prev, next) ? prev : next));
  }, [hints, effectiveStorage, dismissTtlMs, now]);

  const active = useMemo(
    () => selectHint(profile, hints, dismissed),
    [profile, hints, dismissed],
  );

  const handleDismiss = useCallback(
    (id: string): void => {
      setDismissed((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      if (effectiveStorage && dismissTtlMs > 0) {
        try {
          effectiveStorage.setItem(storageKeyFor(id), String(now()));
        } catch {
          // Storage may throw in private mode; ignore — runtime dismiss
          // still works for the current session via React state.
        }
      }
      onDismiss?.(id);
    },
    [effectiveStorage, dismissTtlMs, now, onDismiss],
  );

  const handleActionClick = useCallback(
    (hint: HintCandidate): void => {
      if (hint.action?.emit) {
        dispatchActionEvent(hint.id, hint.action.emit);
      }
      onActionClick?.(hint.id);
    },
    [onActionClick],
  );

  if (!active) return null;

  const containerStyle: CSSProperties = style
    ? { ...styles.container, ...style }
    : styles.container;

  return (
    <aside
      role="status"
      aria-live="polite"
      data-testid="proactive-hint"
      data-hint-id={active.id}
      data-hint-trigger={active.trigger}
      className={className}
      style={containerStyle}
    >
      <div style={styles.row}>
        <HintGlyph />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={styles.title}>{active.title}</p>
          <p style={styles.body}>{active.body}</p>
        </div>
        <button
          type="button"
          aria-label={dismissAriaLabel}
          data-testid="proactive-hint-dismiss"
          onClick={() => handleDismiss(active.id)}
          style={styles.dismissButton}
        >
          <DismissGlyph />
        </button>
      </div>
      {active.action ? (
        <div style={styles.actionRow}>
          {active.action.href ? (
            <a
              href={active.action.href}
              data-testid="proactive-hint-action"
              onClick={() => handleActionClick(active)}
              style={styles.actionLink}
            >
              {active.action.label}
            </a>
          ) : (
            <button
              type="button"
              data-testid="proactive-hint-action"
              onClick={() => handleActionClick(active)}
              style={styles.actionButton}
            >
              {active.action.label}
            </button>
          )}
        </div>
      ) : null}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
