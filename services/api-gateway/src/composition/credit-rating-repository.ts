/**
 * Postgres-backed CreditRatingRepository.
 *
 * Pulls real invoice, payment, arrears, and tenancy signals for a given
 * (tenantId, customerId) and persists rating snapshots, promise outcomes,
 * per-tenant weights, and cross-landlord sharing opt-ins.
 *
 * Zero mock data: if a query yields no rows, counts return 0 and the
 * service caller downgrades the rating to `insufficient_data` rather
 * than inventing numbers.
 */

import { sql } from 'drizzle-orm';
import {
  creditRatingSnapshots,
  creditRatingPromises,
  creditRatingWeights,
  creditRatingSharingOptIns,
} from '@borjie/database';
import type {
  CreditRating,
  CreditRatingHistoryEntry,
  CreditRatingInputs,
  CreditRatingRepository,
  CreditSharingOptIn,
  GradingWeights,
  PromiseOutcomeRecord,
} from '@borjie/ai-copilot';

/**
 * Opaque Drizzle client type. Declared as `unknown` so this file stays
 * decoupled from the `DatabaseClient` alias in `@borjie/database`,
 * which widens through `export *` chains and trips
 * `TS2709 Cannot use namespace 'DatabaseClient' as a type` when pulled
 * in via the package barrel. All db access goes through the local
 * `execute()` helper which narrows to the `.execute(sql\`\`)` shape at
 * a single structural cast.
 */
type DbClient = unknown;

type SqlTag = ReturnType<typeof sql>;

/**
 * Minimal structural shape of the Drizzle insert builder used by this
 * repo. We only call `.values(...)` on the result — no chaining to
 * `.returning()` / `.onConflict…`, so a one-method surface is enough.
 */
type DrizzleInsertRunner = {
  insert(table: unknown): { values(row: Record<string, unknown>): Promise<unknown> };
};

function asInsertRunner(db: DbClient): DrizzleInsertRunner {
  return db as DrizzleInsertRunner;
}

function execute<T = Record<string, unknown>>(
  db: DbClient,
  stmt: SqlTag,
): Promise<T[]> {
  // drizzle `.execute` returns either an array (postgres.js) or
  // `{ rows: [...] }` (node-postgres). Normalise.
  const runner = db as { execute(q: SqlTag): Promise<unknown> };
  return runner.execute(stmt).then((res: unknown) => {
    if (Array.isArray(res)) return res as T[];
    return ((res as { rows?: T[] })?.rows ?? []) as T[];
  });
}

function nowIsoSafe(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export class PostgresCreditRatingRepository implements CreditRatingRepository {
  constructor(private readonly db: DbClient) {}

  async loadInputs(
    tenantId: string,
    customerId: string,
    asOf: string,
  ): Promise<CreditRatingInputs | null> {
    // Confirm customer exists under this tenant.
    const custRows = await execute(
      this.db,
      sql`SELECT id FROM customers WHERE id = ${customerId} AND tenant_id = ${tenantId} LIMIT 1`,
    );
    if (custRows.length === 0) return null;

    // Payment-history counts — derived from invoices + paid vs late signals.
    //   on-time  : status='paid' AND completed_at <= due_date (via payments join)
    //   late 30  : paid 1-30 days past due_date
    //   late 60  : paid 31-60 days past due_date
    //   late 90+ : paid 61+ days past due_date
    //   default  : status='overdue' OR 'cancelled' with amount_due > 0
    //
    // Schema note: the drizzle `invoices` schema calls the emit column
    // `issue_date` — earlier drafts used `issued_at`. Querying a non-
    // existent column raises SQLSTATE 42703 and the endpoint 500s, so
    // the SQL below references `issue_date` literally.
    const paymentHistoryRows = await execute(
      this.db,
      sql`
        WITH latest_payment AS (
          SELECT
            p.invoice_id,
            MAX(p.completed_at) AS paid_at
          FROM payments p
          WHERE p.tenant_id = ${tenantId}
            AND p.customer_id = ${customerId}
            AND p.status = 'completed'
          GROUP BY p.invoice_id
        )
        SELECT
          COUNT(*) FILTER (WHERE i.status = 'paid' AND lp.paid_at IS NOT NULL AND lp.paid_at <= i.due_date)::int AS on_time,
          COUNT(*) FILTER (WHERE i.status = 'paid' AND lp.paid_at IS NOT NULL AND lp.paid_at >  i.due_date AND lp.paid_at <= i.due_date + INTERVAL '30 days')::int AS late_30,
          COUNT(*) FILTER (WHERE i.status = 'paid' AND lp.paid_at IS NOT NULL AND lp.paid_at >  i.due_date + INTERVAL '30 days' AND lp.paid_at <= i.due_date + INTERVAL '60 days')::int AS late_60,
          COUNT(*) FILTER (WHERE i.status = 'paid' AND lp.paid_at IS NOT NULL AND lp.paid_at >  i.due_date + INTERVAL '60 days')::int AS late_90,
          COUNT(*) FILTER (WHERE i.status IN ('overdue','cancelled'))::int AS defaulted,
          COUNT(*)::int AS total_invoices,
          MAX(i.issue_date) AS newest_invoice_at,
          MIN(i.issue_date) AS oldest_invoice_at
        FROM invoices i
        LEFT JOIN latest_payment lp ON lp.invoice_id = i.id
        WHERE i.tenant_id = ${tenantId}
          AND i.customer_id = ${customerId}
      `,
    );

    const ph = paymentHistoryRows[0] ?? {};
    const paidOnTimeCount = Number(ph.on_time ?? 0);
    const paidLate30DaysCount = Number(ph.late_30 ?? 0);
    const paidLate60DaysCount = Number(ph.late_60 ?? 0);
    const paidLate90PlusCount = Number(ph.late_90 ?? 0);
    const defaultCount = Number(ph.defaulted ?? 0);
    const totalInvoices = Number(ph.total_invoices ?? 0);
    const newestInvoiceAt = nowIsoSafe(ph.newest_invoice_at);
    const oldestInvoiceAt = nowIsoSafe(ph.oldest_invoice_at);

    // Promise keeping — honored vs total by kind.
    const promiseRows = await execute(
      this.db,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE kind = 'extension')::int AS extensions_granted,
          COUNT(*) FILTER (WHERE kind = 'extension' AND actual_outcome = 'on_time')::int AS extensions_honored,
          COUNT(*) FILTER (WHERE kind = 'installment')::int AS installments_offered,
          COUNT(*) FILTER (WHERE kind = 'installment' AND actual_outcome = 'on_time')::int AS installments_honored
        FROM credit_rating_promises
        WHERE tenant_id = ${tenantId} AND customer_id = ${customerId}
      `,
    );
    const pr = promiseRows[0] ?? {};

    // Tenancy length + active counts — derive from `leases`.
    // Columns we rely on: tenant_id, customer_id, start_date, end_date, status.
    let avgTenancyMonths = 0;
    let activeTenancyCount = 0;
    try {
      const leaseRows = await execute(
        this.db,
        sql`
          SELECT
            COALESCE(AVG(
              EXTRACT(EPOCH FROM (COALESCE(end_date, NOW()) - start_date)) / (60 * 60 * 24 * 30.0)
            ), 0)::float8 AS avg_months,
            COUNT(*) FILTER (WHERE status = 'active')::int AS active_count
          FROM leases
          WHERE tenant_id = ${tenantId} AND customer_id = ${customerId}
        `,
      );
      const lr = leaseRows[0] ?? {};
      avgTenancyMonths = Number(lr.avg_months ?? 0);
      activeTenancyCount = Number(lr.active_count ?? 0);
    } catch {
      // leases table schema may differ across migrations; stay at zero
      // and let the scorer degrade to insufficient_data.
    }

    // Rent-to-income — income comes from tenant_financial_statements
    // (canonical column: `monthly_gross_income`; minor units). Rent is
    // NOT stored on that table, so we pull it from the customer's most
    // recent lease (`leases.rent_amount`, minor units).
    //
    // Schema drift note: earlier drafts queried `monthly_rent_minor_units`
    // and `monthly_income_minor_units` on this table and ordered by
    // `reported_at` — none of those columns exist. The SQL below uses
    // the real schema columns (`monthly_gross_income`, `updated_at`).
    let rentToIncomeRatio: number | null = null;
    try {
      const fsRows = await execute(
        this.db,
        sql`
          SELECT monthly_gross_income, monthly_net_income
          FROM tenant_financial_statements
          WHERE tenant_id = ${tenantId} AND customer_id = ${customerId}
          ORDER BY updated_at DESC
          LIMIT 1
        `,
      );
      const fs = fsRows[0];
      const income = Number(
        fs?.monthly_gross_income ?? fs?.monthly_net_income ?? 0,
      );
      if (fs && income > 0) {
        const rentRows = await execute(
          this.db,
          sql`
            SELECT rent_amount
            FROM leases
            WHERE tenant_id = ${tenantId}
              AND customer_id = ${customerId}
            ORDER BY start_date DESC
            LIMIT 1
          `,
        );
        const rent = Number(rentRows[0]?.rent_amount ?? 0);
        if (rent > 0) {
          rentToIncomeRatio = rent / income;
        }
      }
    } catch {
      rentToIncomeRatio = null;
    }

    // Dispute / damage / sublease-violation counts from `cases` table.
    //
    // Schema note: the `cases` table stores classification in a `case_type`
    // column (enum `case_type`), NOT `category`. Valid enum values are
    // listed in cases.schema.ts. We map the credit-rating taxonomy to the
    // real enum: any billing/deposit/maintenance/noise dispute counts as a
    // "dispute", damage_claim → damage, lease_violation → sublease.
    let disputeCount = 0;
    let damageDeductionCount = 0;
    let subleaseViolationCount = 0;
    try {
      const caseRows = await execute(
        this.db,
        sql`
          SELECT
            COUNT(*) FILTER (
              WHERE case_type IN ('billing_dispute','deposit_dispute','maintenance_dispute','noise_complaint')
            )::int AS disputes,
            COUNT(*) FILTER (WHERE case_type = 'damage_claim')::int AS damages,
            COUNT(*) FILTER (WHERE case_type = 'lease_violation')::int AS subleases
          FROM cases
          WHERE tenant_id = ${tenantId} AND customer_id = ${customerId}
        `,
      );
      const cr = caseRows[0] ?? {};
      disputeCount = Number(cr.disputes ?? 0);
      damageDeductionCount = Number(cr.damages ?? 0);
      subleaseViolationCount = Number(cr.subleases ?? 0);
    } catch {
      // cases taxonomy differs — leave at zero.
    }

    return {
      tenantId,
      customerId,
      totalInvoices,
      paidOnTimeCount,
      paidLate30DaysCount,
      paidLate60DaysCount,
      paidLate90PlusCount,
      defaultCount,
      extensionsGranted: Number(pr.extensions_granted ?? 0),
      extensionsHonored: Number(pr.extensions_honored ?? 0),
      installmentAgreementsOffered: Number(pr.installments_offered ?? 0),
      installmentAgreementsHonored: Number(pr.installments_honored ?? 0),
      rentToIncomeRatio,
      avgTenancyMonths,
      activeTenancyCount,
      disputeCount,
      damageDeductionCount,
      subleaseViolationCount,
      newestInvoiceAt,
      oldestInvoiceAt,
      asOf,
    };
  }

  async listCustomerIds(tenantId: string): Promise<readonly string[]> {
    const rows = await execute(
      this.db,
      sql`SELECT id FROM customers WHERE tenant_id = ${tenantId}`,
    );
    return rows.map((r) => String(r.id));
  }

  async saveSnapshot(rating: CreditRating): Promise<void> {
    await asInsertRunner(this.db).insert(creditRatingSnapshots).values({
      id: `crs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      tenantId: rating.tenantId,
      customerId: rating.customerId,
      numericScore: rating.numericScore,
      letterGrade: rating.letterGrade,
      band: rating.band,
      weakestFactor: rating.weakestFactor,
      strongestFactor: rating.strongestFactor,
      dataFreshness: rating.dataFreshness,
      insufficientDataReason: rating.insufficientDataReason,
      dimensions: rating.dimensions as unknown as Record<string, unknown>,
      inputs: {} as Record<string, unknown>,
      recommendations: rating.recommendations,
      computedAt: new Date(rating.lastComputedAt),
    });
  }

  async listHistory(
    tenantId: string,
    customerId: string,
    months: number,
  ): Promise<readonly CreditRatingHistoryEntry[]> {
    const rows = await execute(
      this.db,
      sql`
        SELECT computed_at, numeric_score, letter_grade, band, dimensions
        FROM credit_rating_snapshots
        WHERE tenant_id = ${tenantId}
          AND customer_id = ${customerId}
          AND computed_at >= NOW() - (${months} || ' months')::interval
        ORDER BY computed_at DESC
      `,
    );
    return rows.map((r) => {
      const dims = (r.dimensions as Record<string, { score?: number }>) ?? {};
      const summary: Record<string, number> = {};
      for (const key of Object.keys(dims)) {
        summary[key] = Number(dims[key]?.score ?? 0);
      }
      // letter_grade / band come back as strings from the DB; cast to the
      // repository's declared unions. Validation happens at the service
      // layer which checks membership before use.
      return {
        computedAt: nowIsoSafe(r.computed_at) ?? new Date().toISOString(),
        numericScore:
          r.numeric_score === null || r.numeric_score === undefined
            ? null
            : Number(r.numeric_score),
        letterGrade: (r.letter_grade ?? null) as CreditRatingHistoryEntry['letterGrade'],
        band: (r.band ?? 'insufficient_data') as CreditRatingHistoryEntry['band'],
        dimensionsSummary: summary as CreditRatingHistoryEntry['dimensionsSummary'],
      };
    });
  }

  async savePromiseOutcome(record: PromiseOutcomeRecord): Promise<void> {
    await asInsertRunner(this.db).insert(creditRatingPromises).values({
      id: record.id,
      tenantId: record.tenantId,
      customerId: record.customerId,
      kind: record.kind,
      agreedDate: new Date(record.agreedDate),
      dueDate: new Date(record.dueDate),
      actualOutcome: record.actualOutcome,
      delayDays: record.delayDays,
      notes: record.notes,
      recordedAt: new Date(record.recordedAt),
    });
  }

  async loadWeights(tenantId: string): Promise<GradingWeights | null> {
    const rows = await execute(
      this.db,
      sql`
        SELECT payment_history, promise_keeping, rent_to_income,
               tenancy_length, dispute_history
        FROM credit_rating_weights
        WHERE tenant_id = ${tenantId}
        LIMIT 1
      `,
    );
    const r = rows[0];
    if (!r) return null;
    return {
      payment_history: Number(r.payment_history),
      promise_keeping: Number(r.promise_keeping),
      rent_to_income: Number(r.rent_to_income),
      tenancy_length: Number(r.tenancy_length),
      dispute_history: Number(r.dispute_history),
    };
  }

  async saveWeights(
    tenantId: string,
    weights: GradingWeights,
  ): Promise<void> {
    await execute(
      this.db,
      sql`
        INSERT INTO credit_rating_weights (
          tenant_id, payment_history, promise_keeping,
          rent_to_income, tenancy_length, dispute_history, updated_at
        )
        VALUES (
          ${tenantId},
          ${weights.payment_history},
          ${weights.promise_keeping},
          ${weights.rent_to_income},
          ${weights.tenancy_length},
          ${weights.dispute_history},
          NOW()
        )
        ON CONFLICT (tenant_id) DO UPDATE SET
          payment_history = EXCLUDED.payment_history,
          promise_keeping = EXCLUDED.promise_keeping,
          rent_to_income  = EXCLUDED.rent_to_income,
          tenancy_length  = EXCLUDED.tenancy_length,
          dispute_history = EXCLUDED.dispute_history,
          updated_at      = NOW()
      `,
    );
  }

  async saveSharingOptIn(optIn: CreditSharingOptIn): Promise<void> {
    await asInsertRunner(this.db).insert(creditRatingSharingOptIns).values({
      id: optIn.id,
      tenantId: optIn.tenantId,
      customerId: optIn.customerId,
      shareWithOrg: optIn.shareWithOrg,
      purpose: optIn.purpose,
      grantedAt: new Date(optIn.grantedAt),
      expiresAt: new Date(optIn.expiresAt),
      revokedAt: optIn.revokedAt ? new Date(optIn.revokedAt) : null,
    });
  }

  async revokeSharingOptIn(
    tenantId: string,
    customerId: string,
    optInId: string,
  ): Promise<void> {
    await execute(
      this.db,
      sql`
        UPDATE credit_rating_sharing_opt_ins
        SET revoked_at = NOW()
        WHERE id = ${optInId}
          AND tenant_id = ${tenantId}
          AND customer_id = ${customerId}
          AND revoked_at IS NULL
      `,
    );
  }

  async listSharingOptIns(
    tenantId: string,
    customerId: string,
  ): Promise<readonly CreditSharingOptIn[]> {
    const rows = await execute(
      this.db,
      sql`
        SELECT id, share_with_org, purpose, granted_at, expires_at, revoked_at
        FROM credit_rating_sharing_opt_ins
        WHERE tenant_id = ${tenantId}
          AND customer_id = ${customerId}
        ORDER BY granted_at DESC
      `,
    );
    return rows.map((r) => ({
      id: String(r.id),
      tenantId,
      customerId,
      shareWithOrg: String(r.share_with_org),
      purpose: String(r.purpose ?? 'tenancy_application') as CreditSharingOptIn['purpose'],
      grantedAt: nowIsoSafe(r.granted_at) ?? new Date().toISOString(),
      expiresAt: nowIsoSafe(r.expires_at) ?? new Date().toISOString(),
      revokedAt: r.revoked_at ? nowIsoSafe(r.revoked_at) : null,
    }));
  }
}
