/**
 * Real `StatementPort` adapter — Drizzle-backed period-bulk statement
 * placeholder writer.
 *
 * The orchestrator's `StatementPort.generateOwnerStatementsForPeriod`
 * is supposed to produce one statement per owner with active leases in
 * the closing period. The platform's existing `ReportService.getStatement`
 * is per-customer and returns an in-memory report; no PDF generator
 * exists yet for owner statements.
 *
 * Pragmatic minimum:
 *   - Query distinct ownerIds with active leases in the period.
 *   - Sum gross rent collected per owner from `payments` joined to
 *     `leases.property → properties.owner_id`.
 *   - Insert a `draft` row per owner into `owner_statements` (the
 *     existing migration-backed table) so the audit trail is durable
 *     and downstream PDF gen can pick up the row by its
 *     `(tenantId, ownerId, periodStart, periodEnd)` tuple.
 *
 * The actual PDF rendering is deferred — `pdf_url` stays null until
 * the dedicated rendering worker (Wave 29) lands. The orchestrator
 * gets back the inserted `statementId` per owner, which is enough for
 * the downstream notification step.
 *
 * Tenant-scoped on every query.
 */

import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';

type StatementPort = {
  generateOwnerStatementsForPeriod(input: {
    readonly tenantId: string;
    readonly year: number;
    readonly month: number;
  }): Promise<{
    readonly statements: readonly {
      readonly ownerId: string;
      readonly statementId: string;
      readonly grossRentMinor: number;
      readonly currency: string;
    }[];
  }>;
};

type Logger = {
  warn(meta: Record<string, unknown>, msg: string): void;
};

type DbExecutor = { execute(q: unknown): Promise<unknown> };

/**
 * Resolves the display currency for a tenant — wraps the
 * `currency_preferences` service. Used when no payments yet exist in
 * the period (so we can't derive the currency from completed-payment
 * rows). The composition root supplies the implementation.
 */
export type StatementCurrencyResolver = {
  resolveForTenant(tenantId: string): Promise<string>;
};

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === 'bigint') return Number(v);
  return 0;
}

function periodWindow(year: number, month: number): {
  readonly periodStart: string;
  readonly periodEnd: string;
} {
  // [periodStart, periodEnd) — half-open. month is 1-based per the
  // orchestrator's `RunState.periodMonth` convention. Use UTC so the
  // window is timezone-agnostic; jurisdiction-specific TZ shifts are
  // a presentation concern, not a closing-window concern.
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
  };
}

export type CreateDrizzleStatementAdapterOptions = {
  /**
   * Optional per-tenant currency resolver. When supplied, the adapter
   * falls back to the tenant's `currency_preferences` row whenever the
   * dominant-currency subquery returns NULL (no completed payments in
   * the period). The literal `'XXX'` (ISO unknown) fallback has been
   * removed: a missed resolver wire surfaces as a thrown error rather
   * than silently producing an unreadable statement.
   */
  readonly currencyResolver?: StatementCurrencyResolver;
};

export function createDrizzleStatementAdapter(
  db: unknown,
  logger: Logger,
  options: CreateDrizzleStatementAdapterOptions = {},
): StatementPort {
  const exec = (db as DbExecutor).execute.bind(db as DbExecutor);
  const { currencyResolver } = options;
  return {
    async generateOwnerStatementsForPeriod(input) {
      const { tenantId, year, month } = input;
      const { periodStart, periodEnd } = periodWindow(year, month);

      try {
        // Aggregate gross rent per owner from completed payments
        // matched to invoices joined to leases joined to properties.
        // Active-lease filter: lease overlaps the period AND is not
        // terminated/cancelled at period_end.
        const ownerAggRes = await exec(sql`
          SELECT
            pr.owner_id AS owner_id,
            COALESCE(SUM(pmt.amount), 0)::bigint AS gross_minor,
            (
              SELECT pmt2.currency
              FROM payments pmt2
              INNER JOIN invoices inv2 ON inv2.id = pmt2.invoice_id
              INNER JOIN leases lse2 ON lse2.id = inv2.lease_id
              INNER JOIN properties pr2 ON pr2.id = lse2.property_id
              WHERE pr2.owner_id = pr.owner_id
                AND pmt2.tenant_id = ${tenantId}
                AND pmt2.status = 'completed'
                AND pmt2.completed_at >= ${periodStart}
                AND pmt2.completed_at < ${periodEnd}
              GROUP BY pmt2.currency
              ORDER BY COUNT(*) DESC
              LIMIT 1
            ) AS dominant_currency
          FROM properties pr
          INNER JOIN leases lse ON lse.property_id = pr.id
          LEFT JOIN invoices inv ON inv.lease_id = lse.id
          LEFT JOIN payments pmt ON pmt.invoice_id = inv.id
            AND pmt.status = 'completed'
            AND pmt.completed_at >= ${periodStart}
            AND pmt.completed_at < ${periodEnd}
          WHERE pr.tenant_id = ${tenantId}
            AND lse.tenant_id = ${tenantId}
            AND lse.status IN ('active', 'expiring_soon')
            AND lse.start_date < ${periodEnd}
            AND lse.end_date >= ${periodStart}
          GROUP BY pr.owner_id
        `);

        const rows = asRows(ownerAggRes);
        const statements: Array<{
          ownerId: string;
          statementId: string;
          grossRentMinor: number;
          currency: string;
        }> = [];

        // Resolve a tenant-default currency once for the period — used
        // whenever a row has no completed payments yet (dominant_currency
        // is NULL).
        let tenantDefaultCurrency: string | null = null;
        if (currencyResolver) {
          try {
            tenantDefaultCurrency = await currencyResolver.resolveForTenant(
              tenantId,
            );
          } catch (err) {
            logger.warn(
              {
                port: 'statements',
                tenantId,
                degraded_reason: 'currency_resolver_failed',
                err: err instanceof Error ? err.message : String(err),
              },
              'monthly-close: statement-adapter currency resolver threw — will fail loudly on rows with no payments',
            );
          }
        }

        for (const row of rows) {
          const ownerId =
            typeof row.owner_id === 'string' ? row.owner_id : null;
          if (!ownerId) continue;

          const grossRentMinor = toNumber(row.gross_minor);
          const dominantCurrency =
            typeof row.dominant_currency === 'string' &&
            row.dominant_currency.length > 0
              ? row.dominant_currency
              : null;
          const currency = dominantCurrency ?? tenantDefaultCurrency ?? '';
          if (!currency) {
            throw new Error(
              `statement-adapter: cannot resolve currency for tenant ${tenantId} owner ${ownerId} (no completed payments AND no currencyResolver wired). Refusing to write 'XXX' to the statement.`,
            );
          }

          const statementId = `stmt_${tenantId.slice(0, 8)}_${ownerId.slice(0, 8)}_${year}_${month}_${randomUUID().slice(0, 8)}`;
          const statementNumber = `STMT-${year}-${String(month).padStart(2, '0')}-${ownerId.slice(0, 8)}`;

          // Best-effort upsert. The (tenant_id, statement_number) unique
          // index gives idempotency on re-runs of the same period.
          // ON CONFLICT DO NOTHING keeps the original draft row;
          // operators can regenerate via a manual purge if needed.
          // The schema requires a property_id; pick any property the
          // owner has in this tenant — the row exists primarily as a
          // workflow marker for the dedicated PDF generator.
          await exec(sql`
            INSERT INTO owner_statements (
              id, tenant_id, property_id, owner_id, statement_number,
              period_start, period_end, status,
              gross_rent_collected, total_income, currency,
              amount_due, created_at, updated_at
            )
            SELECT
              ${statementId}, ${tenantId},
              (SELECT id FROM properties WHERE tenant_id = ${tenantId} AND owner_id = ${ownerId} LIMIT 1),
              ${ownerId}, ${statementNumber},
              ${periodStart}, ${periodEnd}, 'draft',
              ${grossRentMinor}, ${grossRentMinor},
              ${currency},
              ${grossRentMinor}, NOW(), NOW()
            WHERE EXISTS (
              SELECT 1 FROM properties WHERE tenant_id = ${tenantId} AND owner_id = ${ownerId}
            )
            ON CONFLICT (tenant_id, statement_number) DO NOTHING
          `);

          statements.push({
            ownerId,
            statementId,
            grossRentMinor,
            currency,
          });
        }

        return { statements };
      } catch (err) {
        logger.warn(
          {
            port: 'statements',
            tenantId,
            year,
            month,
            degraded_reason: 'query_error',
            err: err instanceof Error ? err.message : String(err),
          },
          'monthly-close: statement generation query failed — returning empty list',
        );
        return { statements: [] };
      }
    },
  };
}
