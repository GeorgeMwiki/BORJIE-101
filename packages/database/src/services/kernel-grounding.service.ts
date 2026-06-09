/**
 * Kernel grounding service — Drizzle-backed `GroundingFactsProvider`.
 *
 * Restores the proactive, always-on situational-awareness channel the
 * MD injects into its system prompt every turn (see audit findings
 * `grounding-empty-facts-2` / `iq-grounding-stub-1`). The property-
 * domain original (occupancy / leases / work-orders) was deleted in
 * migration 0003_mining_domain.sql; this is the mining-domain rewrite.
 *
 * Facts emitted (capped, see {@link MAX_FACTS}):
 *   - open licences count (status not in expired/surrendered/cancelled)
 *   - licences expiring within 90 days
 *   - production tonnage logged today + month-to-date (ore tonnes)
 *   - open safety incidents
 *   - sales realised value month-to-date (TZS view)
 *
 * Hard rules honoured:
 *   - Tenant-scoped via RLS (`app.current_tenant_id`); we additionally
 *     filter by tenantId so the binding is explicit, never disabling RLS.
 *   - Role visibility: `sovereign` and platform-tier (null tenantId)
 *     receive an empty fact set (no tenant to ground against).
 *   - Resilient: every query is independently guarded; a single failure
 *     degrades that fact to absent (pino warn), never throws to the
 *     kernel. An empty array is an honest "no live facts", not a crash.
 *   - No hard-coded currency: the currency-tzs unit reflects the
 *     `gross_price_tzs` TZS view column the sales table already exposes.
 */

import { and, eq, gte, lte, sql, notInArray } from 'drizzle-orm';
import { licences } from '../schemas/licences.schema.js';
import { sales } from '../schemas/production-sales.schema.js';
import { productionTonnageEvents } from '../schemas/production-tonnage.schema.js';
import { incidents } from '../schemas/safety-csr.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';

// Duck-typed copy of the kernel's port — keep in sync with
// @borjie/central-intelligence/kernel/kernel-types.ts.
export interface GroundingFactShape {
  readonly id: string;
  readonly label: string;
  readonly value: string | number;
  readonly unit?: 'pct' | 'count' | 'currency-tzs' | 'currency-kes' | 'days';
  readonly source: string;
  readonly asOf: string;
}

export interface GroundingFactsProviderShape {
  fetch(args: {
    readonly userMessage: string;
    readonly tier: string;
    readonly limit: number;
  }): Promise<ReadonlyArray<GroundingFactShape>>;
}

export type GroundingViewRole =
  | 'tenant'
  | 'manager'
  | 'owner'
  | 'org-admin'
  | 'sovereign';

export interface KernelGroundingDeps {
  readonly tenantId: string | null;
  readonly userId?: string | null;
  readonly role?: GroundingViewRole;
}

/** Kernel renders only the first 5 facts; cap below the per-turn limit. */
const MAX_FACTS = 5;

/** Licence states that no longer count as "open". */
const CLOSED_LICENCE_STATES = ['expired', 'surrendered', 'cancelled'];

/** Incident states that no longer count as "open". */
const CLOSED_INCIDENT_STATES = ['closed', 'resolved', 'dismissed'];

function startOfTodayIso(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

function startOfMonthIso(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
}

function inNinetyDaysDateOnly(): string {
  const now = new Date();
  const future = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  return future.toISOString().slice(0, 10);
}

/**
 * Run one grounding query; on any failure log a pino warn and return
 * null so the caller drops that fact rather than failing the whole set.
 */
async function safeFact(
  label: string,
  run: () => Promise<GroundingFactShape | null>,
): Promise<GroundingFactShape | null> {
  try {
    return await run();
  } catch (err) {
    logger.warn('kernel-grounding: fact query failed; degrading to absent', {
      label,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function buildFacts(
  db: DatabaseClient,
  tenantId: string,
  asOf: string,
): ReadonlyArray<() => Promise<GroundingFactShape | null>> {
  const todayIso = startOfTodayIso();
  const monthIso = startOfMonthIso();
  const expiryCutoff = inNinetyDaysDateOnly();

  const openLicences = (): Promise<GroundingFactShape | null> =>
    safeFact('open_licences', async () => {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(licences)
        .where(
          and(
            eq(licences.tenantId, tenantId),
            notInArray(licences.status, CLOSED_LICENCE_STATES),
          ),
        );
      return {
        id: 'grounding-open-licences',
        label: 'Open mining licences',
        value: Number(row?.n ?? 0),
        unit: 'count',
        source: 'licences',
        asOf,
      };
    });

  const expiringLicences = (): Promise<GroundingFactShape | null> =>
    safeFact('licences_expiring_90d', async () => {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(licences)
        .where(
          and(
            eq(licences.tenantId, tenantId),
            notInArray(licences.status, CLOSED_LICENCE_STATES),
            lte(licences.expiryDate, expiryCutoff),
          ),
        );
      return {
        id: 'grounding-licences-expiring',
        label: 'Licences expiring within 90 days',
        value: Number(row?.n ?? 0),
        unit: 'count',
        source: 'licences',
        asOf,
      };
    });

  const tonnageToday = (): Promise<GroundingFactShape | null> =>
    safeFact('production_tonnage_today', async () => {
      const [row] = await db
        .select({
          tonnes: sql<string>`coalesce(sum(${productionTonnageEvents.oreTonnes}), 0)`,
        })
        .from(productionTonnageEvents)
        .where(
          and(
            eq(productionTonnageEvents.tenantId, tenantId),
            gte(productionTonnageEvents.capturedAt, sql`${todayIso}::timestamptz`),
          ),
        );
      return {
        id: 'grounding-tonnage-today',
        label: 'Ore tonnes logged today',
        value: Math.round(Number(row?.tonnes ?? 0)),
        unit: 'count',
        source: 'production_tonnage_events',
        asOf,
      };
    });

  const tonnageMtd = (): Promise<GroundingFactShape | null> =>
    safeFact('production_tonnage_mtd', async () => {
      const [row] = await db
        .select({
          tonnes: sql<string>`coalesce(sum(${productionTonnageEvents.oreTonnes}), 0)`,
        })
        .from(productionTonnageEvents)
        .where(
          and(
            eq(productionTonnageEvents.tenantId, tenantId),
            gte(productionTonnageEvents.capturedAt, sql`${monthIso}::timestamptz`),
          ),
        );
      return {
        id: 'grounding-tonnage-mtd',
        label: 'Ore tonnes logged month-to-date',
        value: Math.round(Number(row?.tonnes ?? 0)),
        unit: 'count',
        source: 'production_tonnage_events',
        asOf,
      };
    });

  const openIncidents = (): Promise<GroundingFactShape | null> =>
    safeFact('open_incidents', async () => {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(incidents)
        .where(
          and(
            eq(incidents.tenantId, tenantId),
            notInArray(incidents.status, CLOSED_INCIDENT_STATES),
          ),
        );
      return {
        id: 'grounding-open-incidents',
        label: 'Open safety incidents',
        value: Number(row?.n ?? 0),
        unit: 'count',
        source: 'incidents',
        asOf,
      };
    });

  const salesMtd = (): Promise<GroundingFactShape | null> =>
    safeFact('sales_value_mtd', async () => {
      const [row] = await db
        .select({
          tzs: sql<string>`coalesce(sum(${sales.grossPriceTzs}), 0)`,
        })
        .from(sales)
        .where(
          and(
            eq(sales.tenantId, tenantId),
            gte(sales.ts, sql`${monthIso}::timestamptz`),
          ),
        );
      return {
        id: 'grounding-sales-mtd',
        label: 'Realised sales value month-to-date',
        value: Math.round(Number(row?.tzs ?? 0)),
        unit: 'currency-tzs',
        source: 'sales',
        asOf,
      };
    });

  return [
    openLicences,
    expiringLicences,
    tonnageMtd,
    tonnageToday,
    openIncidents,
    salesMtd,
  ];
}

export function createKernelGroundingProvider(
  db: DatabaseClient,
  deps: KernelGroundingDeps,
): GroundingFactsProviderShape {
  return {
    async fetch({ limit }): Promise<ReadonlyArray<GroundingFactShape>> {
      const role = deps.role ?? 'org-admin';
      // Sovereign role and platform-tier (no tenant) have nothing to
      // ground against — honour the documented visibility contract.
      if (!deps.tenantId || role === 'sovereign') {
        return [];
      }

      const asOf = new Date().toISOString();
      const cap = Math.max(0, Math.min(MAX_FACTS, limit ?? MAX_FACTS));
      if (cap === 0) return [];

      const queries = buildFacts(db, deps.tenantId, asOf);
      const settled = await Promise.all(queries.map((q) => q()));
      const facts = settled.filter(
        (f): f is GroundingFactShape => f !== null,
      );

      return facts.slice(0, cap);
    },
  };
}
