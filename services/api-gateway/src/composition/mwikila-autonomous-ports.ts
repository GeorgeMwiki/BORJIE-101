/**
 * Mr. Mwikila autonomous handler — real domain ports.
 *
 * Replaces the safe-empty port surface in
 * `mwikila-autonomous-wiring.ts` with real Drizzle-backed queries
 * against the canonical Borjie tables. The runtime ALREADY enforces
 * the kill-switch fail-closed / four-eye / envelope / family-relation
 * guards before any inbox row is written; these ports only supply the
 * data the per-handler `propose()` functions need to decide whether
 * to propose at all.
 *
 * Per-tenant tenant_id scoping is supplied by the caller (handler
 * propose() carries `tenantId`); we add the predicate to every WHERE
 * clause so RLS-FORCE remains a defence-in-depth check rather than
 * the only guard.
 *
 * All queries are read-only + idempotent. Each port catches its own
 * errors and returns the safe-degrade value (empty list / null /
 * `true` for "already-exists" probes) so a single failing query
 * cannot crash the worker tick.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { LicenseRow } from '../services/mwikila-autonomy/index.js';
import type {
  PayrollWorkerRow,
  WorkforceMember,
  SiteCapacity,
  OpenOfferRow,
  SellerTargets,
} from '../services/mwikila-autonomy/index.js';

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface ExecRow {
  readonly [key: string]: unknown;
}

function rowsOf(result: unknown): ReadonlyArray<ExecRow> {
  if (Array.isArray(result)) return result as ReadonlyArray<ExecRow>;
  const wrapped = result as { rows?: ReadonlyArray<ExecRow> };
  return wrapped?.rows ?? [];
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// ─── LICENSE-RENEWAL PORTS ────────────────────────────────────────────

/**
 * Scan `licences` for any active row whose expiry_date is within
 * `max(windowDays)` of now. The handler picks the most urgent and
 * checks whether a reminder for that window already fired.
 */
export function buildLicenseRenewalPorts(db: DbLike, logger: Logger) {
  return Object.freeze({
    async listExpiringLicenses(args: {
      readonly tenantId: string;
      readonly windowDays: ReadonlyArray<number>;
      readonly nowIso: string;
    }): Promise<ReadonlyArray<LicenseRow>> {
      const maxWindow = Math.max(...args.windowDays);
      try {
        const result = await db.execute(sql`
          SELECT id, kind, number, mineral, expiry_date
            FROM licences
           WHERE tenant_id = ${args.tenantId}
             AND status = 'active'
             AND expiry_date IS NOT NULL
             AND expiry_date <= (${args.nowIso}::timestamptz + (${maxWindow} || ' days')::interval)::date
             AND expiry_date >= ${args.nowIso}::date
           ORDER BY expiry_date ASC
           LIMIT 50
        `);
        const out: LicenseRow[] = [];
        for (const r of rowsOf(result)) {
          const id = toStr(r.id);
          const expiry = r.expiry_date;
          if (!id || !expiry) continue;
          out.push(
            Object.freeze({
              id,
              licenseKind: toStr(r.kind),
              licenseRef: toStr(r.number),
              issuingAuthority: 'mining_commission',
              expiresAt:
                expiry instanceof Date
                  ? expiry.toISOString()
                  : toStr(expiry),
            }),
          );
        }
        return Object.freeze(out);
      } catch (err) {
        logger.warn(
          {
            port: 'license-renewal.listExpiringLicenses',
            err: err instanceof Error ? err.message : String(err),
          },
          'mwikila-port: listExpiringLicenses failed; returning []',
        );
        return Object.freeze([]);
      }
    },
    async reminderAlreadyFired(args: {
      readonly tenantId: string;
      readonly licenseId: string;
      readonly windowDay: number;
    }): Promise<boolean> {
      try {
        const result = await db.execute(sql`
          SELECT 1
            FROM mwikila_actions_inbox
           WHERE tenant_id = ${args.tenantId}
             AND action_kind = 'license.renewal_reminder'
             AND payload->>'licenseId' = ${args.licenseId}
             AND (payload->>'windowDay')::int = ${args.windowDay}
           LIMIT 1
        `);
        return rowsOf(result).length > 0;
      } catch (err) {
        // Fail-closed: assume already fired so the worker does NOT spam.
        logger.warn(
          {
            port: 'license-renewal.reminderAlreadyFired',
            err: err instanceof Error ? err.message : String(err),
          },
          'mwikila-port: reminderAlreadyFired failed; treating as fired',
        );
        return true;
      }
    },
  });
}

// ─── SHIFT-SCHEDULER PORTS ────────────────────────────────────────────

/**
 * Build availability bitmask from an employee's attributes jsonb (if
 * present) or fall back to all-7-days when absent. Mining shifts are
 * 7-days unless the employee explicitly opts out of weekends, so the
 * default is conservative.
 */
function readAvailabilityDays(attrs: unknown): ReadonlyArray<number> {
  if (attrs && typeof attrs === 'object' && 'availability_days' in attrs) {
    const raw = (attrs as { availability_days?: unknown }).availability_days;
    if (Array.isArray(raw)) {
      const out: number[] = [];
      for (const d of raw) {
        const n = Number(d);
        if (Number.isInteger(n) && n >= 0 && n <= 6) out.push(n);
      }
      if (out.length > 0) return Object.freeze(out);
    }
  }
  return Object.freeze([0, 1, 2, 3, 4, 5, 6]);
}

export function buildShiftSchedulerPorts(db: DbLike, logger: Logger) {
  return Object.freeze({
    async listActiveWorkforce(args: {
      readonly tenantId: string;
    }): Promise<ReadonlyArray<WorkforceMember>> {
      try {
        const result = await db.execute(sql`
          SELECT id, full_name, attributes
            FROM employees
           WHERE tenant_id = ${args.tenantId}
             AND status = 'active'
           ORDER BY full_name ASC
           LIMIT 500
        `);
        const out: WorkforceMember[] = [];
        for (const r of rowsOf(result)) {
          const id = toStr(r.id);
          if (!id) continue;
          out.push(
            Object.freeze({
              id,
              fullName: toStr(r.full_name),
              availabilityDays: readAvailabilityDays(r.attributes),
            }),
          );
        }
        return Object.freeze(out);
      } catch (err) {
        logger.warn(
          {
            port: 'shift-scheduler.listActiveWorkforce',
            err: err instanceof Error ? err.message : String(err),
          },
          'mwikila-port: listActiveWorkforce failed; returning []',
        );
        return Object.freeze([]);
      }
    },
    async listSiteCapacity(args: {
      readonly tenantId: string;
    }): Promise<ReadonlyArray<SiteCapacity>> {
      try {
        const result = await db.execute(sql`
          SELECT s.id, s.name, s.attributes
            FROM sites s
           WHERE s.tenant_id = ${args.tenantId}
             AND s.status = 'active'
           ORDER BY s.name ASC
           LIMIT 100
        `);
        const out: SiteCapacity[] = [];
        for (const r of rowsOf(result)) {
          const siteId = toStr(r.id);
          if (!siteId) continue;
          const attrs = r.attributes as Record<string, unknown> | null;
          const minCap = Math.max(
            1,
            Math.floor(toNum(attrs?.['min_workers_per_shift']) || 2),
          );
          const maxCap = Math.max(
            minCap,
            Math.floor(toNum(attrs?.['max_workers_per_shift']) || 8),
          );
          out.push(
            Object.freeze({
              siteId,
              siteName: toStr(r.name),
              minWorkersPerShift: minCap,
              maxWorkersPerShift: maxCap,
            }),
          );
        }
        return Object.freeze(out);
      } catch (err) {
        logger.warn(
          {
            port: 'shift-scheduler.listSiteCapacity',
            err: err instanceof Error ? err.message : String(err),
          },
          'mwikila-port: listSiteCapacity failed; returning []',
        );
        return Object.freeze([]);
      }
    },
    async hasOverlappingSchedule(args: {
      readonly tenantId: string;
      readonly fromIso: string;
      readonly toIso: string;
    }): Promise<boolean> {
      try {
        const result = await db.execute(sql`
          SELECT 1
            FROM attendance
           WHERE tenant_id = ${args.tenantId}
             AND work_date >= ${args.fromIso}::date
             AND work_date <= ${args.toIso}::date
           LIMIT 1
        `);
        return rowsOf(result).length > 0;
      } catch (err) {
        // Fail-closed: skip when we cannot prove the window is empty.
        logger.warn(
          {
            port: 'shift-scheduler.hasOverlappingSchedule',
            err: err instanceof Error ? err.message : String(err),
          },
          'mwikila-port: hasOverlappingSchedule failed; treating as overlapping',
        );
        return true;
      }
    },
  });
}

// ─── ROYALTY-FILING PORTS ─────────────────────────────────────────────

interface RoyaltyTotals {
  readonly grossSalesTzs: number;
  readonly productionTonnes: number;
  readonly mineralKind: string;
  readonly regionCode: string;
  readonly regionRoyaltyRatePct: number;
}

export function buildRoyaltyFilingPorts(db: DbLike, logger: Logger) {
  return Object.freeze({
    async hasExistingDraft(args: {
      readonly tenantId: string;
      readonly periodStartIso: string;
    }): Promise<boolean> {
      try {
        const periodMonth = args.periodStartIso.slice(0, 7);
        const result = await db.execute(sql`
          SELECT 1
            FROM regulatory_filings
           WHERE tenant_id = ${args.tenantId}
             AND regulator IN ('mining_commission', 'tra')
             AND filing_type LIKE 'royalty%'
             AND to_char(due_at, 'YYYY-MM') = ${periodMonth}
             AND status NOT IN ('cancelled', 'rejected')
           LIMIT 1
        `);
        if (rowsOf(result).length > 0) return true;
        // Also dedupe against a prior mwikila proposal for the same period.
        const proposed = await db.execute(sql`
          SELECT 1
            FROM mwikila_actions_inbox
           WHERE tenant_id = ${args.tenantId}
             AND action_kind = 'royalty.monthly_filing_prep'
             AND payload->>'periodStartIso' = ${args.periodStartIso}
           LIMIT 1
        `);
        return rowsOf(proposed).length > 0;
      } catch (err) {
        logger.warn(
          {
            port: 'royalty-filing.hasExistingDraft',
            err: err instanceof Error ? err.message : String(err),
          },
          'mwikila-port: hasExistingDraft failed; treating as existing',
        );
        return true;
      }
    },
    async monthlyTotals(args: {
      readonly tenantId: string;
      readonly periodStartIso: string;
      readonly periodEndIso: string;
    }): Promise<RoyaltyTotals | null> {
      try {
        // Aggregate sales by site→primary mineral. Pick the largest
        // mineral by gross to drive the filing (the regulator files by
        // mineral kind, not blended). Sites carry the mineral; sales
        // link to parcels which link to sites.
        const result = await db.execute(sql`
          WITH parcel_mineral AS (
            SELECT p.id AS parcel_id, s.mineral
              FROM ore_parcels p
              JOIN sites s ON s.id = p.site_id AND s.tenant_id = p.tenant_id
             WHERE p.tenant_id = ${args.tenantId}
          )
          SELECT pm.mineral,
                 COALESCE(SUM(COALESCE(sa.gross_price_tzs, 0)), 0)::numeric AS gross_tzs,
                 COALESCE(SUM(COALESCE(p.saleable_tonnes, p.tonnes_estimate, 0)), 0)::numeric AS tonnes
            FROM sales sa
            JOIN ore_parcels p ON p.id = sa.parcel_id
            JOIN parcel_mineral pm ON pm.parcel_id = sa.parcel_id
           WHERE sa.tenant_id = ${args.tenantId}
             AND sa.ts >= ${args.periodStartIso}::timestamptz
             AND sa.ts <= ${args.periodEndIso}::timestamptz
           GROUP BY pm.mineral
           ORDER BY gross_tzs DESC
           LIMIT 1
        `);
        const rows = rowsOf(result);
        if (rows.length === 0) return null;
        const r = rows[0]!;
        const mineral = toStr(r.mineral) || 'Au';
        const gross = toNum(r.gross_tzs);
        const tonnes = toNum(r.tonnes);
        if (gross <= 0) return null;
        // Region + royalty rate: pull the active licence covering the
        // tenant's primary mineral. Fees jsonb holds royalty_rate_pct.
        const rateRow = await db.execute(sql`
          SELECT fees, attributes
            FROM licences
           WHERE tenant_id = ${args.tenantId}
             AND mineral = ${mineral}
             AND status = 'active'
           ORDER BY grant_date DESC NULLS LAST
           LIMIT 1
        `);
        const fees =
          (rowsOf(rateRow)[0]?.fees as
            | { royalty_rate_pct?: number | string }
            | null) ?? null;
        const ratePct = toNum(fees?.royalty_rate_pct ?? 6); // TZ Au default
        return Object.freeze({
          grossSalesTzs: gross,
          productionTonnes: tonnes,
          mineralKind: mineral,
          regionCode: 'TZ',
          regionRoyaltyRatePct: ratePct,
        });
      } catch (err) {
        logger.warn(
          {
            port: 'royalty-filing.monthlyTotals',
            err: err instanceof Error ? err.message : String(err),
          },
          'mwikila-port: monthlyTotals failed; returning null',
        );
        return null;
      }
    },
  });
}

// ─── PAYROLL PORTS ────────────────────────────────────────────────────

export function buildPayrollPorts(db: DbLike, logger: Logger) {
  return Object.freeze({
    async hasExistingBatch(args: {
      readonly tenantId: string;
      readonly periodStartIso: string;
    }): Promise<boolean> {
      try {
        const periodStartDate = args.periodStartIso.slice(0, 10);
        const result = await db.execute(sql`
          SELECT 1
            FROM payroll_runs
           WHERE tenant_id = ${args.tenantId}
             AND period_start = ${periodStartDate}::date
             AND status IN ('draft', 'previewed', 'committed', 'paid')
           LIMIT 1
        `);
        if (rowsOf(result).length > 0) return true;
        const proposed = await db.execute(sql`
          SELECT 1
            FROM mwikila_actions_inbox
           WHERE tenant_id = ${args.tenantId}
             AND action_kind = 'payroll.monthly_batch_prep'
             AND payload->>'periodStartIso' = ${args.periodStartIso}
           LIMIT 1
        `);
        return rowsOf(proposed).length > 0;
      } catch (err) {
        logger.warn(
          {
            port: 'payroll.hasExistingBatch',
            err: err instanceof Error ? err.message : String(err),
          },
          'mwikila-port: hasExistingBatch failed; treating as existing',
        );
        return true;
      }
    },
    async monthlyPayrollRoll(args: {
      readonly tenantId: string;
      readonly periodStartIso: string;
      readonly periodEndIso: string;
    }): Promise<ReadonlyArray<PayrollWorkerRow>> {
      try {
        const result = await db.execute(sql`
          SELECT e.id            AS employee_id,
                 e.full_name,
                 e.wage_rate_tzs,
                 e.wage_basis,
                 COALESCE(SUM(COALESCE(a.hours_worked, 0)), 0)::numeric AS hours
            FROM employees e
       LEFT JOIN attendance a
              ON a.employee_id = e.id
             AND a.tenant_id   = e.tenant_id
             AND a.work_date  >= ${args.periodStartIso}::date
             AND a.work_date  <= ${args.periodEndIso}::date
             AND a.status      = 'present'
           WHERE e.tenant_id = ${args.tenantId}
             AND e.status    = 'active'
        GROUP BY e.id, e.full_name, e.wage_rate_tzs, e.wage_basis
          HAVING COALESCE(SUM(COALESCE(a.hours_worked, 0)), 0) > 0
        `);
        const out: PayrollWorkerRow[] = [];
        for (const r of rowsOf(result)) {
          const userId = toStr(r.employee_id);
          if (!userId) continue;
          const wageRate = toNum(r.wage_rate_tzs);
          const wageBasis = toStr(r.wage_basis);
          // Monthly basis: wage_rate IS the monthly base. Daily basis:
          // base = wage_rate × workdays-in-month (≈ 22). Overtime
          // hourly rate defaults to base ÷ 176 × 1.5 (TZ labour code).
          const baseMonthly =
            wageBasis === 'monthly' ? wageRate : wageRate * 22;
          const hourlyOt = (baseMonthly / 176) * 1.5;
          out.push(
            Object.freeze({
              userId,
              fullName: toStr(r.full_name),
              baseMonthlyTzs: Math.round(baseMonthly),
              hourlyOvertimeTzs: Math.round(hourlyOt),
              standardMonthlyHours: 176,
              hoursWorked: toNum(r.hours),
            }),
          );
        }
        return Object.freeze(out);
      } catch (err) {
        logger.warn(
          {
            port: 'payroll.monthlyPayrollRoll',
            err: err instanceof Error ? err.message : String(err),
          },
          'mwikila-port: monthlyPayrollRoll failed; returning []',
        );
        return Object.freeze([]);
      }
    },
  });
}

// ─── MARKETPLACE-COUNTER PORTS ────────────────────────────────────────

export function buildMarketplaceCounterPorts(db: DbLike, logger: Logger) {
  return Object.freeze({
    async listOpenBuyerOffers(args: {
      readonly tenantId: string;
    }): Promise<ReadonlyArray<OpenOfferRow>> {
      try {
        const result = await db.execute(sql`
          SELECT mb.id              AS offer_id,
                 ml.title            AS title,
                 ml.attributes       AS listing_attrs,
                 mb.bid_price_tzs    AS bid_price,
                 b.legal_name        AS buyer_name,
                 b.tenant_id         AS buyer_tenant
            FROM marketplace_bids mb
            JOIN marketplace_listings ml ON ml.id = mb.listing_id
       LEFT JOIN buyers b              ON b.id  = mb.buyer_id
           WHERE mb.tenant_id = ${args.tenantId}
             AND mb.status    = 'pending'
           ORDER BY mb.created_at ASC
           LIMIT 25
        `);
        const out: OpenOfferRow[] = [];
        for (const r of rowsOf(result)) {
          const offerId = toStr(r.offer_id);
          if (!offerId) continue;
          const attrs = r.listing_attrs as Record<string, unknown> | null;
          const mineral = toStr(attrs?.['mineral']) || 'Au';
          const tonnes = toNum(attrs?.['tonnes']) || 1;
          out.push(
            Object.freeze({
              offerId,
              mineralKind: mineral,
              tonnesRemaining: tonnes,
              buyerPriceTzs: toNum(r.bid_price),
              buyerName: toStr(r.buyer_name) || 'Unknown buyer',
              counterpartyTenantId: toStr(r.buyer_tenant),
            }),
          );
        }
        return Object.freeze(out);
      } catch (err) {
        logger.warn(
          {
            port: 'marketplace-counter.listOpenBuyerOffers',
            err: err instanceof Error ? err.message : String(err),
          },
          'mwikila-port: listOpenBuyerOffers failed; returning []',
        );
        return Object.freeze([]);
      }
    },
    async getSellerTargets(args: {
      readonly tenantId: string;
    }): Promise<SellerTargets | null> {
      try {
        // Pull seller floor prices + uplift from active marketplace
        // listings. floor = listing.price_tzs (per unit), uplift = 5%.
        const result = await db.execute(sql`
          SELECT ml.attributes->>'mineral' AS mineral,
                 MIN(ml.price_tzs)         AS floor_tzs
            FROM marketplace_listings ml
           WHERE ml.tenant_id = ${args.tenantId}
             AND ml.status    = 'active'
             AND ml.price_tzs IS NOT NULL
             AND ml.attributes ? 'mineral'
           GROUP BY ml.attributes->>'mineral'
        `);
        const targetFloorByMineral: Record<string, number> = {};
        for (const r of rowsOf(result)) {
          const mineral = toStr(r.mineral);
          const floor = toNum(r.floor_tzs);
          if (mineral && floor > 0) targetFloorByMineral[mineral] = floor;
        }
        if (Object.keys(targetFloorByMineral).length === 0) return null;
        return Object.freeze({
          tenantId: args.tenantId,
          targetFloorByMineral: Object.freeze(targetFloorByMineral),
          targetUpliftPct: 0.05,
        });
      } catch (err) {
        logger.warn(
          {
            port: 'marketplace-counter.getSellerTargets',
            err: err instanceof Error ? err.message : String(err),
          },
          'mwikila-port: getSellerTargets failed; returning null',
        );
        return null;
      }
    },
    async hasAlreadyCountered(args: {
      readonly tenantId: string;
      readonly offerId: string;
    }): Promise<boolean> {
      try {
        // The handler writes a 'marketplace.counter_offer' inbox row
        // on each counter — that row is the source of truth for
        // dedup so we do not double-counter the same buyer offer.
        const result = await db.execute(sql`
          SELECT 1
            FROM mwikila_actions_inbox
           WHERE tenant_id = ${args.tenantId}
             AND action_kind = 'marketplace.counter_offer'
             AND payload->>'offerId' = ${args.offerId}
           LIMIT 1
        `);
        if (rowsOf(result).length > 0) return true;
        // Also dedup against a real counter recorded on the bid row.
        const bid = await db.execute(sql`
          SELECT 1
            FROM marketplace_bids
           WHERE tenant_id = ${args.tenantId}
             AND id = ${args.offerId}
             AND status = 'countered'
           LIMIT 1
        `);
        return rowsOf(bid).length > 0;
      } catch (err) {
        logger.warn(
          {
            port: 'marketplace-counter.hasAlreadyCountered',
            err: err instanceof Error ? err.message : String(err),
          },
          'mwikila-port: hasAlreadyCountered failed; treating as countered',
        );
        return true;
      }
    },
  });
}
