/**
 * `lazyWithRetry` — wraps a dynamic `import()` with exponential
 * back-off retries to handle the classic `ChunkLoadError` race:
 *
 *   1. User opens the app — browser caches old chunk hashes.
 *   2. We deploy a fresh build — those hashed files no longer exist.
 *   3. User navigates to a code-split route — old chunk 404s.
 *   4. `React.lazy` throws `ChunkLoadError`, blank screen, lost sale.
 *
 * Mitigation: retry the import N times (the CDN may have just been
 * mid-deploy), then force ONE full-page reload that re-fetches the
 * current index.html with the new chunk manifest. Use sessionStorage
 * as a guard so a genuinely broken bundle does not infinite-loop.
 *
 * Source: dev.to/devin-rosario/fix-react-chunk-load-errors-fast-2025
 * and dev.to/goenning/how-to-retry-when-react-lazy-fails-mb5.
 *
 * Usage:
 *   const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));
 *   <Suspense fallback={<Skeleton/>}><Dashboard/></Suspense>
 *
 * Type seam: this file does NOT import 'react' — instead it ships a
 * generic loader-with-retry. The app code wraps it in `React.lazy`:
 *
 *   const Dashboard = React.lazy(() =>
 *     loaderWithRetry(() => import('./pages/Dashboard'))
 *   );
 *
 * Or, in apps that have React installed, the optional `React.lazy`-
 * style wrapper is available via `wrapAsLazy(React, loader)`.
 */

import type { LazyLoadOptions, WindowReloadAdapter } from '../types.js';

const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;
const SESSION_FLAG_PREFIX = 'pt:lazy-retry:';

/**
 * Wrap a dynamic-import loader with retry + reload-on-exhaustion.
 *
 *   const loader = loaderWithRetry(() => import('./Dashboard'));
 *   const Dashboard = React.lazy(() => loader());
 */
export function loaderWithRetry<T>(
  importer: () => Promise<T>,
  opts: LazyLoadOptions = {},
): () => Promise<T> {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const reloadOnExhaustion = opts.reloadOnExhaustion ?? true;
  const windowAdapter = opts.windowAdapter ?? getDefaultWindowAdapter();

  return async function lazyRetryAttempt(): Promise<T> {
    const importerKey = importerCacheKey(importer);
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const mod = await importer();
        // Successful load — clear any stale reload-attempted flag so the
        // next deploy gets its own fresh chance.
        windowAdapter?.setRetryFlag(importerKey, '');
        return mod;
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          await sleep(retryDelayMs * (attempt + 1));
        }
      }
    }

    // All retries exhausted. If we are running in a browser and have not
    // already attempted a reload for this importer, do so exactly once.
    if (reloadOnExhaustion && windowAdapter) {
      const alreadyReloaded = windowAdapter.getRetryFlag(importerKey);
      if (alreadyReloaded !== 'true') {
        windowAdapter.setRetryFlag(importerKey, 'true');
        windowAdapter.reload();
        // The reload will tear down the page before the promise resolves.
        // We return a never-resolving promise so React stays in suspended
        // state until the page actually navigates.
        return new Promise<T>(() => {});
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`lazyWithRetry exhausted after ${retries + 1} attempts`);
  };
}

/**
 * Best-effort fingerprint for an importer fn. We use the toString of the
 * arrow body which contains the literal `'./Dashboard'` etc., so two
 * different routes get two different keys.
 */
function importerCacheKey(importer: () => Promise<unknown>): string {
  const src = importer.toString().slice(0, 200);
  let hash = 5381;
  for (let i = 0; i < src.length; i++) {
    hash = (hash * 33 + src.charCodeAt(i)) >>> 0;
  }
  return `${SESSION_FLAG_PREFIX}${hash.toString(36)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Lazily build a WindowReloadAdapter from the global `window` /
 * `sessionStorage`. Returns `null` on the server.
 */
export function getDefaultWindowAdapter(): WindowReloadAdapter | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as unknown as {
    window?: { location?: { reload: () => void } };
    sessionStorage?: {
      getItem(k: string): string | null;
      setItem(k: string, v: string): void;
    };
  };
  if (!g.window?.location?.reload || !g.sessionStorage) return null;
  return {
    reload: () => g.window!.location!.reload(),
    getRetryFlag: (k) => g.sessionStorage!.getItem(k),
    setRetryFlag: (k, v) => g.sessionStorage!.setItem(k, v),
  };
}

/**
 * Optional convenience wrapper — given a React module reference, return
 * a true `React.LazyExoticComponent`. Kept out of the bundle for non-
 * React consumers; React must be passed in by the caller.
 */
export interface ReactLazyShape {
  lazy<P extends object>(
    factory: () => Promise<{ default: (props: P) => unknown }>,
  ): unknown;
}

export function wrapAsLazy<P extends object>(
  React: ReactLazyShape,
  importer: () => Promise<{ default: (props: P) => unknown }>,
  opts: LazyLoadOptions = {},
): unknown {
  const loader = loaderWithRetry(importer, opts);
  return React.lazy(loader);
}
