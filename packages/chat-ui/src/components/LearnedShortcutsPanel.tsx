/**
 * LearnedShortcutsPanel — floating panel that surfaces a user's most
 * frequent actions for the current route, ranked by recency × frequency
 * × confirmation-rate (see `lib/learned-shortcuts/ranker.ts`).
 *
 * Render contract:
 *   - `shortcuts.length === 0` → renders nothing (empty state is
 *     suppressed per spec; the hook returns `null` below mastery
 *     threshold, so callers using the hook + panel together never
 *     reach this branch with a non-null array).
 *   - `placement === 'floating'` (default) → bottom-right desktop,
 *     full-width bottom sheet on mobile (CSS media query inside the
 *     style object — keeps the component dependency-free).
 *   - `placement === 'inline'` → no positioning; flows in document.
 *
 * Drag-to-pin:
 *   Each item is `draggable` and fires `onPin(id)` on drop into the
 *   "pinned slot" (the topmost item's drop target). The panel does
 *   NOT own pin state — wire `onPin` to `useLearnedShortcuts().pin`
 *   so localStorage stays the single source of truth.
 *
 * Styling:
 *   Inline styles only — chat-ui ships to apps with very different
 *   Tailwind setups (owner-portal is Vite + no global layer). This
 *   mirrors `DegradedBanner.tsx` for consistency.
 */

import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import type {
  LearnedShortcut,
  LearnedShortcutsPanelProps,
} from '../lib/learned-shortcuts/types.js';

const DEFAULT_MAX_VISIBLE = 5;
const DEFAULT_HEADLINE = 'Your shortcuts';
const DRAG_MIME = 'application/x-borjie-shortcut';

const styles = {
  floatingContainer: {
    position: 'fixed',
    bottom: 20,
    right: 20,
    width: 280,
    maxWidth: 'calc(100vw - 32px)',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.12)',
    padding: 12,
    zIndex: 40,
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: 13,
    color: '#0f172a',
  } satisfies CSSProperties,
  inlineContainer: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 12,
    padding: 12,
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: 13,
    color: '#0f172a',
  } satisfies CSSProperties,
  headlineRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  } satisfies CSSProperties,
  headline: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    color: '#475569',
    margin: 0,
  } satisfies CSSProperties,
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  } satisfies CSSProperties,
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid transparent',
    background: '#f8fafc',
    cursor: 'pointer',
    textAlign: 'left' as const,
    width: '100%',
    font: 'inherit',
    color: 'inherit',
  } satisfies CSSProperties,
  itemHover: {
    background: '#eef2ff',
    borderColor: '#c7d2fe',
  } satisfies CSSProperties,
  itemDragOver: {
    background: '#dbeafe',
    borderColor: '#60a5fa',
  } satisfies CSSProperties,
  icon: {
    flex: '0 0 16px',
    color: '#6366f1',
    fontSize: 14,
    lineHeight: 1,
  } satisfies CSSProperties,
  label: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } satisfies CSSProperties,
  confidence: {
    flex: '0 0 28px',
    height: 4,
    background: '#e2e8f0',
    borderRadius: 2,
    overflow: 'hidden',
  } satisfies CSSProperties,
  confidenceFill: {
    height: '100%',
    background: '#6366f1',
  } satisfies CSSProperties,
  showMore: {
    marginTop: 8,
    background: 'transparent',
    border: 0,
    color: '#4338ca',
    fontWeight: 500,
    fontSize: 12,
    cursor: 'pointer',
    padding: 4,
    width: '100%',
  } satisfies CSSProperties,
};

interface ItemProps {
  readonly shortcut: LearnedShortcut;
  readonly onClick: (id: string) => void;
  readonly onPin?: (id: string) => void;
  readonly index: number;
}

function ShortcutItem({
  shortcut,
  onClick,
  onPin,
  index,
}: ItemProps): JSX.Element {
  const [hover, setHover] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleClick = useCallback(() => {
    onClick(shortcut.id);
  }, [onClick, shortcut.id]);

  const handleKey = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick(shortcut.id);
      }
    },
    [onClick, shortcut.id],
  );

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>) => {
      event.dataTransfer.setData(DRAG_MIME, shortcut.id);
      event.dataTransfer.effectAllowed = 'move';
    },
    [shortcut.id],
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLButtonElement>) => {
      if (!onPin) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDragOver(true);
    },
    [onPin],
  );

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLButtonElement>) => {
      if (!onPin) return;
      event.preventDefault();
      const draggedId =
        event.dataTransfer.getData(DRAG_MIME) || shortcut.id;
      setDragOver(false);
      onPin(draggedId);
    },
    [onPin, shortcut.id],
  );

  const style: CSSProperties = {
    ...styles.item,
    ...(hover ? styles.itemHover : {}),
    ...(dragOver ? styles.itemDragOver : {}),
  };

  const fillStyle: CSSProperties = {
    ...styles.confidenceFill,
    width: `${Math.round(Math.max(0, Math.min(1, shortcut.confidence)) * 100)}%`,
  };

  return (
    <li>
      <button
        type="button"
        draggable={Boolean(onPin)}
        data-testid={`learned-shortcut-${shortcut.id}`}
        data-shortcut-index={index}
        data-shortcut-confidence={Number(shortcut.confidence ?? 0).toFixed(3)}
        onClick={handleClick}
        onKeyDown={handleKey}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={style}
        aria-label={`Run ${shortcut.label}`}
      >
        {shortcut.icon ? (
          <span aria-hidden="true" style={styles.icon}>
            {shortcut.icon}
          </span>
        ) : null}
        <span style={styles.label}>{shortcut.label}</span>
        <span
          aria-hidden="true"
          style={styles.confidence}
          data-testid={`learned-shortcut-confidence-${shortcut.id}`}
        >
          <span style={fillStyle} />
        </span>
      </button>
    </li>
  );
}

export function LearnedShortcutsPanel({
  shortcuts,
  onActionClick,
  maxVisible = DEFAULT_MAX_VISIBLE,
  placement = 'floating',
  onPin,
  className,
  style,
  headline,
}: LearnedShortcutsPanelProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);

  const visible = useMemo(() => {
    if (shortcuts.length === 0) return [];
    const cap = expanded ? maxVisible + DEFAULT_MAX_VISIBLE : maxVisible;
    return shortcuts.slice(0, cap);
  }, [shortcuts, expanded, maxVisible]);

  // Empty state — render nothing. Hook owns the mastery threshold so
  // we never see a "no shortcuts yet" copy block.
  if (shortcuts.length === 0) return null;

  const containerStyle: CSSProperties = {
    ...(placement === 'floating'
      ? styles.floatingContainer
      : styles.inlineContainer),
    ...(style ?? {}),
  };

  const hasMore = shortcuts.length > visible.length;

  return (
    <aside
      role="complementary"
      data-testid="learned-shortcuts-panel"
      data-placement={placement}
      data-shortcut-count={shortcuts.length}
      className={className}
      style={containerStyle}
      aria-label={headline ?? DEFAULT_HEADLINE}
    >
      <div style={styles.headlineRow}>
        <p style={styles.headline}>{headline ?? DEFAULT_HEADLINE}</p>
      </div>
      <ul style={styles.list}>
        {visible.map((shortcut, index) => (
          <ShortcutItem
            key={shortcut.id}
            shortcut={shortcut}
            index={index}
            onClick={onActionClick}
            {...(onPin ? { onPin } : {})}
          />
        ))}
      </ul>
      {hasMore ? (
        <button
          type="button"
          data-testid="learned-shortcuts-show-more"
          style={styles.showMore}
          onClick={() => setExpanded(true)}
        >
          Show more
        </button>
      ) : null}
    </aside>
  );
}
