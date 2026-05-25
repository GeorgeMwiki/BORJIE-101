import { describe, it, expect } from 'vitest';
import {
  createPayoutOwnerTool,
  type OwnerPayoutWorkflowDispatcherPort,
} from '../platform.payout_owner.js';
import {
  buildCtx,
  makeInMemorySovereignLedger,
  TENANT_SCOPED_SCOPES,
} from './test-rig.js';

interface StubBundle {
  readonly dispatcher: OwnerPayoutWorkflowDispatcherPort;
  readonly starts: Array<{ ownerId: string; amount: number; currency: string }>;
  readonly refunds: Array<{ workflowId: string; reason: string }>;
}

function stub(opts: { usdCents?: number; startThrows?: Error; fxThrows?: Error } = {}): StubBundle {
  const starts: Array<{ ownerId: string; amount: number; currency: string }> = [];
  const refunds: Array<{ workflowId: string; reason: string }> = [];
  return {
    starts,
    refunds,
    dispatcher: {
      async start(args) {
        if (opts.startThrows) throw opts.startThrows;
        starts.push({
          ownerId: args.ownerId,
          amount: args.amount,
          currency: args.currency,
        });
        return {
          workflowId: `owner-payout-${args.ownerId}-${args.periodEnd}`,
          runId: `run-${starts.length}`,
        };
      },
      async refund(args) {
        refunds.push({
          workflowId: args.workflowId,
          reason: args.reason,
        });
      },
      async estimateUsdCents(_args) {
        if (opts.fxThrows) throw opts.fxThrows;
        return opts.usdCents ?? 50_000; // $500 default
      },
    },
  };
}

// platform:admin gives tenant reachability — see callerCanReachTenant.
// Tests that specifically exercise tenant-reachability refusal drop this.
const BILLING_SCOPES = [
  'platform:billing:write',
  'platform:ops:write',
  'platform:admin',
];

const VALID_INPUT = {
  tenantId: 't-alpha',
  ownerId: 'owner-1',
  amount: 2_500_000_00, // 2.5M TZS cents
  currency: 'TZS',
  bankAccount: 'TZ-bank-ref-9123',
  idempotencyKey: 'payout-2026-04',
  periodStart: '2026-04-01T00:00:00.000Z',
  periodEnd: '2026-04-30T23:59:59.000Z',
  initiatedByUserId: 'admin-user-1',
};

describe('platform.payout_owner', () => {
  it('happy path — starts the workflow', async () => {
    const { dispatcher, starts } = stub();
    const tool = createPayoutOwnerTool({
      ownerPayoutDispatcher: dispatcher,
      maxPayoutUsdCents: 50_000_00, // $50k ceiling
    });
    const out = await tool.execute(
      VALID_INPUT,
      buildCtx({ scopes: BILLING_SCOPES }),
    );
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.status).toBe('started');
    expect(starts).toHaveLength(1);
    expect(out.output.workflowId).toContain('owner-payout-owner-1');
  });

  it('declares billing tier with costEstimateUsd', () => {
    const { dispatcher } = stub();
    const tool = createPayoutOwnerTool({
      ownerPayoutDispatcher: dispatcher,
      maxPayoutUsdCents: 50_000_00,
    });
    expect(tool.riskTier).toBe('billing');
    expect(tool.costEstimateUsd).toBeGreaterThan(0);
    expect(tool.approvalRequired).toBe(true);
  });

  it('refuses payout over cost ceiling', async () => {
    const { dispatcher } = stub({ usdCents: 100_000_00 }); // $100k
    const tool = createPayoutOwnerTool({
      ownerPayoutDispatcher: dispatcher,
      maxPayoutUsdCents: 50_000_00, // $50k ceiling
    });
    const out = await tool.execute(
      VALID_INPUT,
      buildCtx({ scopes: BILLING_SCOPES }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('COST_CEILING_EXCEEDED');
  });

  it('demands extra HIL for payouts >$10k USD-equivalent', async () => {
    const { dispatcher } = stub({ usdCents: 1_500_000 }); // $15k
    const tool = createPayoutOwnerTool({
      ownerPayoutDispatcher: dispatcher,
      maxPayoutUsdCents: 100_000_00,
    });
    // No approvalRecordId set — extra HIL gate has NOT run
    const out = await tool.execute(
      VALID_INPUT,
      buildCtx({ scopes: BILLING_SCOPES, approvalRecordId: null }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('DOMAIN_LIMIT_EXCEEDED');
  });

  it('accepts >$10k payout when 5-eye approvalRecordId is bound', async () => {
    const { dispatcher } = stub({ usdCents: 1_500_000 }); // $15k
    const tool = createPayoutOwnerTool({
      ownerPayoutDispatcher: dispatcher,
      maxPayoutUsdCents: 100_000_00,
    });
    const out = await tool.execute(
      VALID_INPUT,
      buildCtx({
        scopes: BILLING_SCOPES,
        approvalRecordId: 'approval-5-eye-9981',
      }),
    );
    expect(out.kind).toBe('ok');
  });

  it('auth-gated — missing billing:write refused', async () => {
    const { dispatcher } = stub();
    const tool = createPayoutOwnerTool({
      ownerPayoutDispatcher: dispatcher,
      maxPayoutUsdCents: 50_000_00,
    });
    const out = await tool.execute(
      VALID_INPUT,
      buildCtx({ scopes: ['platform:ops:write'] }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('refuses tenant the caller cannot reach', async () => {
    const { dispatcher } = stub();
    const tool = createPayoutOwnerTool({
      ownerPayoutDispatcher: dispatcher,
      maxPayoutUsdCents: 50_000_00,
    });
    const out = await tool.execute(
      VALID_INPUT,
      buildCtx({
        // Drop platform:admin so the caller has NO platform-wide
        // reach; their tenant-scoped reach is on t-other but the
        // input targets t-alpha.
        scopes: [
          'platform:billing:write',
          'platform:ops:write',
          ...TENANT_SCOPED_SCOPES('t-other'),
        ],
      }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('refuses inverted period (periodStart >= periodEnd)', async () => {
    const { dispatcher } = stub();
    const tool = createPayoutOwnerTool({
      ownerPayoutDispatcher: dispatcher,
      maxPayoutUsdCents: 50_000_00,
    });
    const out = await tool.execute(
      {
        ...VALID_INPUT,
        periodStart: '2026-05-01T00:00:00.000Z',
        periodEnd: '2026-04-30T23:59:59.000Z',
      },
      buildCtx({ scopes: BILLING_SCOPES }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('INVARIANT_VIOLATION');
  });

  it('input validation — non-ISO-4217 currency rejected', () => {
    const { dispatcher } = stub();
    const tool = createPayoutOwnerTool({
      ownerPayoutDispatcher: dispatcher,
      maxPayoutUsdCents: 50_000_00,
    });
    expect(
      tool.inputSchema.safeParse({
        ...VALID_INPUT,
        currency: 'tanzanian-shillings',
      }).success,
    ).toBe(false);
  });

  it('surfaces FX errors as failed result', async () => {
    const { dispatcher } = stub({ fxThrows: new Error('fx-offline') });
    const tool = createPayoutOwnerTool({
      ownerPayoutDispatcher: dispatcher,
      maxPayoutUsdCents: 50_000_00,
    });
    const out = await tool.execute(VALID_INPUT, buildCtx({ scopes: BILLING_SCOPES }));
    if (out.kind !== 'failed') throw new Error('expected failed');
    expect(out.message).toContain('fx-offline');
  });

  it('surfaces dispatcher throws as failed result', async () => {
    const { dispatcher } = stub({ startThrows: new Error('temporal-down') });
    const tool = createPayoutOwnerTool({
      ownerPayoutDispatcher: dispatcher,
      maxPayoutUsdCents: 50_000_00,
    });
    const out = await tool.execute(VALID_INPUT, buildCtx({ scopes: BILLING_SCOPES }));
    if (out.kind !== 'failed') throw new Error('expected failed');
    expect(out.message).toContain('temporal-down');
  });

  it('emits sovereign-ledger row at billing tier with costEstimateUsd', async () => {
    const { dispatcher } = stub();
    const ledger = makeInMemorySovereignLedger();
    const tool = createPayoutOwnerTool({
      ownerPayoutDispatcher: dispatcher,
      maxPayoutUsdCents: 50_000_00,
    });
    await tool.execute(
      VALID_INPUT,
      buildCtx({ scopes: BILLING_SCOPES, sovereignLedger: ledger }),
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]?.riskTier).toBe('billing');
    expect(ledger.rows[0]?.costEstimateUsd).toBeGreaterThan(0);
  });

  it('rollback signals refund on the workflow', async () => {
    const { dispatcher, refunds } = stub();
    const tool = createPayoutOwnerTool({
      ownerPayoutDispatcher: dispatcher,
      maxPayoutUsdCents: 50_000_00,
    });
    const out = await tool.execute(VALID_INPUT, buildCtx({ scopes: BILLING_SCOPES }));
    if (out.kind !== 'ok') throw new Error('expected ok');
    await tool.rollback?.(out.output, buildCtx({ scopes: BILLING_SCOPES }));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.workflowId).toBe(out.output.workflowId);
  });
});
