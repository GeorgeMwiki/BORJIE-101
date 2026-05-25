import { describe, it, expect } from 'vitest';
import {
  createAdjustInvoiceTool,
  type AdjustInvoiceOutput,
  type InvoiceAdjustmentPort,
} from '../platform.adjust_invoice.js';
import {
  buildCtx,
  makeInMemorySovereignLedger,
  TENANT_SCOPED_SCOPES,
} from './test-rig.js';

function stub(opts: { invoice?: { tenantId: string } | null } = {}): {
  port: InvoiceAdjustmentPort;
  reversals: Array<{ adjustmentId: string }>;
} {
  const reversals: Array<{ adjustmentId: string }> = [];
  const invoice = opts.invoice === undefined ? { tenantId: 't-alpha' } : opts.invoice;
  return {
    reversals,
    port: {
      async loadInvoice(invoiceId) {
        if (!invoice) return null;
        return {
          invoiceId,
          tenantId: invoice.tenantId,
          balanceCents: 100_00,
        };
      },
      async applyAdjustment(args): Promise<AdjustInvoiceOutput> {
        return {
          invoiceId: args.invoiceId,
          tenantId: invoice?.tenantId ?? 't-alpha',
          adjustmentId: `adj-${args.invoiceId}-${args.adjustmentCents}`,
          adjustmentCents: args.adjustmentCents,
          category: args.category,
          reason: args.reason,
          newBalanceCents: 100_00 + args.adjustmentCents,
          appliedAt: '2026-05-15T09:00:00.000Z',
        };
      },
      async reverseAdjustment(args) {
        reversals.push({ adjustmentId: args.adjustmentId });
      },
    },
  };
}

// Billing scopes carry through to a platform-wide ops scope so the
// caller can also reach the tenant the invoice belongs to. The destroy/
// billing tools demand BOTH the role-class scope AND tenant reachability.
const BILLING_SCOPES = [
  'platform:billing:write',
  'platform:ops:write',
  'platform:admin',
];

describe('platform.adjust_invoice', () => {
  it('happy path — applies credit', async () => {
    const { port } = stub();
    const tool = createAdjustInvoiceTool({
      invoices: port,
      maxAdjustmentUsdCents: 500_00,
    });
    const out = await tool.execute(
      {
        invoiceId: 'inv-1',
        adjustmentCents: -25_00,
        reason: 'customer goodwill credit',
        category: 'credit',
      },
      buildCtx({ scopes: BILLING_SCOPES }),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.newBalanceCents).toBe(75_00);
  });

  it('refuses adjustment over cost ceiling', async () => {
    const { port } = stub();
    const tool = createAdjustInvoiceTool({
      invoices: port,
      maxAdjustmentUsdCents: 500_00,
    });
    const out = await tool.execute(
      {
        invoiceId: 'inv-1',
        adjustmentCents: -1_000_00,
        reason: 'over the ceiling',
      },
      buildCtx({ scopes: BILLING_SCOPES }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('COST_CEILING_EXCEEDED');
  });

  it('auth-gated — caller missing billing:write refused', async () => {
    const { port } = stub();
    const tool = createAdjustInvoiceTool({
      invoices: port,
      maxAdjustmentUsdCents: 500_00,
    });
    const out = await tool.execute(
      { invoiceId: 'inv-1', adjustmentCents: -5_00, reason: 'cooks unauthd' },
      buildCtx({ scopes: ['platform:ops:write'] }),
    );
    expect(out.kind).toBe('refused');
  });

  it('refuses invoice on tenant caller cannot reach', async () => {
    const { port } = stub({ invoice: { tenantId: 't-beta' } });
    const tool = createAdjustInvoiceTool({
      invoices: port,
      maxAdjustmentUsdCents: 500_00,
    });
    // Caller carries the role-class scopes BUT only tenant-prefixed
    // reach for t-alpha — the invoice belongs to t-beta so the call
    // is refused.
    const out = await tool.execute(
      { invoiceId: 'inv-1', adjustmentCents: -5_00, reason: 'goodwill credit' },
      buildCtx({
        scopes: [
          'platform:billing:write',
          'platform:ops:write',
          ...TENANT_SCOPED_SCOPES('t-alpha'),
        ],
      }),
    );
    expect(out.kind).toBe('refused');
  });

  it('emits sovereign-ledger row at billing tier with costEstimateUsd', async () => {
    const { port } = stub();
    const ledger = makeInMemorySovereignLedger();
    const tool = createAdjustInvoiceTool({
      invoices: port,
      maxAdjustmentUsdCents: 500_00,
    });
    await tool.execute(
      { invoiceId: 'inv-1', adjustmentCents: -5_00, reason: 'customer credit' },
      buildCtx({ scopes: BILLING_SCOPES, sovereignLedger: ledger }),
    );
    expect(ledger.rows[0].riskTier).toBe('billing');
    expect(ledger.rows[0].costEstimateUsd).toBe(0.05);
  });

  it('rollback reverses the adjustment', async () => {
    const { port, reversals } = stub();
    const tool = createAdjustInvoiceTool({
      invoices: port,
      maxAdjustmentUsdCents: 500_00,
    });
    const out = await tool.execute(
      { invoiceId: 'inv-1', adjustmentCents: -5_00, reason: 'customer credit' },
      buildCtx({ scopes: BILLING_SCOPES }),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    await tool.rollback?.(out.output, buildCtx({ scopes: BILLING_SCOPES }));
    expect(reversals).toHaveLength(1);
  });
});
