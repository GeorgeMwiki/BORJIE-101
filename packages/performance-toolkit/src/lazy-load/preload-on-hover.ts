/**
 * `preloadOnHover` — warm a COMPONENT bundle on intent (hover / focus /
 * touch). Distinct from `prefetchOnHover` which warms ROUTE bundles via
 * `<link rel="prefetch">`.
 *
 * Pattern. Paired with `lazyClient` / `next/dynamic` / `React.lazy` this
 * turns "I clicked, now wait for the chunk" into "the chunk was already
 * in cache by the time I clicked." Combine both on a button that opens
 * a heavy modal: prefetch the route + preload the modal bundle on
 * hover. Click is now instant.
 *
 *   const handlers = preloadOnHover(() => import('@/features/HeavyModal'));
 *   <Button {...handlers} onClick={openModal}>Open</Button>
 *
 * Idempotent — repeated hovers do not refire the import. The internal
 * `started` flag is per-call so each `preloadOnHover(...)` instance
 * tracks its own state.
 *
 * SSR-safe — the loader is called via `Promise.resolve().then(...)` so
 * the import never fires during render. Server bundles never touch the
 * handler set (they are pure functions until invoked).
 *
 * Errors are swallowed by design — if the dynamic chunk fails to load
 * here, the user's actual click triggers a real import which propagates
 * the error via the normal Suspense boundary. Logging a soft error here
 * would double-report.
 *
 * @module lazy-load/preload-on-hover
 */

export interface PreloadHandlers {
  readonly onMouseEnter: () => void;
  readonly onFocus: () => void;
  readonly onTouchStart: () => void;
}

/**
 * Returns handlers that fire `loader()` once on the first intent
 * gesture, then no-op on subsequent fires. Spread onto any Button /
 * Link / Card.
 *
 * @example
 *   const importModal = () => import('./HeavyModal');
 *   const handlers = preloadOnHover(importModal);
 *   <button {...handlers} onClick={() => setOpen(true)}>Open</button>
 */
export function preloadOnHover<T>(
  loader: () => Promise<T>,
): PreloadHandlers {
  let started = false;
  const trigger = (): void => {
    if (started) return;
    started = true;
    // Schedule the import on a microtask so the handler returns
    // immediately and we don't block the gesture's event handler.
    Promise.resolve()
      .then(loader)
      .catch(() => {
        // Swallow prefetch failures. The click path re-imports and
        // surfaces the error through the normal Suspense boundary.
      });
  };
  return {
    onMouseEnter: trigger,
    onFocus: trigger,
    onTouchStart: trigger,
  };
}

/**
 * `preloadManyOnHover` — warm a cluster of component bundles. Useful
 * for a menu / drawer that opens several lazy panels at once.
 *
 * @example
 *   const handlers = preloadManyOnHover([
 *     () => import('./Tab1'),
 *     () => import('./Tab2'),
 *     () => import('./Tab3'),
 *   ]);
 */
export function preloadManyOnHover(
  loaders: ReadonlyArray<() => Promise<unknown>>,
): PreloadHandlers {
  let started = false;
  const trigger = (): void => {
    if (started) return;
    started = true;
    loaders.forEach((loader) => {
      Promise.resolve()
        .then(loader)
        .catch(() => {
          // see preloadOnHover for rationale
        });
    });
  };
  return {
    onMouseEnter: trigger,
    onFocus: trigger,
    onTouchStart: trigger,
  };
}
