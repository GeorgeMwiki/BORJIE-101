/**
 * `@borjie/performance-toolkit` — public types.
 *
 * SOTA 2026 web-performance toolkit covering:
 *
 *   - Lazy loading (route-based + component-based with retry-on-chunk-error)
 *   - Streaming SSE (server + client helpers)
 *   - Cache strategies (ETag/304, stale-while-revalidate, Brotli, Cache-Control presets)
 *   - Bundle-budget enforcement (CI gate)
 *   - Anthropic prompt-cache helpers (90% input-token savings on stable prefixes)
 *   - web-vitals v5 + RED metrics emit (INP, LCP, CLS, TTFB, FCP)
 *
 * Zero hard runtime deps. React/Hono/Fastify are peer-optional and only
 * required when you import the relevant subsystem. Tests use structural
 * typing — we never `import 'react'` so the package builds in pure-Node.
 *
 * Web Vitals 2026 thresholds (75th percentile of real-user data):
 *   - LCP   ≤ 2.5s   (good)  / ≤ 4.0s (needs improvement)
 *   - INP   ≤ 200ms  (good)  / ≤ 500ms (needs improvement)
 *   - CLS   ≤ 0.1    (good)  / ≤ 0.25  (needs improvement)
 *   - TTFB  ≤ 800ms  (good)
 *   - FCP   ≤ 1.8s   (good)
 *
 * INP replaced FID in March 2024. 43% of sites currently fail INP — the
 * most commonly missed CWV. Source: web.dev/inp, corewebvitals.io 2026.
 */

// ─────────────────────────────────────────────────────────────────────
// Lazy load
// ─────────────────────────────────────────────────────────────────────

export interface LazyLoadOptions {
  /**
   * How many times to retry the dynamic import when it throws (typically
   * `ChunkLoadError` after a deploy). Default 2. Each retry waits
   * `retryDelayMs * attempt` before retrying.
   */
  readonly retries?: number;
  /** Linear back-off in ms between retries. Default 250. */
  readonly retryDelayMs?: number;
  /**
   * When all retries fail, force a single full-page reload to pick up the
   * new bundle. Guarded by sessionStorage so we never infinite-loop.
   * Default `true`.
   */
  readonly reloadOnExhaustion?: boolean;
  /**
   * Test seam — inject a custom `window.location.reload` and
   * `sessionStorage`. Lets us assert reload behaviour in vitest without
   * jsdom.
   */
  readonly windowAdapter?: WindowReloadAdapter;
}

export interface WindowReloadAdapter {
  reload(): void;
  getRetryFlag(key: string): string | null;
  setRetryFlag(key: string, value: string): void;
}

export interface PrefetchSpec {
  /** Absolute or relative href to prefetch. */
  readonly href: string;
  /** `script` (module bundle) | `style` | `image` | `font` | `fetch`. */
  readonly as?:
    | 'script'
    | 'style'
    | 'image'
    | 'font'
    | 'fetch'
    | 'document';
  /**
   * Required for cross-origin fonts. Browsers will ignore non-crossorigin
   * font preloads silently — common gotcha.
   */
  readonly crossOrigin?: 'anonymous' | 'use-credentials';
  /**
   * `prefetch` (low-priority, idle) or `preload` (high-priority, immediate).
   * Hover prefetch → `prefetch`. LCP image → `preload`.
   */
  readonly rel?: 'prefetch' | 'preload' | 'modulepreload' | 'dns-prefetch' | 'preconnect';
}

export interface IntersectionLazyState<T> {
  readonly loaded: boolean;
  readonly data: T | null;
  readonly error: Error | null;
}

// ─────────────────────────────────────────────────────────────────────
// Streaming
// ─────────────────────────────────────────────────────────────────────

export interface StreamingResponseSpec<T> {
  /** Async iterable of source records to stream. */
  readonly source: AsyncIterable<T>;
  /** Map each record → SSE data line. Return `null` to skip. */
  readonly mapper: (record: T, index: number) => string | null;
  /**
   * Optional event name applied to every SSE frame (so the client can
   * `addEventListener(name, …)`). Default `'message'`.
   */
  readonly eventName?: string;
  /**
   * Heart-beat ping interval in ms. Many proxies (nginx default 60s,
   * Cloudflare ~100s) close idle SSE streams; a periodic `:ping` comment
   * keeps them alive. Default 30000 (30s). Set 0 to disable.
   */
  readonly keepAliveMs?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────────────

/**
 * Preset cache strategies — match Vercel / Cloudflare / Fastly best
 * practice for SaaS APIs.
 *
 *   - `public-immutable`  : long-lived static (hashed asset names, fonts).
 *   - `public-swr`        : public read-many endpoints (org listings).
 *   - `private-no-store`  : sensitive (financials, KYC, audit).
 *   - `edge-cdn`          : CDN-cached with SWR for global distribution.
 *   - `private-revalidate`: per-user data; must-revalidate every request.
 */
export type CacheStrategy =
  | 'public-immutable'
  | 'public-swr'
  | 'private-no-store'
  | 'edge-cdn'
  | 'private-revalidate';

export interface CacheControlPreset {
  readonly cacheControl: string;
  /**
   * Vary header value — typically `Accept-Encoding, Authorization` for
   * private endpoints, or `Accept-Encoding` for public ones.
   */
  readonly vary: string;
}

export interface ETagCacheOptions<TReq> {
  /** Stable key extractor — typically `req.url + req.user.tenantId`. */
  readonly keyer: (req: TReq) => string;
  /**
   * Optional store — defaults to in-memory LRU (1024 entries). Provide a
   * Redis-backed store for clustered deployments.
   */
  readonly store?: ETagStore;
}

export interface ETagStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, etag: string): Promise<void>;
}

export interface SWROptions<T> {
  readonly fetchFn: () => Promise<T>;
  /** Fresh window — within this period we return cached data without refetching. */
  readonly ttlMs: number;
  /**
   * Stale window — past `ttlMs` but within `swrMs` we return stale data
   * **and** kick off a background refetch ("stale-while-revalidate").
   * Beyond `swrMs` we await a fresh fetch.
   */
  readonly swrMs: number;
}

// ─────────────────────────────────────────────────────────────────────
// Bundle budget
// ─────────────────────────────────────────────────────────────────────

export interface BundleBudget {
  /** Bundle entry name (e.g. `index`, `main`, `dashboard`). */
  readonly entry: string;
  /** Hard cap in KB (gzipped). Build fails above this. */
  readonly maxKB: number;
  /** Soft warning cap. Console warning above, error above `maxKB`. */
  readonly warnKB?: number;
}

export interface BundleCheckResult {
  readonly entry: string;
  readonly actualKB: number;
  readonly maxKB: number;
  readonly warnKB?: number;
  readonly status: 'ok' | 'warn' | 'error' | 'missing';
  readonly message: string;
}

// ─────────────────────────────────────────────────────────────────────
// Prompt cache
// ─────────────────────────────────────────────────────────────────────

/**
 * Anthropic's `cache_control: { type: "ephemeral" }` marker. Stable
 * sections marked this way get 90% input-token discount on cache hits.
 *
 * Cache write costs 1.25× standard input (5-min TTL) or 2.0× (1-hour TTL).
 * Cache read costs 0.1× standard input — the 90% savings figure.
 *
 * Source: platform.claude.com/docs/build-with-claude/prompt-caching (2026).
 */
export interface PromptCacheControl {
  readonly type: 'ephemeral';
  readonly ttl?: '5m' | '1h';
}

export interface PromptCacheBlock {
  readonly type: 'text';
  readonly text: string;
  readonly cache_control?: PromptCacheControl;
}

export interface PromptCacheMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string | readonly PromptCacheBlock[];
}

export interface PromptCacheEstimate {
  readonly cachedTokensEstimate: number;
  readonly writeCostMultiplier: number;
  readonly readCostMultiplier: number;
  readonly hitSavingsPercent: number;
  readonly estimatedHitCostUsd: number;
  readonly estimatedMissCostUsd: number;
}

// ─────────────────────────────────────────────────────────────────────
// Perf metrics
// ─────────────────────────────────────────────────────────────────────

export type WebVitalName = 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB';

export type WebVitalRating = 'good' | 'needs-improvement' | 'poor';

export interface WebVitalReport {
  readonly name: WebVitalName;
  readonly value: number;
  readonly rating: WebVitalRating;
  readonly id: string;
  readonly delta?: number;
  readonly navigationType?: string;
  readonly attribution?: Record<string, unknown>;
}

export interface ResponseLatencyReport {
  readonly route: string;
  readonly ms: number;
  readonly status: number;
  readonly method?: string;
  readonly cacheHit?: boolean;
}

export interface PerfMetricsSink {
  reportWebVital(metric: WebVitalReport): void | Promise<void>;
  reportResponseLatency(metric: ResponseLatencyReport): void | Promise<void>;
}
