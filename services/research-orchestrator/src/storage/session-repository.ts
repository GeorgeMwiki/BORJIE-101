/**
 * Session repository — long-running deep-dive sessions.
 *
 * Migration 0018 §5. Carries id, tenant_id, topic, active_plan_id,
 * state (jsonb), started_at, last_progress_at, status,
 * owner_sign_off_required_at_usd.
 *
 * The state column is the checkpoint payload — last_completed_seq,
 * spent_usd_cents, acked_gates. After every step the plan-runner
 * writes the snapshot here so a worker restart can resume.
 *
 * @module research-orchestrator/storage/session-repository
 */

import type { SqlLike } from './plan-repository.js';

export interface SessionState {
  readonly last_completed_seq: number;
  readonly spent_usd_cents: number;
  readonly acked_gates_usd: ReadonlyArray<number>;
  /** Free-form bag for adapter-specific state (rate-limit cursors, …). */
  readonly bag?: Readonly<Record<string, unknown>>;
}

export interface SessionRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly topic: string;
  readonly active_plan_id: string | null;
  readonly state: SessionState;
  readonly status: 'running' | 'paused' | 'complete' | 'failed';
  readonly owner_sign_off_required_at_usd: ReadonlyArray<number>;
  readonly last_progress_at: string;
}

export interface SessionRepository {
  create(session: SessionRow): Promise<void>;
  loadByPlan(plan_id: string): Promise<SessionRow | null>;
  checkpoint(args: { readonly id: string; readonly state: SessionState; readonly progress_at_iso: string }): Promise<void>;
  setStatus(id: string, status: SessionRow['status']): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export function createInMemorySessionRepository(): SessionRepository {
  const byId = new Map<string, SessionRow>();
  return {
    async create(session) {
      byId.set(session.id, session);
    },
    async loadByPlan(plan_id) {
      for (const s of byId.values()) {
        if (s.active_plan_id === plan_id) return s;
      }
      return null;
    },
    async checkpoint(args) {
      const existing = byId.get(args.id);
      if (!existing) return;
      byId.set(args.id, {
        ...existing,
        state: args.state,
        last_progress_at: args.progress_at_iso,
      });
    },
    async setStatus(id, status) {
      const existing = byId.get(id);
      if (!existing) return;
      byId.set(id, { ...existing, status });
    },
  };
}

// ---------------------------------------------------------------------------
// SQL implementation
// ---------------------------------------------------------------------------

export function createSqlSessionRepository(sql: SqlLike): SessionRepository {
  return {
    async create(session) {
      await sql`
        INSERT INTO research_sessions (
          id, tenant_id, topic, active_plan_id, state, status,
          owner_sign_off_required_at_usd, last_progress_at
        )
        VALUES (
          ${session.id}, ${session.tenant_id}, ${session.topic},
          ${session.active_plan_id}, ${JSON.stringify(session.state)}::jsonb,
          ${session.status},
          ${session.owner_sign_off_required_at_usd as unknown as number[]}::numeric[],
          ${session.last_progress_at}::timestamptz
        )
        ON CONFLICT (id) DO NOTHING
      `;
    },
    async loadByPlan(plan_id) {
      const rows = (await sql<ReadonlyArray<Record<string, unknown>>>`
        SELECT id, tenant_id, topic, active_plan_id, state, status,
               owner_sign_off_required_at_usd, last_progress_at
        FROM research_sessions
        WHERE active_plan_id = ${plan_id}
        ORDER BY last_progress_at DESC
        LIMIT 1
      `) as unknown as ReadonlyArray<Record<string, unknown>>;
      const row = rows[0];
      if (!row) return null;
      return rowToSession(row);
    },
    async checkpoint(args) {
      await sql`
        UPDATE research_sessions
        SET state = ${JSON.stringify(args.state)}::jsonb,
            last_progress_at = ${args.progress_at_iso}::timestamptz
        WHERE id = ${args.id}
      `;
    },
    async setStatus(id, status) {
      await sql`UPDATE research_sessions SET status = ${status} WHERE id = ${id}`;
    },
  };
}

function rowToSession(row: Record<string, unknown>): SessionRow {
  const lastProgress =
    row['last_progress_at'] instanceof Date
      ? (row['last_progress_at'] as Date).toISOString()
      : String(row['last_progress_at']);
  const state = (row['state'] as SessionState | null) ?? {
    last_completed_seq: -1,
    spent_usd_cents: 0,
    acked_gates_usd: [],
  };
  const gates = Array.isArray(row['owner_sign_off_required_at_usd'])
    ? (row['owner_sign_off_required_at_usd'] as ReadonlyArray<unknown>).map(Number)
    : [];
  return {
    id: String(row['id']),
    tenant_id: String(row['tenant_id']),
    topic: String(row['topic']),
    active_plan_id: row['active_plan_id'] === null || row['active_plan_id'] === undefined
      ? null
      : String(row['active_plan_id']),
    state,
    status: row['status'] as SessionRow['status'],
    owner_sign_off_required_at_usd: Object.freeze(gates),
    last_progress_at: lastProgress,
  };
}
