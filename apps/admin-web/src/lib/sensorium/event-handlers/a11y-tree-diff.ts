/**
 * `a11y.tree.diff` handler — Central Command Phase A.
 *
 * MutationObserver-driven, debounced 500ms. Re-snapshots the a11y tree
 * and emits the role-set diff vs. the previous snapshot. The brain
 * reads addedRoles / removedRoles to detect modals opening, side
 * panels appearing, etc. — way cheaper than re-feeding the full DOM.
 */

import { snapshotA11yTree } from '../a11y-tree-snapshot.js';
import type { HandlerInstall } from './types.js';

const DEBOUNCE_MS = 500;

export const installA11yTreeDiffHandler: HandlerInstall = (emit, ctx) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => undefined;
  }
  let lastVisible = new Set<string>();
  let lastFocused: string | undefined;
  let lastDigest = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  function fire(): void {
    const snapshot = snapshotA11yTree();
    if (snapshot.digest === lastDigest) return;
    const visible = new Set(snapshot.visibleRoles);
    const addedRoles = [...visible].filter((r) => !lastVisible.has(r));
    const removedRoles = [...lastVisible].filter((r) => !visible.has(r));
    const focusedRole = snapshot.focusedRole;

    emit({
      eventType: 'a11y.tree.diff',
      route: ctx.route(),
      emittedAt: new Date().toISOString(),
      payload: {
        route: ctx.route(),
        addedRoles,
        removedRoles,
        focusedRole: focusedRole ?? '',
      },
    });

    lastVisible = visible;
    lastFocused = focusedRole;
    lastDigest = snapshot.digest;
  }

  function trigger(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fire();
    }, DEBOUNCE_MS);
  }

  // Initial fire so the first snapshot establishes a baseline.
  fire();

  const observer =
    typeof MutationObserver !== 'undefined'
      ? new MutationObserver(trigger)
      : null;
  if (observer && document.body) {
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'role',
        'aria-label',
        'aria-hidden',
        'aria-expanded',
        'aria-current',
        'hidden',
      ],
    });
  }
  // Suppress "unused" warnings under noUnusedLocals — `lastFocused`
  // is reserved for future per-focus diffing; the assignment above
  // gives it observable side effects.
  void lastFocused;

  return () => {
    if (timer) clearTimeout(timer);
    observer?.disconnect();
  };
};
