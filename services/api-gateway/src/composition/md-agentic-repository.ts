/**
 * Postgres-backed MdAgenticRepository (migration 0281).
 *
 * Encapsulates the agentic plan / subagent + sandbox-preview data layer behind
 * the `/api/v1/md-agentic/*` route and the `plan.*` / `sandbox.*` brain tools.
 * Ported from the BN md-agentic repository (itself a LitFin iter-32 plan-mode +
 * iter-36 agent-teams / sandbox-writes port) and retargeted real-estate →
 * mining. The honest behaviours live here as repository methods so the route
 * stays thin:
 *
 *   - proposePlan          : persist a multi-step plan proposal (no execute)
 *   - dispatchSubagentTeam : persist N md_subagent_runs at status 'pending'
 *                            (honest-degrade — no real multi-process spawn)
 *   - aggregateSubagentResults : read persisted runs, apply aggregation;
 *                            reports 'unavailable' when no executor wired —
 *                            NEVER fabricates subagent output
 *   - stageSandboxWrite    : stage a mutation in md_sandbox_writes (pending)
 *   - commitSandboxWrite   : validate payload + FKs, atomic write to the real
 *                            target table, append a md_sandbox_commits audit
 *                            row, flip status='committed'
 *   - rejectSandboxWrite   : flip status='rejected', append a md_sandbox_rejects
 *                            log row (target untouched)
 *   - listSandboxWrites    : owner review listing
 *
 * Every method is tenant-scoped: each SQL statement carries
 * `WHERE tenant_id = ${tenantId}`. RLS (FORCE-enabled in mig 0281) on the
 * canonical `app.current_tenant_id` GUC is the primary guard; the explicit
 * filter is defense in depth, mirroring org-team-repository.ts.
 *
 * tenant_id + the *_by_user_id columns are TEXT in Borjie (migration 0279/0280
 * convention) so they bind as plain strings — never cast to ::uuid. Plan /
 * team-run / sandbox / target-row ids ARE uuid, so those keep their ::uuid
 * casts. The append-only audit hash lives in the `audit_chain_ids` jsonb column
 * (Borjie convention) — BN's single `audit_hash_id` column does not exist here.
 *
 * Result discipline (honest-degrade): methods return a discriminated
 * `{ ok: true; … } | { ok: false; code; message }` union — never throw for a
 * domain failure and never fabricate a row.
 */

import { randomUUID, createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';

import type { Provenance } from '../services/provenance';
import {
  validateSandboxPayload,
  isSandboxTargetTable,
  type SandboxTargetTable,
} from './md-sandbox-payload';

// ── shared result + row types ──────────────────────────────────────────

export interface MdRepoFailure {
  readonly ok: false;
  readonly code:
    | 'NOT_FOUND'
    | 'INVALID_INPUT'
    | 'CONFLICT'
    | 'EXPIRED'
    | 'NOT_READY'
    | 'UNAVAILABLE'
    | 'NO_ROWS';
  readonly message: string;
}

export type MdRepoResult<T> = ({ readonly ok: true } & T) | MdRepoFailure;

interface DbExec {
  execute(query: unknown): Promise<unknown>;
}

export type ProvenanceLike = Provenance;

export interface PlanStepInput {
  readonly tool: string;
  readonly input: Record<string, unknown>;
  readonly rationale: string;
}

export interface PlanRow {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly step_count: number;
  readonly created_at: string;
}

export interface SubagentMemberSpec {
  readonly role: string;
  readonly brief: string;
  readonly allowedTools: ReadonlyArray<string>;
  readonly tokenBudget: number;
}

export interface SubagentRunRow {
  readonly id: string;
  readonly role: string;
  readonly status: string;
  readonly result: unknown;
  readonly error: string | null;
}

/**
 * A pending member claimed by the executor — carries everything the brain
 * needs to run the member's brief (role / brief / allowedTools / tokenBudget)
 * plus the shared team brief/aggregation so the executor never re-reads.
 */
export interface ClaimedSubagentMember {
  readonly id: string;
  readonly teamRunId: string;
  readonly role: string;
  readonly brief: string;
  readonly teamBrief: string;
  readonly allowedTools: ReadonlyArray<string>;
  readonly tokenBudget: number;
  readonly aggregation: string;
  readonly originSessionId: string | null;
}

export interface SandboxWriteRow {
  readonly id: string;
  readonly target_table: string;
  readonly operation: 'insert' | 'update';
  readonly target_row_id: string | null;
  readonly proposed_payload: Record<string, unknown>;
  readonly rationale: string | null;
  readonly status: string;
  readonly expires_at: string;
  readonly created_at: string;
}

// ── helpers ─────────────────────────────────────────────────────────────

function extractRows<T>(res: unknown): readonly T[] {
  if (Array.isArray(res)) return res as T[];
  const maybe = (res as { rows?: T[] } | null)?.rows;
  return maybe ?? [];
}

/** sha256 over a stable audit subject; stored in the audit_chain_ids array. */
function auditHash(input: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function provenanceJson(p: ProvenanceLike | undefined): string {
  const safe: ProvenanceLike = p ?? {
    via: 'unknown',
    actorId: null,
    requestedAt: new Date().toISOString(),
  };
  return JSON.stringify(safe);
}

const TERMINAL_SANDBOX = new Set(['committed', 'rejected', 'expired']);
const TERMINAL_SUBAGENT = new Set([
  'completed',
  'failed',
  'cancelled',
  'budget_exceeded',
  'unavailable',
]);

/** FK columns that must exist (within tenant) before a real-table write. */
const FK_COLUMNS: Record<
  SandboxTargetTable,
  ReadonlyArray<{ readonly column: string; readonly table: string }>
> = {
  staff_members: [{ column: 'manager_id', table: 'staff_members' }],
  staff_kpis: [{ column: 'staff_member_id', table: 'staff_members' }],
  org_tasks: [{ column: 'assigned_to', table: 'staff_members' }],
  org_escalations: [
    { column: 'escalated_to_staff_id', table: 'staff_members' },
    { column: 'related_task_id', table: 'org_tasks' },
  ],
};

export class MdAgenticRepository {
  constructor(private readonly db: DbExec) {}

  // ── plan.propose ─────────────────────────────────────────────────────

  async proposePlan(
    tenantId: string,
    input: {
      readonly title: string;
      readonly summary: string;
      readonly steps: ReadonlyArray<PlanStepInput>;
      readonly estimatedImpact: string | null;
    },
    actorUserId: string | null,
    originSessionId: string | null,
    provenance?: ProvenanceLike,
  ): Promise<MdRepoResult<{ readonly plan: PlanRow }>> {
    const id = randomUUID();
    const steps = input.steps.map((s, i) => ({
      stepIndex: i,
      tool: s.tool,
      input: s.input,
      rationale: s.rationale,
    }));
    const hash = auditHash({ id, tenantId, title: input.title });
    await this.db.execute(sql`
      INSERT INTO md_plans (
        id, tenant_id, title, summary, steps, estimated_impact, status,
        proposed_by_user_id, origin_session_id, provenance, audit_chain_ids
      ) VALUES (
        ${id}::uuid, ${tenantId}, ${input.title}, ${input.summary},
        ${JSON.stringify(steps)}::jsonb, ${input.estimatedImpact}, 'proposed',
        ${actorUserId}, ${originSessionId},
        ${provenanceJson(provenance)}::jsonb, ${JSON.stringify([hash])}::jsonb
      )
    `);
    const res = await this.db.execute(sql`
      SELECT id, title, status,
             jsonb_array_length(steps) AS step_count, created_at
        FROM md_plans
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}
       LIMIT 1
    `);
    const plan = extractRows<PlanRow>(res)[0];
    if (!plan) {
      return { ok: false, code: 'NO_ROWS', message: 'plan insert returned no row.' };
    }
    return { ok: true, plan };
  }

  // ── plan.dispatch_subagents (honest-degrade) ─────────────────────────

  async dispatchSubagentTeam(
    tenantId: string,
    input: {
      readonly brief: string;
      readonly aggregation: string;
      readonly members: ReadonlyArray<SubagentMemberSpec>;
      readonly planId: string | null;
    },
    actorUserId: string | null,
    originSessionId: string | null,
    provenance?: ProvenanceLike,
  ): Promise<
    MdRepoResult<{
      readonly teamRunId: string;
      readonly memberIds: ReadonlyArray<string>;
    }>
  > {
    if (input.planId) {
      const planRes = await this.db.execute(sql`
        SELECT id FROM md_plans
         WHERE id = ${input.planId}::uuid AND tenant_id = ${tenantId}
         LIMIT 1
      `);
      if (extractRows<{ id: string }>(planRes).length === 0) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: `NOT_FOUND: plan ${input.planId} not in this tenant.`,
        };
      }
    }

    const teamRunId = randomUUID();
    const memberIds: string[] = [];
    // Persist each member at status 'pending'. NO real spawn — an executor
    // (when wired) flips these to completed/failed and writes `result`.
    for (const m of input.members) {
      const id = randomUUID();
      const hash = auditHash({ id, teamRunId, role: m.role });
      await this.db.execute(sql`
        INSERT INTO md_subagent_runs (
          id, tenant_id, team_run_id, plan_id, role, brief, allowed_tools,
          token_budget, aggregation, status, spawned_by_user_id,
          origin_session_id, provenance, audit_chain_ids
        ) VALUES (
          ${id}::uuid, ${tenantId}, ${teamRunId}::uuid,
          ${input.planId === null ? null : sql`${input.planId}::uuid`},
          ${m.role}, ${m.brief},
          ${JSON.stringify(m.allowedTools)}::jsonb, ${m.tokenBudget},
          ${input.aggregation}, 'pending',
          ${actorUserId}, ${originSessionId},
          ${provenanceJson(provenance)}::jsonb, ${JSON.stringify([hash])}::jsonb
        )
      `);
      memberIds.push(id);
    }
    return { ok: true, teamRunId, memberIds };
  }

  // ── executor: claim + finalize (status machine) ──────────────────────

  /**
   * Atomically claim every 'pending' member of a team and flip it to
   * 'running'. The `UPDATE … WHERE status = 'pending' RETURNING …` is the
   * concurrency guard: two executor invocations racing on the same team can
   * never both claim the same row — the second sees zero rows to update.
   *
   * Returns the claimed members carrying the per-member brief + the shared
   * team brief/aggregation so the caller never re-reads. Empty array means
   * nothing to do (already claimed / terminal / unknown team).
   */
  async claimPendingTeamMembers(
    tenantId: string,
    teamRunId: string,
  ): Promise<readonly ClaimedSubagentMember[]> {
    const res = await this.db.execute(sql`
      UPDATE md_subagent_runs AS r
         SET status = 'running', updated_at = now()
       WHERE r.tenant_id = ${tenantId}
         AND r.team_run_id = ${teamRunId}::uuid
         AND r.status = 'pending'
      RETURNING r.id, r.team_run_id, r.role, r.brief, r.allowed_tools,
                r.token_budget, r.aggregation, r.origin_session_id
    `);
    const rows = extractRows<{
      id: string;
      team_run_id: string;
      role: string;
      brief: string;
      allowed_tools: unknown;
      token_budget: number;
      aggregation: string;
      origin_session_id: string | null;
    }>(res);

    // The shared team brief lives on every member row (denormalised at
    // dispatch); read it once from the team rather than the member brief.
    const teamBrief = await this.readTeamBrief(tenantId, teamRunId);

    return rows.map((r) => ({
      id: r.id,
      teamRunId: r.team_run_id,
      role: r.role,
      brief: r.brief,
      teamBrief,
      allowedTools: normaliseAllowedTools(r.allowed_tools),
      tokenBudget: Number(r.token_budget ?? 0),
      aggregation: r.aggregation,
      originSessionId: r.origin_session_id,
    }));
  }

  /** The team's shared brief — read from any one member row. */
  private async readTeamBrief(
    tenantId: string,
    teamRunId: string,
  ): Promise<string> {
    const res = await this.db.execute(sql`
      SELECT brief FROM md_subagent_runs
       WHERE tenant_id = ${tenantId} AND team_run_id = ${teamRunId}::uuid
       ORDER BY created_at ASC
       LIMIT 1
    `);
    const row = extractRows<{ brief: string }>(res)[0];
    return row?.brief ?? '';
  }

  /**
   * Record a member's successful result and flip 'running' → 'completed'.
   * Append-only audit: pushes a fresh result hash onto audit_chain_ids
   * (never mutates the existing chain entries). Guarded on status='running'
   * so a cancelled/failed row is never silently overwritten.
   */
  async completeSubagentRun(
    tenantId: string,
    memberId: string,
    result: Record<string, unknown>,
  ): Promise<boolean> {
    const hash = auditHash({ memberId, tenantId, kind: 'subagent_result' });
    const res = await this.db.execute(sql`
      UPDATE md_subagent_runs
         SET status = 'completed',
             result = ${JSON.stringify(result)}::jsonb,
             error = NULL,
             audit_chain_ids =
               COALESCE(audit_chain_ids, '[]'::jsonb) || ${JSON.stringify([hash])}::jsonb,
             completed_at = now(),
             updated_at = now()
       WHERE id = ${memberId}::uuid
         AND tenant_id = ${tenantId}
         AND status = 'running'
      RETURNING id
    `);
    return extractRows<{ id: string }>(res).length > 0;
  }

  /**
   * Record a member failure and flip 'running' → 'failed'. The error string
   * is truncated defensively. Same append-only audit + status guard as
   * completeSubagentRun.
   */
  async failSubagentRun(
    tenantId: string,
    memberId: string,
    error: string,
  ): Promise<boolean> {
    const hash = auditHash({ memberId, tenantId, kind: 'subagent_failure' });
    const safeError = error.slice(0, 2_000);
    const res = await this.db.execute(sql`
      UPDATE md_subagent_runs
         SET status = 'failed',
             error = ${safeError},
             audit_chain_ids =
               COALESCE(audit_chain_ids, '[]'::jsonb) || ${JSON.stringify([hash])}::jsonb,
             completed_at = now(),
             updated_at = now()
       WHERE id = ${memberId}::uuid
         AND tenant_id = ${tenantId}
         AND status = 'running'
      RETURNING id
    `);
    return extractRows<{ id: string }>(res).length > 0;
  }

  // ── plan.aggregate_results (honest-degrade — never fabricates) ────────

  async aggregateSubagentResults(
    tenantId: string,
    teamRunId: string,
  ): Promise<
    MdRepoResult<{
      readonly aggregation: string;
      readonly memberCount: number;
      readonly completedCount: number;
      readonly failedCount: number;
      readonly pendingCount: number;
      readonly winner: unknown;
      readonly results: ReadonlyArray<SubagentRunRow>;
      readonly executorWired: boolean;
    }>
  > {
    const res = await this.db.execute(sql`
      SELECT id, role, status, result, error, aggregation
        FROM md_subagent_runs
       WHERE tenant_id = ${tenantId} AND team_run_id = ${teamRunId}::uuid
       ORDER BY created_at ASC
    `);
    const rows = extractRows<SubagentRunRow & { aggregation: string }>(res);
    if (rows.length === 0) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `NOT_FOUND: team ${teamRunId} not in this tenant.`,
      };
    }

    const aggregation = rows[0]!.aggregation;
    const pending = rows.filter((r) => !TERMINAL_SUBAGENT.has(r.status));
    const completed = rows.filter((r) => r.status === 'completed');
    const failed = rows.filter(
      (r) => TERMINAL_SUBAGENT.has(r.status) && r.status !== 'completed',
    );

    // Honest-degrade: with NO executor wired every member stays 'pending'.
    // Report 'unavailable' rather than inventing results.
    if (completed.length === 0 && pending.length > 0) {
      return {
        ok: false,
        code: 'UNAVAILABLE',
        message:
          `UNAVAILABLE: ${pending.length}/${rows.length} subagent run(s) ` +
          'still pending and no executor is wired to produce results. ' +
          'The brain never fabricates subagent output.',
      };
    }

    if (pending.length > 0) {
      return {
        ok: false,
        code: 'NOT_READY',
        message: `NOT_READY: ${pending.length}/${rows.length} subagent run(s) still running.`,
      };
    }

    const winner = this.pickWinner(aggregation, completed);
    return {
      ok: true,
      aggregation,
      memberCount: rows.length,
      completedCount: completed.length,
      failedCount: failed.length,
      pendingCount: 0,
      winner,
      results: rows.map((r) => ({
        id: r.id,
        role: r.role,
        status: r.status,
        result: r.result,
        error: r.error,
      })),
      executorWired: completed.length > 0,
    };
  }

  private pickWinner(
    aggregation: string,
    completed: ReadonlyArray<SubagentRunRow>,
  ): unknown {
    if (completed.length === 0) return null;
    if (aggregation === 'first_success') return completed[0]!.result;
    if (aggregation === 'best_of_n') {
      let best = completed[0]!;
      let bestConf = confidenceOf(best.result);
      for (const m of completed.slice(1)) {
        const conf = confidenceOf(m.result);
        if (conf > bestConf) {
          best = m;
          bestConf = conf;
        }
      }
      return best.result;
    }
    if (aggregation === 'majority_vote') {
      const buckets = new Map<string, { value: unknown; count: number }>();
      for (const m of completed) {
        const key = JSON.stringify(m.result ?? null);
        const cur = buckets.get(key) ?? { value: m.result, count: 0 };
        cur.count += 1;
        buckets.set(key, cur);
      }
      let best: { value: unknown; count: number } | null = null;
      for (const b of buckets.values()) {
        if (!best || b.count > best.count) best = b;
      }
      return best?.value ?? null;
    }
    // merge_all (default) returns no single winner.
    return null;
  }

  // ── sandbox.write (stage) ────────────────────────────────────────────

  async stageSandboxWrite(
    tenantId: string,
    input: {
      readonly targetTable: SandboxTargetTable;
      readonly operation: 'insert' | 'update';
      readonly targetRowId: string | null;
      readonly proposedPayload: Record<string, unknown>;
      readonly rationale: string | null;
      readonly planId: string | null;
    },
    actorUserId: string | null,
    originSessionId: string | null,
    provenance?: ProvenanceLike,
  ): Promise<MdRepoResult<{ readonly sandbox: SandboxWriteRow }>> {
    const id = randomUUID();
    const hash = auditHash({ id, tenantId, targetTable: input.targetTable });
    await this.db.execute(sql`
      INSERT INTO md_sandbox_writes (
        id, tenant_id, target_table, operation, target_row_id,
        proposed_payload, rationale, status, plan_id, proposed_by_user_id,
        origin_session_id, provenance, audit_chain_ids
      ) VALUES (
        ${id}::uuid, ${tenantId}, ${input.targetTable}, ${input.operation},
        ${input.targetRowId === null ? null : sql`${input.targetRowId}::uuid`},
        ${JSON.stringify(input.proposedPayload)}::jsonb, ${input.rationale},
        'pending',
        ${input.planId === null ? null : sql`${input.planId}::uuid`},
        ${actorUserId}, ${originSessionId},
        ${provenanceJson(provenance)}::jsonb, ${JSON.stringify([hash])}::jsonb
      )
    `);
    const sandbox = await this.findSandboxWrite(tenantId, id);
    if (!sandbox) {
      return { ok: false, code: 'NO_ROWS', message: 'sandbox insert returned no row.' };
    }
    return { ok: true, sandbox };
  }

  async findSandboxWrite(
    tenantId: string,
    id: string,
  ): Promise<SandboxWriteRow | null> {
    const res = await this.db.execute(sql`
      SELECT id, target_table, operation, target_row_id, proposed_payload,
             rationale, status, expires_at, created_at
        FROM md_sandbox_writes
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}
       LIMIT 1
    `);
    return extractRows<SandboxWriteRow>(res)[0] ?? null;
  }

  // ── sandbox.list ─────────────────────────────────────────────────────

  async listSandboxWrites(
    tenantId: string,
    filters: {
      readonly status: string;
      readonly targetTable: string;
      readonly limit: number;
    },
  ): Promise<readonly Record<string, unknown>[]> {
    const statusClause =
      filters.status === 'all'
        ? sql``
        : sql`AND status = ${filters.status}`;
    const tableClause =
      filters.targetTable === 'all'
        ? sql``
        : sql`AND target_table = ${filters.targetTable}`;
    const res = await this.db.execute(sql`
      SELECT id, target_table, operation, target_row_id, proposed_payload,
             rationale, status, plan_id, expires_at, created_at, updated_at
        FROM md_sandbox_writes
       WHERE tenant_id = ${tenantId}
         ${statusClause}
         ${tableClause}
       ORDER BY created_at DESC
       LIMIT ${filters.limit}
    `);
    return extractRows<Record<string, unknown>>(res);
  }

  // ── sandbox.commit (validate + atomic write + audit) ─────────────────

  async commitSandboxWrite(
    tenantId: string,
    sandboxId: string,
    actorUserId: string | null,
    originSessionId: string | null,
    provenance?: ProvenanceLike,
  ): Promise<
    MdRepoResult<{
      readonly sandboxId: string;
      readonly targetTable: string;
      readonly operation: string;
      readonly targetRowId: string | null;
      readonly hasSnapshot: boolean;
    }>
  > {
    const row = await this.findSandboxWrite(tenantId, sandboxId);
    if (!row) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `NOT_FOUND: sandbox row ${sandboxId} not in this tenant.`,
      };
    }
    if (TERMINAL_SANDBOX.has(row.status)) {
      return {
        ok: false,
        code: 'CONFLICT',
        message: `TERMINAL: sandbox row is already "${row.status}".`,
      };
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await this.db.execute(sql`
        UPDATE md_sandbox_writes SET status = 'expired', updated_at = now()
         WHERE id = ${sandboxId}::uuid AND tenant_id = ${tenantId}
      `);
      return {
        ok: false,
        code: 'EXPIRED',
        message: `EXPIRED: sandbox row expired at ${row.expires_at}.`,
      };
    }
    if (!isSandboxTargetTable(row.target_table)) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: `target_table "${row.target_table}" is not in the sandbox allowlist.`,
      };
    }
    const targetTable: SandboxTargetTable = row.target_table;

    // 1. validate the staged payload (zod shape) — strips reserved columns.
    const validation = validateSandboxPayload(
      targetTable,
      row.operation,
      row.proposed_payload,
    );
    if (!validation.ok) {
      // `in` narrows structurally to the error member that carries `message`
      // (robust regardless of discriminant control-flow narrowing).
      const message =
        'message' in validation
          ? validation.message
          : 'payload failed sandbox validation.';
      return { ok: false, code: 'INVALID_INPUT', message };
    }
    const payload = validation.payload;

    // 2. FK existence checks (within tenant).
    const fkError = await this.checkForeignKeys(tenantId, targetTable, payload);
    if (fkError) return fkError;

    // 3. snapshot (UPDATE) + atomic write to the real target table.
    let preCommitSnapshot: Record<string, unknown> | null = null;
    let targetRowId: string | null = row.target_row_id;
    if (row.operation === 'update') {
      if (!row.target_row_id) {
        return {
          ok: false,
          code: 'INVALID_INPUT',
          message: 'sandbox UPDATE row missing target_row_id; cannot commit.',
        };
      }
      const snap = await this.snapshotTargetRow(
        tenantId,
        targetTable,
        row.target_row_id,
      );
      if (!snap) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: `NOT_FOUND: target row ${row.target_row_id} in ${targetTable} not in this tenant.`,
        };
      }
      preCommitSnapshot = snap;
      const updated = await this.applyUpdate(
        tenantId,
        targetTable,
        row.target_row_id,
        payload,
      );
      if (!updated) {
        return {
          ok: false,
          code: 'NO_ROWS',
          message: `target update affected no row (${targetTable}/${row.target_row_id}).`,
        };
      }
    } else {
      const insertedId = await this.applyInsert(tenantId, targetTable, payload);
      if (!insertedId) {
        return {
          ok: false,
          code: 'NO_ROWS',
          message: `target insert into ${targetTable} returned no row.`,
        };
      }
      targetRowId = insertedId;
    }

    // 4. append the commit audit row.
    const commitId = randomUUID();
    const commitHash = auditHash({
      commitId,
      tenantId,
      sandboxId,
      targetTable,
    });
    await this.db.execute(sql`
      INSERT INTO md_sandbox_commits (
        id, tenant_id, sandbox_write_id, target_table, operation,
        target_row_id, pre_commit_snapshot, committed_payload,
        committed_by_user_id, origin_session_id, provenance, audit_chain_ids
      ) VALUES (
        ${commitId}::uuid, ${tenantId}, ${sandboxId}::uuid, ${targetTable},
        ${row.operation},
        ${targetRowId === null ? null : sql`${targetRowId}::uuid`},
        ${preCommitSnapshot === null ? null : sql`${JSON.stringify(preCommitSnapshot)}::jsonb`},
        ${JSON.stringify(payload)}::jsonb,
        ${actorUserId}, ${originSessionId},
        ${provenanceJson(provenance)}::jsonb, ${JSON.stringify([commitHash])}::jsonb
      )
    `);

    // 5. flip the sandbox row to committed.
    await this.db.execute(sql`
      UPDATE md_sandbox_writes
         SET status = 'committed',
             target_row_id = ${targetRowId === null ? null : sql`${targetRowId}::uuid`},
             updated_at = now()
       WHERE id = ${sandboxId}::uuid AND tenant_id = ${tenantId}
    `);

    return {
      ok: true,
      sandboxId,
      targetTable,
      operation: row.operation,
      targetRowId,
      hasSnapshot: preCommitSnapshot !== null,
    };
  }

  /** Verify every FK column present in the payload exists within tenant. */
  private async checkForeignKeys(
    tenantId: string,
    targetTable: SandboxTargetTable,
    payload: Record<string, unknown>,
  ): Promise<MdRepoFailure | null> {
    for (const fk of FK_COLUMNS[targetTable]) {
      const value = payload[fk.column];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'string') {
        return {
          ok: false,
          code: 'INVALID_INPUT',
          message: `${fk.column} must be a uuid string.`,
        };
      }
      const exists = await this.rowExists(tenantId, fk.table, value);
      if (!exists) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: `NOT_FOUND: ${fk.column}=${value} not found in ${fk.table} for this tenant.`,
        };
      }
    }
    return null;
  }

  private async rowExists(
    tenantId: string,
    table: string,
    id: string,
  ): Promise<boolean> {
    const ident = sql.identifier(table);
    const res = await this.db.execute(sql`
      SELECT 1 FROM ${ident}
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}
       LIMIT 1
    `);
    return extractRows<unknown>(res).length > 0;
  }

  private async snapshotTargetRow(
    tenantId: string,
    table: SandboxTargetTable,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const ident = sql.identifier(table);
    const res = await this.db.execute(sql`
      SELECT * FROM ${ident}
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}
       LIMIT 1
    `);
    return extractRows<Record<string, unknown>>(res)[0] ?? null;
  }

  private async applyInsert(
    tenantId: string,
    table: SandboxTargetTable,
    payload: Record<string, unknown>,
  ): Promise<string | null> {
    const ident = sql.identifier(table);
    // tenant_id is FORCED to the caller's tenant — never the staged value.
    const cols = [sql.identifier('tenant_id')];
    const vals = [sql`${tenantId}`];
    for (const [key, value] of Object.entries(payload)) {
      cols.push(sql.identifier(key));
      vals.push(jsonbSafe(key, value));
    }
    const res = await this.db.execute(sql`
      INSERT INTO ${ident} (${sql.join(cols, sql`, `)})
      VALUES (${sql.join(vals, sql`, `)})
      RETURNING id
    `);
    const inserted = extractRows<{ id: string }>(res)[0];
    return inserted?.id ?? null;
  }

  private async applyUpdate(
    tenantId: string,
    table: SandboxTargetTable,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const ident = sql.identifier(table);
    const assignments = Object.entries(payload).map(
      ([key, value]) => sql`${sql.identifier(key)} = ${jsonbSafe(key, value)}`,
    );
    assignments.push(sql`${sql.identifier('updated_at')} = now()`);
    const res = await this.db.execute(sql`
      UPDATE ${ident}
         SET ${sql.join(assignments, sql`, `)}
       WHERE id = ${id}::uuid AND tenant_id = ${tenantId}
      RETURNING id
    `);
    return extractRows<{ id: string }>(res).length > 0;
  }

  // ── sandbox.reject ───────────────────────────────────────────────────

  async rejectSandboxWrite(
    tenantId: string,
    sandboxId: string,
    reason: string,
    actorUserId: string | null,
    originSessionId: string | null,
    provenance?: ProvenanceLike,
  ): Promise<
    MdRepoResult<{
      readonly sandboxId: string;
      readonly targetTable: string;
      readonly previousStatus: string;
    }>
  > {
    const row = await this.findSandboxWrite(tenantId, sandboxId);
    if (!row) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `NOT_FOUND: sandbox row ${sandboxId} not in this tenant.`,
      };
    }
    if (TERMINAL_SANDBOX.has(row.status)) {
      return {
        ok: false,
        code: 'CONFLICT',
        message: `TERMINAL: sandbox row is already "${row.status}".`,
      };
    }

    const rejectId = randomUUID();
    const hash = auditHash({ rejectId, tenantId, sandboxId });
    await this.db.execute(sql`
      INSERT INTO md_sandbox_rejects (
        id, tenant_id, sandbox_write_id, target_table, reason,
        rejected_by_user_id, origin_session_id, provenance, audit_chain_ids
      ) VALUES (
        ${rejectId}::uuid, ${tenantId}, ${sandboxId}::uuid,
        ${row.target_table}, ${reason},
        ${actorUserId}, ${originSessionId},
        ${provenanceJson(provenance)}::jsonb, ${JSON.stringify([hash])}::jsonb
      )
    `);
    await this.db.execute(sql`
      UPDATE md_sandbox_writes
         SET status = 'rejected', updated_at = now()
       WHERE id = ${sandboxId}::uuid AND tenant_id = ${tenantId}
    `);

    return {
      ok: true,
      sandboxId,
      targetTable: row.target_table,
      previousStatus: row.status,
    };
  }
}

/** Coerce a jsonb allowed_tools column into a string array (defensive). */
function normaliseAllowedTools(raw: unknown): ReadonlyArray<string> {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is string => typeof t === 'string');
}

function confidenceOf(result: unknown): number {
  if (!result || typeof result !== 'object') return 0;
  const obj = result as Record<string, unknown>;
  if (typeof obj.confidence === 'number') return obj.confidence;
  if (typeof obj.score === 'number') return obj.score;
  return 0;
}

/**
 * Bind a payload value as the right SQL type. Plain objects / arrays are cast
 * to jsonb (the org/team tables' metadata columns are jsonb); everything else
 * binds as a normal parameter.
 */
function jsonbSafe(key: string, value: unknown): ReturnType<typeof sql> {
  if (value !== null && typeof value === 'object') {
    return sql`${JSON.stringify(value)}::jsonb`;
  }
  return sql`${value}`;
}
