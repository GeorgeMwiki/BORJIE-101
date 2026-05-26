/**
 * Journal repository — append-only, hash-chained (spec §5).
 *
 * Two implementations:
 *   - createInMemoryJournalRepository — reference impl for tests and
 *     for the in-process worker before SQL is wired.
 *   - createSqlJournalRepository       — Postgres impl via the caller's
 *     Drizzle client. Mirrors the cognitive-memory storage pattern.
 *
 * Invariants enforced at this layer:
 *   - `(tenant_id, tick_no)` is unique. Duplicate writes throw.
 *   - `prev_hash` of entry N MUST equal `audit_hash` of entry N-1
 *     (or null for the genesis tick).
 *   - `audit_hash` is computed by `computeJournalHash` — the caller
 *     does NOT supply it; this is the *only* place hashes are produced
 *     so the chain invariant is enforced single-handedly.
 *
 * The hash chain can be verified end-to-end by walking entries in
 * tick_no order and re-running `computeJournalHash`.
 */

import { randomUUID } from 'node:crypto';

import { computeJournalHash } from '../audit/hash-chain.js';
import { WorkCycleError, type JournalEntry } from '../types.js';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface AppendJournalInput {
  readonly tenant_id: string;
  readonly tick_no: bigint;
  readonly started_at: string;
  readonly ended_at: string;
  readonly mode: JournalEntry['mode'];
  readonly inputs: JournalEntry['inputs'];
  readonly outputs: JournalEntry['outputs'];
  readonly cost_usd_cents: number;
  readonly prev_hash: string | null;
}

export interface JournalRepository {
  /**
   * Append a new journal entry. Throws on duplicate `(tenant_id, tick_no)`.
   * Returns the freshly-projected entry (immutable).
   */
  append(input: AppendJournalInput): Promise<JournalEntry>;

  /**
   * Read the last entry for `tenantId`, or null if no entries yet.
   * Used by the runner to seed `prev_hash` for the next tick.
   */
  readLast(tenantId: string): Promise<JournalEntry | null>;

  /**
   * Read the last K entries for `tenantId` in *descending* tick_no
   * order (newest first). K=20 default.
   */
  readLastK(tenantId: string, k: number): Promise<ReadonlyArray<JournalEntry>>;

  /**
   * Count of entries for `tenantId`.
   */
  countFor(tenantId: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export function createInMemoryJournalRepository(
  initial: ReadonlyArray<JournalEntry> = [],
): JournalRepository {
  // tenant_id -> entries (in tick_no order)
  const store: Map<string, JournalEntry[]> = new Map();
  for (const entry of initial) {
    const existing = store.get(entry.tenant_id) ?? [];
    store.set(entry.tenant_id, [...existing, entry]);
  }

  return {
    async append(input) {
      const existing = store.get(input.tenant_id) ?? [];
      // Enforce uniqueness on (tenant_id, tick_no).
      for (const e of existing) {
        if (e.tick_no === input.tick_no) {
          throw new WorkCycleError(
            'journal.duplicate_tick',
            `tick_no ${input.tick_no.toString()} already journaled for tenant ${input.tenant_id}`,
          );
        }
      }
      // Enforce chain continuity.
      const last = existing[existing.length - 1];
      const expectedPrev = last ? last.audit_hash : null;
      if (input.prev_hash !== expectedPrev) {
        throw new WorkCycleError(
          'journal.prev_hash_mismatch',
          `prev_hash mismatch for tenant ${input.tenant_id}: expected ${expectedPrev ?? '<null>'} got ${input.prev_hash ?? '<null>'}`,
        );
      }
      const auditHash = computeJournalHash({
        prev_hash: input.prev_hash,
        payload: {
          tick_no: input.tick_no,
          tenant_id: input.tenant_id,
          started_at: input.started_at,
          ended_at: input.ended_at,
          mode: input.mode,
          inputs: input.inputs,
          outputs: input.outputs,
          cost_usd_cents: input.cost_usd_cents,
        },
      });
      const entry: JournalEntry = Object.freeze({
        id: randomUUID(),
        tenant_id: input.tenant_id,
        tick_no: input.tick_no,
        started_at: input.started_at,
        ended_at: input.ended_at,
        mode: input.mode,
        inputs: input.inputs,
        outputs: input.outputs,
        cost_usd_cents: input.cost_usd_cents,
        audit_hash: auditHash,
        prev_hash: input.prev_hash,
      });
      store.set(input.tenant_id, [...existing, entry]);
      return entry;
    },

    async readLast(tenantId) {
      const rows = store.get(tenantId);
      if (!rows || rows.length === 0) return null;
      return rows[rows.length - 1] ?? null;
    },

    async readLastK(tenantId, k) {
      const rows = store.get(tenantId);
      if (!rows || rows.length === 0) return [];
      const sliceStart = Math.max(0, rows.length - k);
      // Return newest first — slice from the tail then reverse.
      return [...rows.slice(sliceStart)].reverse();
    },

    async countFor(tenantId) {
      const rows = store.get(tenantId);
      return rows ? rows.length : 0;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL implementation port (caller provides the Drizzle client)
// ---------------------------------------------------------------------------

/**
 * SQL driver port. Kept abstract so this package does not directly
 * depend on Drizzle; the host wires its `db` to satisfy the four
 * methods. Mirrors the pattern used by `@borjie/cognitive-memory`.
 */
export interface JournalSqlDriver {
  insertJournalRow(args: {
    readonly tenant_id: string;
    readonly tick_no: bigint;
    readonly started_at: string;
    readonly ended_at: string;
    readonly mode: string;
    readonly inputs: unknown;
    readonly outputs: unknown;
    readonly cost_usd_cents: number;
    readonly audit_hash: string;
    readonly prev_hash: string | null;
  }): Promise<{ readonly id: string }>;

  readLastJournalRow(tenantId: string): Promise<JournalEntry | null>;

  readLastKJournalRows(
    tenantId: string,
    k: number,
  ): Promise<ReadonlyArray<JournalEntry>>;

  countJournalRows(tenantId: string): Promise<number>;
}

export function createSqlJournalRepository(args: {
  readonly driver: JournalSqlDriver;
}): JournalRepository {
  const { driver } = args;
  return {
    async append(input) {
      const last = await driver.readLastJournalRow(input.tenant_id);
      const expectedPrev = last ? last.audit_hash : null;
      if (input.prev_hash !== expectedPrev) {
        throw new WorkCycleError(
          'journal.prev_hash_mismatch',
          `prev_hash mismatch for tenant ${input.tenant_id}`,
        );
      }
      const auditHash = computeJournalHash({
        prev_hash: input.prev_hash,
        payload: {
          tick_no: input.tick_no,
          tenant_id: input.tenant_id,
          started_at: input.started_at,
          ended_at: input.ended_at,
          mode: input.mode,
          inputs: input.inputs,
          outputs: input.outputs,
          cost_usd_cents: input.cost_usd_cents,
        },
      });
      const { id } = await driver.insertJournalRow({
        tenant_id: input.tenant_id,
        tick_no: input.tick_no,
        started_at: input.started_at,
        ended_at: input.ended_at,
        mode: input.mode,
        inputs: input.inputs,
        outputs: input.outputs,
        cost_usd_cents: input.cost_usd_cents,
        audit_hash: auditHash,
        prev_hash: input.prev_hash,
      });
      return Object.freeze({
        id,
        tenant_id: input.tenant_id,
        tick_no: input.tick_no,
        started_at: input.started_at,
        ended_at: input.ended_at,
        mode: input.mode,
        inputs: input.inputs,
        outputs: input.outputs,
        cost_usd_cents: input.cost_usd_cents,
        audit_hash: auditHash,
        prev_hash: input.prev_hash,
      });
    },

    async readLast(tenantId) {
      return driver.readLastJournalRow(tenantId);
    },

    async readLastK(tenantId, k) {
      return driver.readLastKJournalRows(tenantId, k);
    },

    async countFor(tenantId) {
      return driver.countJournalRows(tenantId);
    },
  };
}
