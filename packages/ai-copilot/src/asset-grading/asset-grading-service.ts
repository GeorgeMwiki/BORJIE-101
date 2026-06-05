/**
 * Asset-grading service.
 *
 * Composes three collaborators passed via the constructor:
 *
 *   - `metricsSource`   — pulls live metrics for an asset from the
 *                         real tables (utilisation, outstanding royalties,
 *                         maintenance, compliance, payments). Production uses a
 *                         Postgres-backed implementation; tests plug in
 *                         an in-memory one.
 *   - `weightsRepo`     — reads / writes per-tenant GradingWeights.
 *   - `snapshotRepo`    — persists + reads computed grade snapshots so
 *                         trajectories across time can be rendered.
 *
 * No mock data anywhere in production paths — if a collaborator can't
 * supply real numbers, the service returns INSUFFICIENT_DATA with a
 * clear reason.
 */

import {
  DEFAULT_GRADING_WEIGHTS,
  GRADE_DIMENSIONS,
  GradeHistoryEntry,
  GradingWeights,
  InsufficientDataReport,
  PortfolioGrade,
  AssetGrade,
  AssetGradeInputs,
  AssetGradeReport,
} from './asset-grading-types.js';
import { scoreAsset, validateWeights } from './scoring-model.js';
import {
  aggregatePortfolioGrade,
  AggregateOptions,
  WeightBy,
} from './portfolio-aggregator.js';

export interface PortfolioWeightHints {
  readonly siteCountByAssetId: Readonly<Record<string, number>>;
  readonly assetValueByAssetId: Readonly<Record<string, number>>;
}

export interface AssetMetricsSource {
  /** Fetch live inputs for an asset. Returns null when the asset is unknown. */
  fetchInputs(
    tenantId: string,
    assetId: string,
  ): Promise<AssetGradeInputs | null>;

  /** List every asset ID known for a tenant. */
  listAssetIds(tenantId: string): Promise<readonly string[]>;

  /** Return the site-count / asset-value weighting hints used by portfolio aggregation. */
  fetchPortfolioWeightHints(tenantId: string): Promise<PortfolioWeightHints>;
}

export interface WeightsRepository {
  getWeights(tenantId: string): Promise<GradingWeights>;
  setWeights(tenantId: string, weights: GradingWeights): Promise<GradingWeights>;
}

export interface GradeSnapshotRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly assetId: string;
  readonly grade: AssetGrade;
  readonly score: number;
  readonly dimensions: Readonly<Record<string, unknown>>;
  readonly reasons: readonly string[];
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly computedAt: string;
}

export interface SnapshotRepository {
  persist(record: GradeSnapshotRecord): Promise<GradeSnapshotRecord>;
  findLatest(
    tenantId: string,
    assetId: string,
  ): Promise<GradeSnapshotRecord | null>;
  findHistory(
    tenantId: string,
    assetId: string,
    months: number,
  ): Promise<readonly GradeSnapshotRecord[]>;
  findLatestByAsset(
    tenantId: string,
  ): Promise<ReadonlyMap<string, GradeSnapshotRecord>>;
}

export interface AssetGradingServiceConfig {
  readonly metricsSource: AssetMetricsSource;
  readonly weightsRepo: WeightsRepository;
  readonly snapshotRepo: SnapshotRepository;
  /** Override the clock for deterministic snapshots in tests. */
  readonly now?: () => Date;
  /** Identifier generator for snapshot rows. Tests plug in a deterministic one. */
  readonly generateId?: () => string;
}

const REQUIRED_FIELDS = [
  'utilisationRate',
  'royaltyCollectionRate',
  'noi',
  'grossPotentialIncome',
  'expenseRatio',
  'outstandingRoyaltyRatio',
  'avgMaintenanceResolutionHours',
  'maintenanceCostPerSite',
  'complianceBreachCount',
  'buyerSatisfactionProxy',
  'downtimeDays',
  'capexDebt',
  'marketPriceRatio',
  'assetAge',
  'siteCount',
] as const;

export type AssetGradingOutcome =
  | { readonly kind: 'report'; readonly report: AssetGradeReport }
  | { readonly kind: 'insufficient'; readonly report: InsufficientDataReport };

export class AssetGradingService {
  private readonly metrics: AssetMetricsSource;

  private readonly weightsRepo: WeightsRepository;

  private readonly snapshotRepo: SnapshotRepository;

  private readonly now: () => Date;

  private readonly generateId: () => string;

  constructor(config: AssetGradingServiceConfig) {
    this.metrics = config.metricsSource;
    this.weightsRepo = config.weightsRepo;
    this.snapshotRepo = config.snapshotRepo;
    this.now = config.now ?? (() => new Date());
    this.generateId =
      config.generateId ?? (() => `ag_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  }

  /** Grade one asset. Fetches live inputs + current weights, persists a snapshot. */
  async gradeAsset(
    tenantId: string,
    assetId: string,
  ): Promise<AssetGradingOutcome> {
    const inputs = await this.metrics.fetchInputs(tenantId, assetId);
    if (!inputs) {
      return {
        kind: 'insufficient',
        report: {
          tenantId,
          assetId,
          grade: 'INSUFFICIENT_DATA',
          missingFields: ['asset_not_found'],
          reasons: [`Asset ${assetId} has no records for tenant ${tenantId}.`],
        },
      };
    }

    const missing = validateInputs(inputs);
    if (missing.length > 0) {
      return {
        kind: 'insufficient',
        report: {
          tenantId,
          assetId,
          grade: 'INSUFFICIENT_DATA',
          missingFields: missing,
          reasons: [
            `Cannot grade — missing live measurements: ${missing.join(', ')}.`,
          ],
        },
      };
    }

    const weights = await this.weightsRepo.getWeights(tenantId);
    validateWeights(weights);

    const report = scoreAsset(inputs, weights);

    await this.snapshotRepo.persist({
      id: this.generateId(),
      tenantId,
      assetId,
      grade: report.grade,
      score: report.score,
      dimensions: serialiseDimensions(report.dimensions),
      reasons: report.reasons,
      inputs: serialiseInputs(inputs),
      computedAt: this.now().toISOString(),
    });

    return { kind: 'report', report };
  }

  /** Grade every asset known for a tenant. */
  async gradeAllAssets(
    tenantId: string,
  ): Promise<readonly AssetGradingOutcome[]> {
    const ids = await this.metrics.listAssetIds(tenantId);
    const outcomes: AssetGradingOutcome[] = [];
    for (const assetId of ids) {
      // Sequential by design — bulk grading runs on a worker, avoids
      // stampeding downstream queries. Parallelise at the caller level
      // if the tenant is extremely large.

      outcomes.push(await this.gradeAsset(tenantId, assetId));
    }
    return outcomes;
  }

  /** Roll up the latest snapshots into a portfolio grade. */
  async getPortfolioGrade(
    tenantId: string,
    opts: { weightBy?: WeightBy; previousScore?: number } = {},
  ): Promise<PortfolioGrade> {
    const latest = await this.snapshotRepo.findLatestByAsset(tenantId);
    const reports = Array.from(latest.values()).map(snapshotToReport);
    const hints = await this.metrics.fetchPortfolioWeightHints(tenantId);
    const weightsByAssetId = pickHint(hints, opts.weightBy ?? 'site_count');

    const aggregateOpts: AggregateOptions = {
      weightBy: opts.weightBy ?? 'site_count',
      weightsByAssetId,
      previousScore: opts.previousScore,
    };
    return aggregatePortfolioGrade(tenantId, reports, aggregateOpts);
  }

  /** Historical grade entries for an asset. */
  async trackOverTime(
    tenantId: string,
    assetId: string,
    months = 12,
  ): Promise<readonly GradeHistoryEntry[]> {
    const rows = await this.snapshotRepo.findHistory(tenantId, assetId, months);
    return rows.map((row) => ({
      tenantId,
      assetId,
      grade: row.grade,
      score: row.score,
      computedAt: row.computedAt,
    }));
  }

  async getWeights(tenantId: string): Promise<GradingWeights> {
    return this.weightsRepo.getWeights(tenantId);
  }

  async setWeights(
    tenantId: string,
    weights: GradingWeights,
  ): Promise<GradingWeights> {
    validateWeights(weights);
    return this.weightsRepo.setWeights(tenantId, weights);
  }
}

/** Return the list of missing fields on the input payload. */
export function validateInputs(inputs: AssetGradeInputs): string[] {
  const missing: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    const value = inputs[field];
    if (value === null || value === undefined || Number.isNaN(value)) {
      missing.push(field);
    }
  }
  return missing;
}

function serialiseDimensions(
  dimensions: AssetGradeReport['dimensions'],
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const dim of GRADE_DIMENSIONS) {
    out[dim] = {
      score: dimensions[dim].score,
      grade: dimensions[dim].grade,
      explanation: dimensions[dim].explanation,
    };
  }
  return out;
}

function serialiseInputs(inputs: AssetGradeInputs): Readonly<Record<string, unknown>> {
  return Object.freeze({ ...inputs });
}

function snapshotToReport(record: GradeSnapshotRecord): AssetGradeReport {
  const dimensions = record.dimensions as AssetGradeReport['dimensions'];
  return {
    assetId: record.assetId,
    tenantId: record.tenantId,
    grade: record.grade,
    score: record.score,
    dimensions,
    reasons: record.reasons,
    weights: DEFAULT_GRADING_WEIGHTS,
    computedAt: record.computedAt,
    evidence: record.inputs,
  };
}

function pickHint(
  hints: PortfolioWeightHints,
  weightBy: WeightBy,
): Readonly<Record<string, number>> | undefined {
  if (weightBy === 'site_count') return hints.siteCountByAssetId;
  if (weightBy === 'asset_value') return hints.assetValueByAssetId;
  return undefined;
}
