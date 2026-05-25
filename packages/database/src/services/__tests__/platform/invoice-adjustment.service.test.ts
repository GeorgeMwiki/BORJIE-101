/**
 * Unit tests — createPlatformInvoiceAdjustmentService.
 *
 * Coverage:
 *   - loadInvoice returns mapped snapshot
 *   - loadInvoice returns null on miss + DB error
 *   - applyAdjustment books delta + emits structured line item
 *   - applyAdjustment refuses unknown invoiceId
 *   - applyAdjustment rethrows on DB error
 *   - reverseAdjustment subtracts delta + emits reversal line item
 *   - reverseAdjustment refuses empty input
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPlatformInvoiceAdjustmentService } from '../../platform/invoice-adjustment.service.js';
import { makeStubDb } from './_stub-db.js';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('platform.invoices — loadInvoice', () => {
  it('returns mapped snapshot when row found', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([
      { id: 'inv1', tenantId: 't1', balanceAmount: 10_000 },
    ]);
    const svc = createPlatformInvoiceAdjustmentService(stub.client);
    const out = await svc.loadInvoice('inv1');
    expect(out?.tenantId).toBe('t1');
    expect(out?.balanceCents).toBe(10_000);
  });

  it('returns null when no row found', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([]);
    const svc = createPlatformInvoiceAdjustmentService(stub.client);
    expect(await svc.loadInvoice('missing')).toBeNull();
  });

  it('returns null on DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('boom'));
    const svc = createPlatformInvoiceAdjustmentService(stub.client);
    expect(await svc.loadInvoice('inv1')).toBeNull();
  });
});

describe('platform.invoices — applyAdjustment', () => {
  it('updates totals and emits structured line item', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([
      {
        id: 'inv1',
        tenantId: 't1',
        totalAmount: 10_000,
        balanceAmount: 6_000,
        lineItems: [],
      },
    ]);
    const svc = createPlatformInvoiceAdjustmentService(stub.client);
    const out = await svc.applyAdjustment({
      invoiceId: 'inv1',
      adjustmentCents: -1_000,
      reason: 'goodwill credit',
      category: 'credit',
    });
    expect(out.newBalanceCents).toBe(5_000);
    expect(out.category).toBe('credit');
    const update = stub.ops.find((o) => o.op === 'update');
    expect(update?.set?.totalAmount).toBe(9_000);
    expect(update?.set?.balanceAmount).toBe(5_000);
    const items = update?.set?.lineItems as unknown[];
    expect(items[items.length - 1]).toMatchObject({
      kind: 'platform.adjustment',
      category: 'credit',
      adjustmentCents: -1_000,
    });
  });

  it('rejects unknown invoiceId', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([]);
    const svc = createPlatformInvoiceAdjustmentService(stub.client);
    await expect(
      svc.applyAdjustment({
        invoiceId: 'missing',
        adjustmentCents: -100,
        reason: 'fix',
        category: 'manual',
      }),
    ).rejects.toThrow(/not found/);
  });

  it('refuses empty invoiceId', async () => {
    const stub = makeStubDb();
    const svc = createPlatformInvoiceAdjustmentService(stub.client);
    await expect(
      svc.applyAdjustment({
        invoiceId: '',
        adjustmentCents: 100,
        reason: 'x',
        category: 'manual',
      }),
    ).rejects.toThrow(/required/);
  });

  it('rethrows on DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('tx boom'));
    const svc = createPlatformInvoiceAdjustmentService(stub.client);
    await expect(
      svc.applyAdjustment({
        invoiceId: 'inv1',
        adjustmentCents: 100,
        reason: 'x',
        category: 'manual',
      }),
    ).rejects.toThrow(/tx boom/);
  });
});

describe('platform.invoices — reverseAdjustment', () => {
  it('subtracts the original delta and emits reversal line item', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([
      {
        totalAmount: 9_000,
        balanceAmount: 5_000,
        lineItems: [
          {
            kind: 'platform.adjustment',
            adjustmentId: 'adj-1',
            category: 'credit',
            reason: 'goodwill',
            adjustmentCents: -1_000,
            appliedAt: '2026-05-01T00:00:00Z',
          },
        ],
      },
    ]);
    const svc = createPlatformInvoiceAdjustmentService(stub.client);
    await svc.reverseAdjustment({
      invoiceId: 'inv1',
      adjustmentId: 'adj-1',
      reason: 'rollback test',
    });
    const update = stub.ops.find((o) => o.op === 'update');
    expect(update?.set?.totalAmount).toBe(10_000);
    expect(update?.set?.balanceAmount).toBe(6_000);
    const items = update?.set?.lineItems as unknown[];
    expect(items[items.length - 1]).toMatchObject({
      kind: 'platform.adjustment.reversal',
      reversalOfAdjustmentId: 'adj-1',
    });
  });

  it('refuses empty inputs', async () => {
    const stub = makeStubDb();
    const svc = createPlatformInvoiceAdjustmentService(stub.client);
    await expect(
      svc.reverseAdjustment({ invoiceId: '', adjustmentId: 'a', reason: 'x' }),
    ).rejects.toThrow(/required/);
    await expect(
      svc.reverseAdjustment({ invoiceId: 'i', adjustmentId: '', reason: 'x' }),
    ).rejects.toThrow(/required/);
  });
});
