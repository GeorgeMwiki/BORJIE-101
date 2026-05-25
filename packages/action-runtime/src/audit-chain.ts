/**
 * @borjie/action-runtime — audit-chain.ts
 *
 * Per-plan + per-step audit-chain rows. The plan's `audit_chain_link` row
 * is the root; each step's `audit_chain_id` is a child whose `prev_hash`
 * equals the root's `this_hash`.
 *
 * Failures + compensations APPEND new rows; never mutate existing ones.
 * This mirrors the sovereign-action-ledger pattern in
 * `packages/database/src/services/sovereign-action-ledger.service.ts`.
 */

import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

// ─────────────────────────────────────────────────────────────────────
// Canonical JSON — stable across key order
// ─────────────────────────────────────────────────────────────────────

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

// ─────────────────────────────────────────────────────────────────────
// Hash computation
// ─────────────────────────────────────────────────────────────────────

export interface ComputeAuditHashArgs {
  readonly prevHash: string;
  readonly tenantId: string;
  readonly action: string;
  readonly payload: unknown;
  readonly createdAtIso: string;
}

export function computeAuditHash(args: ComputeAuditHashArgs): string {
  const blob = [
    args.prevHash,
    args.tenantId,
    args.action,
    canonicalJson(args.payload),
    args.createdAtIso,
  ].join('|');
  return createHash('sha256').update(blob).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────
// Writer port — injected so tests can use an in-memory implementation
// ─────────────────────────────────────────────────────────────────────

export interface AuditChainRow {
  readonly id: string;
  readonly tenantId: string;
  readonly action: string;
  readonly prevHash: string;
  readonly thisHash: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAtIso: string;
  readonly sequenceId: number;
  readonly turnId: string;
}

export interface AuditChainWriter {
  /**
   * Append a row. The implementation locks per-tenant (advisory lock or
   * SERIALIZABLE) so two concurrent writers never produce the same
   * prev_hash; the returned row carries the computed hash for the
   * caller to persist alongside the action_steps row.
   */
  appendRow: (args: {
    readonly tenantId: string;
    readonly action: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly turnId: string;
  }) => Promise<AuditChainRow>;
}

// ─────────────────────────────────────────────────────────────────────
// In-memory implementation for tests
// ─────────────────────────────────────────────────────────────────────

export interface InMemoryAuditChain {
  readonly writer: AuditChainWriter;
  readonly rows: () => ReadonlyArray<AuditChainRow>;
  readonly verify: (tenantId: string) => boolean;
}

export function createInMemoryAuditChain(): InMemoryAuditChain {
  // Per-tenant chain heads.
  const rows: AuditChainRow[] = [];
  let counter = 0;

  const writer: AuditChainWriter = {
    async appendRow({ tenantId, action, payload, turnId }) {
      const tenantRows = rows.filter((r) => r.tenantId === tenantId);
      const prev = tenantRows[tenantRows.length - 1];
      const prevHash = prev?.thisHash ?? GENESIS_HASH;
      const createdAtIso = new Date().toISOString();
      const sequenceId = tenantRows.length;
      counter += 1;
      const id = `audit_${tenantId}_${sequenceId}_${counter}`;
      const thisHash = computeAuditHash({
        prevHash,
        tenantId,
        action,
        payload,
        createdAtIso,
      });
      const row: AuditChainRow = {
        id,
        tenantId,
        action,
        prevHash,
        thisHash,
        payload,
        createdAtIso,
        sequenceId,
        turnId,
      };
      rows.push(row);
      return row;
    },
  };

  return {
    writer,
    rows: () => rows.slice(),
    verify(tenantId: string): boolean {
      const tenantRows = rows.filter((r) => r.tenantId === tenantId);
      let expectedPrev = GENESIS_HASH;
      for (const row of tenantRows) {
        if (row.prevHash !== expectedPrev) return false;
        const expectedThis = computeAuditHash({
          prevHash: expectedPrev,
          tenantId: row.tenantId,
          action: row.action,
          payload: row.payload,
          createdAtIso: row.createdAtIso,
        });
        if (row.thisHash !== expectedThis) return false;
        expectedPrev = row.thisHash;
      }
      return true;
    },
  };
}
