/**
 * Audit emitter — every lock / improve / promote / reject writes a
 * tamper-evident entry on the platform's hash chain.
 *
 * The chain primitive lives in `@borjie/audit-hash-chain`. It is pure
 * (no I/O), so this module owns BOTH the sealing AND the persistence
 * decision. Persistence is delegated to a `ChainStore` port; production
 * wires that against the `audit_hash_chain` Postgres table. Tests use
 * an in-memory chain.
 *
 * Why a per-tenant + a global chain? §5 of the spec says the chain has
 * to be independently verifiable by the regulator. We separate the
 * tenant-scoped events (which mention specific tenant proposals) from
 * the global product-wide events (lock-candidate markers, lock
 * decisions on global recipes). A consumer can then verify per-tenant
 * chains without seeing other tenants' data. The store is responsible
 * for picking the right chain.
 */

import {
  appendEntry,
  hashChainEntry,
  type ChainEntry,
  type AuditPayload,
} from '@borjie/audit-hash-chain';

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface ChainStore {
  /** Load the most recent N entries for the chain identified by
   *  `chainId`. Used to compute `prev` for the next entry. */
  loadTail(chainId: string, n: number): Promise<ReadonlyArray<ChainEntry>>;
  /** Persist a newly-sealed entry. */
  appendEntry(args: {
    readonly chainId: string;
    readonly entry: ChainEntry;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Audit kinds we emit
// ---------------------------------------------------------------------------

export type AuditKind =
  | 'proposal.created'
  | 'proposal.approved'
  | 'proposal.rejected'
  | 'recipe.locked'
  | 'recipe.lock_candidate.marked'
  | 'recipe.deprecated';

export interface AuditEvent {
  readonly kind: AuditKind;
  readonly tenantId?: string;
  readonly payload: AuditPayload;
}

// ---------------------------------------------------------------------------
// Public emitter
// ---------------------------------------------------------------------------

export interface AuditEmitter {
  /** Returns the rowHash of the sealed entry. */
  append(event: AuditEvent): Promise<string>;
}

export interface CreateAuditEmitterArgs {
  readonly store: ChainStore;
  readonly secretId?: string;
  readonly secretValue?: string;
  /** Override clock for tests. */
  readonly now?: () => Date;
}

export function createAuditEmitter(args: CreateAuditEmitterArgs): AuditEmitter {
  const clock = args.now ?? (() => new Date());

  return {
    async append(event) {
      const chainId = event.tenantId ? `tenant:${event.tenantId}` : 'global';
      const tail = await args.store.loadTail(chainId, 1);
      const sealedAtIso = clock().toISOString();
      const enrichedPayload = enrichPayload(event, sealedAtIso);
      const next = appendEntry(tail, enrichedPayload, {
        sealedAtIso,
        ...(args.secretId !== undefined ? { secretId: args.secretId } : {}),
        ...(args.secretValue !== undefined ? { secretValue: args.secretValue } : {}),
      });
      const sealed = next[next.length - 1];
      if (!sealed) {
        // appendEntry guarantees a non-empty array — defensive throw.
        throw new Error('audit-emit: appendEntry returned empty chain');
      }
      await args.store.appendEntry({ chainId, entry: sealed });
      return sealed.rowHash;
    },
  };
}

function enrichPayload(event: AuditEvent, sealedAtIso: string): AuditPayload {
  return {
    kind: event.kind,
    sealedAt: sealedAtIso,
    ...(event.tenantId ? { tenantId: event.tenantId } : {}),
    ...event.payload,
  };
}

// ---------------------------------------------------------------------------
// Hash-only helper — used in tests / dry-run modes that need the row
// hash but don't want to persist.
// ---------------------------------------------------------------------------

export function computeRowHash(args: {
  readonly prev?: string;
  readonly payload: AuditPayload;
  readonly secretId?: string;
  readonly secretValue?: string;
}): string {
  return hashChainEntry({
    ...(args.prev !== undefined ? { prev: args.prev } : {}),
    payload: args.payload,
    ...(args.secretId !== undefined ? { secretId: args.secretId } : {}),
    ...(args.secretValue !== undefined ? { secretValue: args.secretValue } : {}),
  });
}

// ---------------------------------------------------------------------------
// In-memory store — convenient for tests and dev loops.
// ---------------------------------------------------------------------------

export function createInMemoryChainStore(): ChainStore & {
  readonly entries: ReadonlyMap<string, ReadonlyArray<ChainEntry>>;
} {
  const state = new Map<string, ChainEntry[]>();
  return {
    get entries() {
      return state;
    },
    async loadTail(chainId, n) {
      const all = state.get(chainId) ?? [];
      const start = Math.max(0, all.length - n);
      return all.slice(start);
    },
    async appendEntry({ chainId, entry }) {
      const bucket = state.get(chainId);
      if (bucket) {
        bucket.push(entry);
      } else {
        state.set(chainId, [entry]);
      }
    },
  };
}
