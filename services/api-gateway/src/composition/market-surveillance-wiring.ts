/**
 * Market-surveillance wiring — adapts the AI-native `MarketSurveillance`
 * agent from `@borjie/ai-copilot/ai-native/market-surveillance` into
 * a composition-root service backed by Drizzle (via the
 * `createMarketRateSnapshotsService` storage adapter shipped in
 * commit e33cebc).
 *
 * Three ports are constructed here:
 *
 *   1. `MarketSurveillanceRepository` — `insertSnapshot` and
 *      `listRecentSnapshots` delegate to the DB service.
 *      `listActiveUnits` performs a tenant-scoped Drizzle join over
 *      `units` + `properties` + `leases` to produce one
 *      `UnitForSurveillance` per active leased unit, surfacing the
 *      *current lease's* rent/currency (canonical source of truth) and
 *      the property's lat/lon for radius-based comparable queries.
 *      Failures degrade to `[]` so `scanTenant` never crashes the
 *      background loop.
 *
 *   2. `MarketRatePort` — the conservative default is the
 *      `'stub-not-configured'` adapter (returns no comparables; agent
 *      still emits a `marketSampleSize: 0` snapshot for observability).
 *      A caller may pass `comparablesAdapter` to inject a real provider
 *      (Zillow / Airbnb / Rentometer / per-jurisdiction adapter resolved
 *      via `@borjie/compliance-plugins`). Whichever adapter is in
 *      play, this wiring transparently wraps it with a
 *      `market_data_cache`-backed read-through layer so repeated lookups
 *      for the same `(provider, query)` cache-hit within a TTL window
 *      and never hammer the upstream provider.
 *
 *   3. `ClassifyLLMPort`, `MarketSurveillanceEventPublisher`, `BudgetGuard`
 *      — left undefined. The agent treats each as optional and degrades
 *      gracefully (no LLM = `marketSampleSize: 0`; no publisher = no
 *      drift events; no guard = unbudgeted).
 *
 * Returns `null` when `db` is null so callers can branch cleanly in
 * degraded / no-db modes (mirrors classroom-wiring.ts and
 * intelligence-history-wiring.ts).
 *
 * Currency / jurisdiction policy: the unit's currency is read from the
 * active lease (`rent_currency`, ISO-4217 free-form TEXT). NEVER
 * hard-coded. The lat/lon defaults to `null` when the property has no
 * coordinates — the agent gracefully passes `null` through to the
 * `MarketRatePort.fetchComparables` call.
 *
 * Built for the world, starting with TZ.
 */

import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import {
  createDatabaseClient,
  createMarketDataCacheService,
  createMarketRateSnapshotsService,
  leases,
  properties,
  units,
} from '@borjie/database';

/**
 * `MarketDataCacheService` derived via `ReturnType<typeof factory>` to
 * sidestep the package-barrel namespace/type drift (TS2709) — same
 * pattern as `DatabaseClient` and `VoiceTurnsService` in sibling
 * wirings. See `service-registry.ts` for the explanation.
 */
type MarketDataCacheService = ReturnType<typeof createMarketDataCacheService>;
import {
  createMarketSurveillance,
  type ComparableListing,
  type MarketRatePort,
  type MarketRateSnapshot,
  type MarketSurveillance,
  type MarketSurveillanceRepository,
  type UnitForSurveillance,
} from '@borjie/ai-copilot/ai-native';
import {
  withAgentSpan,
  recordDegraded,
} from '../instrumentation/agent-spans.js';

/**
 * `DatabaseClient` is derived via `ReturnType<typeof createDatabaseClient>`
 * so we sidestep the package-barrel `TS2709 Cannot use namespace ... as
 * a type` drift (see service-registry.ts for the full explanation, mirrored
 * by classroom-wiring.ts).
 */
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

/**
 * Marker for the not-yet-configured market-rate adapter. Used by both the
 * stub port itself and the test suite, so we keep it exported as a const
 * rather than scattering a magic string.
 */
export const STUB_ADAPTER_ID = 'stub-not-configured' as const;

/**
 * Default cache TTL for comparable-listings lookups. 6 hours is short
 * enough that intra-day market changes still propagate but long enough
 * to keep upstream call counts under their per-day quotas. Callers may
 * override.
 */
export const DEFAULT_COMPARABLES_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface MarketSurveillanceLogger {
  warn(meta: object, msg: string): void;
}

export interface MarketSurveillanceWiringDeps {
  readonly db: DatabaseClient | null;
  readonly logger?: MarketSurveillanceLogger;
  /**
   * Optional real adapter for comparables. When omitted the wiring
   * defaults to the stub `'stub-not-configured'` adapter. Whichever
   * adapter is supplied, it is transparently wrapped with the
   * `market_data_cache` read-through cache.
   */
  readonly comparablesAdapter?: MarketRatePort;
  /**
   * Override the cache TTL for comparable-listings lookups. Defaults to
   * `DEFAULT_COMPARABLES_CACHE_TTL_MS`.
   */
  readonly comparablesCacheTtlMs?: number;
  /**
   * Disable the cache wrap entirely (e.g. for tests that need to hit
   * the underlying adapter on every call). Defaults to `false` —
   * caching is on by default.
   */
  readonly disableComparablesCache?: boolean;
}

export interface MarketSurveillanceWiring {
  readonly agent: MarketSurveillance;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * Build the Drizzle-backed `MarketSurveillanceRepository`. Exported for
 * testing and reuse.
 *
 * `listActiveUnits` joins `units` ⨝ `properties` ⨝ `leases` (active lease
 * for the unit) and emits one `UnitForSurveillance` per active leased
 * unit. The current lease is the canonical source of truth for rent and
 * currency; the unit's `baseRentAmount` is used as a fallback only when
 * the join doesn't surface an active lease (defensive — should not
 * happen for `unit.status = 'occupied'` but the loop must never crash).
 */
export function createDrizzleMarketSurveillanceRepository(
  db: DatabaseClient,
  logger?: MarketSurveillanceLogger,
): MarketSurveillanceRepository {
  const service = createMarketRateSnapshotsService(db);

  return {
    async listActiveUnits(tenantId: string): Promise<readonly UnitForSurveillance[]> {
      if (!tenantId) return [];
      try {
        const rows = await db
          .select({
            unitId: units.id,
            propertyId: units.propertyId,
            unitTenantId: units.tenantId,
            bedrooms: units.bedrooms,
            bathrooms: units.bathrooms,
            squareMeters: units.squareMeters,
            unitAmenities: units.amenities,
            baseRentAmount: units.baseRentAmount,
            baseRentCurrency: units.baseRentCurrency,
            propertyLat: properties.latitude,
            propertyLon: properties.longitude,
            propertyDefaultCurrency: properties.defaultCurrency,
            leaseRentAmount: leases.rentAmount,
            leaseRentCurrency: leases.rentCurrency,
          })
          .from(units)
          .innerJoin(properties, eq(properties.id, units.propertyId))
          .leftJoin(
            leases,
            and(
              eq(leases.unitId, units.id),
              eq(leases.tenantId, units.tenantId),
              eq(leases.status, 'active'),
            ),
          )
          .where(
            and(
              eq(units.tenantId, tenantId),
              eq(units.status, 'occupied'),
            ),
          );

        return rows.map((row) => toUnitForSurveillance(row as ActiveUnitRow));
      } catch (error) {
        // Never crash the background scan loop — return an empty list so
        // `scanTenant` produces no snapshots this cycle, and the warning
        // surfaces in the logger.
        logger?.warn(
          {
            wiring: 'market-surveillance',
            tenantId,
            err: error instanceof Error ? error.message : String(error),
          },
          'listActiveUnits query failed; returning [] for this scan cycle',
        );
        return [];
      }
    },

    async insertSnapshot(snapshot: MarketRateSnapshot): Promise<MarketRateSnapshot> {
      const stored = await service.insert(snapshot);
      // The DB service preserves every field the agent sets, so the
      // returned shape is structurally identical — but we re-project
      // through the agent's type to keep the boundary explicit and
      // fail-loud if the shapes ever drift.
      return {
        ...snapshot,
        ...stored,
      };
    },

    async listRecentSnapshots(
      tenantId: string,
      params: { unitId?: string; limit?: number },
    ): Promise<readonly MarketRateSnapshot[]> {
      const rows = await service.listRecent(tenantId, {
        unitId: params.unitId,
        limit: params.limit,
      });
      return rows.map((row) => ({ ...row }));
    },
  };
}

// ---------------------------------------------------------------------------
// Internal — row → UnitForSurveillance projection
// ---------------------------------------------------------------------------

interface ActiveUnitRow {
  readonly unitId: string;
  readonly propertyId: string | null;
  readonly unitTenantId: string;
  readonly bedrooms: number | null;
  readonly bathrooms: string | number | null;
  readonly squareMeters: string | number | null;
  readonly unitAmenities: unknown;
  readonly baseRentAmount: number | string | null;
  readonly baseRentCurrency: string | null;
  readonly propertyLat: string | number | null;
  readonly propertyLon: string | number | null;
  readonly propertyDefaultCurrency: string | null;
  readonly leaseRentAmount: number | string | null;
  readonly leaseRentCurrency: string | null;
}

function toUnitForSurveillance(row: ActiveUnitRow): UnitForSurveillance {
  // Active lease wins as canonical rent / currency source; falls back to
  // the unit's base rent (and property default currency) so a unit with
  // a stale `status='occupied'` but no active lease still produces an
  // observation row rather than crashing the loop.
  const rentMinor = numberOrNull(row.leaseRentAmount) ?? numberOrNull(row.baseRentAmount) ?? 0;
  const currency =
    nonEmptyString(row.leaseRentCurrency) ??
    nonEmptyString(row.baseRentCurrency) ??
    nonEmptyString(row.propertyDefaultCurrency) ??
    '';

  // Drizzle returns jsonb columns as `unknown`; we narrow defensively so a
  // mis-shaped row doesn't crash the projection.
  const amenities = readStringArray(row.unitAmenities);

  return {
    tenantId: row.unitTenantId,
    unitId: row.unitId,
    propertyId: row.propertyId ?? null,
    currencyCode: currency,
    ourRentMinor: rentMinor,
    latitude: numberOrNull(row.propertyLat),
    longitude: numberOrNull(row.propertyLon),
    bedrooms: row.bedrooms ?? null,
    bathrooms: numberOrNull(row.bathrooms),
    sqft: squareMetersToSqft(numberOrNull(row.squareMeters)),
    amenities,
  };
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function nonEmptyString(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/**
 * The schema stores unit size in `square_meters` (decimal). The
 * `UnitForSurveillance` shape exposes `sqft`. We translate at the
 * boundary so the agent + downstream comparables work in a single unit.
 * 1 m² ≈ 10.7639 ft².
 */
function squareMetersToSqft(sqm: number | null): number | null {
  if (sqm === null) return null;
  const sqft = sqm * 10.7639;
  return Number.isFinite(sqft) ? Math.round(sqft) : null;
}

// ---------------------------------------------------------------------------
// MarketRatePort — stub + cache wrap
// ---------------------------------------------------------------------------

/**
 * Build the stub `MarketRatePort`. Returns no comparables — the agent
 * still produces a snapshot row (with `marketSampleSize: 0` and
 * `driftFlag: null`) so observability holds. Exported for testing.
 */
export function createStubMarketRatePort(): MarketRatePort {
  return {
    adapterId: STUB_ADAPTER_ID,
    async fetchComparables() {
      return [];
    },
  };
}

export interface CachedMarketRatePortDeps {
  readonly inner: MarketRatePort;
  readonly cache: MarketDataCacheService;
  readonly ttlMs?: number;
  readonly logger?: MarketSurveillanceLogger;
}

/**
 * Wrap a `MarketRatePort` with a read-through `market_data_cache` layer.
 *
 * Cache key: `sha256(adapterId | normalised-query-json)`. We DO NOT
 * include `tenantId` in the key — comparables are per-(geo, beds,
 * radius), so two tenants whose units happen to query the same
 * neighbourhood share the cached result, which is exactly the desired
 * behaviour for an external-data cache.
 *
 * Cache misses + DB errors fall through to a live adapter call. We
 * never let a cache outage block the surveillance pipeline.
 */
export function createCachedMarketRatePort(
  deps: CachedMarketRatePortDeps,
): MarketRatePort {
  const ttlMs = deps.ttlMs ?? DEFAULT_COMPARABLES_CACHE_TTL_MS;
  const inner = deps.inner;

  return {
    adapterId: inner.adapterId,
    async fetchComparables(params): Promise<readonly ComparableListing[]> {
      // Stub adapter never benefits from caching — short-circuit so the
      // cache table doesn't fill with empty arrays keyed off the
      // 'stub-not-configured' adapter.
      if (inner.adapterId === STUB_ADAPTER_ID) {
        return inner.fetchComparables(params);
      }

      const queryJson = {
        unitId: params.unitId,
        latitude: params.latitude,
        longitude: params.longitude,
        radiusKm: params.radiusKm,
        bedrooms: params.bedrooms,
      };
      const cacheKey = computeCacheKey(inner.adapterId, queryJson);

      try {
        const hit = await deps.cache.get(cacheKey);
        if (hit && Array.isArray(hit.resultJson)) {
          return hit.resultJson as readonly ComparableListing[];
        }
      } catch (error) {
        deps.logger?.warn(
          {
            wiring: 'market-surveillance',
            adapter: inner.adapterId,
            err: error instanceof Error ? error.message : String(error),
          },
          'cache.get failed; falling through to live adapter',
        );
      }

      const fresh = await inner.fetchComparables(params);

      try {
        await deps.cache.put(
          cacheKey,
          inner.adapterId,
          queryJson,
          fresh,
          ttlMs,
        );
      } catch (error) {
        deps.logger?.warn(
          {
            wiring: 'market-surveillance',
            adapter: inner.adapterId,
            err: error instanceof Error ? error.message : String(error),
          },
          'cache.put failed; result still returned to caller',
        );
      }

      return fresh;
    },
  };
}

function computeCacheKey(adapterId: string, query: Readonly<Record<string, unknown>>): string {
  // `JSON.stringify` is deterministic for primitive-valued objects with
  // a stable key set, which matches the query shape we feed it.
  const payload = `${adapterId}|${JSON.stringify(query)}`;
  return createHash('sha256').update(payload).digest('hex');
}

// ---------------------------------------------------------------------------
// Composition root entry
// ---------------------------------------------------------------------------

/**
 * Compose the AI-native market-surveillance agent. Returns `null` when
 * no DB is configured — callers branch on this to skip registration in
 * degraded mode.
 */
export function createMarketSurveillanceWiring(
  deps: MarketSurveillanceWiringDeps,
): MarketSurveillanceWiring | null {
  if (!deps.db) {
    deps.logger?.warn(
      { wiring: 'market-surveillance' },
      'market-surveillance wiring skipped — no database client',
    );
    return null;
  }

  const repo = createDrizzleMarketSurveillanceRepository(deps.db, deps.logger);

  // Choose the underlying adapter. Default = stub.
  const baseAdapter = deps.comparablesAdapter ?? createStubMarketRatePort();

  // Wrap with the read-through cache unless explicitly disabled.
  const port = deps.disableComparablesCache
    ? baseAdapter
    : createCachedMarketRatePort({
        inner: baseAdapter,
        cache: createMarketDataCacheService(deps.db),
        ttlMs: deps.comparablesCacheTtlMs,
        logger: deps.logger,
      });

  // `llm`, `publisher`, `budgetGuard` are intentionally undefined — each
  // is optional on `MarketSurveillanceDeps` and the agent degrades
  // gracefully (see `extractRent` and the publisher branch in
  // packages/ai-copilot/src/ai-native/market-surveillance/index.ts).
  const agent = createMarketSurveillance({
    repo,
    port,
  });

  // Surface the not-yet-configured comparables stub on the
  // `agent_port_degraded_total` counter at wiring-construction time.
  // Recording happens once per wiring (NOT per scan) so the counter
  // reflects the configured posture rather than blowing up under load.
  if (port.adapterId === STUB_ADAPTER_ID) {
    recordDegraded(
      'market-surveillance',
      'MarketRatePort',
      'STUB_NOT_CONFIGURED',
    );
  }

  return { agent: instrumentMarketSurveillance(agent) };
}

/**
 * Wrap the surveillance agent's three public methods (`scanTenant`,
 * `scanUnit`, `listRecentSnapshots`) in `withAgentSpan(...)` so each
 * call emits a per-agent span + counter + latency histogram. Returns
 * a fresh object — does not mutate the underlying agent.
 */
function instrumentMarketSurveillance(
  agent: MarketSurveillance,
): MarketSurveillance {
  return {
    scanTenant(tenantId) {
      return withAgentSpan(
        'market-surveillance',
        'scanTenant',
        () => agent.scanTenant(tenantId),
        { tenantId },
      );
    },
    scanUnit(unit) {
      return withAgentSpan(
        'market-surveillance',
        'scanUnit',
        () => agent.scanUnit(unit),
        {
          tenantId: unit?.tenantId ?? null,
          attributes: {
            ...(unit?.unitId && { unitId: unit.unitId }),
          },
        },
      );
    },
    listRecentSnapshots(tenantId, params) {
      return withAgentSpan(
        'market-surveillance',
        'listRecentSnapshots',
        () => agent.listRecentSnapshots(tenantId, params),
        { tenantId },
      );
    },
  };
}
