/**
 * DegradedBanner — surfaces the brain's `degraded` marker to the user.
 *
 * The central-intelligence kernel attaches a `DegradedDecisionMarker`
 * on `BrainDecision.degraded` whenever sensor-failover is operating
 * off a non-primary provider OR a tool refused with `NotYetWiredError`.
 * The marker propagates through the gateway → SDK → chat UI as
 *   { reason: string; affected_capabilities: ReadonlyArray<string>; since?: string }
 *
 * Render contract:
 *   - props.degraded undefined / null → render null (zero cost)
 *   - props.degraded set            → render a yellow-warning banner
 *
 * Designed to live above a brain response body so the user sees the
 * fallback signal in the same eye-line as the answer text. Tested
 * across owner-portal (Vite), customer-app (Next.js) and the floating
 * chat widget — all three consume this single shared component.
 *
 * Uses inline styles (not Tailwind utilities) because the chat-ui
 * package ships to apps with very different design-token setups —
 * Vite owner-portal has no global Tailwind layer at all. Keeping the
 * banner self-styled means every consumer renders identically without
 * forcing them to import a stylesheet.
 */

import type { CSSProperties, ReactNode } from 'react';

/**
 * Marker shape mirroring `DegradedDecisionMarker` from
 * `@borjie/central-intelligence`. Duplicated here so chat-ui does
 * not depend on the kernel package; the contract is tested in the
 * kernel's `degraded-mode-visibility.test.ts`.
 */
export interface DegradedMarker {
  readonly reason: string;
  readonly affected_capabilities: ReadonlyArray<string>;
  readonly since?: string | undefined;
}

export interface DegradedBannerProps {
  /**
   * The `degraded` marker pulled from a `BrainDecision` / SSE `done`
   * event. When `undefined` or `null` the banner renders nothing — so
   * callers can wire it unconditionally above every assistant turn.
   */
  readonly degraded?: DegradedMarker | null;
  /**
   * Where the "Learn more" link points. Admins want `/healthz/dependencies`;
   * tenant-facing apps prefer a docs page. Falls back to a generic docs
   * route when omitted.
   */
  readonly learnMoreHref?: string;
  /**
   * Hide the affected-capabilities pill row. Useful on the floating
   * widget where vertical space is tight.
   */
  readonly compact?: boolean;
  /**
   * Optional override label for the headline (i18n).
   */
  readonly headline?: string;
  /**
   * Optional override label for the body copy (i18n).
   */
  readonly body?: string;
  /**
   * Optional override for the affected-capabilities list aria-label
   * (i18n). When omitted falls back to an English default — consumer
   * apps should pass a localised string.
   */
  readonly affectedAriaLabel?: string;
  /**
   * Optional className for outer container — picked up only when the
   * consuming app uses a styled-components / Tailwind layer that wants
   * to override positioning. Inline styles still apply.
   */
  readonly className?: string;
  /**
   * Optional inline-style override merged into the outer container.
   */
  readonly style?: CSSProperties;
}

const DEFAULT_LEARN_MORE_HREF = '/help/degraded-mode';

const DEFAULT_HEADLINE =
  'AI brain operating in fallback mode. Some advanced features may be limited.';

function defaultBody(reason: string): string {
  return reason && reason.length > 0
    ? `Reason: ${reason}`
    : 'A fallback provider is serving this answer while we restore the primary service.';
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
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
  headline: {
    fontWeight: 600,
    color: '#7c2d12',
    margin: 0,
  } satisfies CSSProperties,
  body: {
    margin: 0,
    color: '#92400e',
    fontSize: 12,
  } satisfies CSSProperties,
  pills: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 4,
    marginTop: 2,
  } satisfies CSSProperties,
  pill: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    background: '#fde68a',
    color: '#78350f',
    fontSize: 11,
    fontWeight: 500,
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  } satisfies CSSProperties,
  link: {
    color: '#7c2d12',
    fontSize: 12,
    fontWeight: 500,
    textDecoration: 'underline',
    alignSelf: 'flex-start' as const,
  } satisfies CSSProperties,
  since: {
    fontSize: 11,
    color: '#a16207',
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  } satisfies CSSProperties,
};

/**
 * Render a triangle warning glyph as an inline SVG so chat-ui ships
 * no extra icon dependency. lucide-react is available in every
 * consumer but chat-ui itself avoids the runtime cost for one icon.
 */
function WarningGlyph(): ReactNode {
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
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function DegradedBanner({
  degraded,
  learnMoreHref = DEFAULT_LEARN_MORE_HREF,
  compact = false,
  headline,
  body,
  affectedAriaLabel = 'Affected capabilities',
  className,
  style,
}: DegradedBannerProps): JSX.Element | null {
  if (!degraded) return null;

  const containerStyle: CSSProperties = style
    ? { ...styles.container, ...style }
    : styles.container;

  const affected = degraded.affected_capabilities ?? [];
  const showPills = !compact && affected.length > 0;

  return (
    <aside
      role="status"
      aria-live="polite"
      data-testid="degraded-banner"
      data-degraded-reason={degraded.reason}
      className={className}
      style={containerStyle}
    >
      <div style={styles.row}>
        <WarningGlyph />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={styles.headline}>{headline ?? DEFAULT_HEADLINE}</p>
          <p style={styles.body}>{body ?? defaultBody(degraded.reason)}</p>
          {degraded.since ? (
            <p style={styles.since} data-testid="degraded-since">
              Since {degraded.since}
            </p>
          ) : null}
        </div>
      </div>
      {showPills ? (
        <ul
          aria-label={affectedAriaLabel}
          data-testid="degraded-capabilities"
          style={{ ...styles.pills, listStyle: 'none', padding: 0, margin: 0 }}
        >
          {affected.map((cap) => (
            <li key={cap} style={styles.pill}>
              {cap}
            </li>
          ))}
        </ul>
      ) : null}
      <a
        href={learnMoreHref}
        data-testid="degraded-learn-more"
        style={styles.link}
      >
        Learn more
      </a>
    </aside>
  );
}
