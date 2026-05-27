/**
 * Commodity tracker — fetches the latest price snapshot for one of
 * gold / copper / tanzanite via an injected `PriceProviderPort`.
 *
 * Tanzania-specific behaviour:
 *   - gold: LBMA AM/PM fix; USD price + TZS conversion via FxProvider.
 *   - copper: LME 3-month + Mwadui/Mbeya regional spread already baked
 *     into the upstream provider (we just propagate the region).
 *   - tanzanite: Block C/D production reports out of Karatu/Mererani.
 *
 * Always emits `OSHA-TZ` + `TMAA` regulatory tags so downstream
 * consumers can audit which compliance overlays apply.
 */

import {
  commodityPriceSchema,
  commoditySchema,
  UnknownCommodityError,
  TenantPermissionError,
  type Commodity,
  type CommodityPrice,
  type RegulatoryContextTag,
  type TanzaniaRegion,
} from './types.js';
import {
  type FxProviderPort,
  type Logger,
  type PriceProviderPort,
  type TelemetryPort,
  type TenantPermissionPort,
  NOOP_LOGGER,
  NOOP_TELEMETRY,
} from './ports.js';

export interface CommodityTrackerDeps {
  readonly priceProvider: PriceProviderPort;
  readonly fxProvider: FxProviderPort;
  readonly tenantPermission: TenantPermissionPort;
  readonly logger?: Logger;
  readonly telemetry?: TelemetryPort;
}

export interface CommodityTracker {
  track(commodity: Commodity, tenantId: string): Promise<CommodityPrice>;
}

const DEFAULT_TAGS: Array<RegulatoryContextTag> = ['OSHA-TZ', 'TMAA'];

const DEFAULT_REGION_BY_COMMODITY: Readonly<Record<Commodity, TanzaniaRegion>> = {
  gold: 'geita',
  copper: 'mbeya',
  tanzanite: 'mererani',
};

export function createCommodityTracker(
  deps: CommodityTrackerDeps,
): CommodityTracker {
  const logger = deps.logger ?? NOOP_LOGGER;
  const telemetry = deps.telemetry ?? NOOP_TELEMETRY;
  return {
    async track(commodity, tenantId) {
      assertKnownCommodity(commodity);
      await assertTenantAllowed(tenantId, deps.tenantPermission);
      logger.info('market-intel.track.start', { commodity, tenantId });
      const raw = await deps.priceProvider.fetchLatest(commodity, tenantId);
      const merged = await enrich(raw, commodity, tenantId, deps.fxProvider);
      const validated = commodityPriceSchema.parse(merged);
      telemetry.count('market_intel.track', {
        commodity,
        currency: validated.currency,
      });
      logger.info('market-intel.track.done', {
        commodity,
        price: validated.price,
      });
      return validated;
    },
  };
}

function assertKnownCommodity(commodity: string): asserts commodity is Commodity {
  const parsed = commoditySchema.safeParse(commodity);
  if (!parsed.success) throw new UnknownCommodityError(String(commodity));
}

async function assertTenantAllowed(
  tenantId: string,
  port: TenantPermissionPort,
): Promise<void> {
  if (tenantId.length === 0) throw new TenantPermissionError(tenantId);
  const ok = await port.canAccess(tenantId);
  if (!ok) throw new TenantPermissionError(tenantId);
}

async function enrich(
  raw: CommodityPrice,
  commodity: Commodity,
  tenantId: string,
  fx: FxProviderPort,
): Promise<CommodityPrice> {
  const region = raw.region ?? DEFAULT_REGION_BY_COMMODITY[commodity];
  const tags = mergeTags(raw.regulatoryTags, DEFAULT_TAGS);
  const tzs =
    raw.currency === 'USD' && raw.tzsEquivalent === undefined
      ? raw.price * (await fx.usdToTzs(raw.asOfISO))
      : raw.tzsEquivalent;
  return {
    ...raw,
    tenantId,
    region,
    regulatoryTags: tags,
    ...(tzs !== undefined ? { tzsEquivalent: tzs } : {}),
  };
}

function mergeTags(
  a: ReadonlyArray<RegulatoryContextTag>,
  b: ReadonlyArray<RegulatoryContextTag>,
): Array<RegulatoryContextTag> {
  const seen = new Set<RegulatoryContextTag>();
  for (const t of a) seen.add(t);
  for (const t of b) seen.add(t);
  return Array.from(seen);
}

// ─── In-memory default provider (test + dev convenience) ─────────

export interface FixturePriceMap {
  readonly gold?: Omit<CommodityPrice, 'tenantId'>;
  readonly copper?: Omit<CommodityPrice, 'tenantId'>;
  readonly tanzanite?: Omit<CommodityPrice, 'tenantId'>;
}

/**
 * In-memory `PriceProviderPort` for deterministic tests and dev
 * scaffolding. Production callers should wire real adapters.
 */
export function createInMemoryPriceProvider(
  fixtures: FixturePriceMap,
): PriceProviderPort {
  return {
    async fetchLatest(commodity, tenantId) {
      const fx = fixtures[commodity];
      if (!fx) {
        throw new UnknownCommodityError(commodity);
      }
      return { ...fx, tenantId };
    },
  };
}
