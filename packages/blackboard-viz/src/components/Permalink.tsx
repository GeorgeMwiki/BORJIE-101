'use client';

/**
 * Permalink — copy-to-clipboard + scroll-to-anchor for a post.
 *
 * On mount, every view scans `window.location.search` for a
 * `post={id}` parameter and calls `scrollToPost(id)` to land the
 * shared URL at the right anchor.
 *
 * The component itself only renders the copy button; the scroll logic
 * is exported as a standalone function so the views can call it
 * independently of any specific post card.
 *
 * Accessibility:
 *  - Button has visible focus ring (`bb-focusable`).
 *  - Status announcement via the polite announcer when copy succeeds.
 */

import type { CSSProperties } from 'react';

import { announce } from '../a11y/announcer';
import { BLACKBOARD_OKLCH_THEME } from '../themes/blackboard-oklch';

export interface PermalinkProps {
  readonly postId: string;
  /**
   * Builder for the URL. Defaults to `window.location.origin +
   * window.location.pathname + '?post=' + id` so the test bench can
   * inject a deterministic builder.
   */
  readonly buildUrl?: (postId: string) => string;
  /** Optional override for clipboard (test bench). */
  readonly writeClipboard?: (text: string) => Promise<void>;
}

function defaultBuildUrl(postId: string): string {
  if (typeof window === 'undefined') return `?post=${encodeURIComponent(postId)}`;
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?post=${encodeURIComponent(postId)}`;
}

function defaultWriteClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.resolve();
}

/**
 * Scroll the viewport to a post card identified by `postId`. Uses
 * the `data-post-id` attribute every view applies to its cards.
 * No-op when running on the server or when the node is not in the DOM.
 */
export function scrollToPost(postId: string): void {
  if (typeof document === 'undefined') return;
  const node = document.querySelector(`[data-post-id="${CSS.escape(postId)}"]`);
  if (!node) return;
  (node as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' });
  // Optionally pull focus to the card so j/k nav starts from there.
  (node as HTMLElement).focus({ preventScroll: true });
}

/**
 * Read the `post` query parameter from the current URL. Returns null
 * when missing, on the server, or malformed.
 */
export function readPostQueryParam(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('post');
  } catch {
    return null;
  }
}

function buttonStyle(): CSSProperties {
  return {
    background: 'transparent',
    border: `1px solid ${BLACKBOARD_OKLCH_THEME.border.oklch}`,
    borderRadius: 6,
    padding: '4px 8px',
    color: BLACKBOARD_OKLCH_THEME.muted.oklch,
    fontSize: 11,
    cursor: 'pointer',
    minWidth: 24,
    minHeight: 24,
  };
}

export function Permalink({
  postId,
  buildUrl = defaultBuildUrl,
  writeClipboard = defaultWriteClipboard,
}: PermalinkProps): JSX.Element {
  async function handleClick(): Promise<void> {
    const url = buildUrl(postId);
    try {
      await writeClipboard(url);
      announce('Permalink copied to clipboard');
    } catch (error) {
      announce('Failed to copy permalink');
      // Surface the error to host telemetry without crashing the UI.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('bb:permalink-error', {
            detail: { postId, error: String(error) },
          }),
        );
      }
    }
  }

  return (
    <button
      type="button"
      data-testid={`permalink-${postId}`}
      aria-label="Copy permalink"
      onClick={handleClick}
      className="bb-focusable bb-action"
      style={buttonStyle()}
    >
      Link
    </button>
  );
}
