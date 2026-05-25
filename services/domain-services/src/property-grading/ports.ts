/**
 * Structural contracts mirroring `@borjie/ai-copilot/property-grading`.
 *
 * We re-declare the shapes here (rather than importing) because
 * domain-services must not depend on ai-copilot (ai-copilot depends on
 * domain-services in the dependency graph, making the reverse a cycle).
 *
 * The composition root in api-gateway adapts these concrete Postgres
 * repositories into the ai-copilot `PropertyGradingService` via
 * structural typing — both halves share the same property names.
 */

export type GradingWeights = Readonly<{
  income: number;
  expense: number;
  maintenance: number;
  occupancy: number;
  compliance: number;
  tenant: number;
}>;

export const DEFAULT_GRADING_WEIGHTS: GradingWeights = Object.freeze({
  income: 0.25,
  expense: 0.2,
  maintenance: 0.2,
  occupancy: 0.15,
  compliance: 0.1,
  tenant: 0.1,
});

export type PropertyGrade =
  | 'A_PLUS'
  | 'A'
  | 'A_MINUS'
  | 'B_PLUS'
  | 'B'
  | 'B_MINUS'
  | 'C_PLUS'
  | 'C'
  | 'C_MINUS'
  | 'D_PLUS'
  | 'D'
  | 'F'
  | 'INSUFFICIENT_DATA';

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

export interface PortfolioWeightHints {
  readonly unitCountByPropertyId: Readonly<Record<string, number>>;
  readonly assetValueByPropertyId: Readonly<Record<string, number>>;
}

export interface PropertyGradeInputs {
  readonly propertyId: string;
  readonly tenantId: string;
  readonly occupancyRate: number;
  readonly rentCollectionRate: number;
  readonly noi: number;
  readonly grossPotentialIncome: number;
  readonly expenseRatio: number;
  readonly arrearsRatio: number;
  readonly avgMaintenanceResolutionHours: number;
  readonly maintenanceCostPerUnit: number;
  readonly complianceBreachCount: number;
  readonly tenantSatisfactionProxy: number;
  readonly vacancyDurationDays: number;
  readonly capexDebt: number;
  readonly marketRentRatio: number;
  readonly propertyAge: number;
  readonly unitCount: number;
}

export interface WeightsRepository {
  getWeights(tenantId: string): Promise<GradingWeights>;
  setWeights(tenantId: string, weights: GradingWeights): Promise<GradingWeights>;
}

export interface SnapshotRepository {
  persist(record: GradeSnapshotRecord): Promise<GradeSnapshotRecord>;
  findLatest(tenantId: string, propertyId: string): Promise<GradeSnapshotRecord | null>;
  findHistory(
    tenantId: string,
    propertyId: string,
    months: number,
  ): Promise<readonly GradeSnapshotRecord[]>;
  findLatestByProperty(
    tenantId: string,
  ): Promise<ReadonlyMap<string, GradeSnapshotRecord>>;
}

export interface PropertyMetricsSource {
  fetchInputs(
    tenantId: string,
    propertyId: string,
  ): Promise<PropertyGradeInputs | null>;
  listPropertyIds(tenantId: string): Promise<readonly string[]>;
  fetchPortfolioWeightHints(tenantId: string): Promise<PortfolioWeightHints>;
}
