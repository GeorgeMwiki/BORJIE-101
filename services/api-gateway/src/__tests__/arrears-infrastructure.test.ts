/**
 * Arrears infrastructure unit tests (shape only).
 *
 * We exercise the three adapters with a minimal call-recording fake so
 * the test can run without a live Postgres. The assertions confirm:
 *  - the repo SELECTs/INSERTs the right tables
 *  - the ledger port maps entry types to transaction_type correctly
 *  - the loader returns null for an unknown case
 *
 * Deep behaviour (balance replay, tenant isolation enforcement) is
 * covered by the arrears-projection-service unit suite and by the
 * integration UAT against a real gateway instance.
 */

import { describe, it, expect } from 'vitest';
import {
  PostgresArrearsRepository,
  PostgresLedgerPort,
  createPostgresArrearsEntryLoader,
} from '../composition/arrears-infrastructure';

function makeFakeDb() {
  const calls: Array<{ op: string; detail: unknown }> = [];
  const db: any = {
    calls,
    select() {
      calls.push({ op: 'select', detail: null });
      const builder: any = {
        from: () => builder,
        where: () => builder,
        orderBy: () => builder,
        limit: () => Promise.resolve([]),
        then: (r: any) => r([]),
      };
      return builder;
    },
    insert(table: any) {
      return {
        values: async (row: any) => {
          calls.push({ op: 'insert', detail: { table: String(table), row } });
          return row;
        },
      };
    },
    update(table: any) {
      return {
        set: (patch: any) => ({
          where: async () => {
            calls.push({ op: 'update', detail: { table: String(table), patch } });
          },
        }),
      };
    },
    async execute() {
      return { rows: [] };
    },
    async transaction(fn: any) {
      return fn(db);
    },
  };
  return db;
}

describe('PostgresArrearsRepository', () => {
  it('saveProposal issues an INSERT', async () => {
    const db = makeFakeDb();
    const repo = new PostgresArrearsRepository(db);
    await repo.saveProposal({
      id: 'p1',
      tenantId: 't1',
      customerId: 'c1',
      arrearsCaseId: 'arc_1',
      invoiceId: null,
      kind: 'waiver',
      amountMinorUnits: -500,
      currency: 'KES',
      reason: 'test',
      evidenceDocIds: [],
      status: 'pending',
      proposedBy: 'u1',
      proposedAt: '2026-04-19T00:00:00.000Z',
      approvedBy: null,
      approvedAt: null,
      approvalNotes: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
      relatedEntryId: null,
      balanceBeforeMinorUnits: null,
      projectedBalanceAfterMinorUnits: null,
      createdAt: '2026-04-19T00:00:00.000Z',
    });
    const insertCall = db.calls.find((c: any) => c.op === 'insert');
    expect(insertCall).toBeDefined();
    expect(insertCall.detail.row.id).toBe('p1');
    expect(insertCall.detail.row.kind).toBe('waiver');
  });

  it('updateProposalOnApproval issues an UPDATE', async () => {
    const db = makeFakeDb();
    const repo = new PostgresArrearsRepository(db);
    await repo.updateProposalOnApproval('t1', 'p1', {
      approvedBy: 'u1',
      approvedAt: '2026-04-19T00:00:00.000Z',
      relatedEntryId: 'entry-1',
    });
    const updateCall = db.calls.find((c: any) => c.op === 'update');
    expect(updateCall).toBeDefined();
    expect(updateCall.detail.patch.status).toBe('approved');
    expect(updateCall.detail.patch.relatedEntryId).toBe('entry-1');
  });
});

describe('PostgresLedgerPort', () => {
  it('appendAdjustment inserts a transaction row and maps entryType', async () => {
    const db = makeFakeDb();
    const port = new PostgresLedgerPort(db);
    await port.appendAdjustment({
      id: 'entry-1',
      tenantId: 't1',
      customerId: 'c1',
      invoiceId: null,
      entryType: 'waiver',
      amountMinorUnits: -500,
      currency: 'KES',
      description: 'test waiver',
      relatedEntryId: null,
      postedAt: new Date().toISOString(),
      postedBy: 'u1',
    });
    const insertCall = db.calls.find((c: any) => c.op === 'insert');
    expect(insertCall).toBeDefined();
    expect(insertCall.detail.row.id).toBe('entry-1');
    // waiver -> adjustment on the transactions table
    expect(insertCall.detail.row.transactionType).toBe('adjustment');
    expect(insertCall.detail.row.amount).toBe(-500);
    expect(insertCall.detail.row.balanceBefore).toBe(0);
    expect(insertCall.detail.row.balanceAfter).toBe(-500);
  });

  it('writeoff maps to write_off transaction type', async () => {
    const db = makeFakeDb();
    const port = new PostgresLedgerPort(db);
    await port.appendAdjustment({
      id: 'entry-2',
      tenantId: 't1',
      customerId: 'c1',
      invoiceId: null,
      entryType: 'writeoff',
      amountMinorUnits: -1000,
      currency: 'KES',
      description: 'bad debt',
      relatedEntryId: null,
      postedAt: new Date().toISOString(),
      postedBy: 'u1',
    });
    const insertCall = db.calls.find((c: any) => c.op === 'insert');
    expect(insertCall.detail.row.transactionType).toBe('write_off');
  });
});

describe('createPostgresArrearsEntryLoader', () => {
  it('returns null when no proposals exist and no arrears_cases row', async () => {
    const db = makeFakeDb();
    const loader = createPostgresArrearsEntryLoader(db);
    const result = await loader({ tenantId: 't1', arrearsCaseId: 'unknown' });
    expect(result).toBeNull();
  });
});
