/**
 * Tests for the ledger / audit hash-chain attestor cron wiring (LP-19).
 *
 * The cron is pure orchestration over `@borjie/ledger-attestor`; here we drive
 * it with a fake `execute(q)` DB that returns canned ledger + audit rows and
 * assert:
 *   - the read-only source groups rows into one segment per chain with dense
 *     0-based leaf indices (so the attestor's contiguity check holds even when
 *     the underlying sequence numbers are sparse / legacy);
 *   - a clean run attests every distinct chain;
 *   - a DB read error degrades to "no segments" (never throws);
 *   - the cron returns the attestation result for the caller to alert on.
 */

import { describe, expect, it } from 'vitest';
import {
  buildLedgerAttestorCronDeps,
  createChainSource,
  runLedgerAttestorCron,
  type AttestorDbLike,
} from '../tasks/ledger-attestor-cron.js';

/** A fake DB whose `execute` dispatches on the SQL text the source emits. */
function fakeDb(
  rows: { ledger: ReadonlyArray<Record<string, unknown>>; audit: ReadonlyArray<Record<string, unknown>> },
  opts: { failLedger?: boolean; failAudit?: boolean } = {},
): AttestorDbLike {
  return {
    async execute(query: unknown): Promise<unknown> {
      const text = sqlTextOf(query);
      if (text.includes('ledger_entries')) {
        if (opts.failLedger) throw new Error('ledger read boom');
        return { rows: rows.ledger };
      }
      if (text.includes('ai_audit_chain')) {
        if (opts.failAudit) throw new Error('audit read boom');
        return { rows: rows.audit };
      }
      return { rows: [] };
    },
  };
}

/** Drizzle `sql` objects expose their fragments; stringify defensively. */
function sqlTextOf(query: unknown): string {
  const q = query as { queryChunks?: unknown[]; sql?: string };
  if (typeof q.sql === 'string') return q.sql;
  try {
    return JSON.stringify(q.queryChunks ?? query);
  } catch {
    return String(query);
  }
}

const LEDGER_ROWS = [
  { tenant_id: 't1', account_id: 'a1', sequence_number: 0, this_hash: 'h0' },
  { tenant_id: 't1', account_id: 'a1', sequence_number: 1, this_hash: 'h1' },
  // Distinct account → distinct chain.
  { tenant_id: 't1', account_id: 'a2', sequence_number: 7, this_hash: 'hx' },
];

const AUDIT_ROWS = [
  { tenant_id: 't1', sequence_id: 100, this_hash: 'ah0' },
  { tenant_id: 't1', sequence_id: 101, this_hash: 'ah1' },
];

describe('createChainSource', () => {
  it('groups rows into one dense-indexed segment per chain', async () => {
    const source = createChainSource(
      fakeDb({ ledger: LEDGER_ROWS, audit: AUDIT_ROWS }),
    );
    const segments = await source.listSegments();
    const byId = new Map(segments.map((s) => [s.chainId, s]));

    expect(byId.get('ledger:t1:a1')?.leaves.map((l) => l.index)).toEqual([0, 1]);
    expect(byId.get('ledger:t1:a1')?.leaves.map((l) => l.rowHash)).toEqual([
      'h0',
      'h1',
    ]);
    // Sparse underlying sequence (7) collapses to dense index 0.
    expect(byId.get('ledger:t1:a2')?.leaves).toEqual([{ index: 0, rowHash: 'hx' }]);
    expect(byId.get('audit:t1')?.leaves.map((l) => l.index)).toEqual([0, 1]);
  });

  it('degrades to no segments when both reads fail (never throws)', async () => {
    const source = createChainSource(
      fakeDb({ ledger: [], audit: [] }, { failLedger: true, failAudit: true }),
    );
    await expect(source.listSegments()).resolves.toEqual([]);
  });

  it('isolates a single failing read', async () => {
    const source = createChainSource(
      fakeDb({ ledger: LEDGER_ROWS, audit: AUDIT_ROWS }, { failAudit: true }),
    );
    const segments = await source.listSegments();
    // Ledger chains still present; audit dropped.
    expect(segments.some((s) => s.chainId.startsWith('ledger:'))).toBe(true);
    expect(segments.some((s) => s.chainId.startsWith('audit:'))).toBe(false);
  });
});

describe('runLedgerAttestorCron', () => {
  it('attests every distinct chain on a clean run', async () => {
    const deps = await buildLedgerAttestorCronDeps(
      fakeDb({ ledger: LEDGER_ROWS, audit: AUDIT_ROWS }),
    );
    const result = await runLedgerAttestorCron(deps);
    // 2 ledger chains + 1 audit chain.
    expect(result.scanned).toBe(3);
    expect(result.attested).toBe(3);
    expect(result.failed).toBe(0);
  });

  it('skips unchanged chains on a second tick (idempotent)', async () => {
    const deps = await buildLedgerAttestorCronDeps(
      fakeDb({ ledger: LEDGER_ROWS, audit: AUDIT_ROWS }),
    );
    await runLedgerAttestorCron(deps);
    const second = await runLedgerAttestorCron(deps);
    expect(second.attested).toBe(0);
    expect(second.skippedUnchanged).toBe(3);
    expect(second.failed).toBe(0);
  });

  it('always wires at least one sink (in-memory)', async () => {
    const deps = await buildLedgerAttestorCronDeps(
      fakeDb({ ledger: [], audit: [] }),
    );
    expect(deps.sinks.length).toBeGreaterThanOrEqual(1);
  });
});
