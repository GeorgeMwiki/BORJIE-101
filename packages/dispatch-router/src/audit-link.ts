/**
 * Piece L — Audit chain helpers.
 *
 * Capture rows and proposal rows BOTH hash-chain into `ai_audit_chain`
 * (the tamper-evident AI-turn log from Wave-11). This module computes
 * the next chain link given the previous link's hash; the writes
 * themselves are owned by an injected port so the dispatcher does not
 * depend on `@borjie/database` at type-check time.
 */

import { createHash } from 'crypto';
import type { AuditChainLink } from './types.js';

/**
 * Compute the SHA-256 hash for the next audit-chain link.
 *
 * The hash is a function of:
 *   - the previous link's hash
 *   - the action name (e.g. 'capture_emitted')
 *   - a deterministic JSON serialisation of the payload
 *
 * Determinism matters: a chain verifier recomputes hashes from
 * persisted payloads and compares against `this_hash`. Any
 * non-determinism (Date.now(), Map iteration order, etc.) would
 * break the verify step.
 */
export function computeChainHash(args: {
  readonly prev_hash: string;
  readonly action: string;
  readonly payload: Record<string, unknown>;
}): string {
  const stableJson = stableStringify(args.payload);
  const input = `${args.prev_hash}|${args.action}|${stableJson}`;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Build the new audit-chain link record.
 */
export function buildChainLink(args: {
  readonly id: string;
  readonly tenant_id: string;
  readonly turn_id: string;
  readonly session_id?: string | null;
  readonly action: string;
  readonly prev_hash: string;
  readonly payload: Record<string, unknown>;
  readonly sequence_id: number;
}): AuditChainLink {
  const this_hash = computeChainHash({
    prev_hash: args.prev_hash,
    action: args.action,
    payload: args.payload,
  });
  return {
    id: args.id,
    tenant_id: args.tenant_id,
    turn_id: args.turn_id,
    session_id: args.session_id ?? null,
    action: args.action,
    prev_hash: args.prev_hash,
    this_hash,
    payload: args.payload,
    sequence_id: args.sequence_id,
  };
}

/**
 * Deterministic JSON serialisation — keys sorted lexicographically at
 * every nesting level. Required for chain-hash stability across runtimes.
 */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'undefined') return 'null';
  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) return 'null';
    return JSON.stringify(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const parts = value.map((v) => stableStringify(v));
    return `[${parts.join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
    return `{${parts.join(',')}}`;
  }
  // Function / symbol / bigint — coerce to null (audit shouldn't contain these)
  return 'null';
}

/**
 * Audit-chain sink port. Implementations write the link to the
 * `ai_audit_chain` table and return the sequence id used. The
 * dispatcher calls this AFTER computing the hash with the previous
 * link's hash that the sink also tracks.
 */
export interface AuditChainSink {
  /**
   * Append a new link to the chain. The sink is responsible for:
   *   - looking up the latest hash + sequence for (tenant_id)
   *   - computing the new sequence_id
   *   - persisting the link
   *
   * Returns the persisted link with `this_hash` + `sequence_id` filled.
   */
  append(args: {
    readonly tenant_id: string;
    readonly turn_id: string;
    readonly session_id?: string | null;
    readonly action: string;
    readonly payload: Record<string, unknown>;
  }): Promise<AuditChainLink>;
}

/**
 * In-memory audit-chain sink — for tests + the demo flow. Maintains
 * per-tenant chain state in a Map. Production wires a Postgres-backed
 * sink that uses the existing `ai_audit_chain` schema via Drizzle.
 */
export function createInMemoryAuditChainSink(): AuditChainSink & {
  readonly snapshot: (tenant_id: string) => ReadonlyArray<AuditChainLink>;
} {
  const chains = new Map<string, AuditChainLink[]>();

  const next = (tenant_id: string): { prev_hash: string; sequence_id: number } => {
    const chain = chains.get(tenant_id);
    if (!chain || chain.length === 0) {
      return { prev_hash: 'GENESIS', sequence_id: 1 };
    }
    const last = chain[chain.length - 1];
    if (!last) {
      return { prev_hash: 'GENESIS', sequence_id: 1 };
    }
    return { prev_hash: last.this_hash, sequence_id: last.sequence_id + 1 };
  };

  return {
    async append(args) {
      const { prev_hash, sequence_id } = next(args.tenant_id);
      const id = `audit_${args.tenant_id}_${sequence_id}`;
      const link = buildChainLink({
        id,
        tenant_id: args.tenant_id,
        turn_id: args.turn_id,
        session_id: args.session_id ?? null,
        action: args.action,
        prev_hash,
        payload: args.payload,
        sequence_id,
      });
      const chain = chains.get(args.tenant_id) ?? [];
      chain.push(link);
      chains.set(args.tenant_id, chain);
      return link;
    },
    snapshot(tenant_id) {
      return [...(chains.get(tenant_id) ?? [])];
    },
  };
}
