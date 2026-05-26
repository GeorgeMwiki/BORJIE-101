/**
 * Hash-chain helper for the work cycle journal.
 *
 * Wraps `@borjie/audit-hash-chain` so the journal repos can compute the
 * next entry's `audit_hash` deterministically from the previous entry's
 * hash plus the canonical-JSON payload. Pure, no I/O.
 *
 * The chain invariant: for tick N,
 *   audit_hash[N] = sha256(canonical_json({
 *     prev:    audit_hash[N-1] ?? GENESIS_HASH,
 *     payload: { tick_no, tenant_id, started_at, ended_at, mode,
 *                inputs, outputs, cost_usd_cents }
 *   }))
 */

import { hashChainEntry, GENESIS_HASH } from '@borjie/audit-hash-chain';

import type { TickInput, TickOutput, WorkCycleMode } from '../types.js';

export interface JournalHashPayload {
  readonly tick_no: bigint;
  readonly tenant_id: string;
  readonly started_at: string;
  readonly ended_at: string;
  readonly mode: WorkCycleMode;
  readonly inputs: TickInput;
  readonly outputs: TickOutput;
  readonly cost_usd_cents: number;
}

/**
 * Compute the audit_hash for a new journal entry.
 *
 * `prev_hash` is the last entry's audit_hash, or null/undefined for the
 * very first tick (which falls back to the audit-hash-chain
 * `GENESIS_HASH` constant).
 */
export function computeJournalHash(args: {
  readonly prev_hash: string | null | undefined;
  readonly payload: JournalHashPayload;
}): string {
  // bigint is not JSON-serialisable; canonicalize to string for the
  // hash domain. The DB stores tick_no as bigint; tests and consumers
  // recover the bigint via `BigInt(row.tick_no)`.
  const canonicalPayload = {
    tick_no: args.payload.tick_no.toString(),
    tenant_id: args.payload.tenant_id,
    started_at: args.payload.started_at,
    ended_at: args.payload.ended_at,
    mode: args.payload.mode,
    inputs: serialiseTickInput(args.payload.inputs),
    outputs: args.payload.outputs as unknown as Record<string, unknown>,
    cost_usd_cents: args.payload.cost_usd_cents,
  } satisfies Record<string, unknown>;

  return hashChainEntry({
    prev: args.prev_hash ?? GENESIS_HASH,
    payload: canonicalPayload,
  });
}

function serialiseTickInput(input: TickInput): Record<string, unknown> {
  return {
    tenant_id: input.tenant_id,
    tick_no: input.tick_no.toString(),
    mode: input.mode,
    last_hash: input.last_hash,
    recall: input.recall,
    pending_threads: input.pending_threads,
    clock_iso: input.clock_iso,
  };
}

export { GENESIS_HASH };
