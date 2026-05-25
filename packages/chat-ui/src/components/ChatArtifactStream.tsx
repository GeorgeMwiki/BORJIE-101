/**
 * ChatArtifactStream — renders an ordered stream of GenUI artifacts inside
 * a chat thread.
 *
 * Wave-3 INT-4 cross-cutting component. Lives next to ProactiveHint and
 * DegradedBanner so consumers in customer-app, estate-manager-app and
 * owner-portal can mount a single subtree to surface kernel-emitted
 * AgUiUiPart payloads as a vertically-stacked list.
 *
 * The component owns NO data fetching: callers pass the artifact list in
 * (typically derived from a TanStack Query over the threads endpoint).
 * That keeps chat-ui SSR-safe and decoupled from any specific transport.
 *
 * Each artifact is rendered via @borjie/genui's AdaptiveRenderer. If
 * AdaptiveRenderer is unavailable in the consumer's build (peer not
 * installed) we fall back to a minimal placeholder card so the UI does
 * not crash — this also makes the unit tests trivial.
 *
 * Inline styles are used (not Tailwind) to match the rest of chat-ui's
 * runtime-shipping philosophy: works in Vite SPAs without a global
 * Tailwind layer, works in Next.js apps too.
 */

import { useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimal artifact contract — kept intentionally loose so it can wrap any
 * AgUiUiPart-shaped payload the kernel emits. Strong typing happens in
 * the AdaptiveRenderer once the artifact is dispatched.
 */
export interface ChatArtifact {
  readonly id: string;
  readonly kind: string;
  readonly title?: string;
  readonly subtitle?: string;
  readonly payload: unknown;
  readonly createdAt?: string;
}

/**
 * A renderer that consumes a single artifact and returns a node. Typically
 * `AdaptiveRenderer` from `@borjie/genui` — injected here so chat-ui
 * does not take a hard dependency on genui's full module graph.
 */
export type ArtifactRenderer = (artifact: ChatArtifact) => ReactNode;

export interface ChatArtifactStreamProps {
  /** Ordered artifacts (oldest first). Stream is append-only. */
  readonly artifacts: ReadonlyArray<ChatArtifact>;
  /**
   * Optional renderer for individual artifacts. Defaults to a placeholder
   * card. Consumers should pass `(a) => <AdaptiveRenderer part={a.payload} />`.
   */
  readonly renderer?: ArtifactRenderer;
  /** Loading flag — shows a skeleton row when true and list is empty. */
  readonly isLoading?: boolean;
  /** Empty-state copy. Defaults to a generic message. */
  readonly emptyMessage?: string;
  /** Optional max artifacts to render (newest tail). */
  readonly maxItems?: number;
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
    gap: 12,
    width: '100%',
  } satisfies CSSProperties,
  item: {
    border: '1px solid #e5e7eb',
    background: '#ffffff',
    borderRadius: 12,
    padding: 12,
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  } satisfies CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  } satisfies CSSProperties,
  kindBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: '#4338ca',
    background: '#eef2ff',
    padding: '2px 8px',
    borderRadius: 999,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  } satisfies CSSProperties,
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: '#111827',
    margin: 0,
  } satisfies CSSProperties,
  subtitle: {
    fontSize: 12,
    color: '#6b7280',
    margin: 0,
  } satisfies CSSProperties,
  timestamp: {
    marginLeft: 'auto',
    fontSize: 11,
    color: '#9ca3af',
  } satisfies CSSProperties,
  empty: {
    padding: '24px 16px',
    textAlign: 'center' as const,
    color: '#6b7280',
    background: '#f9fafb',
    border: '1px dashed #e5e7eb',
    borderRadius: 12,
    fontSize: 13,
  } satisfies CSSProperties,
  skeleton: {
    height: 96,
    background:
      'linear-gradient(90deg, #f3f4f6 0%, #e5e7eb 50%, #f3f4f6 100%)',
    backgroundSize: '200% 100%',
    animation: 'chatArtifactStreamPulse 1.4s ease-in-out infinite',
    borderRadius: 12,
  } satisfies CSSProperties,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultRenderer(artifact: ChatArtifact): ReactNode {
  // Placeholder UI used when genui's AdaptiveRenderer is not injected.
  // Production consumers should always supply a real renderer.
  return (
    <pre
      style={{
        margin: 0,
        fontSize: 12,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        color: '#374151',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {safeStringify(artifact.payload)}
    </pre>
  );
}

function safeStringify(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function formatTimestamp(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Compact relative-style label without bringing in a date library.
  const now = Date.now();
  const diffMs = now - d.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatArtifactStream({
  artifacts,
  renderer = defaultRenderer,
  isLoading = false,
  emptyMessage = 'No artifacts yet.',
  maxItems,
  className,
  style,
}: ChatArtifactStreamProps): JSX.Element {
  const visible = useMemo<ReadonlyArray<ChatArtifact>>(() => {
    if (!maxItems || maxItems <= 0) return artifacts;
    if (artifacts.length <= maxItems) return artifacts;
    return artifacts.slice(-maxItems);
  }, [artifacts, maxItems]);

  const containerStyle: CSSProperties = style
    ? { ...styles.container, ...style }
    : styles.container;

  if (isLoading && visible.length === 0) {
    return (
      <div
        data-testid="chat-artifact-stream"
        aria-busy="true"
        className={className}
        style={containerStyle}
      >
        <div style={styles.skeleton} />
        <div style={styles.skeleton} />
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div
        data-testid="chat-artifact-stream"
        data-empty="true"
        className={className}
        style={containerStyle}
      >
        <p style={styles.empty}>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div
      data-testid="chat-artifact-stream"
      data-count={visible.length}
      className={className}
      style={containerStyle}
    >
      {visible.map((artifact) => (
        <article
          key={artifact.id}
          data-testid="chat-artifact-item"
          data-artifact-id={artifact.id}
          data-artifact-kind={artifact.kind}
          style={styles.item}
        >
          <header style={styles.header}>
            <span style={styles.kindBadge}>{artifact.kind}</span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {artifact.title ? (
                <h4 style={styles.title}>{artifact.title}</h4>
              ) : null}
              {artifact.subtitle ? (
                <p style={styles.subtitle}>{artifact.subtitle}</p>
              ) : null}
            </div>
            {formatTimestamp(artifact.createdAt) ? (
              <span style={styles.timestamp}>
                {formatTimestamp(artifact.createdAt)}
              </span>
            ) : null}
          </header>
          {renderer(artifact)}
        </article>
      ))}
    </div>
  );
}
