/**
 * Postgres-backed Occupancy Timeline Repository (NEW 22)
 *
 * Reads a chronological occupancy history from the `leases` table,
 * joining to `customers` for display name. Each lease row becomes one
 * `OccupancyPeriod`. Tenant isolation is enforced on every query via
 * WHERE tenant_id = :ctx.
 *
 * Note: in the current schema `leases` is the canonical chronology
 * source — occupancies table is the current-active join. We read
 * historical periods from `leases` so 20+ year histories are
 * preserved even after a customer has moved out.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { leases, customers } from '@borjie/database';
import type {
  OccupancyPeriod,
  OccupancyPeriodStatus,
  OccupancyTimelineRepository,
} from './occupancy-timeline-service.js';

export interface DrizzleLike {
  select: (...args: unknown[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

function mapStatus(leaseStatus: string): OccupancyPeriodStatus {
  switch (leaseStatus) {
    case 'active':
    case 'approved':
    case 'expiring_soon':
      return 'active';
    case 'terminated':
    case 'cancelled':
      return 'moved_out';
    case 'renewed':
      return 'moved_out';
    case 'expired':
      return 'moved_out';
    default:
      return 'vacant';
  }
}

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

export class PostgresOccupancyTimelineRepository
  implements OccupancyTimelineRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async findByUnit(input: {
    readonly tenantId: string;
    readonly unitId: string;
    readonly page: number;
    readonly limit: number;
  }): Promise<{
    readonly unitId: string;
    readonly propertyId: string;
    readonly periods: readonly OccupancyPeriod[];
    readonly total: number;
  }> {
    const offset = (input.page - 1) * input.limit;

    const [{ count: total }] = (await this.db
      .select({ count: sql`count(*)::int` })
      .from(leases)
      .where(
        and(
          eq(leases.tenantId, input.tenantId),
          eq(leases.unitId, input.unitId)
        )
      )) as Array<{ count: number }>;

    const rows = await this.db
      .select({
        id: leases.id,
        tenantId: leases.tenantId,
        unitId: leases.unitId,
        propertyId: leases.propertyId,
        customerId: leases.customerId,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        startDate: leases.startDate,
        endDate: leases.endDate,
        terminationDate: leases.terminationDate,
        rentAmount: leases.rentAmount,
        rentCurrency: leases.rentCurrency,
        status: leases.status,
        terminationReason: leases.terminationReason,
      })
      .from(leases)
      .leftJoin(customers, eq(leases.customerId, customers.id))
      .where(
        and(
          eq(leases.tenantId, input.tenantId),
          eq(leases.unitId, input.unitId)
        )
      )
      .orderBy(desc(leases.startDate))
      .limit(input.limit)
      .offset(offset);

    const propertyId = rows[0]?.propertyId ?? '';

    const periods: OccupancyPeriod[] = rows.map((row: any) => ({
      id: row.id,
      tenantId: row.tenantId,
      unitId: row.unitId,
      propertyId: row.propertyId,
      customerId: row.customerId ?? null,
      customerName:
        [row.customerFirstName, row.customerLastName]
          .filter(Boolean)
          .join(' ')
          .trim() || null,
      from: toIso(row.startDate) ?? '',
      to: toIso(row.terminationDate ?? row.endDate),
      rent:
        row.rentAmount != null
          ? {
              amount: Number(row.rentAmount),
              currency: String(row.rentCurrency ?? ''),
            }
          : null,
      status: mapStatus(String(row.status ?? '')),
      exitReason: row.terminationReason ?? null,
      leaseId: row.id,
    }));

    return { unitId: input.unitId, propertyId, periods, total };
  }

  async findByProperty(input: {
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
  }> {
    const offset = (input.page - 1) * input.limit;

    const unitRows = (await this.db
      .selectDistinct({ unitId: leases.unitId })
      .from(leases)
      .where(
        and(
          eq(leases.tenantId, input.tenantId),
          eq(leases.propertyId, input.propertyId)
        )
      )
      .limit(input.limit)
      .offset(offset)) as Array<{ unitId: string }>;

    const [{ count: totalUnits }] = (await this.db
      .select({
        count: sql`count(distinct ${leases.unitId})::int`,
      })
      .from(leases)
      .where(
        and(
          eq(leases.tenantId, input.tenantId),
          eq(leases.propertyId, input.propertyId)
        )
      )) as Array<{ count: number }>;

    const units: Array<{
      unitId: string;
      periods: OccupancyPeriod[];
    }> = [];

    for (const { unitId } of unitRows) {
      const { periods } = await this.findByUnit({
        tenantId: input.tenantId,
        unitId,
        page: 1,
        limit: 100,
      });
      units.push({ unitId, periods: periods as OccupancyPeriod[] });
    }

    return { propertyId: input.propertyId, units, totalUnits };
  }
}
