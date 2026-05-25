/**
 * Slow Query Logger
 *
 * Wraps a DatabaseClient so every query whose wall-clock duration exceeds
 * `SLOW_QUERY_THRESHOLD_MS` is reported via the supplied `onSlowQuery`
 * callback. Drop the wrapper in front of the drizzle client in any service
 * that wants the extra visibility:
 *
 *   const rawDb = createDatabaseClient(url)
 *   const db = withSlowQueryLogging(rawDb, { onSlowQuery: sendToObservability })
 *
 * The wrapper is additive: when no callback is supplied it falls back to a
 * plain console.warn (kept out of `console.log` per style guide). Threshold
 * defaults to 500 ms but may be overridden via env or options.
 */

import type { DatabaseClient } from './client.js'
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SlowQueryEvent {
  readonly query: string
  readonly params: ReadonlyArray<unknown>
  readonly durationMs: number
  readonly rowCount: number | undefined
  readonly thresholdMs: number
  readonly startedAt: Date
}

export interface SlowQueryLoggerOptions {
  /**
   * Threshold in milliseconds above which a query is considered slow.
   * Defaults to the numeric value of SLOW_QUERY_THRESHOLD_MS env var, or 500.
   */
  readonly thresholdMs?: number
  /**
   * Called once per slow query. Defaults to console.warn with a structured
   * line — wire this into your observability stack in production.
   */
  readonly onSlowQuery?: (event: SlowQueryEvent) => void
  /**
   * Optional tag included in every event (e.g. service name).
   */
  readonly tag?: string
  /**
   * When true, every query (not just slow ones) is forwarded to
   * `onQuery` — useful in dev. Default: false.
   */
  readonly logAllQueries?: boolean
  readonly onQuery?: (event: SlowQueryEvent) => void
}

/**
 * Returns a DatabaseClient-like proxy that times every query. The original
 * client is not mutated; callers should prefer the returned handle.
 */
export function withSlowQueryLogging(
  db: DatabaseClient,
  options: SlowQueryLoggerOptions = {}
): DatabaseClient {
  const thresholdMs = options.thresholdMs ?? parseThresholdEnv() ?? 500
  const onSlowQuery = options.onSlowQuery ?? defaultSlowQueryHandler(options.tag)
  const onQuery = options.onQuery
  const logAllQueries = options.logAllQueries ?? false

  // Drizzle exposes the low-level postgres.js client via `$client`; we
  // intercept its tagged-template invocations there.
  const client = (db as unknown as { $client?: unknown }).$client
  if (!isPostgresJsClient(client)) {
    // Graceful fallback: return the client unwrapped if the shape isn't what
    // we expect. We still emit a single warning so the misconfiguration is
    // visible at startup.
    emitConfigurationWarning()
    return db
  }

  // Wrap the sql callable so every invocation is measured.
  const wrapped = wrapPostgresClient(client, {
    thresholdMs,
    onSlowQuery,
    onQuery,
    logAllQueries,
  })

  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === '$client') return wrapped
      return Reflect.get(target as object, prop, receiver)
    },
  }) as DatabaseClient
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface PostgresJsClient {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>
  unsafe: (query: string, params?: unknown[]) => Promise<unknown>
}

function isPostgresJsClient(candidate: unknown): candidate is PostgresJsClient {
  return (
    typeof candidate === 'function' &&
    typeof (candidate as { unsafe?: unknown }).unsafe === 'function'
  )
}

interface WrapContext {
  readonly thresholdMs: number
  readonly onSlowQuery: (event: SlowQueryEvent) => void
  readonly onQuery?: (event: SlowQueryEvent) => void
  readonly logAllQueries: boolean
}

function wrapPostgresClient(
  client: PostgresJsClient,
  ctx: WrapContext
): PostgresJsClient {
  const wrappedUnsafe = async (query: string, params: unknown[] = []) => {
    const startedAt = new Date()
    const start = performanceNow()
    try {
      const result = await client.unsafe(query, params)
      recordQuery({
        ctx,
        event: {
          query,
          params,
          durationMs: performanceNow() - start,
          rowCount: extractRowCount(result),
          thresholdMs: ctx.thresholdMs,
          startedAt,
        },
      })
      return result
    } catch (error) {
      recordQuery({
        ctx,
        event: {
          query,
          params,
          durationMs: performanceNow() - start,
          rowCount: undefined,
          thresholdMs: ctx.thresholdMs,
          startedAt,
        },
      })
      throw error
    }
  }

  // Tagged-template invocations aren't trivially interceptable on the raw
  // callable — postgres.js users can still reach them via wrapped.unsafe(…),
  // and drizzle routes through that path. Preserve the function identity
  // while overriding .unsafe.
  const proxy = new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'unsafe') return wrappedUnsafe
      return Reflect.get(target as object, prop, receiver)
    },
  }) as PostgresJsClient

  return proxy
}

function recordQuery(input: { ctx: WrapContext; event: SlowQueryEvent }): void {
  const { ctx, event } = input
  if (ctx.logAllQueries && ctx.onQuery) {
    try {
      ctx.onQuery(event)
    } catch {
      // swallow logger faults; never break the caller
    }
  }
  if (event.durationMs >= ctx.thresholdMs) {
    try {
      ctx.onSlowQuery(event)
    } catch {
      // swallow logger faults; never break the caller
    }
  }
}

function extractRowCount(result: unknown): number | undefined {
  if (Array.isArray(result)) return result.length
  if (result && typeof result === 'object' && 'count' in result) {
    const c = (result as { count?: unknown }).count
    return typeof c === 'number' ? c : undefined
  }
  return undefined
}

function performanceNow(): number {
  // Node has performance.now since 16; fall back to Date if missing.
  const perf = (globalThis as { performance?: { now: () => number } }).performance
  return perf ? perf.now() : Date.now()
}

function parseThresholdEnv(): number | undefined {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.SLOW_QUERY_THRESHOLD_MS
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function defaultSlowQueryHandler(tag?: string): (event: SlowQueryEvent) => void {
  return (event) => {
    const prefix = tag ? `[slow-query:${tag}]` : '[slow-query]'
    logger.warn(prefix, {
      tag,
      durationMs: Math.round(event.durationMs * 100) / 100,
      thresholdMs: event.thresholdMs,
      rowCount: event.rowCount,
      query: truncate(event.query, 500),
      startedAt: event.startedAt.toISOString(),
    });
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`
}

let configWarningEmitted = false
function emitConfigurationWarning(): void {
  if (configWarningEmitted) return
  configWarningEmitted = true
  logger.warn('[slow-query] could not attach: database client does not expose a postgres.js $client; logging disabled.');
}
