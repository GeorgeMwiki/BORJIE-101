/**
 * Occupancy Timeline Service (NEW 22)
 *
 * Builds a chronological occupancy history for a unit (or aggregated
 * across a property). Designed for 20+ year histories — queries are
 * paginated and results streamed page-by-page.
 *
 * The service is dependency-inverted: it depends on
 * OccupancyTimelineRepository, which the infra layer can back with
 * Drizzle / Postgres or Neo4j (via graph-agent-toolkit).
 */

export type OccupancyPeriodStatus =
  | 'active'
  | 'notice_given'
  | 'moved_out'
  | 'evicted'
  | 'abandoned'
  | 'vacant';

export interface OccupancyPeriod {
  readonly id: string;
  readonly tenantId: string;
  readonly unitId: string;
  readonly propertyId: string;
  readonly customerId: string | null;
  readonly customerName: string | null;
  readonly from: string; // ISO datetime
  readonly to: string | null; // ISO datetime or null if still active
  readonly rent: { readonly amount: number; readonly currency: string } | null;
  readonly status: OccupancyPeriodStatus;
  readonly exitReason: string | null;
  readonly leaseId: string | null;
}

export interface UnitTimeline {
  readonly unitId: string;
  readonly propertyId: string;
  readonly periods: readonly OccupancyPeriod[];
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

export interface PortfolioTimeline {
  readonly propertyId: string;
  readonly timelinesByUnit: ReadonlyArray<{
    readonly unitId: string;
    readonly periods: readonly OccupancyPeriod[];
  }>;
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly totalUnits: number;
  };
}

export interface PaginationOpts {
  readonly page?: number;
  readonly limit?: number;
}

export interface OccupancyTimelineRepository {
  findByUnit(input: {
    readonly tenantId: string;
    readonly unitId: string;
    readonly page: number;
    readonly limit: number;
  }): Promise<{
    readonly unitId: string;
    readonly propertyId: string;
    readonly periods: readonly OccupancyPeriod[];
    readonly total: number;
  }>;
  findByProperty(input: {
    readonly tenantId: string;
    readonly propertyId: string;
    readonly page: number;
    readonly limit: number;
  }): Promise<{
    readonly propertyId: string;
    readonly units: ReadonlyArray<{
      readonly unitId: string;
      readonly periods: readonly OccupancyPeriod[];
    }>;
    readonly totalUnits: number;
  }>;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function clampPagination(opts?: PaginationOpts): {
  readonly page: number;
  readonly limit: number;
} {
  const page = Math.max(DEFAULT_PAGE, opts?.page ?? DEFAULT_PAGE);
  const requested = opts?.limit ?? DEFAULT_LIMIT;
  const limit = Math.min(MAX_LIMIT, Math.max(1, requested));
  return { page, limit };
}

export class OccupancyTimelineService {
  constructor(private readonly repository: OccupancyTimelineRepository) {}

  async getUnitTimeline(
    unitId: string,
    tenantId: string,
    opts?: PaginationOpts
  ): Promise<UnitTimeline> {
    const { page, limit } = clampPagination(opts);
    const result = await this.repository.findByUnit({
      tenantId,
      unitId,
      page,
      limit,
    });
    return {
      unitId: result.unitId,
      propertyId: result.propertyId,
      periods: result.periods,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / limit)),
      },
    };
  }

  async getPortfolioTimeline(
    propertyId: string,
    tenantId: string,
    opts?: PaginationOpts
  ): Promise<PortfolioTimeline> {
    const { page, limit } = clampPagination(opts);
    const result = await this.repository.findByProperty({
      tenantId,
      propertyId,
      page,
      limit,
    });
    return {
      propertyId: result.propertyId,
      timelinesByUnit: result.units,
      pagination: { page, limit, totalUnits: result.totalUnits },
    };
  }
}
