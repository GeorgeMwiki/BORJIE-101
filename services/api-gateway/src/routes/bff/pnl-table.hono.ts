/**
 * /api/v1/owner/finance/pnl — R-FUTURE-3 PnlTable BFF wire.
 *
 * Composes a monthly P&L envelope the owner-web `<PnlTable />` consumes
 * directly. Reads from the live tables (`sales` for revenue, `costs`
 * for cogs/opex/other) and groups deterministically. RLS handles
 * tenant-scoping via the `app.current_tenant_id` GUC bound in
 * `databaseMiddleware`.
 *
 * Wire shape:
 *   GET /api/v1/owner/finance/pnl?month=YYYY-MM
 *     → { success: true, data: { rows: PnlRow[], periodStart, periodEnd } }
 *
 * Empty tenants (no sales / no costs yet) get an honest-empty envelope
 * — `rows: []` — rather than a 404. The component already renders that
 * shape as the four empty group headers.
 *
 * Mapping (`costs.category` → PnL group):
 *   - revenue (synthetic from `sales.netTzs`)
 *   - cogs   ← royalty, inspection, levy, processing, transport
 *   - opex   ← wages, fuel, food, water, equipment, repairs, security, admin
 *   - other  ← land, debt, advance, other
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from 'drizzle-orm';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';
import { e403 } from '../../utils/error-response';

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (exported for unit tests)
// ─────────────────────────────────────────────────────────────────────

export const PNL_GROUP = ['revenue', 'cogs', 'opex', 'other'] as const;
export type PnlGroup = (typeof PNL_GROUP)[number];

export interface PnlRow {
  readonly label: string;
  readonly tzsM: number;
  readonly group: PnlGroup;
}

const COGS_CATEGORIES = new Set([
  'royalty',
  'inspection',
  'levy',
  'processing',
  'transport',
]);

const OPEX_CATEGORIES = new Set([
  'wages',
  'fuel',
  'food',
  'water',
  'equipment',
  'repairs',
  'security',
  'admin',
]);

/** Bucket a `costs.category` value into a P&L group. */
export function bucketCategory(category: string): PnlGroup {
  if (COGS_CATEGORIES.has(category)) return 'cogs';
  if (OPEX_CATEGORIES.has(category)) return 'opex';
  return 'other';
}

/**
 * Convert raw TZS to millions, rounded to 1 decimal. Costs always
 * render as a NEGATIVE so the component subtotal arithmetic stays
 * additive (`sum(rows) === EBITDA`).
 */
export function toTzsM(amountTzs: number, isCost: boolean): number {
  const millions = amountTzs / 1_000_000;
  const rounded = Math.round(millions * 10) / 10;
  return isCost ? -rounded : rounded;
}

/**
 * Build the canonical month boundaries — first instant of month and
 * first instant of next month. Inputs are validated `YYYY-MM`.
 */
export function monthBounds(yyyymm: string): {
  readonly periodStart: Date;
  readonly periodEnd: Date;
} {
  const [yearStr, monthStr] = yyyymm.split('-');
  const year = Number.parseInt(yearStr ?? '', 10);
  const month = Number.parseInt(monthStr ?? '', 10);
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1));
  return { periodStart, periodEnd };
}

interface RawSaleRow {
  readonly net_tzs: string | null;
}

interface RawCostRow {
  readonly category: string;
  readonly amount_tzs: string;
}

/**
 * Compose the row envelope from raw query results. Pure — no IO. The
 * unit test suite calls this directly with mock rows.
 */
export function composePnlRows(
  sales: ReadonlyArray<RawSaleRow>,
  costs: ReadonlyArray<RawCostRow>,
): PnlRow[] {
  const revenueTzs = sales.reduce((sum, r) => {
    const n = Number.parseFloat(r.net_tzs ?? '0');
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);

  const costByCategory = new Map<string, number>();
  for (const c of costs) {
    const amount = Number.parseFloat(c.amount_tzs);
    if (!Number.isFinite(amount)) continue;
    costByCategory.set(
      c.category,
      (costByCategory.get(c.category) ?? 0) + amount,
    );
  }

  const rows: PnlRow[] = [];
  if (revenueTzs > 0) {
    rows.push({ label: 'Mineral sales', tzsM: toTzsM(revenueTzs, false), group: 'revenue' });
  }
  for (const [category, amount] of costByCategory.entries()) {
    rows.push({
      label: humaniseCategory(category),
      tzsM: toTzsM(amount, true),
      group: bucketCategory(category),
    });
  }
  return rows;
}

function humaniseCategory(category: string): string {
  // costs.category is a snake-case enum-ish — capitalise the first
  // letter so it lands well in the PnlTable left column.
  return category.charAt(0).toUpperCase() + category.slice(1);
}

// ─────────────────────────────────────────────────────────────────────
// Hono router
// ─────────────────────────────────────────────────────────────────────

const QuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
});

export const pnlTableRouter = new Hono();
pnlTableRouter.use('*', authMiddleware);
pnlTableRouter.use('*', databaseMiddleware);

pnlTableRouter.get(
  '/pnl',
  zValidator('query', QuerySchema),
  async (c) => {
    const auth = c.get('auth');
    if (
      !(
        [
          UserRole.OWNER,
          UserRole.TENANT_ADMIN,
          UserRole.ADMIN,
          UserRole.SUPER_ADMIN,
        ] as UserRole[]
      ).includes(auth.role)
    ) {
      return e403(c, 'FORBIDDEN', 'Finance P&L access denied for this role.');
    }

    const { month } = c.req.valid('query');
    const { periodStart, periodEnd } = monthBounds(month);
    const db = c.get('db') as {
      execute: (q: ReturnType<typeof sql>) => Promise<{
        rows: ReadonlyArray<Record<string, unknown>>;
      }>;
    };

    // RLS handles tenant filtering; we still filter by date.
    const [salesResult, costsResult] = await Promise.all([
      db.execute(sql`
        SELECT COALESCE(SUM(CAST(net_tzs AS NUMERIC)), 0)::text AS net_tzs
        FROM sales
        WHERE ts >= ${periodStart.toISOString()}
          AND ts < ${periodEnd.toISOString()}
          AND payment_status IN ('settled', 'received', 'pending')
      `),
      db.execute(sql`
        SELECT category,
               COALESCE(SUM(amount_tzs), 0)::text AS amount_tzs
        FROM costs
        WHERE ts >= ${periodStart.toISOString()}
          AND ts < ${periodEnd.toISOString()}
          AND state IN ('actual', 'committed')
        GROUP BY category
      `),
    ]);

    const salesRows = (salesResult.rows ?? []) as unknown as ReadonlyArray<RawSaleRow>;
    const costRows = (costsResult.rows ?? []) as unknown as ReadonlyArray<RawCostRow>;
    const rows = composePnlRows(salesRows, costRows);

    return c.json({
      success: true,
      data: {
        rows,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        month,
      },
    });
  },
);
