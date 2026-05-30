/**
 * Process-event log service — append-only, per-org hash-chained.
 *
 * Mirrors the junior-runs executor's audit pattern: each insert reads
 * the chain head, computes the next sequence_id + HMAC-SHA256 row_hash
 * over a canonical payload, and inserts. Retries up to 3 times on a
 * unique-violation so concurrent appends across workers don't lose
 * data.
 *
 * Hash secret comes from `PROCESS_EVENTS_HASH_SECRET` in production;
 * a random per-process secret stands in for dev/test. Leak of the DB
 * key alone cannot forge a valid row_hash.
 *
 * @module features/central-command/md/process-mining/event-log-service
 */

import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { createLogger } from "@/lib/logger";

import {
  processEventSchema,
  type ProcessEventInput,
  type ProcessEventRecord,
} from "./types";

const log = createLogger("md.process-mining.event-log");

const MAX_CANONICAL_BYTES = 8 * 1024;
const APPEND_RETRY_MAX = 3;

// ---------------------------------------------------------------------------
// Supabase shape (loose — same contract as the rest of the MD slice).
// ---------------------------------------------------------------------------

export interface EventLogSupabaseLike {
  from(table: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    select(cols?: string): any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    insert(rows: unknown): any;
  };
}

// ---------------------------------------------------------------------------
// Hash secret — env-backed, lazy, cached.
// ---------------------------------------------------------------------------

let cachedSecret: string | null = null;

function getHashSecret(): string {
  if (cachedSecret) return cachedSecret;
  const raw = process.env.PROCESS_EVENTS_HASH_SECRET;
  if (!raw || raw.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[md.process-mining] PROCESS_EVENTS_HASH_SECRET missing or <32 chars in production",
      );
    }
    cachedSecret = `dev:${randomBytes(32).toString("hex")}`;
    return cachedSecret;
  }
  cachedSecret = raw;
  return cachedSecret;
}

export function __resetProcessEventsHashSecretForTests(): void {
  cachedSecret = null;
}

function rowHashOver(
  secret: string,
  prevHash: string | null,
  canonical: string,
): string {
  const h = createHmac("sha256", secret);
  h.update("process-events:v1\n", "utf8");
  h.update(prevHash ?? "GENESIS", "utf8");
  h.update("\n", "utf8");
  h.update(canonical, "utf8");
  return h.digest("hex");
}

// ---------------------------------------------------------------------------
// Public ports
// ---------------------------------------------------------------------------

export interface AppendEventArgs {
  readonly orgId: string;
  readonly event: ProcessEventInput;
}

export interface AppendEventResult {
  readonly ok: boolean;
  readonly record?: ProcessEventRecord;
  readonly error?: string;
}

export interface AppendManyResult {
  readonly ok: boolean;
  readonly appended: number;
  readonly records: ReadonlyArray<ProcessEventRecord>;
  readonly failed: ReadonlyArray<{
    readonly caseId: string;
    readonly activity: string;
    readonly error: string;
  }>;
}

export interface EventLogService {
  /** Append one event. Hash-chained + retry on UNIQUE violation. */
  append(args: AppendEventArgs): Promise<AppendEventResult>;
  /** Append a batch — sequential to keep the hash chain ordered. */
  appendMany(
    orgId: string,
    events: ReadonlyArray<ProcessEventInput>,
  ): Promise<AppendManyResult>;
  /** Read events for a window. Used by the mapper junior. */
  read(
    orgId: string,
    processKey: string,
    windowStart: string,
    windowEnd: string,
    maxRows?: number,
  ): Promise<ReadonlyArray<ProcessEventRecord>>;
}

export interface EventLogServiceDeps {
  readonly supabase: EventLogSupabaseLike;
  readonly hashSecret?: string;
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function makeEventLogService(
  deps: EventLogServiceDeps,
): EventLogService {
  const { supabase } = deps;
  const now = deps.now ?? (() => new Date());
  const secret = deps.hashSecret ?? getHashSecret();

  return Object.freeze({
    async append({
      orgId,
      event,
    }: AppendEventArgs): Promise<AppendEventResult> {
      const parsed = processEventSchema.safeParse(event);
      if (!parsed.success) {
        return {
          ok: false,
          error: `invalid_event: ${parsed.error.issues
            .map((i) => i.message)
            .join(", ")}`,
        };
      }
      const e = parsed.data;
      const record = await appendOne(supabase, secret, orgId, e, now);
      if (!record) return { ok: false, error: "append_failed" };
      return { ok: true, record };
    },

    async appendMany(
      orgId: string,
      events: ReadonlyArray<ProcessEventInput>,
    ): Promise<AppendManyResult> {
      const records: ProcessEventRecord[] = [];
      const failed: Array<{
        caseId: string;
        activity: string;
        error: string;
      }> = [];
      for (const event of events) {
        const parsed = processEventSchema.safeParse(event);
        if (!parsed.success) {
          failed.push({
            caseId: event.caseId ?? "?",
            activity: event.activity ?? "?",
            error: parsed.error.issues.map((i) => i.message).join(", "),
          });
          continue;
        }
        const rec = await appendOne(supabase, secret, orgId, parsed.data, now);
        if (rec) records.push(rec);
        else
          failed.push({
            caseId: event.caseId,
            activity: event.activity,
            error: "append_failed",
          });
      }
      return {
        ok: failed.length === 0,
        appended: records.length,
        records: Object.freeze(records),
        failed: Object.freeze(failed),
      };
    },

    async read(
      orgId: string,
      processKey: string,
      windowStart: string,
      windowEnd: string,
      maxRows = 50_000,
    ): Promise<ReadonlyArray<ProcessEventRecord>> {
      try {
        const r = await supabase
          .from("process_events")
          .select(
            "id, org_id, process_key, case_id, activity, actor_kind, actor_id, attributes, occurred_at, sequence_id, prev_hash, row_hash, created_at",
          )
          .eq("org_id", orgId)
          .eq("process_key", processKey)
          .gte("occurred_at", windowStart)
          .lte("occurred_at", windowEnd)
          .order("occurred_at", { ascending: true })
          .limit(Math.min(maxRows, 100_000));
        const data = (r as { data?: unknown[] }).data;
        if (!Array.isArray(data)) return [];
        return Object.freeze(
          data.map((row) => mapEventRow(row as Record<string, unknown>)),
        );
      } catch (e) {
        log.warn("md.process-mining.event-log.read-failed", {
          orgId,
          processKey,
          error: e instanceof Error ? e.message : String(e),
        });
        return [];
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Single append with retry on unique-violation
// ---------------------------------------------------------------------------

async function appendOne(
  supabase: EventLogSupabaseLike,
  secret: string,
  orgId: string,
  event: ProcessEventInput,
  now: () => Date,
): Promise<ProcessEventRecord | null> {
  let attempt = 0;
  while (attempt < APPEND_RETRY_MAX) {
    attempt += 1;
    let prevHash: string | null = null;
    let nextSeq = 1;
    try {
      const r = await supabase
        .from("process_events")
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
      log.warn("md.process-mining.event-log.head-read-failed", {
        orgId,
        attempt,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const id = randomUUID();
    const createdAt = now().toISOString();
    const canonical = JSON.stringify([
      orgId,
      event.processKey,
      event.caseId,
      event.activity,
      event.actorKind,
      event.actorId,
      event.occurredAt,
      JSON.stringify(event.attributes ?? null),
      nextSeq,
      id,
    ]);
    if (canonical.length > MAX_CANONICAL_BYTES) {
      log.warn("md.process-mining.event-log.canonical-too-long", {
        orgId,
        length: canonical.length,
      });
      return null;
    }
    const rowHash = rowHashOver(secret, prevHash, canonical);

    const row = {
      id,
      org_id: orgId,
      process_key: event.processKey,
      case_id: event.caseId,
      activity: event.activity,
      actor_kind: event.actorKind,
      actor_id: event.actorId,
      attributes: event.attributes ?? null,
      occurred_at: event.occurredAt,
      sequence_id: nextSeq,
      prev_hash: prevHash,
      row_hash: rowHash,
      created_at: createdAt,
    };

    try {
      const r = await supabase.from("process_events").insert([row]);
      const err = (r as { error?: { message: string } | null }).error;
      if (err) {
        const msg = err.message.toLowerCase();
        const isUnique =
          msg.includes("23505") ||
          msg.includes("unique") ||
          msg.includes("duplicate");
        if (isUnique && attempt < APPEND_RETRY_MAX) {
          log.debug("md.process-mining.event-log.append-race", {
            orgId,
            attempt,
          });
          continue;
        }
        log.warn("md.process-mining.event-log.append-failed", {
          orgId,
          attempt,
          error: err.message,
        });
        return null;
      }
      return Object.freeze({
        id,
        orgId,
        processKey: event.processKey,
        caseId: event.caseId,
        activity: event.activity,
        actorKind: event.actorKind,
        actorId: event.actorId,
        attributes: event.attributes,
        occurredAt: event.occurredAt,
        sequenceId: nextSeq,
        prevHash,
        rowHash,
        createdAt,
      });
    } catch (e) {
      log.warn("md.process-mining.event-log.append-threw", {
        orgId,
        attempt,
        error: e instanceof Error ? e.message : String(e),
      });
      if (attempt >= APPEND_RETRY_MAX) return null;
      continue;
    }
  }
  return null;
}

function mapEventRow(row: Record<string, unknown>): ProcessEventRecord {
  return Object.freeze({
    id: String(row.id ?? ""),
    orgId: String(row.org_id ?? ""),
    processKey: String(row.process_key ?? ""),
    caseId: String(row.case_id ?? ""),
    activity: String(row.activity ?? ""),
    actorKind: row.actor_kind as ProcessEventRecord["actorKind"],
    actorId: String(row.actor_id ?? ""),
    attributes:
      row.attributes && typeof row.attributes === "object"
        ? (row.attributes as Record<string, unknown>)
        : undefined,
    occurredAt: String(row.occurred_at ?? ""),
    sequenceId: Number(row.sequence_id ?? 0),
    prevHash: (row.prev_hash as string | null) ?? null,
    rowHash: String(row.row_hash ?? ""),
    createdAt: String(row.created_at ?? ""),
  });
}
