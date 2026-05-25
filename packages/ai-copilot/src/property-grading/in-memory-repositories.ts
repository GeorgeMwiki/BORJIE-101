/**
 * In-memory implementations of the repository contracts defined in
 * property-grading-service. Used by tests and by the api-gateway's
 * degraded-mode fallback when DATABASE_URL is unset.
 *
 * Production wires the Postgres variants from
 * `services/domain-services/src/property-grading/` — the repositories
 * in this file only ever see transient state held in RAM.
 */

import {
  DEFAULT_GRADING_WEIGHTS,
  GradingWeights,
  PropertyGradeInputs,
} from './property-grading-types.js';
import {
  GradeSnapshotRecord,
  PortfolioWeightHints,
  PropertyMetricsSource,
  SnapshotRepository,
  WeightsRepository,
} from './property-grading-service.js';

export class InMemoryMetricsSource implements PropertyMetricsSource {
  private readonly store: Map<string, Map<string, PropertyGradeInputs>> = new Map();

  private readonly weightHints: Map<string, PortfolioWeightHints> = new Map();

  seed(tenantId: string, inputs: PropertyGradeInputs): void {
    const tenantMap = this.store.get(tenantId) ?? new Map<string, PropertyGradeInputs>();
    tenantMap.set(inputs.propertyId, { ...inputs });
    this.store.set(tenantId, tenantMap);
  }

  seedHints(tenantId: string, hints: PortfolioWeightHints): void {
    this.weightHints.set(tenantId, {
      unitCountByPropertyId: { ...hints.unitCountByPropertyId },
      assetValueByPropertyId: { ...hints.assetValueByPropertyId },
    });
  }

  async fetchInputs(
    tenantId: string,
    propertyId: string,
  ): Promise<PropertyGradeInputs | null> {
    return this.store.get(tenantId)?.get(propertyId) ?? null;
  }

  async listPropertyIds(tenantId: string): Promise<readonly string[]> {
    const map = this.store.get(tenantId);
    return map ? Array.from(map.keys()) : [];
  }

  async fetchPortfolioWeightHints(tenantId: string): Promise<PortfolioWeightHints> {
    return (
      this.weightHints.get(tenantId) ?? {
        unitCountByPropertyId: {},
        assetValueByPropertyId: {},
      }
    );
  }
}

export class InMemoryWeightsRepository implements WeightsRepository {
  private readonly weights: Map<string, GradingWeights> = new Map();

  async getWeights(tenantId: string): Promise<GradingWeights> {
    return this.weights.get(tenantId) ?? DEFAULT_GRADING_WEIGHTS;
  }

  async setWeights(tenantId: string, weights: GradingWeights): Promise<GradingWeights> {
    const stored: GradingWeights = {
      income: weights.income,
      expense: weights.expense,
      maintenance: weights.maintenance,
      occupancy: weights.occupancy,
      compliance: weights.compliance,
      tenant: weights.tenant,
    };
    this.weights.set(tenantId, stored);
    return stored;
  }
}

export class InMemorySnapshotRepository implements SnapshotRepository {
  private readonly store: Map<string, GradeSnapshotRecord[]> = new Map();

  async persist(record: GradeSnapshotRecord): Promise<GradeSnapshotRecord> {
    const key = `${record.tenantId}:${record.propertyId}`;
    const list = this.store.get(key) ?? [];
    const next = [...list, record].sort((a, b) =>
      a.computedAt.localeCompare(b.computedAt),
    );
    this.store.set(key, next);
    return record;
  }

  async findLatest(
    tenantId: string,
    propertyId: string,
  ): Promise<GradeSnapshotRecord | null> {
    const rows = this.store.get(`${tenantId}:${propertyId}`);
    return rows && rows.length > 0 ? rows[rows.length - 1] : null;
  }

  async findHistory(
    tenantId: string,
    propertyId: string,
    months: number,
  ): Promise<readonly GradeSnapshotRecord[]> {
    const rows = this.store.get(`${tenantId}:${propertyId}`) ?? [];
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    return rows.filter((r) => new Date(r.computedAt).getTime() >= cutoff.getTime());
  }

  async findLatestByProperty(
    tenantId: string,
  ): Promise<ReadonlyMap<string, GradeSnapshotRecord>> {
    const out = new Map<string, GradeSnapshotRecord>();
    for (const [key, rows] of this.store.entries()) {
      if (!key.startsWith(`${tenantId}:`) || rows.length === 0) continue;
      out.set(rows[rows.length - 1].propertyId, rows[rows.length - 1]);
    }
    return out;
  }
}
