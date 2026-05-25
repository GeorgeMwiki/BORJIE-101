/**
 * `yieldNow` — yield control to the browser's main thread.
 *
 * Chunks long client-side loops so the browser keeps the main thread
 * responsive. INP (Interaction to Next Paint) improves from "Needs
 * improvement" to "Good" once the longest individual task during an
 * interaction drops below 50ms — well under the < 200ms Web Vitals
 * INP threshold.
 *
 * Chrome 129+ ships the official `scheduler.yield()` Web Platform API
 * which yields to higher-priority tasks (user input, paint, rAF
 * callbacks). On older browsers we fall back to `setTimeout(0)` which
 * yields at the end of the macrotask queue.
 *
 * SSR + tests. When `window` is undefined (Server Components, Vitest
 * Node runner) the function resolves immediately so the same code path
 * works on every surface without branching.
 *
 * @example
 *   for (let i = 0; i < items.length; i++) {
 *     processOne(items[i]);
 *     if ((i & 31) === 31) await yieldNow();
 *   }
 *
 * Cite: web.dev/inp (INP < 200ms thresholds, March 2025),
 * developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield.
 *
 * @module yield-and-chunk/yield-now
 */

interface SchedulerLike {
  readonly yield?: () => Promise<void>;
}

interface WindowWithScheduler {
  readonly scheduler?: SchedulerLike;
}

/**
 * Yield control to the browser's main thread. Resolves on the next
 * task tick. Cooperatively safe to call inside any client-side loop.
 *
 * Resolves immediately on the server (no window, no scheduler) so the
 * function is safe to call inside SSR, Server Components, or Vitest.
 */
export async function yieldNow(): Promise<void> {
  if (typeof globalThis === 'undefined') return;
  const win = (globalThis as { window?: WindowWithScheduler }).window;
  if (win === undefined) {
    return;
  }
  const scheduler = win.scheduler;
  if (scheduler !== undefined && typeof scheduler.yield === 'function') {
    return scheduler.yield();
  }
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
