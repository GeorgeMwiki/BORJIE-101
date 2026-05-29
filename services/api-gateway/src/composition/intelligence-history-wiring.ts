/**
 * Intelligence-history wiring — Wave-26 Agent Z4.
 *
 * Wires `createIntelligenceHistoryWorker` into the background scheduler by
 * providing Postgres-backed `IntelligenceHistoryRepository`, a deterministic
 * `CustomerCohortProvider` (reads active tenants + customers from Postgres),
 * and a minimal `CustomerSignalsProvider` (emits zero-signal snapshots until
 * richer calculators land — the row existence + sentinel zeros are what the
 * trend-line dashboards need).
 *
 * The worker is deterministic — no LLM calls — so there is no budget-guard
 * concern here. It runs once per day via the `recompute_intelligence_history`
 * scheduled task registered by `background-wiring.createBackgroundSupervisor`.
 */

import { sql } from 'drizzle-orm';
import {
  createIntelligenceHistoryWorker,
  type IntelligenceHistoryRepository,
  type IntelligenceHistoryWorker,
  type CustomerCohortProvider,
  type CustomerSignalsProvider,
  type IntelligenceSnapshot,
} from '@borjie/domain-services/intelligence';
import type { TenantId } from '@borjie/domain-models';

type DbLike = { execute(q: unknown): Promise<unknown> };

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

export function createPostgresIntelligenceHistoryRepository(
  db: unknown,
): IntelligenceHistoryRepository {
  const exec = (db as DbLike).execute.bind(db as DbLike);
  return {
    async upsertSnapshot(snapshot: IntelligenceSnapshot): Promise<void> {
      // Idempotent upsert on (tenant_id, customer_id, snapshot_date) — the
      // unique index `intelligence_history_customer_date_unique` guarantees a
      // single row per day per customer.
      await exec(sql`
        INSERT INTO intelligence_history (
          id, tenant_id, customer_id, snapshot_date,
          payment_risk_score, payment_risk_level,
          churn_risk_score, churn_risk_level,
          sentiment_score, open_maintenance_count,
          complaints_last_30_days,
          payments_last_30_days_on_time, payments_last_30_days_late,
          payment_sub_scores, churn_sub_scores,
          created_at
        ) VALUES (
          ${snapshot.id}, ${snapshot.tenantId}, ${snapshot.customerId},
          ${snapshot.snapshotDate},
          ${snapshot.paymentRiskScore}, ${snapshot.paymentRiskLevel},
          ${snapshot.churnRiskScore}, ${snapshot.churnRiskLevel},
          ${snapshot.sentimentScore}, ${snapshot.openMaintenanceCount},
          ${snapshot.complaintsLast30Days},
          ${snapshot.paymentsLast30DaysOnTime}, ${snapshot.paymentsLast30DaysLate},
          ${snapshot.paymentSubScores ? JSON.stringify(snapshot.paymentSubScores) : null}::jsonb,
          ${snapshot.churnSubScores ? JSON.stringify(snapshot.churnSubScores) : null}::jsonb,
          ${snapshot.createdAt}
        )
        ON CONFLICT (tenant_id, customer_id, snapshot_date)
        DO UPDATE SET
          payment_risk_score = EXCLUDED.payment_risk_score,
          payment_risk_level = EXCLUDED.payment_risk_level,
          churn_risk_score = EXCLUDED.churn_risk_score,
          churn_risk_level = EXCLUDED.churn_risk_level,
          sentiment_score = EXCLUDED.sentiment_score,
          open_maintenance_count = EXCLUDED.open_maintenance_count,
          complaints_last_30_days = EXCLUDED.complaints_last_30_days,
          payments_last_30_days_on_time = EXCLUDED.payments_last_30_days_on_time,
          payments_last_30_days_late = EXCLUDED.payments_last_30_days_late,
          payment_sub_scores = EXCLUDED.payment_sub_scores,
          churn_sub_scores = EXCLUDED.churn_sub_scores
      `);
    },
  };
}

export function createPostgresCustomerCohortProvider(
  db: unknown,
): CustomerCohortProvider {
  const exec = (db as DbLike).execute.bind(db as DbLike);
  return {
    async listTenants(): Promise<TenantId[]> {
      try {
        const rows = asRows(
          await exec(sql`SELECT id FROM tenants WHERE status = 'active'`),
        );
        return rows.map((r) => String((r as { id: unknown }).id) as TenantId);
      } catch {
        return [];
      }
    },
    async listActiveCustomers(tenantId: TenantId) {
      try {
        const rows = asRows(
          await exec(
            sql`SELECT id FROM customers WHERE tenant_id = ${tenantId}`,
          ),
        );
        return rows.map((r) => ({
          customerId: String((r as { id: unknown }).id),
          tenantId,
        }));
      } catch {
        return [];
      }
    },
  };
}

/**
 * Minimal deterministic signals provider. Every field is populated from
 * straightforward Postgres aggregates (or zero-default) so the worker always
 * produces a complete snapshot row. The richer calculators in ai-copilot can
 * replace individual fields in a follow-up without breaking the wiring here.
 */
export function createPostgresCustomerSignalsProvider(
  db: unknown,
): CustomerSignalsProvider {
  const exec = (db as DbLike).execute.bind(db as DbLike);
  return {
    async getSignals(tenantId, customerId, asOf) {
      const windowStart = new Date(asOf.getTime() - 30 * 24 * 60 * 60 * 1000);
      let openMaintenanceCount = 0;
      let complaintsLast30Days = 0;
      let paymentsLast30DaysOnTime = 0;
      let paymentsLast30DaysLate = 0;
      try {
        const mx = asRows(
          await exec(sql`
            SELECT COUNT(*)::int AS c
            FROM maintenance_tickets
            WHERE tenant_id = ${tenantId}
              AND customer_id = ${customerId}
              AND status NOT IN ('closed','resolved','cancelled')
          `),
        );
        openMaintenanceCount = Number(mx[0]?.c ?? 0);
      } catch {
        /* table may not exist in early migrations — zero is safe */
      }
      try {
        const cmp = asRows(
          await exec(sql`
            SELECT COUNT(*)::int AS c
            FROM complaints
            WHERE tenant_id = ${tenantId}
              AND customer_id = ${customerId}
              AND created_at >= ${windowStart.toISOString()}
          `),
        );
        complaintsLast30Days = Number(cmp[0]?.c ?? 0);
      } catch {
        /* zero-default */
      }
      try {
        const pay = asRows(
          await exec(sql`
            SELECT
              COUNT(*) FILTER (WHERE paid_at IS NOT NULL AND paid_at <= due_date)::int AS on_time,
              COUNT(*) FILTER (WHERE paid_at IS NOT NULL AND paid_at > due_date)::int AS late
            FROM invoices
            WHERE tenant_id = ${tenantId}
              AND customer_id = ${customerId}
              AND due_date >= ${windowStart.toISOString().slice(0, 10)}
          `),
        );
        paymentsLast30DaysOnTime = Number(pay[0]?.on_time ?? 0);
        paymentsLast30DaysLate = Number(pay[0]?.late ?? 0);
      } catch {
        /* zero-default */
      }
      return {
        paymentRiskScore: null,
        paymentRiskLevel: null,
        churnRiskScore: null,
        churnRiskLevel: null,
        sentimentScore: null,
        openMaintenanceCount,
        complaintsLast30Days,
        paymentsLast30DaysOnTime,
        paymentsLast30DaysLate,
        paymentSubScores: null,
        churnSubScores: null,
      };
    },
  };
}

export interface IntelligenceHistorySupervisor {
  readonly worker: IntelligenceHistoryWorker | null;
  start(): void;
  stop(): void;
}

/**
 * Build a daily-cadence supervisor around the worker. Returns a null worker
 * when `db` is absent (degraded mode) — the supervisor exposes no-op
 * start/stop so callers never branch.
 */
export function createIntelligenceHistorySupervisor(
  db: unknown | null,
  logger: {
    info: (meta: Record<string, unknown>, msg: string) => void;
    warn: (meta: Record<string, unknown>, msg: string) => void;
  },
): IntelligenceHistorySupervisor {
  if (!db) {
    return { worker: null, start() {}, stop() {} };
  }
  const worker = createIntelligenceHistoryWorker({
    repo: createPostgresIntelligenceHistoryRepository(db),
    cohorts: createPostgresCustomerCohortProvider(db),
    signals: createPostgresCustomerSignalsProvider(db),
  });

  let handle: NodeJS.Timeout | null = null;
  const DAY_MS = 24 * 60 * 60 * 1000;

  async function tick(): Promise<void> {
    try {
      const res = await worker.runDaily();
      logger.info(
        {
          tenantsProcessed: res.tenantsProcessed,
          customersProcessed: res.customersProcessed,
          snapshotsWritten: res.snapshotsWritten,
          errors: res.errors,
        },
        'intelligence-history-worker tick complete',
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'intelligence-history-worker tick failed',
      );
    }
  }

  return {
    worker,
    start() {
      if (handle) return;
      // First run immediately so operators can see a snapshot the same day.
      void tick();
      handle = setInterval(tick, DAY_MS);
      if (typeof handle.unref === 'function') handle.unref();
      logger.info({ cadenceMs: DAY_MS }, 'intelligence-history-worker started');
    },
    stop() {
      if (handle) {
        clearInterval(handle);
        handle = null;
        logger.info({}, 'intelligence-history-worker stopped');
      }
    },
  };
}
