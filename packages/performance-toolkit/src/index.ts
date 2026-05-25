/**
 * `@borjie/performance-toolkit` — public barrel.
 *
 * SOTA 2026 performance primitives — lazy-load, streaming SSE, cache
 * strategies, bundle-budget enforcement, prompt-cache, web-vitals.
 *
 *   import { createPerformanceToolkit } from '@borjie/performance-toolkit';
 *
 *   const perf = createPerformanceToolkit({ metricsSink: mySink });
 *   const Dashboard = perf.lazy.loaderWithRetry(() => import('./Dashboard'));
 *   app.use(perf.cache.applyCacheControl('public-swr'));
 *
 * Cite (2026 web perf SOTA): web.dev/inp, web.dev/lcp, web.dev/cls,
 * vercel.com/blog/ai-sdk-5, platform.claude.com/docs/build-with-claude/
 * prompt-caching, web.dev/learn/pwa/workbox, tanstack.com/query/v5,
 * tanstack.com/virtual, developer.chrome.com/docs/web-platform/early-hints.
 */

export * from './types.js';
export * as lazy from './lazy-load/index.js';
export * as streaming from './streaming/index.js';
export * as cache from './cache/index.js';
export * as bundleBudget from './bundle-budget/index.js';
export * as promptCache from './prompt-cache/index.js';
export * as perfMetrics from './perf-metrics/index.js';
export * as yieldAndChunk from './yield-and-chunk/index.js';

import type { PerfMetricsSink } from './types.js';
import * as lazyMod from './lazy-load/index.js';
import * as streamingMod from './streaming/index.js';
import * as cacheMod from './cache/index.js';
import * as bundleBudgetMod from './bundle-budget/index.js';
import * as promptCacheMod from './prompt-cache/index.js';
import * as perfMetricsMod from './perf-metrics/index.js';
import * as yieldAndChunkMod from './yield-and-chunk/index.js';

export interface PerformanceToolkitOptions {
  readonly metricsSink?: PerfMetricsSink;
}

/**
 * Composition root — wires the seven subsystems with a shared metrics
 * sink so a single import gives callers the full toolkit.
 */
export function createPerformanceToolkit(opts: PerformanceToolkitOptions = {}) {
  return {
    lazy: lazyMod,
    streaming: streamingMod,
    cache: cacheMod,
    bundleBudget: bundleBudgetMod,
    promptCache: promptCacheMod,
    yieldAndChunk: yieldAndChunkMod,
    metrics: opts.metricsSink !== undefined
      ? perfMetricsMod.bindSink(opts.metricsSink)
      : perfMetricsMod,
  };
}
