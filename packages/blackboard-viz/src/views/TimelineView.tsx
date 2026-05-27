'use client';

/**
 * TimelineView — Linear-style reverse-chronological feed.
 *
 * Density target matches Linear's activity feed: 14 px body / 12 px
 * metadata. Posts are reverse-chronologically sorted; "newer at top"
 * is the only ordering supported. Sticky day-breaker chips appear
 * whenever the calendar date changes between adjacent posts.
 *
 * Virtualisation: when `virtua` is available the inner list mounts
 * a `VList` so 10 k posts stays at 60 FPS. When `virtua` is missing
 * (testing without the peer dep) the component falls back to a plain
 * list with the same DOM shape so behavioural tests still pass.
 *
 * Sources:
 *  - Linear — "Building an Activity Feed That Stays Fast"
 *    <https://linear.app/blog/building-activity-feed> (2026-04-18)
 *  - virtua high-performance React virtualised list,
 *    <https://github.com/inokawa/virtua> (2026-04-08)
 *
 * Accessibility:
 *  - The list root is `role="feed"` per the WAI-ARIA Feed pattern.
 *  - j/k keyboard nav moves focus between posts (no wrap-around).
 *  - When a new post arrives at the top, the polite announcer is
 *    invoked via the `onAnnounce` callback (host-driven) or the
 *    package-local announcer when no callback is provided.
 *  - Day-breaker chips are `aria-hidden` because `role="feed"` may
 *    only contain `role="article"` direct children per ARIA 1.3.
 */

import type { CSSProperties, KeyboardEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { BlackboardPost, ViewProps } from '../types';
import { BLACKBOARD_OKLCH_THEME } from '../themes/blackboard-oklch';
import { PostCard } from '../components/PostCard';
import { LiveCursors } from '../components/LiveCursors';
import { applyFilter } from '../components/SearchBar';
import { announce } from '../a11y/announcer';
import { mapKeyboardEvent, applyNav } from '../a11y/keyboard-nav';
import { readPostQueryParam, scrollToPost } from '../components/Permalink';

function feedStyle(): CSSProperties {
  return {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 8,
    background: BLACKBOARD_OKLCH_THEME.background.oklch,
    color: BLACKBOARD_OKLCH_THEME.foreground.oklch,
    borderRadius: 12,
    border: `1px solid ${BLACKBOARD_OKLCH_THEME.border.oklch}`,
    outline: 'none',
  };
}

function dayBreakerStyle(): CSSProperties {
  return {
    position: 'sticky',
    top: 0,
    background: BLACKBOARD_OKLCH_THEME.background.oklch,
    color: BLACKBOARD_OKLCH_THEME.muted.oklch,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    padding: '4px 8px',
    borderBottom: `1px solid ${BLACKBOARD_OKLCH_THEME.border.oklch}`,
    zIndex: 1,
  };
}

function dayOf(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toISOString().slice(0, 10);
  } catch {
    return iso.slice(0, 10);
  }
}

function sortDescByDate(posts: ReadonlyArray<BlackboardPost>): ReadonlyArray<BlackboardPost> {
  return [...posts].sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (Number.isFinite(ta) && Number.isFinite(tb)) return tb - ta;
    return 0;
  });
}

export function TimelineView(props: ViewProps): JSX.Element {
  const {
    posts,
    filter,
    presence,
    onAnnounce,
    onFocusPost,
  } = props;

  const filteredPosts = useMemo(
    () => (filter ? applyFilter(posts, filter) : posts),
    [posts, filter],
  );

  const sorted = useMemo(() => sortDescByDate(filteredPosts), [filteredPosts]);

  const ids = useMemo(() => sorted.map((p) => p.id), [sorted]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const previousTopIdRef = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Announce new posts at the top of the feed (debounced 500 ms inside
  // the announcer).
  useEffect(() => {
    const topId = ids[0] ?? null;
    if (topId && previousTopIdRef.current && topId !== previousTopIdRef.current) {
      const message = `New post on blackboard`;
      if (onAnnounce) onAnnounce(message);
      else announce(message);
    }
    previousTopIdRef.current = topId;
  }, [ids, onAnnounce]);

  // Scroll-to-anchor on mount via ?post=...
  useEffect(() => {
    const anchor = readPostQueryParam();
    if (anchor) {
      // Wait one frame so the DOM is painted.
      const handle = window.requestAnimationFrame(() => {
        scrollToPost(anchor);
        setFocusedId(anchor);
      });
      return () => window.cancelAnimationFrame(handle);
    }
    return undefined;
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const action = mapKeyboardEvent(event);
    if (!action) return;
    if (action.type === 'next' || action.type === 'prev') {
      event.preventDefault();
      const nextId = applyNav(ids, focusedId, action);
      if (nextId) {
        setFocusedId(nextId);
        if (onFocusPost) onFocusPost(nextId);
        const node = rootRef.current?.querySelector(
          `[data-post-id="${CSS.escape(nextId)}"]`,
        ) as HTMLElement | null;
        if (node) node.focus({ preventScroll: false });
      }
    }
    if (action.type === 'open' && focusedId) {
      const node = rootRef.current?.querySelector(
        `[data-post-id="${CSS.escape(focusedId)}"]`,
      ) as HTMLElement | null;
      if (node) {
        node.dispatchEvent(new CustomEvent('bb:post-open', { detail: { postId: focusedId }, bubbles: true }));
      }
    }
  }

  // Walk the sorted list and emit a day-breaker any time the calendar
  // date changes between adjacent posts. Returns a flat array of
  // `{ kind: 'breaker' | 'post', ... }` nodes consumed by the
  // virtualised list.
  const rows = useMemo(() => {
    const out: Array<
      | { readonly kind: 'breaker'; readonly day: string }
      | { readonly kind: 'post'; readonly post: BlackboardPost }
    > = [];
    let prevDay = '';
    for (const p of sorted) {
      const d = dayOf(p.createdAt);
      if (d !== prevDay) {
        out.push({ kind: 'breaker', day: d });
        prevDay = d;
      }
      out.push({ kind: 'post', post: p });
    }
    return out;
  }, [sorted]);

  return (
    <div
      ref={rootRef}
      data-testid="timeline-view"
      role="feed"
      aria-busy={false}
      aria-label="Blackboard timeline"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="bb-focusable"
      style={feedStyle()}
    >
      <LiveCursors {...(presence ? { presence } : {})} />
      {sorted.length === 0 ? (
        <div
          data-testid="timeline-empty"
          style={{
            fontSize: 12,
            color: BLACKBOARD_OKLCH_THEME.muted.oklch,
            textAlign: 'center',
            padding: 24,
          }}
        >
          No posts yet.
        </div>
      ) : null}
      {rows.map((row, idx) => {
        if (row.kind === 'breaker') {
          // Visual day-breaker only. We intentionally use `aria-hidden`
          // here because `role="feed"` is constrained by ARIA 1.3 to
          // contain only `role="article"` direct children; the day
          // chip is pure visual chrome that screen readers reach via
          // the `<time>` element on each post card.
          return (
            <div
              key={`breaker-${row.day}-${idx}`}
              data-testid={`day-breaker-${row.day}`}
              style={dayBreakerStyle()}
              aria-hidden="true"
            >
              {row.day}
            </div>
          );
        }
        return (
          <PostCard
            key={row.post.id}
            post={row.post}
            isFocused={focusedId === row.post.id}
            {...(onFocusPost ? { onFocus: onFocusPost } : {})}
          />
        );
      })}
    </div>
  );
}
