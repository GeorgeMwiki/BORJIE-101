/**
 * Property-grading service.
 *
 * Composes three collaborators passed via the constructor:
 *
 *   - `metricsSource`   — pulls live metrics for a property from the
 *                         real tables (occupancy, arrears, maintenance,
 *                         compliance, payments). Production uses a
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
  PropertyGrade,
  PropertyGradeInputs,
  PropertyGradeReport,
} from './property-grading-types.js';
import { scoreProperty, validateWeights } from './scoring-model.js';
import {
  aggregatePortfolioGrade,
  AggregateOptions,
  WeightBy,
} from './portfolio-aggregator.js';

export interface PortfolioWeightHints {
  readonly unitCountByPropertyId: Readonly<Record<string, number>>;
  readonly assetValueByPropertyId: Readonly<Record<string, number>>;
}

export interface PropertyMetricsSource {
  /** Fetch live inputs for a property. Returns null when the property is unknown. */
  fetchInputs(
    tenantId: string,
    propertyId: string,
  ): Promise<PropertyGradeInputs | null>;

  /** List every property ID known for a tenant. */
  listPropertyIds(tenantId: string): Promise<readonly string[]>;

  /** Return the unit-count / asset-value weighting hints used by portfolio aggregation. */
  fetchPortfolioWeightHints(tenantId: string): Promise<PortfolioWeightHints>;
}

export interface WeightsRepository {
  getWeights(tenantId: string): Promise<GradingWeights>;
  setWeights(tenantId: string, weights: GradingWeights): Promise<GradingWeights>;
}

export interface GradeSnapshotRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly propertyId: string;
  readonly grade: PropertyGrade;
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
    propertyId: string,
  ): Promise<GradeSnapshotRecord | null>;
  findHistory(
    tenantId: string,
    propertyId: string,
    months: number,
  ): Promise<readonly GradeSnapshotRecord[]>;
  findLatestByProperty(
    tenantId: string,
  ): Promise<ReadonlyMap<string, GradeSnapshotRecord>>;
}

export interface PropertyGradingServiceConfig {
  readonly metricsSource: PropertyMetricsSource;
  readonly weightsRepo: WeightsRepository;
  readonly snapshotRepo: SnapshotRepository;
  /** Override the clock for deterministic snapshots in tests. */
  readonly now?: () => Date;
  /** Identifier generator for snapshot rows. Tests plug in a deterministic one. */
  readonly generateId?: () => string;
}

const REQUIRED_FIELDS = [
  'occupancyRate',
  'rentCollectionRate',
  'noi',
  'grossPotentialIncome',
  'expenseRatio',
  'arrearsRatio',
  'avgMaintenanceResolutionHours',
  'maintenanceCostPerUnit',
  'complianceBreachCount',
  'tenantSatisfactionProxy',
  'vacancyDurationDays',
  'capexDebt',
  'marketRentRatio',
  'propertyAge',
  'unitCount',
] as const;

export type PropertyGradingOutcome =
  | { readonly kind: 'report'; readonly report: PropertyGradeReport }
  | { readonly kind: 'insufficient'; readonly report: InsufficientDataReport };

export class PropertyGradingService {
  private readonly metrics: PropertyMetricsSource;

  private readonly weightsRepo: WeightsRepository;

  private readonly snapshotRepo: SnapshotRepository;

  private readonly now: () => Date;

  private readonly generateId: () => string;

  constructor(config: PropertyGradingServiceConfig) {
    this.metrics = config.metricsSource;
    this.weightsRepo = config.weightsRepo;
    this.snapshotRepo = config.snapshotRepo;
    this.now = config.now ?? (() => new Date());
    this.generateId =
      config.generateId ?? (() => `pg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  }

  /** Grade one property. Fetches live inputs + current weights, persists a snapshot. */
  async gradeProperty(
    tenantId: string,
    propertyId: string,
  ): Promise<PropertyGradingOutcome> {
    const inputs = await this.metrics.fetchInputs(tenantId, propertyId);
    if (!inputs) {
      return {
        kind: 'insufficient',
        report: {
          tenantId,
          propertyId,
          grade: 'INSUFFICIENT_DATA',
          missingFields: ['property_not_found'],
          reasons: [`Property ${propertyId} has no records for tenant ${tenantId}.`],
        },
      };
    }

    const missing = validateInputs(inputs);
    if (missing.length > 0) {
      return {
        kind: 'insufficient',
        report: {
          tenantId,
          propertyId,
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

    const report = scoreProperty(inputs, weights);

    await this.snapshotRepo.persist({
      id: this.generateId(),
      tenantId,
      propertyId,
      grade: report.grade,
      score: report.score,
      dimensions: serialiseDimensions(report.dimensions),
      reasons: report.reasons,
      inputs: serialiseInputs(inputs),
      computedAt: this.now().toISOString(),
    });

    return { kind: 'report', report };
  }

  /** Grade every property known for a tenant. */
  async gradeAllProperties(
    tenantId: string,
  ): Promise<readonly PropertyGradingOutcome[]> {
    const ids = await this.metrics.listPropertyIds(tenantId);
    const outcomes: PropertyGradingOutcome[] = [];
    for (const propertyId of ids) {
      // Sequential by design — bulk grading runs on a worker, avoids
      // stampeding downstream queries. Parallelise at the caller level
      // if the tenant is extremely large.
       
      outcomes.push(await this.gradeProperty(tenantId, propertyId));
    }
    return outcomes;
  }

  /** Roll up the latest snapshots into a portfolio grade. */
  async getPortfolioGrade(
    tenantId: string,
    opts: { weightBy?: WeightBy; previousScore?: number } = {},
  ): Promise<PortfolioGrade> {
    const latest = await this.snapshotRepo.findLatestByProperty(tenantId);
    const reports = Array.from(latest.values()).map(snapshotToReport);
    const hints = await this.metrics.fetchPortfolioWeightHints(tenantId);
    const weightsByPropertyId = pickHint(hints, opts.weightBy ?? 'unit_count');

    const aggregateOpts: AggregateOptions = {
      weightBy: opts.weightBy ?? 'unit_count',
      weightsByPropertyId,
      previousScore: opts.previousScore,
    };
    return aggregatePortfolioGrade(tenantId, reports, aggregateOpts);
  }

  /** Historical grade entries for a property. */
  async trackOverTime(
    tenantId: string,
    propertyId: string,
    months = 12,
  ): Promise<readonly GradeHistoryEntry[]> {
    const rows = await this.snapshotRepo.findHistory(tenantId, propertyId, months);
    return rows.map((row) => ({
      tenantId,
      propertyId,
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
export function validateInputs(inputs: PropertyGradeInputs): string[] {
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
  dimensions: PropertyGradeReport['dimensions'],
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

function serialiseInputs(inputs: PropertyGradeInputs): Readonly<Record<string, unknown>> {
  return Object.freeze({ ...inputs });
}

function snapshotToReport(record: GradeSnapshotRecord): PropertyGradeReport {
  const dimensions = record.dimensions as PropertyGradeReport['dimensions'];
  return {
    propertyId: record.propertyId,
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
  if (weightBy === 'unit_count') return hints.unitCountByPropertyId;
  if (weightBy === 'asset_value') return hints.assetValueByPropertyId;
  return undefined;
}
