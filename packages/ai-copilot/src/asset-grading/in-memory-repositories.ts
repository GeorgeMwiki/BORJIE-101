/**
 * In-memory implementations of the repository contracts defined in
 * asset-grading-service. Used by tests and by the api-gateway's
 * degraded-mode fallback when DATABASE_URL is unset.
 *
 * Production wires the Postgres variants from
 * `services/domain-services/src/asset-grading/` — the repositories
 * in this file only ever see transient state held in RAM.
 */

import {
  DEFAULT_GRADING_WEIGHTS,
  GradingWeights,
  AssetGradeInputs,
} from './asset-grading-types.js';
import {
  GradeSnapshotRecord,
  PortfolioWeightHints,
  AssetMetricsSource,
  SnapshotRepository,
  WeightsRepository,
} from './asset-grading-service.js';

export class InMemoryMetricsSource implements AssetMetricsSource {
  private readonly store: Map<string, Map<string, AssetGradeInputs>> = new Map();

  private readonly weightHints: Map<string, PortfolioWeightHints> = new Map();

  seed(tenantId: string, inputs: AssetGradeInputs): void {
    const tenantMap = this.store.get(tenantId) ?? new Map<string, AssetGradeInputs>();
    tenantMap.set(inputs.assetId, { ...inputs });
    this.store.set(tenantId, tenantMap);
  }

  seedHints(tenantId: string, hints: PortfolioWeightHints): void {
    this.weightHints.set(tenantId, {
      siteCountByAssetId: { ...hints.siteCountByAssetId },
      assetValueByAssetId: { ...hints.assetValueByAssetId },
    });
  }

  async fetchInputs(
    tenantId: string,
    assetId: string,
  ): Promise<AssetGradeInputs | null> {
    return this.store.get(tenantId)?.get(assetId) ?? null;
  }

  async listAssetIds(tenantId: string): Promise<readonly string[]> {
    const map = this.store.get(tenantId);
    return map ? Array.from(map.keys()) : [];
  }

  async fetchPortfolioWeightHints(tenantId: string): Promise<PortfolioWeightHints> {
    return (
      this.weightHints.get(tenantId) ?? {
        siteCountByAssetId: {},
        assetValueByAssetId: {},
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
      royalty_yield: weights.royalty_yield,
      opex_efficiency: weights.opex_efficiency,
      maintenance: weights.maintenance,
      recovery: weights.recovery,
      royalty_compliance: weights.royalty_compliance,
      buyer_quality: weights.buyer_quality,
    };
    this.weights.set(tenantId, stored);
    return stored;
  }
}

export class InMemorySnapshotRepository implements SnapshotRepository {
  private readonly store: Map<string, GradeSnapshotRecord[]> = new Map();

  async persist(record: GradeSnapshotRecord): Promise<GradeSnapshotRecord> {
    const key = `${record.tenantId}:${record.assetId}`;
    const list = this.store.get(key) ?? [];
    const next = [...list, record].sort((a, b) =>
      a.computedAt.localeCompare(b.computedAt),
    );
    this.store.set(key, next);
    return record;
  }

  async findLatest(
    tenantId: string,
    assetId: string,
  ): Promise<GradeSnapshotRecord | null> {
    const rows = this.store.get(`${tenantId}:${assetId}`);
    return rows && rows.length > 0 ? (rows[rows.length - 1] ?? null) : null;
  }

  async findHistory(
    tenantId: string,
    assetId: string,
    months: number,
  ): Promise<readonly GradeSnapshotRecord[]> {
    const rows = this.store.get(`${tenantId}:${assetId}`) ?? [];
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    return rows.filter((r) => new Date(r.computedAt).getTime() >= cutoff.getTime());
  }

  async findLatestByAsset(
    tenantId: string,
  ): Promise<ReadonlyMap<string, GradeSnapshotRecord>> {
    const out = new Map<string, GradeSnapshotRecord>();
    for (const [key, rows] of this.store.entries()) {
      if (!key.startsWith(`${tenantId}:`) || rows.length === 0) continue;
      const last = rows[rows.length - 1];
      if (last === undefined) continue;
      out.set(last.assetId, last);
    }
    return out;
  }
}
