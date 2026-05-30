/**
 * Follow-Up — Supabase Persister
 *
 * Tier-scoped + RLS-enforced writes for the `follow_ups` table. Idempotent
 * upserts: re-running with the same `id` is safe. The Supabase shape is a
 * narrow interface so tests can inject an in-memory double.
 *
 * @module features/central-command/md/follow-up/persister
 */

import { createLogger } from "@/lib/logger";
import { followUpSchema, type FollowUp, type FollowUpStatus } from "./types";

const log = createLogger("md.follow-up.persister");

/**
 * Minimal Supabase-shaped client — matches the pattern used elsewhere in
 * `src/core/brain/outbox-supabase-persistor.ts`.
 */
export interface SupabaseLike {
  from: (table: string) => SupabaseTable;
}

export interface SupabaseTable {
  upsert: (
    rows: ReadonlyArray<Record<string, unknown>>,
    opts?: { readonly onConflict?: string },
  ) => Promise<{ error: unknown }>;
  select: (cols: string) => SupabaseQuery;
  update: (patch: Record<string, unknown>) => SupabaseUpdateChain;
}

export interface SupabaseQuery {
  eq: (col: string, val: unknown) => SupabaseQuery;
  in: (col: string, vals: ReadonlyArray<unknown>) => SupabaseQuery;
  lte: (col: string, val: unknown) => SupabaseQuery;
  order: (col: string, opts?: { ascending?: boolean }) => SupabaseQuery;
  limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
  // Allow direct await:
  then?: never;
}

export interface SupabaseUpdateChain {
  eq: (col: string, val: unknown) => Promise<{ error: unknown }>;
}

export interface FollowUpPersisterConfig {
  readonly tableName?: string;
}

const DEFAULT_TABLE = "follow_ups";

export interface FollowUpPersister {
  upsert(fu: FollowUp): Promise<void>;
  upsertMany(fus: ReadonlyArray<FollowUp>): Promise<void>;
  listPending(
    tenantId: string,
    limit?: number,
  ): Promise<ReadonlyArray<FollowUp>>;
  setStatus(id: string, status: FollowUpStatus): Promise<void>;
}

/**
 * Build a Supabase-backed persister. RLS at the Postgres level enforces
 * the tenant scope; the persister only translates rows.
 */
export function makeFollowUpPersister(
  supabase: SupabaseLike,
  config: FollowUpPersisterConfig = {},
): FollowUpPersister {
  const table = config.tableName ?? DEFAULT_TABLE;
  return Object.freeze({
    async upsert(fu: FollowUp): Promise<void> {
      const row = followUpToRow(followUpSchema.parse(fu));
      const { error } = await supabase
        .from(table)
        .upsert([row], { onConflict: "id" });
      if (error) {
        log.warn("upsert failed", { id: fu.id, tenantId: fu.tenantId, error });
        throw new Error(`follow_ups upsert failed: ${stringifyError(error)}`);
      }
    },
    async upsertMany(fus: ReadonlyArray<FollowUp>): Promise<void> {
      if (fus.length === 0) return;
      const rows = fus.map((fu) => followUpToRow(followUpSchema.parse(fu)));
      const { error } = await supabase
        .from(table)
        .upsert(rows, { onConflict: "id" });
      if (error) {
        log.warn("upsertMany failed", { count: fus.length, error });
        throw new Error(
          `follow_ups upsertMany failed: ${stringifyError(error)}`,
        );
      }
    },
    async listPending(
      tenantId: string,
      limit = 200,
    ): Promise<ReadonlyArray<FollowUp>> {
      const q = supabase
        .from(table)
        .select("*")
        .eq("tenant_id", tenantId)
        .in("status", ["pending", "escalated"])
        .order("due_at", { ascending: true })
        .limit(limit);
      const { data, error } = await q;
      if (error) {
        log.warn("listPending failed", { tenantId, error });
        throw new Error(
          `follow_ups listPending failed: ${stringifyError(error)}`,
        );
      }
      if (!Array.isArray(data)) return Object.freeze([]);
      return Object.freeze(
        data.map(rowToFollowUp).filter((x): x is FollowUp => x !== null),
      );
    },
    async setStatus(id: string, status: FollowUpStatus): Promise<void> {
      const { error } = await supabase
        .from(table)
        .update({ status })
        .eq("id", id);
      if (error) {
        log.warn("setStatus failed", { id, status, error });
        throw new Error(
          `follow_ups setStatus failed: ${stringifyError(error)}`,
        );
      }
    },
  });
}

function followUpToRow(fu: FollowUp): Record<string, unknown> {
  return {
    id: fu.id,
    tenant_id: fu.tenantId,
    owner_id: fu.ownerId,
    subject: fu.subject,
    due_at: fu.dueAt,
    snoozed_until: fu.snoozedUntil ?? null,
    status: fu.status,
    origin_turn_id: fu.originTurnId,
    escalation_level: fu.escalationLevel,
    priority: fu.priority,
    created_at: fu.createdAt,
    counterparty: fu.counterparty ?? null,
    metadata: fu.metadata ?? null,
  };
}

function rowToFollowUp(raw: unknown): FollowUp | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const candidate = {
    id: r.id,
    tenantId: r.tenant_id,
    ownerId: r.owner_id,
    subject: r.subject,
    dueAt: r.due_at,
    snoozedUntil: r.snoozed_until,
    status: r.status,
    originTurnId: r.origin_turn_id,
    escalationLevel: r.escalation_level,
    priority: r.priority ?? "normal",
    createdAt: r.created_at,
    counterparty: r.counterparty,
    metadata: r.metadata,
  };
  const parsed = followUpSchema.safeParse(candidate);
  if (!parsed.success) {
    log.warn("row failed schema validation", {
      id: r.id,
      issues: parsed.error.issues.length,
    });
    return null;
  }
  return Object.freeze(parsed.data);
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
