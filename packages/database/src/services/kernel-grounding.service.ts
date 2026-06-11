/**
 * Kernel grounding service — Drizzle-backed `GroundingFactsProvider`.
 *
 * Restores the proactive, always-on situational-awareness channel the
 * MD injects into its system prompt every turn (see audit findings
 * `grounding-empty-facts-2` / `iq-grounding-stub-1`). The property-
 * domain original (occupancy / leases / work-orders) was deleted in
 * migration 0003_mining_domain.sql; this is the mining-domain rewrite.
 *
 * Facts built (the kernel renders the first {@link MAX_FACTS}; the most
 * message-relevant are selected upstream by the per-turn limit):
 *   - open licences count (status not in expired/surrendered/cancelled)
 *   - licences expiring within 90 days
 *   - production tonnage logged today + month-to-date (ore tonnes)
 *   - open safety incidents
 *   - sales realised value month-to-date (TZS view)
 *   - outstanding royalty balance (settlements not yet completed/failed)
 *   - treasury / wallet balance (sum of ACTIVE ledger accounts)
 *   - active workforce headcount (employees status = active)
 *   - open compliance filings (regulatory_filings still requiring action)
 *   - active marketplace bids (marketplace_bids status = pending)
 *   - holding-company count (active estate entities)
 *   - estate asset-register item count (estate_assets)
 *
 * Every estate-wide fact above is independently guarded by {@link safeFact};
 * a missing table or query error degrades just that fact to absent (pino
 * warn), never throwing to the kernel.
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
import { settlements } from '../schemas/settlements.schema.js';
import { accounts } from '../schemas/payments-ledger.schema.js';
import { employees } from '../schemas/workforce.schema.js';
import { regulatoryFilings } from '../schemas/regulatory-filings.schema.js';
import { marketplaceBids } from '../schemas/marketplace-bids.schema.js';
import { estateEntities } from '../schemas/estate-entities.schema.js';
import { estateAssets } from '../schemas/estate-assets.schema.js';
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

/**
 * Hard ceiling on facts returned in one turn, so the system prompt never
 * bloats no matter how many fact-builders exist. The kernel asks for a
 * per-turn `limit` (currently 6); we honour `min(MAX_FACTS, limit)`. We now
 * build a 13-fact estate-wide set (royalty / treasury / workforce /
 * compliance / marketplace / holdings / assets in addition to the original
 * production six), so {@link selectRelevantFacts} orders by relevance to the
 * user's message BEFORE the slice — otherwise the estate-wide facts beyond
 * the cap would never reach the prompt and any estate question would feel
 * foreign again.
 */
const MAX_FACTS = 6;

/** Licence states that no longer count as "open". */
const CLOSED_LICENCE_STATES = ['expired', 'surrendered', 'cancelled'];

/** Incident states that no longer count as "open". */
const CLOSED_INCIDENT_STATES = ['closed', 'resolved', 'dismissed'];

/**
 * Settlement states whose royalty is no longer outstanding — `completed`
 * has paid out, `failed` is dead. Everything else (pending/posted/
 * paying_out) still owes royalty to the regulator. See settlements.schema.
 */
const SETTLED_ROYALTY_STATES = ['completed', 'failed'];

/** Ledger account status that counts toward live treasury balance. */
const ACTIVE_ACCOUNT_STATUS = 'ACTIVE';

/** Employee status that counts toward active headcount. */
const ACTIVE_EMPLOYEE_STATUS = 'active';

/**
 * Regulatory-filing states that no longer require action — `submitted`
 * is filed, `approved`/`rejected` are decided, `cancelled` is dropped.
 * Open = upcoming/in_progress/overdue. See regulatory-filings.schema.
 */
const CLOSED_FILING_STATES = [
  'submitted',
  'approved',
  'rejected',
  'cancelled',
];

/** Marketplace-bid status that counts as a live, in-play bid. */
const ACTIVE_BID_STATUS = 'pending';

/** Estate-entity status that counts toward the live holding count. */
const ACTIVE_ESTATE_ENTITY_STATUS = 'active';

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
/**
 * Per-fact relevance keywords (matched lowercase against the user message).
 * A fact whose topic appears in the message floats above the always-on
 * production core so estate-wide questions (royalty / treasury / workforce /
 * compliance / bids / holdings / assets) surface their fact within the cap.
 * Facts absent from this map keep the neutral baseline score.
 */
const FACT_RELEVANCE_KEYWORDS: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    'grounding-outstanding-royalty': ['royalty', 'royalties', 'mrate', 'levy'],
    'grounding-treasury-balance': [
      'treasury',
      'wallet',
      'balance',
      'cash',
      'liquidity',
      'account',
      'funds',
    ],
    'grounding-workforce-headcount': [
      'workforce',
      'headcount',
      'employee',
      'staff',
      'worker',
      'crew',
      'payroll',
    ],
    'grounding-open-compliance': [
      'compliance',
      'filing',
      'regulator',
      'inspection',
      'permit',
      'audit',
      'overdue',
    ],
    'grounding-active-bids': [
      'bid',
      'offer',
      'marketplace',
      'buyer',
      'negotiation',
      'sale',
      'sell',
    ],
    'grounding-holding-companies': [
      'holding',
      'subsidiary',
      'entity',
      'group',
      'estate',
      'family office',
    ],
    'grounding-asset-register': [
      'asset',
      'register',
      'equipment',
      'valuation',
      'inventory',
    ],
  };

/**
 * Order facts so message-relevant ones precede the neutral baseline, keeping
 * a stable ordering within each band. Pure, immutable — never mutates input.
 */
function selectRelevantFacts(
  facts: ReadonlyArray<GroundingFactShape>,
  userMessage: string,
  cap: number,
): ReadonlyArray<GroundingFactShape> {
  const haystack = (userMessage ?? '').toLowerCase();
  const scored = facts.map((fact, index) => {
    const keywords = FACT_RELEVANCE_KEYWORDS[fact.id] ?? [];
    const relevant = keywords.some((kw) => haystack.includes(kw));
    return { fact, index, score: relevant ? 1 : 0 };
  });
  const ordered = [...scored].sort(
    (a, b) => b.score - a.score || a.index - b.index,
  );
  return ordered.slice(0, cap).map((entry) => entry.fact);
}

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

  const outstandingRoyalty = (): Promise<GroundingFactShape | null> =>
    safeFact('outstanding_royalty', async () => {
      const [row] = await db
        .select({
          tzs: sql<string>`coalesce(sum(${settlements.royaltyTzs}), 0)`,
        })
        .from(settlements)
        .where(
          and(
            eq(settlements.tenantId, tenantId),
            notInArray(settlements.status, SETTLED_ROYALTY_STATES),
          ),
        );
      return {
        id: 'grounding-outstanding-royalty',
        label: 'Outstanding royalty balance',
        value: Math.round(Number(row?.tzs ?? 0)),
        unit: 'currency-tzs',
        source: 'settlements',
        asOf,
      };
    });

  const treasuryBalance = (): Promise<GroundingFactShape | null> =>
    safeFact('treasury_balance', async () => {
      const [row] = await db
        .select({
          tzs: sql<string>`coalesce(sum(${accounts.balanceMinorUnits}), 0)`,
        })
        .from(accounts)
        .where(
          and(
            eq(accounts.tenantId, tenantId),
            eq(accounts.status, ACTIVE_ACCOUNT_STATUS),
          ),
        );
      return {
        id: 'grounding-treasury-balance',
        label: 'Treasury balance (active ledger accounts)',
        value: Math.round(Number(row?.tzs ?? 0)),
        unit: 'currency-tzs',
        source: 'accounts',
        asOf,
      };
    });

  const workforceHeadcount = (): Promise<GroundingFactShape | null> =>
    safeFact('workforce_headcount', async () => {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(employees)
        .where(
          and(
            eq(employees.tenantId, tenantId),
            eq(employees.status, ACTIVE_EMPLOYEE_STATUS),
          ),
        );
      return {
        id: 'grounding-workforce-headcount',
        label: 'Active workforce headcount',
        value: Number(row?.n ?? 0),
        unit: 'count',
        source: 'employees',
        asOf,
      };
    });

  const openComplianceFilings = (): Promise<GroundingFactShape | null> =>
    safeFact('open_compliance_filings', async () => {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(regulatoryFilings)
        .where(
          and(
            eq(regulatoryFilings.tenantId, tenantId),
            notInArray(regulatoryFilings.status, CLOSED_FILING_STATES),
          ),
        );
      return {
        id: 'grounding-open-compliance',
        label: 'Open compliance filings',
        value: Number(row?.n ?? 0),
        unit: 'count',
        source: 'regulatory_filings',
        asOf,
      };
    });

  const activeMarketplaceBids = (): Promise<GroundingFactShape | null> =>
    safeFact('active_marketplace_bids', async () => {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(marketplaceBids)
        .where(
          and(
            eq(marketplaceBids.tenantId, tenantId),
            eq(marketplaceBids.status, ACTIVE_BID_STATUS),
          ),
        );
      return {
        id: 'grounding-active-bids',
        label: 'Active marketplace bids',
        value: Number(row?.n ?? 0),
        unit: 'count',
        source: 'marketplace_bids',
        asOf,
      };
    });

  const holdingCompanyCount = (): Promise<GroundingFactShape | null> =>
    safeFact('holding_company_count', async () => {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(estateEntities)
        .where(
          and(
            eq(estateEntities.tenantId, tenantId),
            eq(estateEntities.status, ACTIVE_ESTATE_ENTITY_STATUS),
          ),
        );
      return {
        id: 'grounding-holding-companies',
        label: 'Holding companies (active estate entities)',
        value: Number(row?.n ?? 0),
        unit: 'count',
        source: 'estate_entities',
        asOf,
      };
    });

  const assetRegisterCount = (): Promise<GroundingFactShape | null> =>
    safeFact('asset_register_count', async () => {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(estateAssets)
        .where(eq(estateAssets.tenantId, tenantId));
      return {
        id: 'grounding-asset-register',
        label: 'Asset-register items',
        value: Number(row?.n ?? 0),
        unit: 'count',
        source: 'estate_assets',
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
    outstandingRoyalty,
    treasuryBalance,
    workforceHeadcount,
    openComplianceFilings,
    activeMarketplaceBids,
    holdingCompanyCount,
    assetRegisterCount,
  ];
}

export function createKernelGroundingProvider(
  db: DatabaseClient,
  deps: KernelGroundingDeps,
): GroundingFactsProviderShape {
  return {
    async fetch({
      userMessage,
      limit,
    }): Promise<ReadonlyArray<GroundingFactShape>> {
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

      // Float message-relevant estate-wide facts above the production core
      // so they reach the prompt within the cap; never mutates `facts`.
      return selectRelevantFacts(facts, userMessage, cap);
    },
  };
}
