/**
 * Junior-agent executor.
 *
 * Responsibilities (in order):
 *   1. Enforce guardrails (cooldown, payload validation, hard budget).
 *   2. Brace the junior's execute() in an AbortController with the
 *      junior's `maxDurationMs` cap.
 *   3. Persist a `junior_runs` row with a per-org HMAC-SHA256 hash
 *      chain — mirrors the staged-call audit pattern in
 *      `src/core/staged-call/conversation-log.ts`. A leaked DB key
 *      alone cannot forge a valid `row_hash`; the secret lives in env
 *      (`JUNIOR_RUNS_HASH_SECRET`) and the row_hash is HMAC'd over the
 *      canonical payload plus the previous row's hash.
 *   4. Hand the result back to the caller.
 *
 * The executor is pure-ish — it takes a Supabase-like client and the
 * SchemaRegistryService at construct time and never reaches for env
 * itself (besides the hash secret accessor, which is lazy + cached).
 *
 * @module features/central-command/md/juniors/executor
 */

import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { createLogger } from "@/lib/logger";

import type { SchemaRegistryService } from "../schema-registry/schema-registry-service";

import type {
  JuniorRunRecord,
  JuniorRunResult,
  MdJuniorPort,
  JuniorTrigger,
} from "./types";

const log = createLogger("md.juniors.executor");

const ALLOWED_TRIGGER_KINDS: ReadonlySet<JuniorTrigger["kind"]> = new Set([
  "manual",
  "cron",
  "event",
]);
const MAX_CANONICAL_BYTES = 4 * 1024; // hash-chain payload upper bound
const MAX_JUNIOR_ID_LEN = 80;
const HASH_RETRY_MAX = 3;

// ---------------------------------------------------------------------------
// Supabase-shape (loose — matches the rest of the MD slice)
// ---------------------------------------------------------------------------

export interface JuniorExecutorSupabaseLike {
  from(table: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    select(cols?: string): any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    insert(rows: unknown): any;
  };
}

// ---------------------------------------------------------------------------
// Public ports
// ---------------------------------------------------------------------------

export interface RunJuniorArgs {
  readonly junior: MdJuniorPort;
  readonly orgId: string;
  readonly triggerKind: MdJuniorPort["trigger"]["kind"];
  readonly payload: unknown;
}

export interface RunJuniorOutcome {
  readonly result: JuniorRunResult;
  readonly record: JuniorRunRecord | null;
  /** Surfaced when the executor rejected the junior pre-execute. */
  readonly skipped?: "rate_limited" | "payload_invalid" | "no_table_writes";
}

export interface JuniorExecutor {
  run(args: RunJuniorArgs): Promise<RunJuniorOutcome>;
}

export interface JuniorExecutorDeps {
  readonly supabase: JuniorExecutorSupabaseLike;
  readonly schemaRegistry: SchemaRegistryService;
  /** Override the env-backed hash secret (test injection). */
  readonly hashSecret?: string;
  /** Override the current-time source (test injection). */
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Hash secret — env-backed, lazy, cached.
// ---------------------------------------------------------------------------

let cachedSecret: string | null = null;

function getHashSecret(): string {
  if (cachedSecret) return cachedSecret;
  const raw = process.env.JUNIOR_RUNS_HASH_SECRET;
  if (!raw || raw.length < 32) {
    // Dev fallback: derive a deterministic-per-process secret so local
    // testing doesn't crash, but PROD with a short / missing secret
    // would fail the boot-time validator elsewhere.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[md.juniors] JUNIOR_RUNS_HASH_SECRET missing or <32 chars in production",
      );
    }
    // H-3 fix: random per-process secret in dev/test instead of a
    // hard-coded string in source. A leaked source tree can no longer
    // forge an audit chain on a dev cluster.
    cachedSecret = `dev:${randomBytes(32).toString("hex")}`;
    return cachedSecret;
  }
  cachedSecret = raw;
  return cachedSecret;
}

// Test-only reset hook so vitest can swap the env between cases.
export function __resetJuniorHashSecretForTests(): void {
  cachedSecret = null;
}

function rowHashOver(
  secret: string,
  prevHash: string | null,
  canonical: string,
): string {
  const h = createHmac("sha256", secret);
  h.update("junior-runs:v1\n", "utf8");
  h.update(prevHash ?? "GENESIS", "utf8");
  h.update("\n", "utf8");
  h.update(canonical, "utf8");
  return h.digest("hex");
}

// ---------------------------------------------------------------------------
// C-3: cooldown is DB-backed (see `readLastRunMs`), keyed on the
// `idx_junior_runs_org_created` index. The previous in-process Map was
// broken under multi-worker / serverless (every worker had its own
// view). The DB is now the single source of truth and the cost is one
// indexed read per junior run.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function makeJuniorExecutor(deps: JuniorExecutorDeps): JuniorExecutor {
  const { supabase, schemaRegistry } = deps;
  const now = deps.now ?? (() => new Date());
  const secret = deps.hashSecret ?? getHashSecret();

  return Object.freeze({
    async run({
      junior,
      orgId,
      triggerKind,
      payload,
    }: RunJuniorArgs): Promise<RunJuniorOutcome> {
      const runId = randomUUID();
      const startedAt = now().getTime();

      // M-8: kill-switch defence-in-depth. The chat route checks it
      // too, but a future internal caller (cron, event-bus replay)
      // would bypass that gate without this.
      if (process.env.BORJIE_BRAIN_OS_ENABLED === "false") {
        return {
          result: {
            outcome: "skipped_policy",
            proposalsFiled: 0,
            rowsProcessed: 0,
            summary: `junior "${junior.id}" gated by kill-switch`,
            errorMessage: "brain_os_disabled",
          },
          record: null,
          skipped: "no_table_writes",
        };
      }

      // H-1 validation: triggerKind MUST be one of the literal three
      // before we hash it into the chain. A bug elsewhere that emits
      // an unexpected triggerKind would otherwise chain a row no
      // verifier accepts.
      if (!ALLOWED_TRIGGER_KINDS.has(triggerKind)) {
        log.warn("md.juniors.executor.invalid-trigger-kind", {
          orgId,
          juniorId: junior.id,
          triggerKind,
        });
        return {
          result: {
            outcome: "skipped_policy",
            proposalsFiled: 0,
            rowsProcessed: 0,
            summary: `junior "${junior.id}" invalid triggerKind`,
            errorMessage: "invalid_trigger_kind",
          },
          record: null,
          skipped: "payload_invalid",
        };
      }

      // 1. Cooldown gate — DB-backed (C-3). The in-process cache is
      // gone because it doesn't survive multi-worker / serverless. We
      // read the most-recent `junior_runs.created_at` for this
      // (org, junior) and reject if it's inside the cooldown window.
      // The DB index `idx_junior_runs_org_created` covers this.
      const lastRunMs = await readLastRunMs(supabase, orgId, junior.id);
      if (
        lastRunMs !== null &&
        startedAt - lastRunMs < junior.guardrails.cooldownMs
      ) {
        const skipResult: JuniorRunResult = {
          outcome: "rate_limited",
          proposalsFiled: 0,
          rowsProcessed: 0,
          summary: `junior "${junior.id}" rate-limited (cooldown ${junior.guardrails.cooldownMs}ms)`,
        };
        const record = await persistAuditRow({
          supabase,
          secret,
          now,
          orgId,
          junior,
          runId,
          triggerKind,
          result: skipResult,
          durationMs: 0,
        });
        return { result: skipResult, record, skipped: "rate_limited" };
      }

      // 2. Payload validation.
      const parsed = junior.payloadSchema.safeParse(payload);
      if (!parsed.success) {
        const skipResult: JuniorRunResult = {
          outcome: "skipped_policy",
          proposalsFiled: 0,
          rowsProcessed: 0,
          summary: `junior "${junior.id}" payload invalid`,
          errorMessage: parsed.error.issues
            .map((i) => i.message)
            .join("; ")
            .slice(0, 500),
        };
        const record = await persistAuditRow({
          supabase,
          secret,
          now,
          orgId,
          junior,
          runId,
          triggerKind,
          result: skipResult,
          durationMs: 0,
        });
        return { result: skipResult, record, skipped: "payload_invalid" };
      }

      // 3. Hard-budget abort.
      const ac = new AbortController();
      const timer = setTimeout(
        () => ac.abort(new Error("junior_budget_exceeded")),
        junior.guardrails.maxDurationMs,
      );

      // 4. Execute.
      let result: JuniorRunResult;
      try {
        result = await junior.execute({
          orgId,
          juniorId: junior.id,
          triggerKind,
          payload: parsed.data,
          schemaRegistry,
          guardrails: junior.guardrails,
          signal: ac.signal,
          runId,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log.warn("md.juniors.executor.execute-threw", {
          juniorId: junior.id,
          orgId,
          error: message,
        });
        result = {
          outcome: "error",
          proposalsFiled: 0,
          rowsProcessed: 0,
          summary: `junior "${junior.id}" threw: ${message.slice(0, 200)}`,
          errorMessage: message.slice(0, 1000),
        };
      } finally {
        clearTimeout(timer);
      }

      const durationMs = Math.max(0, now().getTime() - startedAt);

      // 5. Persist audit row. C-3 removed the in-process cache write
      // because cooldown is now DB-driven; persistAuditRow is the
      // single source of truth.
      const record = await persistAuditRow({
        supabase,
        secret,
        now,
        orgId,
        junior,
        runId,
        triggerKind,
        result,
        durationMs,
      });

      return { result, record };
    },
  });
}

// ---------------------------------------------------------------------------
// DB-backed cooldown helper (C-3).
// ---------------------------------------------------------------------------

async function readLastRunMs(
  supabase: JuniorExecutorSupabaseLike,
  orgId: string,
  juniorId: string,
): Promise<number | null> {
  try {
    const r = await supabase
      .from("junior_runs")
      .select("created_at")
      .eq("org_id", orgId)
      .eq("junior_id", juniorId)
      .order("created_at", { ascending: false })
      .limit(1);
    const data = (r as { data?: unknown[] }).data;
    if (!Array.isArray(data) || !data[0]) return null;
    const createdAt = (data[0] as { created_at?: unknown }).created_at;
    if (typeof createdAt !== "string") return null;
    const t = new Date(createdAt).getTime();
    return Number.isFinite(t) ? t : null;
  } catch (e) {
    // Fail-OPEN on the cooldown read: a DB outage shouldn't block the
    // junior from running. If we failed CLOSED, a transient outage
    // would starve the entire org. The audit-insert downstream is
    // where we fail CLOSED.
    log.warn("md.juniors.executor.cooldown-read-failed", {
      orgId,
      juniorId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Audit persistence — hash-chain head read + canonical row build + insert.
// ---------------------------------------------------------------------------

interface PersistArgs {
  readonly supabase: JuniorExecutorSupabaseLike;
  readonly secret: string;
  readonly now: () => Date;
  readonly orgId: string;
  readonly junior: MdJuniorPort;
  readonly runId: string;
  readonly triggerKind: MdJuniorPort["trigger"]["kind"];
  readonly result: JuniorRunResult;
  readonly durationMs: number;
}

async function persistAuditRow(
  args: PersistArgs,
): Promise<JuniorRunRecord | null> {
  const {
    supabase,
    secret,
    now,
    orgId,
    junior,
    runId,
    triggerKind,
    result,
    durationMs,
  } = args;

  // H-1: hard caps before hashing. junior.id and orgId are upstream-
  // validated but a future buggy caller could supply something larger;
  // we slice to a known bound so the canonical never blows out the
  // hash budget.
  const safeJuniorId = String(junior.id).slice(0, MAX_JUNIOR_ID_LEN);
  const safeErrorMessage = result.errorMessage
    ? String(result.errorMessage).slice(0, 1000)
    : null;

  // H-2: retry the chain insert up to HASH_RETRY_MAX on a unique-
  // violation. Two concurrent runs for the same org will race the
  // head read + insert; the UNIQUE(org_id, sequence_id) constraint
  // rejects the loser. The loser re-reads the head and tries again
  // with the next sequence id.
  let attempt = 0;
  let prevHash: string | null = null;
  let nextSeq = 1;
  let rowHash = "";
  let canonical = "";
  let createdAt = now().toISOString();
  while (attempt < HASH_RETRY_MAX) {
    attempt += 1;
    // Re-read the head every attempt — losing the race means the
    // sequence we computed is stale.
    prevHash = null;
    nextSeq = 1;
    try {
      const r = await supabase
        .from("junior_runs")
        .select("sequence_id, row_hash")
        .eq("org_id", orgId)
        .order("sequence_id", { ascending: false })
        .limit(1);
      const data = (r as { data?: unknown[] }).data;
      if (Array.isArray(data) && data[0]) {
        const head = data[0] as { sequence_id?: number; row_hash?: string };
        if (typeof head.row_hash === "string") prevHash = head.row_hash;
        if (typeof head.sequence_id === "number")
          nextSeq = head.sequence_id + 1;
      }
    } catch (e) {
      log.warn("md.juniors.executor.head-read-failed", {
        orgId,
        attempt,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    createdAt = now().toISOString();
    // H-1: canonical uses sliced + validated values only. The array
    // form keeps it deterministic; JSON.stringify of a plain array of
    // primitives never reorders fields.
    canonical = JSON.stringify([
      orgId,
      safeJuniorId,
      triggerKind,
      result.outcome,
      result.proposalsFiled,
      result.rowsProcessed,
      durationMs,
      safeErrorMessage,
      nextSeq,
      runId,
      createdAt,
    ]);
    if (canonical.length > MAX_CANONICAL_BYTES) {
      log.warn("md.juniors.executor.canonical-too-long", {
        orgId,
        juniorId: safeJuniorId,
        length: canonical.length,
      });
      return null;
    }
    rowHash = rowHashOver(secret, prevHash, canonical);

    const row = {
      id: runId,
      org_id: orgId,
      junior_id: safeJuniorId,
      trigger_kind: triggerKind,
      trigger_payload: null,
      outcome: result.outcome,
      proposals_filed: result.proposalsFiled,
      rows_processed: result.rowsProcessed,
      duration_ms: durationMs,
      error_message: safeErrorMessage,
      sequence_id: nextSeq,
      prev_hash: prevHash,
      row_hash: rowHash,
      created_at: createdAt,
    };

    try {
      const r = await supabase.from("junior_runs").insert([row]);
      const err = (r as { error?: { message: string } | null }).error;
      if (err) {
        // PG unique-violation = '23505'. Try again if it looks like a
        // race; bail on anything else.
        const msg = err.message.toLowerCase();
        const isUniqueViolation =
          msg.includes("23505") ||
          msg.includes("unique") ||
          msg.includes("duplicate");
        if (isUniqueViolation && attempt < HASH_RETRY_MAX) {
          log.debug("md.juniors.executor.audit-insert-race", {
            orgId,
            juniorId: safeJuniorId,
            attempt,
          });
          continue;
        }
        log.warn("md.juniors.executor.audit-insert-failed", {
          orgId,
          juniorId: safeJuniorId,
          attempt,
          error: err.message,
        });
        return null;
      }
      break; // success
    } catch (e) {
      log.warn("md.juniors.executor.audit-insert-threw", {
        orgId,
        juniorId: safeJuniorId,
        attempt,
        error: e instanceof Error ? e.message : String(e),
      });
      // LOW-1: explicit control flow. Bail on final attempt; otherwise
      // fall through to the next iteration (re-read head + retry).
      if (attempt >= HASH_RETRY_MAX) return null;
      continue;
    }
  }

  return Object.freeze({
    id: runId,
    orgId,
    juniorId: safeJuniorId,
    triggerKind,
    outcome: result.outcome,
    proposalsFiled: result.proposalsFiled,
    rowsProcessed: result.rowsProcessed,
    durationMs,
    errorMessage: safeErrorMessage,
    sequenceId: nextSeq,
    prevHash,
    rowHash,
    createdAt,
  });
}

// ---------------------------------------------------------------------------
// Test-only utility: kept for back-compat with tests that called it
// during the in-process-cache era. Now a no-op since cooldown lives in
// the DB; tests should reset the audit rows in their fake supabase
// instead.
// ---------------------------------------------------------------------------

export function __resetJuniorCooldownCacheForTests(): void {
  // intentionally empty — cooldown is DB-backed (C-3)
}
