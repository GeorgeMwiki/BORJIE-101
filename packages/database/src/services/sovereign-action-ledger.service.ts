/**
 * Sovereign action ledger — append-only hash-chained service.
 *
 * Three operations:
 *
 *   appendLedgerEntry(entry)        — INSERT a new row, computing
 *     payload_hash, prev_hash (= latest this_hash for the tenant, or
 *     GENESIS_HASH), and this_hash inline. Returns `{ id, thisHash }`.
 *
 *   getLedgerTail(tenantId, n)      — SELECT the last n rows ordered by
 *     (executed_at DESC, id DESC). Powers the operator dashboard tail
 *     and is the read used by `verifyLedgerChain` to fetch the head.
 *
 *   verifyLedgerChain(tenantId)     — walks every row for the tenant in
 *     chain order (executed_at, id) and re-derives `this_hash` from
 *     `prev_hash || tenant_id || action_type || payload_hash
 *     || executed_at_iso`. Returns `{ ok: true, count }` when every
 *     row checks; `{ ok: false, brokenAt, expected, actual, ... }`
 *     on the first mismatch.
 *
 * LITFIN parity:
 *   `audit-ledger.ts:46-71` — same column shape
 *   `audit-ledger.ts:77-100` — same `computeLedgerHash` semantics
 *   `audit-ledger.ts:260-299` — same forward-walk verifier
 *
 * Errors:
 *   - DB errors on append() are RETHROWN — the caller must know that
 *     the ledger write failed (audit-grade requirement; we never lose
 *     an executed action silently).
 *   - DB errors on getLedgerTail() / verifyLedgerChain() are logged
 *     and surface as `{ ok: false, reason: 'db-error', ... }`.
 *
 * Concurrency:
 *   appendLedgerEntry uses an advisory-locked SELECT-then-INSERT inside
 *   a transaction so two simultaneous appends on the same tenant can't
 *   race and write the same prev_hash. The lock key is derived from a
 *   stable hash of `tenant_id`.
 */
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import {

  sovereignActionLedger,
  GENESIS_HASH,
} from '../schemas/sovereign-action-ledger.schema.js';
import { logger } from '../logger.js';
import type { DatabaseClient } from '../client.js';

export interface SovereignLedgerAppendArgs {
  readonly tenantId: string;
  readonly actionType: string;
  readonly payloadJson: Record<string, unknown>;
  readonly proposer: string;
  readonly approvers: ReadonlyArray<string>;
  readonly executedAt: Date;
  /**
   * Optional reversal-plan payload (Phase D D2). Persisted alongside
   * the chain row so operators can drive a recovery workflow if a
   * sovereign action needs to be undone. NOT included in the hash
   * chain — verifyLedgerChain walks the existing hash inputs
   * untouched.
   */
  readonly rollbackPayload?: unknown;
}

export interface SovereignLedgerRow {
  readonly id: string;
  readonly tenantId: string;
  readonly actionType: string;
  readonly payloadJson: Record<string, unknown>;
  readonly payloadHash: string;
  readonly proposer: string;
  readonly approvers: ReadonlyArray<string>;
  readonly executedAt: string;
  readonly prevHash: string;
  readonly thisHash: string;
  readonly capturedAt: string;
}

export interface SovereignLedgerAppendResult {
  readonly id: string;
  readonly thisHash: string;
  readonly prevHash: string;
}

export type SovereignLedgerVerifyResult =
  | { readonly ok: true; readonly count: number }
  | {
      readonly ok: false;
      readonly count: number;
      readonly brokenAt: string;
      readonly expected: string;
      readonly actual: string;
      readonly reason: 'hash-mismatch' | 'prev-hash-mismatch' | 'db-error';
    };

/**
 * Row + per-row tamper indicator. Powers the operator dashboard's
 * critical-path verify-on-read surface (HIGH 1.3 — 2026-05-19 sweep).
 * `verified === true` means the row's `this_hash` re-derives from the
 * canonical hash inputs; `false` means a post-hoc mutation broke the
 * chain at this row. The chain CONNECTION to the predecessor is
 * verified by `verifyLedgerChain` (full forward walk) — `verified` here
 * is the per-row self-consistency check that does NOT require
 * predecessor access.
 */
export interface SovereignLedgerVerifiedRow extends SovereignLedgerRow {
  readonly verified: boolean;
}

export interface SovereignActionLedgerService {
  appendLedgerEntry(
    args: SovereignLedgerAppendArgs,
  ): Promise<SovereignLedgerAppendResult>;
  getLedgerTail(
    tenantId: string,
    limit: number,
  ): Promise<ReadonlyArray<SovereignLedgerRow>>;
  /**
   * Variant of `getLedgerTail` that ALSO recomputes each row's
   * `this_hash` and tags the row with a `verified` boolean. Critical-
   * path operator surfaces (e.g. the sovereign-ledger dashboard tail)
   * MUST use this method, not the bare tail — without re-derivation, a
   * tampered row surfaced on the dashboard appears pristine
   * (HIGH 1.3 from the 2026-05-19 post-PR-90 data-layer sweep).
   *
   * NOTE: only the row's SELF-hash is recomputed here. Verifying the
   * chain CONNECTION (this.prev_hash == predecessor.this_hash) requires
   * the full forward walk in `verifyLedgerChain`, because the
   * predecessor is not available in a tail-only read.
   */
  getVerifiedLedgerTail(
    tenantId: string,
    limit: number,
  ): Promise<ReadonlyArray<SovereignLedgerVerifiedRow>>;
  verifyLedgerChain(tenantId: string): Promise<SovereignLedgerVerifyResult>;
  /**
   * Load the optional rollback payload for a previously-recorded
   * sovereign action (Phase D D2). Returns `null` when the row is
   * missing OR when the row has no recorded rollback plan. Errors are
   * logged and surface as `null` so the operator UI can fall back to
   * manual recovery.
   */
  loadRollbackPayload(actionId: string): Promise<unknown | null>;
}

const MAX_TAIL = 1000;
const DEFAULT_TAIL = 100;
const VERIFY_CHUNK = 500;

/**
 * Canonical JSON serialisation — DEEP-SORT every nested object's keys
 * so the hash is stable across producers regardless of insertion order.
 * Mirrors the kernel-side `hashPayload` in
 * `agency/executor/audit-sink.ts` (sha256 of canonical JSON).
 *
 * CRITICAL #5 fix: the previous implementation passed
 * `Object.keys(payload).sort()` as JSON.stringify's replacer-list arg,
 * which only sorts TOP-LEVEL keys. Nested objects retained insertion
 * order, so two semantically-equal payloads could produce different
 * payload_hashes — breaking the ledger chain verifier for any non-flat
 * payload. We now deep-sort recursively. Arrays are NOT sorted (array
 * order IS semantically significant — the verifier must distinguish
 * `[a,b]` from `[b,a]`).
 */
function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    // Preserve array order — semantic ordering matters for sequences.
    return value.map((v) => canonicalize(v));
  }
  const sortedEntries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => [k, canonicalize(v)] as const);
  const out: Record<string, unknown> = {};
  for (const [k, v] of sortedEntries) {
    out[k] = v;
  }
  return out;
}

export function hashPayload(payload: Record<string, unknown> | null): string {
  if (!payload || typeof payload !== 'object') {
    return createHash('sha256').update('null', 'utf8').digest('hex');
  }
  let canonical: string;
  try {
    canonical = JSON.stringify(canonicalize(payload));
  } catch {
    canonical = String(payload);
  }
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ─────────────────────────────────────────────────────────────────────
// Phase D / A2b-1 — PII redaction for ledger payload_json.
//
// Sovereign-action ledger rows live under append-only audit retention.
// Operators have legitimate read access, but ledger payloads must not
// leak raw PII (KRA PIN, NIDA, M-Pesa phone, email) into the
// long-retention surface. We redact-before-write so the persisted JSONB
// column never contains plaintext PII — but the HASH is computed on
// the ORIGINAL payload so the tamper-detection chain stays intact
// (the verifier re-derives the hash from (prev || tenant || type ||
// payload_hash || executed_at) — never from the persisted payload_json
// — so this redaction is invariant-safe).
//
// Patterns mirror `packages/ai-copilot/src/security/pii-scrubber.ts`
// — duplicated locally to avoid a backward dependency edge from the
// `database` package to `ai-copilot` (ai-copilot already imports
// database via the DSAR data-source).
// ─────────────────────────────────────────────────────────────────────

const PAYLOAD_PII_PATTERNS: ReadonlyArray<{
  readonly regex: RegExp;
  readonly replacement: string;
}> = [
  // Kenya KRA PIN — A123456789B
  {
    regex: /\b[A-Z]\d{9}[A-Z]\b/g,
    replacement: '<kra-pin:redacted>',
  },
  // Tanzania NIDA — 20 digits, dash-separated
  {
    regex: /\b(19|20)\d{2}[-\s]?\d{4}[-\s]?\d{5}[-\s]?\d{2,4}\b/g,
    replacement: '[NIDA_ID]',
  },
  // Kenya +254 mobile
  {
    regex: /\b(?:\+?254|0)\s?7\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g,
    replacement: '[PHONE]',
  },
  // Tanzania +255 mobile
  {
    regex: /\b(?:\+?255|0)\s?[67]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g,
    replacement: '[PHONE]',
  },
  // Uganda +256 mobile
  {
    regex: /\b(?:\+?256|0)\s?[37]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g,
    replacement: '[PHONE]',
  },
  // Rwanda +250 mobile
  {
    regex: /\b(?:\+?250|0)\s?[78]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g,
    replacement: '[PHONE]',
  },
  // South Africa +27 mobile
  {
    regex: /\b(?:\+?27|0)\s?[678]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g,
    replacement: '[PHONE]',
  },
  // Nigeria +234 mobile
  {
    regex: /\b(?:\+?234|0)\s?[789]\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g,
    replacement: '[PHONE]',
  },
  // Generic E.164 fallback — anything else that looks like an
  // international phone. ITU-T E.164: 7-15 digits after the country code.
  {
    regex: /\+[1-9]\d{6,14}\b/g,
    replacement: '[PHONE]',
  },
  // Email
  {
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[EMAIL]',
  },
];

function scrubPiiFromString(input: string): string {
  let out = input;
  for (const p of PAYLOAD_PII_PATTERNS) {
    out = out.replace(p.regex, p.replacement);
  }
  return out;
}

/**
 * Walk an unknown JSON-compatible value and scrub PII from every
 * leaf string. Returns a NEW value — never mutates the input.
 */
export function redactPayloadPii<T>(payload: T): T {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload === 'string') {
    return scrubPiiFromString(payload) as unknown as T;
  }
  if (typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) {
    return payload.map((v) => redactPayloadPii(v)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    out[k] = redactPayloadPii(v);
  }
  return out as unknown as T;
}

/**
 * Per-row hash binding the action to its predecessor. Matches LITFIN's
 * `computeLedgerHash`: sha256 of (prev_hash || tenant_id ||
 * action_type || payload_hash || executed_at_iso) joined with a
 * record-separator byte so adjacent column values cannot blur together.
 */
export function computeRowHash(args: {
  readonly prevHash: string;
  readonly tenantId: string;
  readonly actionType: string;
  readonly payloadHash: string;
  readonly executedAt: Date;
}): string {
  const SEP = '\x1f';
  const buf = [
    args.prevHash,
    args.tenantId,
    args.actionType,
    args.payloadHash,
    args.executedAt.toISOString(),
  ].join(SEP);
  return createHash('sha256').update(buf, 'utf8').digest('hex');
}

function tenantLockKey(tenantId: string): number {
  // Stable signed-int64 from sha256(tenantId) — we slice the leading 15
  // hex digits to fit comfortably inside a Postgres BIGINT (53 bits is
  // safe for JS Number). pg_try_advisory_xact_lock accepts BIGINT.
  const digest = createHash('sha256').update(tenantId, 'utf8').digest('hex');
  return Number.parseInt(digest.slice(0, 15), 16);
}

function rowToLedger(row: Record<string, unknown>): SovereignLedgerRow {
  return {
    id: String(row.id ?? ''),
    tenantId: String(row.tenantId ?? row.tenant_id ?? ''),
    actionType: String(row.actionType ?? row.action_type ?? ''),
    payloadJson:
      (row.payloadJson as Record<string, unknown>) ??
      (row.payload_json as Record<string, unknown>) ??
      {},
    payloadHash: String(row.payloadHash ?? row.payload_hash ?? ''),
    proposer: String(row.proposer ?? ''),
    approvers: Array.isArray(row.approvers)
      ? (row.approvers as string[])
      : [],
    executedAt: toIso(row.executedAt ?? row.executed_at),
    prevHash: String(row.prevHash ?? row.prev_hash ?? ''),
    thisHash: String(row.thisHash ?? row.this_hash ?? ''),
    capturedAt: toIso(row.capturedAt ?? row.captured_at),
  };
}

function toIso(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) return asDate.toISOString();
    return value;
  }
  return '';
}

export function createSovereignActionLedgerService(
  db: DatabaseClient,
): SovereignActionLedgerService {
  return {
    async appendLedgerEntry(args) {
      if (!args.tenantId) {
        throw new Error('sovereign-action-ledger.append: tenantId is required');
      }
      if (!args.actionType) {
        throw new Error(
          'sovereign-action-ledger.append: actionType is required',
        );
      }
      if (!args.proposer) {
        throw new Error('sovereign-action-ledger.append: proposer is required');
      }

      // Hash is computed on the ORIGINAL payload — the tamper-detection
      // chain ties to the canonical un-redacted form. Persistence uses
      // the REDACTED form so the long-retention JSONB column never
      // carries plaintext PII. The verifier re-derives the hash from
      // (prev || tenant || type || payload_hash || executed_at) — never
      // from the persisted payload_json — so this redaction is
      // invariant-safe.
      const payloadHash = hashPayload(args.payloadJson);
      const redactedPayload = redactPayloadPii(args.payloadJson);
      const lockKey = tenantLockKey(args.tenantId);
      const id = randomUUID();

      // HIGH-C — Use `pg_advisory_xact_lock` inside an explicit
      // transaction so the lock is AUTO-RELEASED when the transaction
      // ends (commit or rollback). The previous `pg_advisory_lock` is
      // session-scoped; if the pooled connection returned to the pool
      // between acquire and unlock (e.g. a thrown error before the
      // explicit unlock, or pool reset on transaction error), the lock
      // leaked. Wrapping in a transaction with xact-scoped lock makes
      // the contract crash-safe.
      //
      // The transaction is opened via the drizzle `db.transaction`
      // helper when available; fall back to inline execute for stub
      // clients in tests (which mock `execute()`).
      const dbAny = db as unknown as {
        execute(q: unknown): Promise<unknown>;
        transaction?: <T>(
          fn: (tx: typeof db) => Promise<T>,
        ) => Promise<T>;
      };

      async function runInside(
        tx: typeof db | undefined,
      ): Promise<{ id: string; thisHash: string; prevHash: string }> {
        const exec = (tx ?? db) as unknown as {
          execute(q: unknown): Promise<unknown>;
        };
        try {
          await exec.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
        } catch (error) {
          logger.error('sovereign-action-ledger: advisory_xact_lock failed', { error: error });
          throw error instanceof Error
            ? error
            : new Error(
                'sovereign-action-ledger: advisory_xact_lock failed',
              );
        }
        const headRows = (await (tx ?? db)
          .select({ thisHash: sovereignActionLedger.thisHash })
          .from(sovereignActionLedger)
          .where(eq(sovereignActionLedger.tenantId, args.tenantId))
          .orderBy(
            desc(sovereignActionLedger.executedAt),
            desc(sovereignActionLedger.id),
          )
          .limit(1)) as ReadonlyArray<{ thisHash: string }>;
        const prevHash = headRows[0]?.thisHash ?? GENESIS_HASH;
        const thisHash = computeRowHash({
          prevHash,
          tenantId: args.tenantId,
          actionType: args.actionType,
          payloadHash,
          executedAt: args.executedAt,
        });
        try {
          await (tx ?? db).insert(sovereignActionLedger).values({
            id,
            tenantId: args.tenantId,
            actionType: args.actionType,
            payloadJson: redactedPayload as unknown as Record<
              string,
              unknown
            >,
            payloadHash,
            proposer: args.proposer,
            approvers: args.approvers as unknown as Record<
              string,
              unknown
            >[],
            executedAt: args.executedAt,
            prevHash,
            thisHash,
            ...(args.rollbackPayload !== undefined
              ? {
                  rollbackPayload:
                    args.rollbackPayload as unknown as Record<
                      string,
                      unknown
                    >,
                }
              : {}),
          } as never);
        } catch (error) {
          logger.error('sovereign-action-ledger.append insert failed', { error: error });
          throw error instanceof Error
            ? error
            : new Error('sovereign-action-ledger.append failed');
        }
        return { id, thisHash, prevHash };
      }

      if (typeof dbAny.transaction === 'function') {
        return await dbAny.transaction(async (tx) => runInside(tx));
      }
      // Fallback path for stubbed/mocked clients without
      // `.transaction()`. Still issues `pg_advisory_xact_lock` — in a
      // mocked test environment the lock is a no-op, but the SQL emitted
      // matches the production contract so tests can assert on it.
      return await runInside(undefined);
    },

    async getLedgerTail(tenantId, limit) {
      try {
        if (!tenantId) return [];
        const capped = Math.max(
          1,
          Math.min(MAX_TAIL, Math.floor(limit ?? DEFAULT_TAIL)),
        );
        const rows = (await db
          .select()
          .from(sovereignActionLedger)
          .where(eq(sovereignActionLedger.tenantId, tenantId))
          .orderBy(
            desc(sovereignActionLedger.executedAt),
            desc(sovereignActionLedger.id),
          )
          .limit(capped)) as ReadonlyArray<Record<string, unknown>>;
        return (rows ?? []).map(rowToLedger);
      } catch (error) {
        logger.error('sovereign-action-ledger.getLedgerTail failed', { error: error });
        return [];
      }
    },

    async getVerifiedLedgerTail(tenantId, limit) {
      // HIGH 1.3 — verify-on-read for critical-path operator dashboards.
      // For each returned row we recompute this_hash from the canonical
      // hash inputs and tag the row with `verified=true|false`. A row
      // whose stored this_hash diverges from the recomputed value is
      // flagged so the dashboard can surface tampering instead of
      // silently displaying the post-hoc forgery.
      //
      // This is a SELF-check only — the CONNECTION between rows
      // (this.prev_hash == predecessor.this_hash) requires the forward
      // walk in verifyLedgerChain; that should be called separately for
      // load-bearing audit reads.
      try {
        if (!tenantId) return [];
        const rows = await this.getLedgerTail(tenantId, limit);
        return rows.map((r) => {
          let executed: Date;
          try {
            executed = new Date(r.executedAt);
            if (Number.isNaN(executed.getTime())) {
              return { ...r, verified: false };
            }
          } catch {
            return { ...r, verified: false };
          }
          const recomputed = computeRowHash({
            prevHash: r.prevHash,
            tenantId: r.tenantId,
            actionType: r.actionType,
            payloadHash: r.payloadHash,
            executedAt: executed,
          });
          return { ...r, verified: recomputed === r.thisHash };
        });
      } catch (error) {
        logger.error('sovereign-action-ledger.getVerifiedLedgerTail failed', { error: error });
        return [];
      }
    },

    async verifyLedgerChain(tenantId) {
      if (!tenantId) {
        return {
          ok: false,
          count: 0,
          brokenAt: '',
          expected: '',
          actual: '',
          reason: 'db-error',
        };
      }
      let expectedPrev = GENESIS_HASH;
      let count = 0;
      let lastId = '';
      try {
        // Chunked forward walk so we never load >VERIFY_CHUNK rows at
        // once for tenants with deep ledgers. Pagination uses a
        // (executed_at, id) cursor — both monotonically advance within
        // a tenant's chain (id is unique, so ordered after executed_at
        // is a stable tiebreaker).
        let cursorExecutedAt: Date | null = null;
        let cursorId: string | null = null;
        while (true) {
          const where = cursorExecutedAt
            ? and(
                eq(sovereignActionLedger.tenantId, tenantId),
                sql`(${sovereignActionLedger.executedAt}, ${sovereignActionLedger.id}) > (${cursorExecutedAt.toISOString()}::timestamptz, ${cursorId ?? ''})`,
              )
            : eq(sovereignActionLedger.tenantId, tenantId);
          const rows = (await db
            .select()
            .from(sovereignActionLedger)
            .where(where)
            .orderBy(
              sovereignActionLedger.executedAt,
              sovereignActionLedger.id,
            )
            .limit(VERIFY_CHUNK)) as ReadonlyArray<Record<string, unknown>>;
          if (!rows || rows.length === 0) break;
          for (const raw of rows) {
            const r = rowToLedger(raw);
            count += 1;
            lastId = r.id;
            if (r.prevHash !== expectedPrev) {
              return {
                ok: false,
                count,
                brokenAt: r.id,
                expected: expectedPrev,
                actual: r.prevHash,
                reason: 'prev-hash-mismatch',
              };
            }
            const recomputed = computeRowHash({
              prevHash: r.prevHash,
              tenantId: r.tenantId,
              actionType: r.actionType,
              payloadHash: r.payloadHash,
              executedAt: new Date(r.executedAt),
            });
            if (recomputed !== r.thisHash) {
              return {
                ok: false,
                count,
                brokenAt: r.id,
                expected: recomputed,
                actual: r.thisHash,
                reason: 'hash-mismatch',
              };
            }
            expectedPrev = r.thisHash;
            cursorExecutedAt = new Date(r.executedAt);
            cursorId = r.id;
          }
          if (rows.length < VERIFY_CHUNK) break;
        }
        return { ok: true, count };
      } catch (error) {
        logger.error('sovereign-action-ledger.verifyLedgerChain failed', { error: error });
        return {
          ok: false,
          count,
          brokenAt: lastId,
          expected: expectedPrev,
          actual: '',
          reason: 'db-error',
        };
      }
    },

    async loadRollbackPayload(actionId) {
      if (!actionId) return null;
      try {
        const rows = (await db
          .select()
          .from(sovereignActionLedger)
          .where(eq(sovereignActionLedger.id, actionId))
          .limit(1)) as ReadonlyArray<Record<string, unknown>>;
        const first = rows?.[0];
        if (!first) return null;
        const raw =
          (first.rollbackPayload as unknown) ??
          (first.rollback_payload as unknown) ??
          null;
        return raw ?? null;
      } catch (error) {
        logger.error('sovereign-action-ledger.loadRollbackPayload failed', { error: error });
        return null;
      }
    },
  };
}

export { sovereignActionLedger, GENESIS_HASH };
