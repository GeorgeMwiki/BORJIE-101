/**
 * Plan repository — CRUD over the `research_plans` table.
 *
 * Per migration 0018 + DEEP_RESEARCH_SPEC §14, the table carries:
 *   id, tenant_id, mode, query, created_by, created_at, budget_ms,
 *   budget_usd_cents, spent_usd_cents, status, result_id, audit_hash.
 *
 * The repository is a typed port. Two implementations ship in this
 * service: an in-memory store for tests and a Postgres-backed store
 * via the `postgres` driver. The composition root picks one based on
 * `DATABASE_URL`.
 *
 * @module research-orchestrator/storage/plan-repository
 */

import type { ResearchPlan } from '../types.js';

export interface PlanRepository {
  create(plan: ResearchPlan): Promise<void>;
  setStatus(plan_id: string, status: ResearchPlan['status']): Promise<void>;
  setResultId(plan_id: string, result_id: string): Promise<void>;
  setAuditHash(plan_id: string, audit_hash: string): Promise<void>;
  incrementSpent(plan_id: string, delta_cents: number): Promise<void>;
  findById(plan_id: string): Promise<ResearchPlan | null>;
}

// ---------------------------------------------------------------------------
// In-memory implementation — tests + dry-run
// ---------------------------------------------------------------------------

export interface InMemoryPlanRepository extends PlanRepository {
  readonly plans: ReadonlyMap<string, ResearchPlan>;
}

export function createInMemoryPlanRepository(): InMemoryPlanRepository {
  const plans = new Map<string, ResearchPlan>();
  return {
    plans,
    async create(plan) {
      plans.set(plan.id, plan);
    },
    async setStatus(plan_id, status) {
      const existing = plans.get(plan_id);
      if (!existing) return;
      plans.set(plan_id, { ...existing, status });
    },
    async setResultId(plan_id, result_id) {
      const existing = plans.get(plan_id);
      if (!existing) return;
      plans.set(plan_id, { ...existing, result_id });
    },
    async setAuditHash(plan_id, _audit_hash) {
      // Stored on the row but not in the typed ResearchPlan; no-op for
      // in-memory store — tests assert through the SQL repo.
      const existing = plans.get(plan_id);
      if (!existing) return;
      // Field is persisted via the audit emitter directly; here we
      // just ensure idempotency.
      plans.set(plan_id, existing);
    },
    async incrementSpent(plan_id, _delta_cents) {
      // No `spent_usd_cents` field on the typed shape — repo persists
      // separately. In-memory variant is a no-op for the typed plan,
      // tests assert via the SQL repo.
      const existing = plans.get(plan_id);
      if (!existing) return;
      plans.set(plan_id, existing);
    },
    async findById(plan_id) {
      return plans.get(plan_id) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// SqlPlanRepository port — implemented by composition root with `postgres`
// ---------------------------------------------------------------------------

/**
 * Minimal SQL client surface — matches the `postgres` driver's
 * tagged-template + `.unsafe()` shape.
 */
export interface SqlLike {
  /** Execute a tagged-template SQL statement. */
  <T = unknown>(strings: TemplateStringsArray, ...values: ReadonlyArray<unknown>): Promise<T>;
}

export function createSqlPlanRepository(sql: SqlLike): PlanRepository {
  return {
    async create(plan) {
      await sql`
        INSERT INTO research_plans (
          id, tenant_id, mode, query, created_by, created_at,
          budget_ms, budget_usd_cents, status, result_id
        )
        VALUES (
          ${plan.id}, ${plan.tenant_id}, ${plan.mode}, ${plan.query},
          ${plan.created_by}, ${plan.created_at},
          ${plan.budget_ms}, ${plan.budget_usd_cents},
          ${plan.status}, ${plan.result_id}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    },
    async setStatus(plan_id, status) {
      await sql`UPDATE research_plans SET status = ${status} WHERE id = ${plan_id}`;
    },
    async setResultId(plan_id, result_id) {
      await sql`UPDATE research_plans SET result_id = ${result_id} WHERE id = ${plan_id}`;
    },
    async setAuditHash(plan_id, audit_hash) {
      await sql`UPDATE research_plans SET audit_hash = ${audit_hash} WHERE id = ${plan_id}`;
    },
    async incrementSpent(plan_id, delta_cents) {
      await sql`
        UPDATE research_plans
        SET spent_usd_cents = COALESCE(spent_usd_cents, 0) + ${delta_cents}
        WHERE id = ${plan_id}
      `;
    },
    async findById(plan_id) {
      const rows = (await sql<ReadonlyArray<Record<string, unknown>>>`
        SELECT id, tenant_id, mode, query, created_by, created_at,
               budget_ms, budget_usd_cents, status, result_id
        FROM research_plans
        WHERE id = ${plan_id}
        LIMIT 1
      `) as unknown as ReadonlyArray<Record<string, unknown>>;
      const row = rows[0];
      if (!row) return null;
      return {
        id: String(row['id']),
        tenant_id: String(row['tenant_id']),
        mode: row['mode'] as ResearchPlan['mode'],
        query: String(row['query']),
        created_by: row['created_by'] as ResearchPlan['created_by'],
        created_at: toIso(row['created_at']),
        budget_ms: Number(row['budget_ms']),
        budget_usd_cents: Number(row['budget_usd_cents']),
        steps: Object.freeze([]),
        status: row['status'] as ResearchPlan['status'],
        result_id: row['result_id'] === null || row['result_id'] === undefined ? null : String(row['result_id']),
      };
    },
  };
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return new Date().toISOString();
}
