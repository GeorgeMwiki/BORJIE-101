/**
 * Research Service — external-data enrichment triggered by accumulator state.
 *
 * Tenant-scoped. Looks up local market rent benchmarks (gazetteer),
 * district vacancy rates, utility-cost comparables, etc.
 *
 * All remote calls go through a pluggable ResearchClient abstraction so
 * tests can stub them. Results cached per (tenantId, sessionId) to avoid
 * runaway queries.
 *
 * @module progressive-intelligence/research-service
 */

export interface MarketRentBenchmark {
  readonly district: string;
  readonly unitType: string;
  readonly medianRentCents: number;
  readonly sampleSize: number;
  readonly fetchedAt: string;
}

export interface DistrictVacancy {
  readonly district: string;
  readonly vacancyPct: number;
  readonly daysOnMarketMedian: number;
  readonly fetchedAt: string;
}

export interface ResearchClient {
  fetchMarketRent(
    tenantId: string,
    district: string,
    unitType: string,
  ): Promise<MarketRentBenchmark | null>;
  fetchDistrictVacancy(
    tenantId: string,
    district: string,
  ): Promise<DistrictVacancy | null>;
}

export interface ResearchRecord {
  readonly key: string;
  readonly value: unknown;
  readonly fetchedAt: string;
  readonly ttlMs: number;
}

export class InMemoryResearchClient implements ResearchClient {
  constructor(private readonly seeds: {
    rent?: Record<string, MarketRentBenchmark>;
    vacancy?: Record<string, DistrictVacancy>;
  } = {}) {}

  async fetchMarketRent(
    _tenantId: string,
    district: string,
    unitType: string,
  ): Promise<MarketRentBenchmark | null> {
    return this.seeds.rent?.[`${district}::${unitType}`] ?? null;
  }

  async fetchDistrictVacancy(
    _tenantId: string,
    district: string,
  ): Promise<DistrictVacancy | null> {
    return this.seeds.vacancy?.[district] ?? null;
  }
}

export class ResearchService {
  private readonly cache = new Map<string, ResearchRecord>();

  constructor(
    private readonly client: ResearchClient,
    private readonly ttlMs: number = 60 * 60 * 1000,
  ) {}

  private keyFor(tenantId: string, sessionId: string, kind: string): string {
    return `${tenantId}::${sessionId}::${kind}`;
  }

  private cachedOr<T>(
    tenantId: string,
    sessionId: string,
    kind: string,
    loader: () => Promise<T | null>,
  ): Promise<T | null> {
    const key = this.keyFor(tenantId, sessionId, kind);
    const hit = this.cache.get(key);
    if (hit && Date.now() - new Date(hit.fetchedAt).getTime() < hit.ttlMs) {
      return Promise.resolve(hit.value as T);
    }
    return loader().then((value) => {
      if (value !== null && value !== undefined) {
        this.cache.set(key, {
          key,
          value,
          fetchedAt: new Date().toISOString(),
          ttlMs: this.ttlMs,
        });
      }
      return value;
    });
  }

  async lookupMarketRent(
    tenantId: string,
    sessionId: string,
    district: string,
    unitType: string,
  ): Promise<MarketRentBenchmark | null> {
    if (!tenantId) throw new Error('research-service: tenantId required');
    return this.cachedOr(
      tenantId,
      sessionId,
      `market-rent::${district}::${unitType}`,
      () => this.client.fetchMarketRent(tenantId, district, unitType),
    );
  }

  async lookupDistrictVacancy(
    tenantId: string,
    sessionId: string,
    district: string,
  ): Promise<DistrictVacancy | null> {
    if (!tenantId) throw new Error('research-service: tenantId required');
    return this.cachedOr(
      tenantId,
      sessionId,
      `district-vacancy::${district}`,
      () => this.client.fetchDistrictVacancy(tenantId, district),
    );
  }

  invalidate(tenantId: string, sessionId: string): void {
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(`${tenantId}::${sessionId}::`)) {
        this.cache.delete(key);
      }
    }
  }
}

export function createResearchService(
  client: ResearchClient,
  ttlMs?: number,
): ResearchService {
  return new ResearchService(client, ttlMs);
}
