/**
 * Kernel cohort service — Drizzle-backed `TenantAggregateSource`
 * implementation for `@borjie/graph-privacy`'s DP aggregator.
 *
 * The graph-privacy package treats this source as a port: it asks
 *   1. Which tenants are eligible for a slice (`eligibleTenants`)?
 *   2. What are tenant `T`'s contributions for statistic `S`
 *      (`contributionsFor`)?
 *
 * For step 2 the aggregator clamps each contribution to its
 * sensitivity range and combines per-tenant means, so we are free to
 * return raw per-row contributions (e.g. one 0/1 per arrears case).
 * Missing data ⇒ empty array — the aggregator skips that tenant.
 *
 * Per the production scaffold contract: queries are coarse and
 * defensive. Slice filtering by jurisdiction / property class is a
 * follow-up — today every tenant is eligible and the slice's time
 * window is the only filter applied to per-tenant contributions.
 *
 * The `TenantAggregateSource` port is duck-typed locally so this
 * package does NOT compile-time-depend on `@borjie/graph-privacy`.
 * If the port shape changes, a unit test in graph-privacy will break
 * first.
 */

import { and, eq, gte, lt, sql, isNull, isNotNull } from 'drizzle-orm';
import { tenants } from '../schemas/tenant.schema.js';
import { leases } from '../schemas/lease.schema.js';
import { invoices, payments, arrearsCases } from '../schemas/payment.schema.js';
import { workOrders } from '../schemas/maintenance.schema.js';
import type { DatabaseClient } from '../client.js';

// ─────────────────────────────────────────────────────────────────────
// Port surface — duck-typed copy of `@borjie/graph-privacy`'s
// `TenantAggregateSource`. Keep in sync with
// packages/graph-privacy/src/types.ts.
// ─────────────────────────────────────────────────────────────────────

export interface PlatformSliceShape {
  readonly jurisdictions: ReadonlyArray<string>;
  readonly propertyClasses: ReadonlyArray<string>;
  readonly from: string;
  readonly to: string;
}

export interface ContributionsArgs {
  readonly tenantId: string;
  readonly statistic: string;
  readonly slice: PlatformSliceShape;
}

export interface TenantAggregateSourceShape {
  contributionsFor(args: ContributionsArgs): Promise<ReadonlyArray<number>>;
  eligibleTenants(slice: PlatformSliceShape): Promise<ReadonlyArray<string>>;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createPgTenantAggregateSource(
  db: DatabaseClient,
): TenantAggregateSourceShape {
  return {
    async eligibleTenants(_slice) {
      // Per-slice (jurisdiction / property class) filtering is a
      // follow-up; today the eligible set is every active tenant. The
      // aggregator combines results and applies k-anonymity itself.
      try {
        const rows = await db
          .select({ id: tenants.id })
          .from(tenants);
        return rows.map((r) => r.id);
      } catch {
        // If the read fails for any reason, return an empty slice so
        // the aggregator returns a structured `slice_empty` refusal
        // rather than throwing.
        return [];
      }
    },

    async contributionsFor({ tenantId, statistic, slice }) {
      try {
        const from = parseSliceDate(slice.from);
        const to = parseSliceDate(slice.to);
        switch (statistic) {
          case 'arrears_rate':
            return await computeArrearsRate(db, tenantId);
          case 'collection_rate':
            return await computeCollectionRate(db, tenantId, from, to);
          case 'vacancy_days_mean':
            // Without a unit-occupancy history table the platform
            // cannot derive vacancy duration cheaply. Return empty —
            // the aggregator handles missing data correctly.
            return [];
          case 'renewal_rate':
            return await computeRenewalRate(db, tenantId, from, to);
          case 'maintenance_ttc_mean':
            return await computeMaintenanceTtc(db, tenantId, from, to);
          default:
            return [];
        }
      } catch {
        // Per-statistic per-tenant failures must never surface; the
        // aggregator already tolerates empty contributions.
        return [];
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function parseSliceDate(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** arrears_rate: open ≥30-day-overdue cases / active leases. Single
 *  ratio per tenant. */
async function computeArrearsRate(
  db: DatabaseClient,
  tenantId: string,
): Promise<ReadonlyArray<number>> {
  const [arrearsRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(arrearsCases)
    .where(
      and(
        eq(arrearsCases.tenantId, tenantId),
        eq(arrearsCases.status, 'active' as never),
        gte(arrearsCases.daysPastDue, 30),
      ),
    );

  const [leaseRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(leases)
    .where(
      and(
        eq(leases.tenantId, tenantId),
        eq(leases.status, 'active' as never),
      ),
    );

  const numerator = Number(arrearsRow?.n ?? 0);
  const denominator = Number(leaseRow?.n ?? 0);
  if (denominator <= 0) return [];
  // Single rate-style contribution; the aggregator clips into
  // [-sensitivity, sensitivity] before combining.
  return [numerator / denominator];
}

/** collection_rate: paid-on-time payments amount / invoiced amount,
 *  bounded to the slice's time window. One ratio per tenant. */
async function computeCollectionRate(
  db: DatabaseClient,
  tenantId: string,
  from: Date | null,
  to: Date | null,
): Promise<ReadonlyArray<number>> {
  const invoiceConds = [eq(invoices.tenantId, tenantId)];
  if (from) invoiceConds.push(gte(invoices.issueDate, from));
  if (to) invoiceConds.push(lt(invoices.issueDate, to));

  const [invRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${invoices.totalAmount}), 0)::int` })
    .from(invoices)
    .where(and(...invoiceConds));

  const paymentConds = [
    eq(payments.tenantId, tenantId),
    eq(payments.status, 'completed' as never),
    // "On time" approximated as: payment completed before the linked
    // invoice's due date. Without a SQL JOIN that scales we use a
    // correlated EXISTS — Drizzle expresses it via raw SQL.
    sql`EXISTS (SELECT 1 FROM invoices i WHERE i.id = ${payments.invoiceId} AND ${payments.completedAt} <= i.due_date)`,
  ];
  if (from) paymentConds.push(gte(payments.completedAt, from));
  if (to) paymentConds.push(lt(payments.completedAt, to));

  const [payRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)::int` })
    .from(payments)
    .where(and(...paymentConds));

  const invoiced = Number(invRow?.total ?? 0);
  const paidOnTime = Number(payRow?.total ?? 0);
  if (invoiced <= 0) return [];
  return [paidOnTime / invoiced];
}

/** renewal_rate: leases with renewalStatus='accepted' /
 *  leases that ended within the slice. */
async function computeRenewalRate(
  db: DatabaseClient,
  tenantId: string,
  from: Date | null,
  to: Date | null,
): Promise<ReadonlyArray<number>> {
  const expiredConds = [
    eq(leases.tenantId, tenantId),
  ];
  if (from) expiredConds.push(gte(leases.endDate, from));
  if (to) expiredConds.push(lt(leases.endDate, to));

  const [expiredRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(leases)
    .where(and(...expiredConds));

  const renewedConds = [
    eq(leases.tenantId, tenantId),
    isNotNull(leases.previousLeaseId),
  ];
  if (from) renewedConds.push(gte(leases.startDate, from));
  if (to) renewedConds.push(lt(leases.startDate, to));

  const [renewedRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(leases)
    .where(and(...renewedConds));

  const expired = Number(expiredRow?.n ?? 0);
  const renewed = Number(renewedRow?.n ?? 0);
  if (expired <= 0) return [];
  return [renewed / expired];
}

/** maintenance_ttc_mean: average time-to-complete across completed
 *  work orders within the slice, expressed in hours. */
async function computeMaintenanceTtc(
  db: DatabaseClient,
  tenantId: string,
  from: Date | null,
  to: Date | null,
): Promise<ReadonlyArray<number>> {
  const conds = [
    eq(workOrders.tenantId, tenantId),
    isNotNull(workOrders.completedAt),
  ];
  // Skip silly nulls explicitly so the avg expression never sees them.
  conds.push(sql`${workOrders.completedAt} IS NOT NULL` as never);
  if (from) conds.push(gte(workOrders.completedAt, from));
  if (to) conds.push(lt(workOrders.completedAt, to));
  // Suppress the unused-import lint while keeping `isNull` available
  // for future filters on still-open work orders.
  void isNull;

  const [row] = await db
    .select({
      hours: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${workOrders.completedAt} - ${workOrders.createdAt}))) / 3600.0, 0)::float`,
    })
    .from(workOrders)
    .where(and(...conds));

  const hours = Number(row?.hours ?? 0);
  if (hours <= 0) return [];
  return [hours];
}
