/**
 * Audit chain — Drizzle/Postgres implementation (cognitive-persistence
 * follow-up).
 *
 * Durable counterpart to `createInMemoryAuditChain`. Persists one row per
 * memory mutation (observe / reinforce / cite / contradict / promote /
 * decay) to the `cognitive_memory_audit_chain` table so the hash-chained,
 * append-only provenance survives a process restart — the in-memory variant
 * loses the whole chain on reboot.
 *
 * Chain semantics (PRESERVED EXACTLY — see `@borjie/audit-hash-chain`)
 * ------------------------------------------------------------------------
 *   - Per tenant the chain is a linear, zero-based, contiguous sequence.
 *   - `prevHash` is the immediately preceding row's `rowHash`, or
 *     `GENESIS_HASH` for the first row in the tenant chain.
 *   - `rowHash = sha256/hmac(canonicalJson({ prev, payload, secretId? }))`
 *     computed by `chainHash` from `@borjie/audit-hash-chain`. The payload
 *     is the canonical `AuditChainPort.append` argument so an out-of-band
 *     `verifyChain` can recompute every hash from the stored columns.
 *   - APPEND-ONLY. This repo NEVER updates or deletes a row; doing so would
 *     break the chain. `append` returns the freshly-sealed `rowHash`,
 *     matching the in-memory port contract.
 *
 * Concurrency note: the previous-row read + new-row insert is a read-modify-
 * write on the tenant's chain head. The host serialises memory mutations per
 * tenant turn (the brain orchestrator processes one turn at a time), so the
 * window is benign; a unique `(tenant_id, chain_index)` constraint at the DB
 * layer (added in the table's migration) backstops a concurrent append by
 * surfacing a duplicate-index error the caller can retry.
 *
 * Dependency direction: `@borjie/cognitive-memory` → `@borjie/database` +
 * `@borjie/audit-hash-chain` (both one-way; no cycle).
 */

import { desc, eq } from 'drizzle-orm';
import {
  cognitiveMemoryAuditChain,
  type DatabaseClient,
  type CognitiveMemoryAuditChainRow,
} from '@borjie/database';
import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';

import { CognitiveMemoryError, type AuditChainPort } from '../types.js';

// ---------------------------------------------------------------------------
// Narrow logger contract — keeps this module free of any logging library.
// ---------------------------------------------------------------------------

export interface DrizzleAuditChainLogger {
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
}

const NOOP_LOGGER: DrizzleAuditChainLogger = Object.freeze({
  warn: (): void => {
    // intentional no-op default logger
  },
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DrizzleAuditChainOptions {
  readonly logger?: DrizzleAuditChainLogger;
  /**
   * Optional HMAC secret used to seal each row. When provided, the row hash
   * is HMAC-SHA256 over the canonical form (protecting against an attacker
   * that controls the chain storage but not the secret). `secretId` is
   * stamped on the row so a rotation-aware `verifyChain` can look the value
   * up via its `SecretRing`.
   */
  readonly secret?: {
    readonly id: string;
    readonly value: string;
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct a Drizzle-backed {@link AuditChainPort}. Implements the identical
 * port as {@link createInMemoryAuditChain}: a single `append` method that
 * seals a hash-chained, append-only row and returns its `rowHash`. The chain
 * is per-tenant; the head is read inside the same call so the new row links
 * to the correct predecessor.
 *
 * @param db   A Drizzle client (postgres-js backed). RLS pins the tenant via
 *             the `app.tenant_id` GUC at the request layer; this repo also
 *             reads/writes the chain head filtered by `tenant_id`.
 * @param opts Optional structural logger + HMAC secret for sealing.
 */
export function createDrizzleAuditChain(
  db: DatabaseClient,
  opts: DrizzleAuditChainOptions = {},
): AuditChainPort {
  const logger = opts.logger ?? NOOP_LOGGER;
  const secret = opts.secret;

  return {
    async append(payload): Promise<string> {
      try {
        // Read the tenant chain head to derive prevHash + the next index.
        const headRows = (await db
          .select()
          .from(cognitiveMemoryAuditChain)
          .where(eq(cognitiveMemoryAuditChain.tenantId, payload.tenant_id))
          .orderBy(desc(cognitiveMemoryAuditChain.chainIndex))
          .limit(1)) as ReadonlyArray<CognitiveMemoryAuditChainRow>;

        const head = headRows[0];
        const prevHash = head === undefined ? GENESIS_HASH : head.rowHash;
        const nextIndex = head === undefined ? 0 : head.chainIndex + 1;

        // The canonical hash payload — identical fields that an out-of-band
        // verifier recomputes from the stored columns. `extra` is folded in
        // only when present so the canonical form is stable.
        const hashPayload: Readonly<Record<string, unknown>> = {
          tenant_id: payload.tenant_id,
          event_kind: payload.event_kind,
          cell_id: payload.cell_id,
          specialisation: payload.specialisation,
          turn_id: payload.turn_id,
          occurred_at: payload.occurred_at,
          ...(payload.extra !== undefined ? { extra: payload.extra } : {}),
        };

        const rowHash = chainHash(
          {
            prev: prevHash,
            payload: hashPayload,
            ...(secret !== undefined ? { secretId: secret.id } : {}),
          },
          secret?.value,
        );

        await db.insert(cognitiveMemoryAuditChain).values({
          tenantId: payload.tenant_id,
          chainIndex: nextIndex,
          prevHash,
          rowHash,
          eventKind: payload.event_kind,
          cellId: payload.cell_id,
          specialisation: payload.specialisation,
          turnId: payload.turn_id,
          occurredAt: new Date(payload.occurred_at),
          extra: payload.extra ?? null,
          secretId: secret?.id ?? null,
        });

        return rowHash;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('drizzle audit chain: append failed', { error: message });
        throw new CognitiveMemoryError(
          'audit_chain.append_failed',
          'drizzle audit chain: append failed',
          { error: message },
        );
      }
    },
  };
}
