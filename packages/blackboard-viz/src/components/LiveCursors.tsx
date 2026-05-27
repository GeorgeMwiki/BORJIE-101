'use client';

/**
 * LiveCursors — multiplayer presence overlay.
 *
 * Renders one cursor per peer in `presence`. Cursors are positioned
 * with `transform: translate3d(...)` so only the compositor moves —
 * no layout, no paint inside the post list.
 *
 * Source: Liveblocks — "How to build multiplayer cursors with React"
 * <https://liveblocks.io/blog/how-to-build-multiplayer-cursors-with-react>
 * 2025-09-20.
 *
 * The component is render-only. The host injects `presence`; the
 * transport (Liveblocks, Supabase Realtime, SSE) is not this
 * package's concern.
 *
 * Accessibility:
 *  - Cursors are decorative (`aria-hidden="true"`). The peer list is
 *    surfaced separately via the announcer when a peer joins/leaves
 *    (host-driven; we only render the visual layer).
 *  - Names are visible labels next to each cursor, so sighted users
 *    can tell who is who.
 */

import type { CSSProperties } from 'react';

import type { LiveCursorState } from '../types';
import { tokenForCursor } from '../themes/blackboard-oklch';

export interface LiveCursorsProps {
  readonly presence?: ReadonlyArray<LiveCursorState>;
  /** ISO-8601; presence older than `staleMs` is hidden. Default 5000 ms. */
  readonly staleMs?: number;
  /** Current time provider — overridden by tests. */
  readonly now?: () => number;
}

function isFresh(state: LiveCursorState, nowMs: number, staleMs: number): boolean {
  const t = Date.parse(state.updatedAt);
  if (!Number.isFinite(t)) return false;
  return nowMs - t < staleMs;
}

function cursorContainerStyle(): CSSProperties {
  return {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: 50,
  };
}

function cursorStyle(state: LiveCursorState): CSSProperties {
  const color = tokenForCursor(state.userId).oklch;
  return {
    position: 'absolute',
    top: 0,
    left: 0,
    transform: `translate3d(${state.x}px, ${state.y}px, 0)`,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    color,
    fontSize: 11,
    transition: 'transform 80ms linear',
  };
}

function labelStyle(state: LiveCursorState): CSSProperties {
  const color = tokenForCursor(state.userId).oklch;
  return {
    background: color,
    color: 'white',
    padding: '1px 6px',
    borderRadius: 4,
    fontSize: 11,
    marginLeft: 6,
  };
}

export function LiveCursors({
  presence,
  staleMs = 5000,
  now = Date.now,
}: LiveCursorsProps): JSX.Element | null {
  if (!presence || presence.length === 0) return null;
  const nowMs = now();
  const fresh = presence.filter((p) => isFresh(p, nowMs, staleMs));
  if (fresh.length === 0) return null;

  return (
    <div
      data-testid="live-cursors"
      aria-hidden="true"
      style={cursorContainerStyle()}
    >
      {fresh.map((state) => (
        <div
          key={state.userId}
          data-testid={`cursor-${state.userId}`}
          style={cursorStyle(state)}
        >
          <svg width="14" height="20" viewBox="0 0 14 20" aria-hidden="true">
            <path
              d="M0 0 L0 16 L4 12 L7 19 L10 18 L7 11 L13 11 Z"
              fill={tokenForCursor(state.userId).oklch}
              stroke="white"
              strokeWidth="1"
            />
          </svg>
          <span style={labelStyle(state)}>{state.name}</span>
        </div>
      ))}
    </div>
  );
}
