/**
 * a2a-task-store.service — Drizzle-backed adapter.
 *
 * Satisfies the `TaskStore` port declared in
 * `packages/agent-platform/src/a2a/task-lifecycle.ts`. The in-memory
 * store remains the default; this adapter is opt-in at the agent-
 * platform composition root.
 *
 * Operations match the port exactly:
 *
 *   - put(task): upsert by id (idempotent put-on-existing replaces
 *     status / artifacts / updatedAt; tenant_id never changes after
 *     creation).
 *   - get(id): fetch one task by id within scope (tenant-scoped).
 *   - list(sessionId): all tasks for a session (tenant-scoped).
 *
 * Multi-tenant isolation:
 *   - The base port is single-tenant. This adapter requires a
 *     `tenantId` at construction time; every query filters by it.
 *     A compromised session_id therefore cannot be replayed across
 *     tenants.
 *
 * Error handling:
 *   - `put` rethrows on DB error (losing a task transition produces
 *     an undefined-state A2A task; the orchestrator must observe the
 *     failure to retry or fail the task).
 *   - `get` returns `null` on error or miss.
 *   - `list` returns `[]` on error.
 *
 * SOC 2 / GDPR Art. 30 rationale:
 *   - `message` + `artifacts` may carry user-facing content; host
 *     pipelines apply PII redaction upstream.
 *   - tenant_id NOT NULL ⇒ paired with RLS migration 0155, prevents
 *     cross-tenant reads at the role level.
 *   - `error` field bounded to 4_000 chars to keep DSAR exports
 *     bounded.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import {

  a2aTasks,
  type A2aTaskRow,
} from '../schemas/a2a-tasks.schema.js';
import { logger } from '../logger.js';
import type { DatabaseClient } from '../client.js';

// ─────────────────────────────────────────────────────────────────────
// Port shape (mirrors packages/agent-platform/src/a2a/task-lifecycle.ts).
// ─────────────────────────────────────────────────────────────────────

export type A2ATaskStatus =
  | 'submitted'
  | 'working'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface A2ATaskPart {
  readonly type: 'text' | 'data' | 'file';
  readonly content: string;
  readonly mimeType?: string;
}

export interface A2ATaskMessage {
  readonly role: 'user' | 'agent';
  readonly parts: ReadonlyArray<A2ATaskPart>;
}

export interface A2ATask {
  readonly id: string;
  readonly sessionId: string;
  readonly status: A2ATaskStatus;
  readonly message: A2ATaskMessage;
  readonly artifacts: ReadonlyArray<A2ATaskMessage>;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskStore {
  put(task: A2ATask): Promise<void>;
  get(id: string): Promise<A2ATask | null>;
  list(sessionId: string): Promise<ReadonlyArray<A2ATask>>;
}

export interface A2aTaskStoreOpts {
  /** Multi-tenant scope. REQUIRED — the in-memory port is single-tenant; this adapter is not. */
  readonly tenantId: string;
}

const ERROR_MAX_LEN = 4_000;
const VALID_STATUSES: ReadonlySet<A2ATaskStatus> = new Set([
  'submitted',
  'working',
  'completed',
  'failed',
  'canceled',
]);

function rowToTask(row: A2aTaskRow): A2ATask {
  const base: {
    readonly id: string;
    readonly sessionId: string;
    readonly status: A2ATaskStatus;
    readonly message: A2ATaskMessage;
    readonly artifacts: ReadonlyArray<A2ATaskMessage>;
    readonly createdAt: string;
    readonly updatedAt: string;
  } = {
    id: row.id,
    sessionId: row.sessionId,
    status: VALID_STATUSES.has(row.status as A2ATaskStatus)
      ? (row.status as A2ATaskStatus)
      : 'failed',
    message: row.message as A2ATaskMessage,
    artifacts: Array.isArray(row.artifacts)
      ? (row.artifacts as ReadonlyArray<A2ATaskMessage>)
      : [],
    createdAt: row.createdAtIso,
    updatedAt: row.updatedAtIso,
  };
  return row.error
    ? Object.freeze({ ...base, error: row.error })
    : Object.freeze(base);
}

export function createA2aTaskStoreService(
  db: DatabaseClient,
  opts: A2aTaskStoreOpts,
): TaskStore {
  if (!opts.tenantId) {
    throw new Error(
      'a2a-task-store: tenantId is required (port is multi-tenant)',
    );
  }
  const tenantId = opts.tenantId;

  return {
    async put(task) {
      if (!task?.id) {
        throw new Error('a2a-task-store.put: task.id is required');
      }
      if (!task.sessionId) {
        throw new Error('a2a-task-store.put: task.sessionId is required');
      }
      if (!VALID_STATUSES.has(task.status)) {
        throw new Error(`a2a-task-store.put: invalid status "${task.status}"`);
      }
      const errorText = task.error
        ? task.error.slice(0, ERROR_MAX_LEN)
        : null;
      try {
        await db
          .insert(a2aTasks)
          .values({
            id: task.id,
            sessionId: task.sessionId,
            tenantId,
            status: task.status,
            message: task.message as never,
            artifacts: (task.artifacts ?? []) as never,
            error: errorText,
            createdAtIso: task.createdAt,
            updatedAtIso: task.updatedAt,
          } as never)
          .onConflictDoUpdate({
            target: a2aTasks.id,
            set: {
              status: task.status,
              message: task.message as never,
              artifacts: (task.artifacts ?? []) as never,
              error: errorText,
              updatedAtIso: task.updatedAt,
            } as never,
          });
      } catch (error) {
        // Task-state transitions that fail leave the orchestrator in
        // an undefined state. Surface the error so the caller (lifecycle
        // module) can retry or fail the task explicitly.
        logger.error('a2a-task-store.put failed', { error: error });
        throw error;
      }
    },

    async get(id) {
      try {
        if (!id) return null;
        const rows = (await db
          .select(SELECT_COLS)
          .from(a2aTasks)
          .where(and(eq(a2aTasks.id, id), eq(a2aTasks.tenantId, tenantId)))
          .limit(1)) as ReadonlyArray<A2aTaskRow>;
        const row = rows?.[0];
        return row ? rowToTask(row) : null;
      } catch (error) {
        logger.error('a2a-task-store.get failed', { error: error });
        return null;
      }
    },

    async list(sessionId) {
      try {
        if (!sessionId) return Object.freeze([]);
        const rows = (await db
          .select(SELECT_COLS)
          .from(a2aTasks)
          .where(
            and(
              eq(a2aTasks.sessionId, sessionId),
              eq(a2aTasks.tenantId, tenantId),
            ),
          )
          .orderBy(asc(a2aTasks.createdAtIso))) as ReadonlyArray<A2aTaskRow>;
        return Object.freeze((rows ?? []).map(rowToTask));
      } catch (error) {
        logger.error('a2a-task-store.list failed', { error: error });
        return Object.freeze([]);
      }
    },
  };
}

const SELECT_COLS = {
  id: a2aTasks.id,
  sessionId: a2aTasks.sessionId,
  tenantId: a2aTasks.tenantId,
  status: a2aTasks.status,
  message: a2aTasks.message,
  artifacts: a2aTasks.artifacts,
  error: a2aTasks.error,
  createdAtIso: a2aTasks.createdAtIso,
  updatedAtIso: a2aTasks.updatedAtIso,
  insertedAt: a2aTasks.insertedAt,
} as const;

// keep sql referenced so lint doesn't strip the import (used by future bumpers)
void sql;

export { a2aTasks };
