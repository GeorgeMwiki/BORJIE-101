import { describe, expect, it } from 'vitest';
import {
  createListArrearsTool,
  type ArrearsServicePort,
  type ListArrearsOutput,
} from '../owner.list_arrears.js';
import {
  buildOwnerCtx,
  DEFAULT_TENANT_ID,
  makeInMemoryOtel,
  ownerScopesFor,
} from './test-rig.js';

function makePort(rows: ListArrearsOutput['rows'] = []): ArrearsServicePort {
  return {
    async listArrears(args) {
      return {
        rows: rows.filter((r) => r.daysOverdue >= args.minDaysOverdue),
        totalReturned: rows.length,
        totalAmountMinorUnits: rows.reduce(
          (acc, r) => acc + r.amountDueMinorUnits,
          0,
        ),
        currency: 'KES',
      };
    },
  };
}

describe('owner.list_arrears', () => {
  it('happy path — returns the service rows for in-scope tenant', async () => {
    const port = makePort([
      {
        unitId: 'unit-1',
        unitLabel: 'A-101',
        tenantName: 'Asha Kamau',
        daysOverdue: 14,
        amountDueMinorUnits: 45_000_00,
        currency: 'KES',
        lastPaymentAt: '2026-04-10T00:00:00.000Z',
      },
    ]);
    const tool = createListArrearsTool({ arrears: port });
    const out = await tool.execute(
      { tenantId: DEFAULT_TENANT_ID },
      buildOwnerCtx(),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.totalReturned).toBe(1);
    expect(out.output.rows[0]?.unitId).toBe('unit-1');
  });

  it('refuses cross-tenant calls (OUT_OF_SCOPE)', async () => {
    const port = makePort();
    const tool = createListArrearsTool({ arrears: port });
    const out = await tool.execute(
      { tenantId: 'tenant-other' },
      buildOwnerCtx({ scopes: ownerScopesFor(DEFAULT_TENANT_ID) }),
    );
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('input validation — limit must be 1..200', () => {
    const tool = createListArrearsTool({ arrears: makePort() });
    expect(
      tool.inputSchema.safeParse({ tenantId: 't', limit: 0 }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({ tenantId: 't', limit: 500 }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({ tenantId: 't', limit: 100 }).success,
    ).toBe(true);
  });

  it('emits OTel span tagged read-tier', async () => {
    const otel = makeInMemoryOtel();
    const tool = createListArrearsTool({ arrears: makePort() });
    await tool.execute(
      { tenantId: DEFAULT_TENANT_ID },
      buildOwnerCtx({ otel }),
    );
    expect(otel.spans.length).toBe(1);
    expect(otel.spans[0]?.name).toBe('tool.owner.list_arrears');
    expect(otel.spans[0]?.attributes['bn.tool.riskTier']).toBe('read');
  });
});
