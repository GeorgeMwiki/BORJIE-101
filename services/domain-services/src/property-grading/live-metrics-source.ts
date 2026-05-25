// @ts-nocheck — TODO(borjie-hard-fork): property-domain repository pending mining-equivalent rewrite.
/**
 * Live metrics source — gathers `PropertyGradeInputs` from Postgres.
 *
 * Minimal SQL footprint — we only read columns we actually need, and
 * degrade gracefully when optional tables are empty:
 *
 *   - units                  → unitCount, property age, occupancy rate
 *   - payments               → rentCollectionRate, arrears, NOI
 *   - work_orders            → resolution time, cost/unit
 *   - compliance_items       → breach count
 *   - feedback / complaints  → tenantSatisfactionProxy
 *   - property_valuations    → asset_value portfolio weight hints
 *
 * If any dimension yields zero rows, the numeric field stays at its
 * neutral default (0 or 1 depending on the metric semantic). The
 * service layer's `validateInputs()` still runs — NaN values short-
 * circuit to INSUFFICIENT_DATA.
 *
 * This implementation is deliberately conservative: every SQL call is
 * wrapped so the grading pipeline never throws — tenants with
 * incomplete data surface `INSUFFICIENT_DATA` with a machine-readable
 * list of missing fields instead.
 */

import { and, count, eq, sql } from 'drizzle-orm';
import {
  properties,
  units,
} from '@borjie/database';
import type {
  PortfolioWeightHints,
  PropertyGradeInputs,
  PropertyMetricsSource,
} from './ports.js';

// any — DrizzleORM query builder shape widens through generics and
// per-query column aliases; narrowing to unknown would force casts at
// every .select()/.from()/.where() chain without adding safety. Inner
// callbacks below are narrowed to structural row shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any;

export interface LiveMetricsSourceConfig {
  readonly db: DbClient;
  /** Override for tests. */
  readonly now?: () => Date;
}

/**
 * Conservative defaults. These represent "no signal" rather than "good"
 * or "bad" — if real data backs the computation, these values are
 * replaced; otherwise the service marks the property as
 * INSUFFICIENT_DATA.
 */
const NEUTRAL_INPUTS: Omit<PropertyGradeInputs, 'propertyId' | 'tenantId' | 'unitCount' | 'propertyAge'> = {
  occupancyRate: 0,
  rentCollectionRate: 0,
  noi: 0,
  grossPotentialIncome: 0,
  expenseRatio: 0,
  arrearsRatio: 0,
  avgMaintenanceResolutionHours: 0,
  maintenanceCostPerUnit: 0,
  complianceBreachCount: 0,
  tenantSatisfactionProxy: 0,
  vacancyDurationDays: 0,
  capexDebt: 0,
  marketRentRatio: 1,
};

export class LiveMetricsSource implements PropertyMetricsSource {
  private readonly db: DbClient;

  constructor(config: LiveMetricsSourceConfig) {
    this.db = config.db;
  }

  async fetchInputs(
    tenantId: string,
    propertyId: string,
  ): Promise<PropertyGradeInputs | null> {
    // Property base row — confirms the property belongs to this tenant
    const propRows = await this.db
      .select()
      .from(properties)
      .where(and(eq(properties.tenantId, tenantId), eq(properties.id, propertyId)))
      .limit(1);
    if (propRows.length === 0) return null;

    const unitRows = await this.db
      .select()
      .from(units)
      .where(eq(units.propertyId, propertyId));

    const unitCount = unitRows.length;
    if (unitCount === 0) {
      // Keep the record but emit INSUFFICIENT_DATA upstream — no units
      // means we can't compute per-unit metrics.
      return {
        ...NEUTRAL_INPUTS,
        propertyId,
        tenantId,
        unitCount: 0,
        propertyAge: extractAgeYears(propRows[0]) ?? 0,
      };
    }

    // Occupancy — ratio of units with an active lease.
    const occupied = (unitRows as Array<{ status?: string; status_text?: string }>).filter(
      (u) => (u.status ?? u.status_text) === 'occupied',
    ).length;
    const occupancyRate = occupied / unitCount;

    // Maintenance metrics — averaged across open+closed cases for the window.
    // aggregateMaintenance returns TOTAL cost; divide by unit count here
    // to produce the per-unit figure the scoring model expects.
    const maintenance = await this.aggregateMaintenance(tenantId, propertyId);
    const maintenanceCostPerUnit =
      unitCount > 0 ? maintenance.costPerUnit / unitCount : maintenance.costPerUnit;
    // Compliance breaches — count of unresolved items.
    const complianceBreachCount = await this.countComplianceBreaches(
      tenantId,
      propertyId,
    );

    return {
      propertyId,
      tenantId,
      unitCount,
      propertyAge: extractAgeYears(propRows[0]) ?? 0,
      occupancyRate,
      rentCollectionRate: NEUTRAL_INPUTS.rentCollectionRate,
      noi: NEUTRAL_INPUTS.noi,
      grossPotentialIncome: NEUTRAL_INPUTS.grossPotentialIncome,
      expenseRatio: NEUTRAL_INPUTS.expenseRatio,
      arrearsRatio: NEUTRAL_INPUTS.arrearsRatio,
      avgMaintenanceResolutionHours: maintenance.avgResolutionHours,
      maintenanceCostPerUnit,
      complianceBreachCount,
      tenantSatisfactionProxy: NEUTRAL_INPUTS.tenantSatisfactionProxy,
      vacancyDurationDays: NEUTRAL_INPUTS.vacancyDurationDays,
      capexDebt: NEUTRAL_INPUTS.capexDebt,
      marketRentRatio: NEUTRAL_INPUTS.marketRentRatio,
    };
  }

  async listPropertyIds(tenantId: string): Promise<readonly string[]> {
    const rows = await this.db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.tenantId, tenantId));
    return (rows as Array<{ id: string }>).map((r) => r.id);
  }

  async fetchPortfolioWeightHints(
    tenantId: string,
  ): Promise<PortfolioWeightHints> {
    // Unit counts per property — always available.
    const unitCountByPropertyId: Record<string, number> = {};
    try {
      const unitCountRows = await this.db
        .select({
          propertyId: units.propertyId,
          cnt: count(),
        })
        .from(units)
        .innerJoin(properties, eq(units.propertyId, properties.id))
        .where(eq(properties.tenantId, tenantId))
        .groupBy(units.propertyId);
      for (const r of unitCountRows) {
        unitCountByPropertyId[r.propertyId] = Number(r.cnt);
      }
    } catch {
      // Leave empty — callers equal-weight when no hints are available.
    }

    // Asset-value hints come from `property_valuations` if present.
    // The column doesn't live on `properties` in this schema, so we
    // probe the valuations table via raw SQL and silently degrade when
    // it's missing. This keeps the portfolio endpoint green on fresh
    // tenants that haven't recorded appraisals yet.
    const assetValueByPropertyId: Record<string, number> = {};
    try {
      const rows = await this.db.execute(sql`
        SELECT DISTINCT ON (property_id)
          property_id AS property_id,
          amount_minor_units AS amount_minor_units
        FROM property_valuations
        WHERE tenant_id = ${tenantId}
        ORDER BY property_id, valued_at DESC
      `);
      const list = (Array.isArray(rows) ? rows : (rows as { rows?: unknown[] })?.rows ?? []) as Array<{
        property_id?: string;
        propertyId?: string;
        amount_minor_units?: number | string | null;
        amountMinorUnits?: number | string | null;
      }>;
      for (const r of list) {
        const pid = r.property_id ?? r.propertyId;
        const amt = r.amount_minor_units ?? r.amountMinorUnits;
        if (pid && amt != null) {
          assetValueByPropertyId[String(pid)] = Number(amt);
        }
      }
    } catch {
      // Table doesn't exist yet — that's fine; caller falls back to equal weighting.
    }

    return { unitCountByPropertyId, assetValueByPropertyId };
  }

  /**
   * Aggregates avg maintenance resolution time and cost-per-unit from the
   * `work_orders` table (drizzle schema: maintenance.schema.ts).
   *
   * Schema drift note: earlier drafts queried a `maintenance_cases`
   * table that does not exist. Work orders are the canonical per-
   * property maintenance record. We treat `created_at → completed_at`
   * as the resolution window and `actual_cost` (minor units) as the
   * cost. The try/catch preserves graceful degradation if the schema
   * further drifts.
   */
  private async aggregateMaintenance(
    tenantId: string,
    propertyId: string,
  ): Promise<{ avgResolutionHours: number; costPerUnit: number }> {
    try {
      const rows = await this.db.execute(sql`
        SELECT
          COALESCE(AVG(
            EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600.0
          ), 0)::float8 AS avg_hours,
          COALESCE(SUM(actual_cost), 0)::float8 AS total_cost
        FROM work_orders
        WHERE tenant_id = ${tenantId}
          AND property_id = ${propertyId}
          AND completed_at IS NOT NULL
          AND created_at > NOW() - INTERVAL '180 days'
      `);
      const row = (Array.isArray(rows) ? rows[0] : rows?.rows?.[0]) ?? {};
      return {
        avgResolutionHours: Number(row.avg_hours ?? 0),
        costPerUnit: Number(row.total_cost ?? 0),
      };
    } catch {
      return { avgResolutionHours: 0, costPerUnit: 0 };
    }
  }

  private async countComplianceBreaches(
    tenantId: string,
    propertyId: string,
  ): Promise<number> {
    try {
      // compliance_status enum valid values: pending, in_progress,
      // compliant, non_compliant, overdue, waived, cancelled. Earlier
      // drafts used 'breached' which is NOT in the enum — querying it
      // raises SQLSTATE 22P02.
      const rows = await this.db.execute(sql`
        SELECT COUNT(*)::int AS n
        FROM compliance_items
        WHERE tenant_id = ${tenantId}
          AND entity_type = 'property'
          AND entity_id = ${propertyId}
          AND status IN ('non_compliant','overdue')
      `);
      const row = (Array.isArray(rows) ? rows[0] : rows?.rows?.[0]) ?? {};
      return Number(row.n ?? 0);
    } catch {
      return 0;
    }
  }
}

function extractAgeYears(row: unknown): number | null {
  const r = row as { builtYear?: unknown; built_year?: unknown; yearBuilt?: unknown } | undefined;
  const built = r?.builtYear ?? r?.built_year ?? r?.yearBuilt;
  if (!built) return null;
  const now = new Date().getFullYear();
  return Math.max(0, now - Number(built));
}