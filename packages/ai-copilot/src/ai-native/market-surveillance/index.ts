/**
 * Market-rate surveillance.
 *
 * For every active unit, daily: query comparable listings (via abstract
 * `MarketRatePort` — no hardcoded site), feed through LLM to extract
 * rent/sqft/amenities, compute a 30-day rolling percentile band. Write to
 * `market_rate_snapshots`. When our rent deviates beyond thresholds, emit
 * `MarketRateDriftDetected` for the advisor persona.
 *
 * WHY AI-NATIVE: continuous market-intelligence across an entire portfolio;
 * a human operator cannot track thousands of units vs thousands of
 * comparable listings every day.
 *
 * External scrapers / APIs are stubbed behind env vars; first-class
 * deliverable is the orchestration + pipeline + schema.
 */

import {
  type BudgetGuard,
  type ClassifyLLMPort,
  noopBudgetGuard,
  DEGRADED_MODEL_VERSION,
  promptHash,
  safeJsonParse,
  newId,
} from '../shared.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnitForSurveillance {
  readonly tenantId: string;
  readonly unitId: string;
  readonly propertyId: string | null;
  readonly currencyCode: string; // ISO-4217
  readonly ourRentMinor: bigint | number; // stored in minor units
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly bedrooms: number | null;
  readonly bathrooms: number | null;
  readonly sqft: number | null;
  readonly amenities: readonly string[];
}

export interface ComparableListing {
  readonly adapterId: string;
  readonly url: string | null;
  readonly title: string;
  readonly rawDescription: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

/**
 * Port — abstract data provider of comparable listings. Concrete adapters
 * (Zillow, Airbnb, local classified sites, estate-agent APIs) implement
 * this. Every adapter is gated by its own env var.
 *
 * Follow-up adapter (Docs/TODO_BACKLOG.md): wire a concrete adapter per jurisdiction via
 * `resolvePlugin(tenantCountry)` from `@borjie/compliance-plugins`.
 */
export interface MarketRatePort {
  readonly adapterId: string;
  fetchComparables(params: {
    readonly tenantId: string;
    readonly unitId: string;
    readonly latitude: number | null;
    readonly longitude: number | null;
    readonly radiusKm: number;
    readonly bedrooms: number | null;
  }): Promise<readonly ComparableListing[]>;
}

export interface MarketRateSnapshot {
  readonly id: string;
  readonly tenantId: string;
  readonly unitId: string;
  readonly propertyId: string | null;
  readonly currencyCode: string;
  readonly ourRentMinor: number;
  readonly marketMedianMinor: number | null;
  readonly marketP25Minor: number | null;
  readonly marketP75Minor: number | null;
  readonly marketSampleSize: number;
  readonly deltaPct: number | null;
  readonly driftFlag: 'below_market' | 'above_market' | 'on_band' | null;
  readonly compRadiusKm: number;
  readonly sourceAdapter: string;
  readonly sourceMetadata: Readonly<Record<string, unknown>>;
  readonly modelVersion: string;
  readonly promptHash: string | null;
  readonly observedAt: string;
}

export interface MarketDriftEvent {
  readonly type: 'MarketRateDriftDetected';
  readonly tenantId: string;
  readonly unitId: string;
  readonly driftFlag: 'below_market' | 'above_market';
  readonly deltaPct: number;
  readonly observedAt: string;
}

export interface MarketSurveillanceRepository {
  listActiveUnits(tenantId: string): Promise<readonly UnitForSurveillance[]>;
  insertSnapshot(snapshot: MarketRateSnapshot): Promise<MarketRateSnapshot>;
  listRecentSnapshots(
    tenantId: string,
    params: { unitId?: string; limit?: number },
  ): Promise<readonly MarketRateSnapshot[]>;
}

export interface MarketSurveillanceEventPublisher {
  publishDrift(event: MarketDriftEvent): Promise<void>;
}

export interface MarketSurveillanceDeps {
  readonly repo: MarketSurveillanceRepository;
  readonly port: MarketRatePort;
  readonly llm?: ClassifyLLMPort;
  readonly publisher?: MarketSurveillanceEventPublisher;
  readonly budgetGuard?: BudgetGuard;
  readonly belowMarketPct?: number; // default 0.10 (10%)
  readonly aboveMarketPct?: number; // default 0.20 (20%)
  readonly radiusKm?: number; // default 2 km
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const EXTRACTION_SYSTEM_PROMPT = `You are a real-estate listing extractor. Read a raw listing description in any
language and return ONLY JSON matching:
{
  "monthlyRentMinor": number (in minor units of the currency, e.g. cents) or null,
  "currencyCode": string (ISO-4217) or null,
  "bedrooms": number or null,
  "bathrooms": number or null,
  "sqft": number or null,
  "amenities": string[] (lowercase, e.g. "parking","wifi","pool")
}
Return null for fields you cannot extract with high confidence.`;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function percentile(
  sorted: readonly number[],
  p: number,
): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return sorted[rank] ?? null;
}

export function driftFlagFor(
  ourRent: number,
  median: number | null,
  belowPct: number,
  abovePct: number,
): 'below_market' | 'above_market' | 'on_band' | null {
  if (!median || median <= 0) return null;
  const deltaPct = (ourRent - median) / median;
  if (deltaPct <= -belowPct) return 'below_market';
  if (deltaPct >= abovePct) return 'above_market';
  return 'on_band';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface MarketSurveillance {
  scanTenant(tenantId: string): Promise<readonly MarketRateSnapshot[]>;
  scanUnit(
    unit: UnitForSurveillance,
  ): Promise<MarketRateSnapshot>;
  listRecentSnapshots(
    tenantId: string,
    params?: { unitId?: string; limit?: number },
  ): Promise<readonly MarketRateSnapshot[]>;
}

export function createMarketSurveillance(
  deps: MarketSurveillanceDeps,
): MarketSurveillance {
  const now = deps.now ?? (() => new Date());
  const guard = deps.budgetGuard ?? noopBudgetGuard;
  const belowPct = deps.belowMarketPct ?? 0.1;
  const abovePct = deps.aboveMarketPct ?? 0.2;
  const radiusKm = deps.radiusKm ?? 2;

  async function extractRent(
    listing: ComparableListing,
    tenantId: string,
  ): Promise<{ monthlyRentMinor: number | null; promptHash: string; modelVersion: string }> {
    const system = EXTRACTION_SYSTEM_PROMPT;
    const user = `Listing:\n"""\n${listing.rawDescription}\n"""`;
    const hash = promptHash(system + '\n---\n' + user);
    if (!deps.llm) {
      return {
        monthlyRentMinor: null,
        promptHash: hash,
        modelVersion: DEGRADED_MODEL_VERSION,
      };
    }
    await guard(tenantId, 'market-surveillance:extract');
    try {
      const res = await deps.llm.classify({ systemPrompt: system, userPrompt: user });
      const parsed = safeJsonParse<{ monthlyRentMinor?: number | null }>(res.raw);
      const rent =
        parsed && typeof parsed.monthlyRentMinor === 'number' && Number.isFinite(parsed.monthlyRentMinor)
          ? Math.max(0, Math.round(parsed.monthlyRentMinor))
          : null;
      return { monthlyRentMinor: rent, promptHash: hash, modelVersion: res.modelVersion };
    } catch {
      return { monthlyRentMinor: null, promptHash: hash, modelVersion: DEGRADED_MODEL_VERSION };
    }
  }

  return {
    async scanUnit(unit) {
      const comparables = await deps.port.fetchComparables({
        tenantId: unit.tenantId,
        unitId: unit.unitId,
        latitude: unit.latitude,
        longitude: unit.longitude,
        radiusKm,
        bedrooms: unit.bedrooms,
      });

      const rents: number[] = [];
      let lastPromptHash: string | null = null;
      let lastModelVersion: string = DEGRADED_MODEL_VERSION;
      for (const c of comparables) {
        const { monthlyRentMinor, promptHash: ph, modelVersion } = await extractRent(
          c,
          unit.tenantId,
        );
        lastPromptHash = ph;
        lastModelVersion = modelVersion;
        if (typeof monthlyRentMinor === 'number') rents.push(monthlyRentMinor);
      }

      rents.sort((a, b) => a - b);
      const median = percentile(rents, 0.5);
      const p25 = percentile(rents, 0.25);
      const p75 = percentile(rents, 0.75);
      const ourRent = Number(unit.ourRentMinor);
      const flag = driftFlagFor(ourRent, median, belowPct, abovePct);
      const deltaPct = median && median > 0 ? (ourRent - median) / median : null;

      const snapshot: MarketRateSnapshot = {
        id: newId('mrss'),
        tenantId: unit.tenantId,
        unitId: unit.unitId,
        propertyId: unit.propertyId,
        currencyCode: unit.currencyCode,
        ourRentMinor: ourRent,
        marketMedianMinor: median,
        marketP25Minor: p25,
        marketP75Minor: p75,
        marketSampleSize: rents.length,
        deltaPct,
        driftFlag: flag,
        compRadiusKm: radiusKm,
        sourceAdapter: deps.port.adapterId,
        sourceMetadata: { comparableCount: comparables.length },
        modelVersion: lastModelVersion,
        promptHash: lastPromptHash,
        observedAt: now().toISOString(),
      };

      const stored = await deps.repo.insertSnapshot(snapshot);

      if (deps.publisher && (flag === 'below_market' || flag === 'above_market') && typeof deltaPct === 'number') {
        await deps.publisher.publishDrift({
          type: 'MarketRateDriftDetected',
          tenantId: unit.tenantId,
          unitId: unit.unitId,
          driftFlag: flag,
          deltaPct,
          observedAt: snapshot.observedAt,
        });
      }

      return stored;
    },

    async scanTenant(tenantId) {
      const units = await deps.repo.listActiveUnits(tenantId);
      const out: MarketRateSnapshot[] = [];
      for (const unit of units) {
        out.push(await this.scanUnit(unit));
      }
      return out;
    },

    async listRecentSnapshots(tenantId, params) {
      return deps.repo.listRecentSnapshots(tenantId, params ?? {});
    },
  };
}
