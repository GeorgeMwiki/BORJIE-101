/**
 * Persistent MCP cost ledger tests — verify the Drizzle-backed CostLedgerPort:
 *
 *   1. record() INSERTs a row with the MCP-native axes (server, tool,
 *      tokens, usd, free, requestId) inside withTenantContext.
 *   2. record() is FAIL-SOFT — a throwing DB never propagates.
 *   3. record() against a null DB is a no-op (no DATABASE_URL).
 *   4. snapshot() rolls up per-tool cost in USD micro for the period.
 *   5. snapshot() degrades to an empty snapshot on a read error.
 *   6. aggregateByServer() returns per-server spend buckets.
 *
 * The fake Drizzle client mimics the narrow surface the ledger touches:
 *   - `transaction(fn)` (so withTenantContext binds the GUC and runs fn)
 *   - `execute(sql)` (the set_config calls inside withTenantContext)
 *   - `insert(table).values(row)` (record)
 *   - a chained `select().from().where().groupBy()` thenable (reads)
 */

import { describe, it, expect, vi } from 'vitest';
import type { McpCostEntry } from '@borjie/mcp-server';
import { createPersistentMcpCostLedger } from '../mcp/persistent-mcp-cost-ledger';

interface Captured {
  readonly inserts: Array<Record<string, unknown>>;
}

/**
 * Build a fake transaction-capable Drizzle client.
 * `selectResult` is the array the chained select resolves to.
 */
function fakeDb(
  captured: Captured,
  selectResult: ReadonlyArray<Record<string, unknown>> = [],
  opts: { throwOnInsert?: boolean; throwOnSelect?: boolean } = {},
) {
  const selectChain = {
    from() {
      return this;
    },
    where() {
      return this;
    },
    groupBy() {
      if (opts.throwOnSelect) throw new Error('boom-select');
      return Promise.resolve(selectResult);
    },
  };

  const tx = {
    async execute() {
      return undefined;
    },
    insert() {
      return {
        async values(row: Record<string, unknown>) {
          if (opts.throwOnInsert) throw new Error('boom-insert');
          captured.inserts.push(row);
          return undefined;
        },
      };
    },
    select() {
      return selectChain;
    },
  };

  return {
    async transaction(fn: (t: typeof tx) => Promise<unknown>) {
      return fn(tx);
    },
  };
}

const baseEntry: McpCostEntry = {
  tenantId: 'tenant-1',
  principalId: 'user-1',
  toolName: 'get_tenant_risk_profile',
  tier: 'enterprise',
  estimatedCostUsdMicro: 2_500, // $0.0025
  inputTokens: 100,
  outputTokens: 40,
  durationMs: 12,
  wasFree: false,
  correlationId: 'corr-abc',
  timestamp: '2026-06-07T10:00:00.000Z',
};

describe('createPersistentMcpCostLedger.record', () => {
  it('INSERTs a row carrying the MCP-native axes', async () => {
    const captured: Captured = { inserts: [] };
    const ledger = createPersistentMcpCostLedger(fakeDb(captured));
    await ledger.record(baseEntry);

    expect(captured.inserts).toHaveLength(1);
    const row = captured.inserts[0]!;
    expect(row.tenantId).toBe('tenant-1');
    expect(row.serverName).toBe('borjie-mcp-server');
    expect(row.toolName).toBe('get_tenant_risk_profile');
    expect(row.inputTokens).toBe(100);
    expect(row.outputTokens).toBe(40);
    expect(row.wasFree).toBe(false);
    expect(row.requestId).toBe('corr-abc');
    // $0.0025 persisted as a numeric string.
    expect(row.usdCost).toBe('0.0025');
    expect(row.occurredAt).toBeInstanceOf(Date);
  });

  it('prefers actualCostUsdMicro when present', async () => {
    const captured: Captured = { inserts: [] };
    const ledger = createPersistentMcpCostLedger(fakeDb(captured));
    await ledger.record({ ...baseEntry, actualCostUsdMicro: 5_000_000 });
    expect(captured.inserts[0]!.usdCost).toBe('5');
  });

  it('is FAIL-SOFT — a throwing insert never propagates', async () => {
    const captured: Captured = { inserts: [] };
    const ledger = createPersistentMcpCostLedger(
      fakeDb(captured, [], { throwOnInsert: true }),
    );
    await expect(ledger.record(baseEntry)).resolves.toBeUndefined();
    expect(captured.inserts).toHaveLength(0);
  });

  it('is a no-op against a null DB', async () => {
    const ledger = createPersistentMcpCostLedger(null);
    await expect(ledger.record(baseEntry)).resolves.toBeUndefined();
  });
});

describe('createPersistentMcpCostLedger.snapshot', () => {
  it('rolls up per-tool cost in USD micro', async () => {
    const captured: Captured = { inserts: [] };
    const db = fakeDb(captured, [
      { toolName: 'tool_a', totalUsd: '0.01', calls: 3, freeCalls: 1 },
      { toolName: 'tool_b', totalUsd: '0.02', calls: 2, freeCalls: 0 },
    ]);
    const ledger = createPersistentMcpCostLedger(db, {
      now: () => new Date('2026-06-07T00:00:00.000Z'),
    });
    const snap = await ledger.snapshot('tenant-1');

    expect(snap.tenantId).toBe('tenant-1');
    expect(snap.callCount).toBe(5);
    expect(snap.freeCallCount).toBe(1);
    expect(snap.paidCallCount).toBe(4);
    expect(snap.totalCostUsdMicro).toBe(30_000); // (0.01 + 0.02) * 1e6
    expect(snap.costByTool.tool_a).toBe(10_000);
    expect(snap.costByTool.tool_b).toBe(20_000);
    expect(snap.periodStart).toBe('2026-06-01T00:00:00.000Z');
  });

  it('degrades to an empty snapshot on read error', async () => {
    const captured: Captured = { inserts: [] };
    const db = fakeDb(captured, [], { throwOnSelect: true });
    const ledger = createPersistentMcpCostLedger(db);
    const snap = await ledger.snapshot('tenant-1');
    expect(snap.callCount).toBe(0);
    expect(snap.totalCostUsdMicro).toBe(0);
  });

  it('returns an empty snapshot against a null DB', async () => {
    const ledger = createPersistentMcpCostLedger(null);
    const snap = await ledger.snapshot('tenant-1');
    expect(snap.callCount).toBe(0);
  });
});

describe('createPersistentMcpCostLedger.aggregateByServer', () => {
  it('returns per-server spend buckets', async () => {
    const captured: Captured = { inserts: [] };
    const db = fakeDb(captured, [
      {
        key: 'borjie-mcp-server',
        totalUsd: '0.5',
        calls: 10,
        inTok: 1000,
        outTok: 400,
      },
    ]);
    const ledger = createPersistentMcpCostLedger(db);
    const buckets = await ledger.aggregateByServer('tenant-1');
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.key).toBe('borjie-mcp-server');
    expect(buckets[0]!.totalUsdCost).toBe(0.5);
    expect(buckets[0]!.totalUsdCostMicro).toBe(500_000);
    expect(buckets[0]!.callCount).toBe(10);
    expect(buckets[0]!.inputTokens).toBe(1000);
  });

  it('returns [] against a null DB', async () => {
    const ledger = createPersistentMcpCostLedger(null);
    expect(await ledger.aggregateByServer('tenant-1')).toEqual([]);
  });
});
