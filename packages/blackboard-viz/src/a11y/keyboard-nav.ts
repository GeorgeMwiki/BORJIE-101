/**
 * Linear-style keyboard navigation primitives.
 *
 * - j → next post (move focus down)
 * - k → previous post (move focus up)
 * - o → open the focused post's detail surface
 * - Enter → activate the focused post (same as 'o' on most surfaces)
 * - / → focus the search bar
 *
 * Sources:
 *  - Linear — "Building an Activity Feed That Stays Fast",
 *    <https://linear.app/blog/building-activity-feed> (2026-04-18)
 *  - WCAG 2.2 SC 2.1.1 Keyboard,
 *    <https://www.w3.org/TR/WCAG22/#keyboard> (2026-01-30)
 */

import type { KeyboardEvent } from 'react';

export type BlackboardKeyAction =
  | { readonly type: 'next' }
  | { readonly type: 'prev' }
  | { readonly type: 'open' }
  | { readonly type: 'focus-search' }
  | null;

/**
 * Pure mapping from a keyboard event to a logical action.
 * Returns `null` when the key has no binding so the host can let
 * it bubble. Modifier keys (Cmd/Ctrl/Alt) suppress the binding so
 * browser shortcuts continue to work.
 */
export function mapKeyboardEvent(event: KeyboardEvent | { readonly key: string; readonly metaKey?: boolean; readonly ctrlKey?: boolean; readonly altKey?: boolean }): BlackboardKeyAction {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  switch (event.key) {
    case 'j':
    case 'ArrowDown':
      return { type: 'next' };
    case 'k':
    case 'ArrowUp':
      return { type: 'prev' };
    case 'o':
    case 'Enter':
      return { type: 'open' };
    case '/':
      return { type: 'focus-search' };
    default:
      return null;
  }
}

/**
 * Given the current focused id and the list of ids, compute the next
 * id under a `next` or `prev` action. Returns the same id when at the
 * top or bottom (no wrap-around — matches Linear behaviour).
 */
export function applyNav(
  ids: ReadonlyArray<string>,
  currentId: string | null,
  action: BlackboardKeyAction,
): string | null {
  if (ids.length === 0) return null;
  if (action === null) return currentId;

  if (action.type === 'next') {
    if (currentId === null) return ids[0] ?? null;
    const i = ids.indexOf(currentId);
    if (i === -1) return ids[0] ?? null;
    return ids[Math.min(i + 1, ids.length - 1)] ?? currentId;
  }

  if (action.type === 'prev') {
    if (currentId === null) return ids[0] ?? null;
    const i = ids.indexOf(currentId);
    if (i === -1) return ids[0] ?? null;
    return ids[Math.max(i - 1, 0)] ?? currentId;
  }

  // 'open' and 'focus-search' don't change the focused id.
  return currentId;
}
