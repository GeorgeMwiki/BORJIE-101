/**
 * Z5 HA wire — single source of truth for ioredis client construction.
 *
 * The DA3 audit found that every service constructed `new Redis(url)`
 * directly from `REDIS_URL`, silently ignoring the `REDIS_SENTINEL_HOSTS`
 * topology Z5 shipped. This module centralises the decision tree:
 *
 *   - `REDIS_SENTINEL_HOSTS` set → Sentinel mode, master selected by
 *     `REDIS_SENTINEL_NAME` (default 'mymaster').
 *   - Otherwise → single-instance mode using `REDIS_URL`.
 *   - Neither set → caller-supplied URL; if still empty, the factory
 *     returns null so dependents can degrade rather than crash on boot.
 *
 * The factory takes an OPTIONS bag (not raw env reads) so:
 *   - Tests can drive every branch deterministically.
 *   - Composition roots can override per-call (e.g. notifications can
 *     point at a separate Redis logical DB).
 *
 * Important: this module does NOT import the `ioredis` runtime. It
 * accepts a constructor at call time. That keeps the `@borjie/config`
 * package free of a heavy peer dep — every service already pulls
 * `ioredis` in directly.
 */

// Minimal structural type for the ioredis constructor — keeps the
// `ioredis` import out of `@borjie/config` while still letting
// consumers pass the real constructor through.
export type IORedisConstructor = new (...args: never[]) => unknown;

/**
 * Inputs to the Redis factory. Every field is optional; we read from
 * `process.env` only inside the dedicated `resolveRedisOptionsFromEnv`
 * helper so this module is pure and easy to mock.
 */
export interface RedisFactoryOptions {
  /**
   * Sentinel hosts as a comma-separated string. Example:
   * "sentinel-1:26379,sentinel-2:26379,sentinel-3:26379".
   */
  readonly sentinelHosts?: string | undefined;
  /** Sentinel master name. Defaults to 'mymaster'. */
  readonly sentinelName?: string | undefined;
  /** Single-instance URL. Used when sentinelHosts is unset. */
  readonly url?: string | undefined;
  /** Redis AUTH password — applied to both modes. */
  readonly password?: string | undefined;
  /**
   * Extra ioredis options passed through verbatim (maxRetriesPerRequest,
   * lazyConnect, enableOfflineQueue, etc). Sentinel-specific keys are
   * merged automatically when sentinelHosts is present.
   */
  readonly clientOptions?: Record<string, unknown>;
}

/**
 * Parsed sentinel entry. Exported so tests can assert the parser's
 * output without round-tripping through ioredis.
 */
export interface SentinelHost {
  readonly host: string;
  readonly port: number;
}

/**
 * Parse "host:port,host:port" into [{host, port}, ...]. Whitespace
 * around commas / colons is trimmed. Invalid entries (missing port,
 * non-numeric port) are dropped silently — the caller decides whether
 * an empty list is fatal.
 */
export function parseSentinelHosts(raw: string | undefined): SentinelHost[] {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry): SentinelHost | null => {
      const [host, portStr] = entry.split(':').map((part) => part.trim());
      if (!host || !portStr) return null;
      const port = Number.parseInt(portStr, 10);
      if (!Number.isFinite(port) || port <= 0 || port > 65_535) return null;
      return { host, port };
    })
    .filter((entry): entry is SentinelHost => entry !== null);
}

/**
 * Resolve options from `process.env`. Service composition roots that
 * need the standard environment-driven wiring call this and then pass
 * the result to `buildRedisOptions`. Tests bypass this helper.
 */
export function resolveRedisOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RedisFactoryOptions {
  return {
    sentinelHosts: env.REDIS_SENTINEL_HOSTS,
    sentinelName: env.REDIS_SENTINEL_NAME,
    url: env.REDIS_URL,
    password: env.REDIS_PASSWORD,
  };
}

/**
 * Discriminated union describing how `new IORedis(...args)` should be
 * invoked. The factory returns this so callers can construct the
 * client themselves using their imported `ioredis` symbol, sidestepping
 * cross-package peer-dep gymnastics.
 *
 * - `mode: 'sentinel'` → invoke as `new IORedis(opts)` where opts
 *   carries `{ sentinels, name, password, ...clientOptions }`.
 * - `mode: 'single'` → invoke as `new IORedis(url, opts)`.
 * - `mode: 'none'` → no Redis configured; the caller must degrade.
 */
export type ResolvedRedisConfig =
  | {
      readonly mode: 'sentinel';
      readonly options: {
        readonly sentinels: ReadonlyArray<SentinelHost>;
        readonly name: string;
        readonly password?: string;
      } & Record<string, unknown>;
    }
  | {
      readonly mode: 'single';
      readonly url: string;
      readonly options: Record<string, unknown>;
    }
  | { readonly mode: 'none' };

/**
 * Pure resolver — does not touch ioredis. Returns a discriminated
 * config the caller can map directly to a constructor invocation.
 */
export function resolveRedisConfig(
  opts: RedisFactoryOptions = {},
): ResolvedRedisConfig {
  const sentinels = parseSentinelHosts(opts.sentinelHosts);
  if (sentinels.length > 0) {
    const sentinelOptions: Record<string, unknown> = {
      sentinels,
      name: opts.sentinelName ?? 'mymaster',
      ...(opts.clientOptions ?? {}),
    };
    if (opts.password) {
      sentinelOptions['password'] = opts.password;
      // Sentinel cluster password — used to authenticate WITH the
      // sentinel daemons themselves. We default it to the same as
      // REDIS_PASSWORD which matches our infra/redis-sentinel default.
      sentinelOptions['sentinelPassword'] = opts.password;
    }
    // The `sentinels` + `name` keys are always present (we just set
    // them) so the cast through `unknown` to the sentinel options shape
    // is sound; sentinelOptions is structurally a superset.
    type SentinelOptions = Extract<
      ResolvedRedisConfig,
      { mode: 'sentinel' }
    >['options'];
    return {
      mode: 'sentinel',
      options: sentinelOptions as unknown as SentinelOptions,
    };
  }
  if (opts.url) {
    const singleOptions: Record<string, unknown> = {
      ...(opts.clientOptions ?? {}),
    };
    // password on URL takes precedence; but if the caller passed a
    // bare password we attach it to the options too so AUTH is sent.
    if (opts.password && !opts.url.includes('@')) {
      singleOptions['password'] = opts.password;
    }
    return { mode: 'single', url: opts.url, options: singleOptions };
  }
  return { mode: 'none' };
}

/**
 * Construct an ioredis client from the resolved config. The caller
 * supplies the `IORedis` constructor (avoids a hard dep on `ioredis`
 * inside `@borjie/config`). Returns null when no Redis is
 * configured — callers must check and degrade.
 *
 * Test pattern:
 *   const fake = vi.fn();
 *   const client = createRedisClient(fake as any, { sentinelHosts: '...' });
 *   expect(fake).toHaveBeenCalledWith({ sentinels: [...], name: 'mymaster', ... });
 */
export function createRedisClient<T = unknown>(
  IORedis: IORedisConstructor,
  opts: RedisFactoryOptions = {},
): T | null {
  const config = resolveRedisConfig(opts);
  switch (config.mode) {
    case 'sentinel':
      // ioredis Sentinel constructor takes a single options object.
      // We've already merged sentinels + name + password into it.
      return new IORedis(config.options as unknown as never) as T;
    case 'single':
      return new IORedis(
        config.url as unknown as never,
        config.options as unknown as never,
      ) as T;
    case 'none':
    default:
      return null;
  }
}
