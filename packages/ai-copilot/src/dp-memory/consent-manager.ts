/**
 * consent-manager.ts — tenant opt-in / opt-out for cross-tenant
 * pattern sharing.
 *
 * Two switches live here:
 *   - `benchmarkContribution`     — default ON. Tenants contribute to
 *                                   the cross-tenant aggregate pool that
 *                                   backs the published industry
 *                                   benchmarks. DP guarantees mean no
 *                                   per-row information leaks.
 *   - `detailedPatternSharing`    — default OFF. Opt-in for finer-grained
 *                                   pattern sharing (future extensions,
 *                                   e.g. clause-level lease benchmarks).
 *
 * The aggregator and DP-query layer MUST consult this manager before
 * accepting a tenant contribution. See the `pattern-aggregator.ts`
 * contribution path.
 */

import type { ConsentRecord, ConsentRepository } from './types.js';

export interface ConsentManagerConfig {
  readonly repository?: ConsentRepository;
  readonly now?: () => Date;
}

/** Default consent when no explicit record exists. */
export const DEFAULT_CONSENT: Pick<
  ConsentRecord,
  'benchmarkContribution' | 'detailedPatternSharing'
> = {
  benchmarkContribution: true,
  detailedPatternSharing: false,
};

/** Simple in-memory consent repository for degraded mode + tests. */
export class InMemoryConsentRepository implements ConsentRepository {
  private readonly store = new Map<string, ConsentRecord>();

  async read(tenantId: string): Promise<ConsentRecord | null> {
    const found = this.store.get(tenantId);
    return found ? { ...found } : null;
  }

  async write(record: ConsentRecord): Promise<void> {
    this.store.set(record.tenantId, { ...record });
  }

  async readAll(): Promise<readonly ConsentRecord[]> {
    return Array.from(this.store.values()).map((r) => ({ ...r }));
  }
}

export class ConsentManager {
  private readonly repository: ConsentRepository;
  private readonly now: () => Date;

  constructor(config: ConsentManagerConfig = {}) {
    this.repository = config.repository ?? new InMemoryConsentRepository();
    this.now = config.now ?? (() => new Date());
  }

  async get(tenantId: string): Promise<ConsentRecord> {
    if (!tenantId) throw new Error('tenantId is required');
    const stored = await this.repository.read(tenantId);
    if (stored) return stored;
    return {
      tenantId,
      benchmarkContribution: DEFAULT_CONSENT.benchmarkContribution,
      detailedPatternSharing: DEFAULT_CONSENT.detailedPatternSharing,
      updatedAt: this.now().toISOString(),
    };
  }

  async set(
    tenantId: string,
    updates: Partial<Pick<ConsentRecord, 'benchmarkContribution' | 'detailedPatternSharing'>>,
  ): Promise<ConsentRecord> {
    if (!tenantId) throw new Error('tenantId is required');
    const current = await this.get(tenantId);
    const next: ConsentRecord = {
      tenantId,
      benchmarkContribution: updates.benchmarkContribution ?? current.benchmarkContribution,
      detailedPatternSharing: updates.detailedPatternSharing ?? current.detailedPatternSharing,
      updatedAt: this.now().toISOString(),
    };
    await this.repository.write(next);
    return next;
  }

  async optOut(tenantId: string): Promise<ConsentRecord> {
    return this.set(tenantId, {
      benchmarkContribution: false,
      detailedPatternSharing: false,
    });
  }

  async optIn(tenantId: string, detailed = false): Promise<ConsentRecord> {
    return this.set(tenantId, {
      benchmarkContribution: true,
      detailedPatternSharing: detailed,
    });
  }

  /** Returns true when the tenant is in the benchmark contribution pool. */
  async mayContributeBenchmark(tenantId: string): Promise<boolean> {
    const record = await this.get(tenantId);
    return record.benchmarkContribution;
  }

  async mayShareDetailedPatterns(tenantId: string): Promise<boolean> {
    const record = await this.get(tenantId);
    return record.detailedPatternSharing;
  }

  async listContributingTenants(): Promise<readonly string[]> {
    const all = await this.repository.readAll();
    return all.filter((r) => r.benchmarkContribution).map((r) => r.tenantId);
  }
}
