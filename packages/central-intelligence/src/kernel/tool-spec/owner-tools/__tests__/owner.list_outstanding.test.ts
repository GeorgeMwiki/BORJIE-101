import { describe, expect, it } from 'vitest';
import {
  createListOutstandingTool,
  type OutstandingServicePort,
  type ListOutstandingOutput,
} from '../owner.list_outstanding.js';
import {
  buildOwnerCtx,
  DEFAULT_TENANT_ID,
  makeInMemoryOtel,
  ownerScopesFor,
} from './test-rig.js';

function makePort(rows: ListOutstandingOutput['rows'] = []): OutstandingServicePort {
  return {
    async listOutstanding(args) {
      return {
        rows: rows.filter((r) => r.daysOverdue >= args.minDaysOverdue),
        totalReturned: rows.length,
        totalAmountMinorUnits: rows.reduce(
          (acc, r) => acc + r.amountDueMinorUnits,
          0,
        ),
        currency: 'TZS',
      };
    },
  };
}

describe('owner.list_outstanding', () => {
  it('happy path — returns the service rows for in-scope tenant', async () => {
    const port = makePort([
      {
        siteId: 'site-1',
        siteLabel: 'A-101',
        operatorName: 'Asha Kamau',
        daysOverdue: 14,
        amountDueMinorUnits: 45_000_00,
        currency: 'TZS',
        lastPaymentAt: '2026-04-10T00:00:00.000Z',
      },
    ]);
    const tool = createListOutstandingTool({ outstanding: port });
    const out = await tool.execute(
      { tenantId: DEFAULT_TENANT_ID },
      buildOwnerCtx(),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.totalReturned).toBe(1);
    expect(out.output.rows[0]?.siteId).toBe('site-1');
  });

  it('refuses cross-tenant calls (OUT_OF_SCOPE)', async () => {
    const port = makePort();
    const tool = createListOutstandingTool({ outstanding: port });
    const out = await tool.execute(
      { tenantId: 'tenant-other' },
      buildOwnerCtx({ scopes: ownerScopesFor(DEFAULT_TENANT_ID) }),
    );
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('input validation — limit must be 1..200', () => {
    const tool = createListOutstandingTool({ outstanding: makePort() });
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
    const tool = createListOutstandingTool({ outstanding: makePort() });
    await tool.execute(
      { tenantId: DEFAULT_TENANT_ID },
      buildOwnerCtx({ otel }),
    );
    expect(otel.spans.length).toBe(1);
    expect(otel.spans[0]?.name).toBe('tool.owner.list_outstanding');
    expect(otel.spans[0]?.attributes['bn.tool.riskTier']).toBe('read');
  });
});
