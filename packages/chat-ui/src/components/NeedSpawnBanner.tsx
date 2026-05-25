/**
 * NeedSpawnBanner — surfaces `tab_spawn_proposals` produced by Piece O
 * (`@borjie/tab-need-detector`).
 *
 * The brain occasionally detects that the user could benefit from a new
 * tab (e.g. "you're asking three rent questions — want a Rent Insights
 * tab to pin on your dashboard?"). The detector emits proposals which
 * land in the `tab_spawn_proposals` table; this banner reads them via a
 * fetch seam supplied by the consuming app and lets the user accept or
 * dismiss.
 *
 * Layout choices follow the existing ProactiveHint pattern:
 *   - Soft yellow callout (info-level urgency, not warning)
 *   - Inline accept + dismiss buttons
 *   - Multiple proposals render in priority order — only the top-N show
 *     by default, the rest collapse behind a "show more" affordance
 *
 * The component is intentionally renderer-pure: caller hands it the
 * proposals, this component renders + emits events. Network calls happen
 * via callbacks so tests can assert without HTTP mocking.
 */

import { useCallback, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TabSpawnProposal {
  readonly id: string;
  /** Short label shown as the banner headline. */
  readonly label: string;
  /** Optional reason/explanation surfaced under the label. */
  readonly reason?: string;
  /**
   * Where the new tab would route to once accepted. May be a relative
   * path (Next/Vite) or a deep-link id resolved by the host app.
   */
  readonly targetRoute?: string;
  /**
   * Score 0..1 — used purely for sorting; not displayed.
   */
  readonly confidence?: number;
  /**
   * Timestamp (ISO) — surfaced as a relative label when present.
   */
  readonly proposedAt?: string;
}

export interface NeedSpawnBannerProps {
  readonly proposals: ReadonlyArray<TabSpawnProposal>;
  /**
   * Fires when the user clicks "Open" / "Accept". The caller is
   * responsible for navigating + recording the acceptance server-side.
   */
  readonly onAccept?: (proposal: TabSpawnProposal) => void;
  /**
   * Fires when the user dismisses an individual proposal.
   */
  readonly onDismiss?: (proposal: TabSpawnProposal) => void;
  /**
   * Maximum proposals to render before collapsing into "show more". 0
   * means render all. Default 1 — keeps the chat focused.
   */
  readonly maxVisible?: number;
  /** Outer className. */
  readonly className?: string;
  /** Inline style override merged into the container. */
  readonly style?: CSSProperties;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    padding: '12px 14px',
    borderRadius: 12,
    border: '1px solid #c7d2fe',
    background: '#eef2ff',
    color: '#312e81',
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: 13,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
  } satisfies CSSProperties,
  icon: {
    flex: '0 0 18px',
    width: 18,
    height: 18,
    marginTop: 2,
    color: '#4338ca',
  } satisfies CSSProperties,
  label: {
    fontWeight: 600,
    color: '#312e81',
    margin: 0,
  } satisfies CSSProperties,
  reason: {
    margin: 0,
    color: '#4338ca',
    fontSize: 12,
  } satisfies CSSProperties,
  actions: {
    display: 'flex',
    gap: 8,
    marginTop: 6,
  } satisfies CSSProperties,
  acceptButton: {
    appearance: 'none',
    border: '1px solid #4338ca',
    background: '#4338ca',
    color: '#ffffff',
    padding: '6px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 500,
    fontSize: 12,
    outlineOffset: 2,
  } satisfies CSSProperties,
  dismissButton: {
    appearance: 'none',
    border: '1px solid #c7d2fe',
    background: '#ffffff',
    color: '#4338ca',
    padding: '6px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 500,
    fontSize: 12,
    outlineOffset: 2,
  } satisfies CSSProperties,
  showMore: {
    appearance: 'none',
    background: 'transparent',
    border: 0,
    color: '#4338ca',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'underline',
    alignSelf: 'flex-start',
  } satisfies CSSProperties,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sort proposals newest-first within confidence buckets. Pure for tests.
 */
export function sortProposals(
  proposals: ReadonlyArray<TabSpawnProposal>,
): ReadonlyArray<TabSpawnProposal> {
  const next = [...proposals];
  next.sort((a, b) => {
    const confDelta = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (confDelta !== 0) return confDelta;
    const aT = a.proposedAt ? Date.parse(a.proposedAt) : 0;
    const bT = b.proposedAt ? Date.parse(b.proposedAt) : 0;
    return bT - aT;
  });
  return next;
}

function SpawnGlyph(): ReactNode {
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
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M17.5 14v7" />
      <path d="M14 17.5h7" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NeedSpawnBanner({
  proposals,
  onAccept,
  onDismiss,
  maxVisible = 1,
  className,
  style,
}: NeedSpawnBannerProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const sorted = useMemo(() => sortProposals(proposals), [proposals]);

  const handleAccept = useCallback(
    (proposal: TabSpawnProposal) => () => onAccept?.(proposal),
    [onAccept],
  );
  const handleDismiss = useCallback(
    (proposal: TabSpawnProposal) => () => onDismiss?.(proposal),
    [onDismiss],
  );

  if (sorted.length === 0) return null;

  const visibleCount =
    maxVisible <= 0 || expanded ? sorted.length : Math.min(sorted.length, maxVisible);
  const visible = sorted.slice(0, visibleCount);
  const hiddenCount = sorted.length - visibleCount;

  const containerStyle: CSSProperties = style
    ? { ...styles.container, ...style }
    : styles.container;

  return (
    <aside
      role="status"
      aria-live="polite"
      data-testid="need-spawn-banner"
      data-count={sorted.length}
      className={className}
      style={containerStyle}
    >
      {visible.map((proposal) => (
        <div key={proposal.id} style={styles.row} data-proposal-id={proposal.id}>
          <SpawnGlyph />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={styles.label}>{proposal.label}</p>
            {proposal.reason ? <p style={styles.reason}>{proposal.reason}</p> : null}
            <div style={styles.actions}>
              <button
                type="button"
                data-testid={`need-spawn-accept-${proposal.id}`}
                onClick={handleAccept(proposal)}
                style={styles.acceptButton}
              >
                Open tab
              </button>
              <button
                type="button"
                data-testid={`need-spawn-dismiss-${proposal.id}`}
                onClick={handleDismiss(proposal)}
                style={styles.dismissButton}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          data-testid="need-spawn-show-more"
          onClick={() => setExpanded(true)}
          style={styles.showMore}
        >
          Show {hiddenCount} more proposal{hiddenCount === 1 ? '' : 's'}
        </button>
      ) : null}
    </aside>
  );
}
