import { describe, expect, it } from 'vitest';
import {
  createFinancialSummaryTool,
  type FinancialSummaryServicePort,
} from '../owner.financial_summary.js';
import {
  buildOwnerCtx,
  DEFAULT_TENANT_ID,
  makeInMemoryOtel,
  ownerScopesFor,
} from './test-rig.js';

function makePort(): FinancialSummaryServicePort {
  return {
    async summariseFinancials(args) {
      return {
        windowMonths: args.windowMonths,
        currency: args.currency,
        totalCollectedMinorUnits: 1_200_000_00,
        totalBilledMinorUnits: 1_400_000_00,
        collectionRate: 0.857,
        outstandingMinorUnits: 200_000_00,
        monthly: Array.from({ length: args.windowMonths }, (_, i) => ({
          month: `2025-${String(i + 1).padStart(2, '0')}`,
          collectedMinorUnits: 100_000_00,
          billedMinorUnits: 110_000_00,
        })),
      };
    },
  };
}

describe('owner.financial_summary', () => {
  it('happy path — returns KPI + monthly series', async () => {
    const tool = createFinancialSummaryTool({ financials: makePort() });
    const out = await tool.execute(
      { tenantId: DEFAULT_TENANT_ID, windowMonths: 6 },
      buildOwnerCtx(),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.windowMonths).toBe(6);
    expect(out.output.monthly.length).toBe(6);
  });

  it('refuses cross-tenant financials', async () => {
    const tool = createFinancialSummaryTool({ financials: makePort() });
    const out = await tool.execute(
      { tenantId: 'tenant-other' },
      buildOwnerCtx({ scopes: ownerScopesFor(DEFAULT_TENANT_ID) }),
    );
    expect(out.kind).toBe('refused');
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('input validation — windowMonths must be 1..24', () => {
    const tool = createFinancialSummaryTool({ financials: makePort() });
    expect(
      tool.inputSchema.safeParse({ tenantId: 't', windowMonths: 0 }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({ tenantId: 't', windowMonths: 25 }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({ tenantId: 't', windowMonths: 12 }).success,
    ).toBe(true);
  });

  it('default values — windowMonths=12, currency=KES', async () => {
    const tool = createFinancialSummaryTool({ financials: makePort() });
    const out = await tool.execute(
      { tenantId: DEFAULT_TENANT_ID },
      buildOwnerCtx(),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.windowMonths).toBe(12);
    expect(out.output.currency).toBe('KES');
  });

  it('emits OTel span tagged read-tier', async () => {
    const otel = makeInMemoryOtel();
    const tool = createFinancialSummaryTool({ financials: makePort() });
    await tool.execute(
      { tenantId: DEFAULT_TENANT_ID },
      buildOwnerCtx({ otel }),
    );
    expect(otel.spans[0]?.name).toBe('tool.owner.financial_summary');
    expect(otel.spans[0]?.attributes['bn.tool.riskTier']).toBe('read');
  });
});
