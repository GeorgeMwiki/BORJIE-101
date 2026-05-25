import { describe, it, expect } from 'vitest';
import {
  createEvictTenantTool,
  type EvictionWorkflowDispatcherPort,
} from '../platform.evict_tenant.js';
import {
  buildCtx,
  makeInMemorySovereignLedger,
  TENANT_SCOPED_SCOPES,
} from './test-rig.js';

interface StubBundle {
  readonly dispatcher: EvictionWorkflowDispatcherPort;
  readonly starts: Array<{
    tenantId: string;
    leaseId: string;
    breachKind: string;
  }>;
  readonly withdrawals: Array<{ workflowId: string; reason: string }>;
}

function stub(
  opts: { startThrows?: Error } = {},
): StubBundle {
  const starts: Array<{
    tenantId: string;
    leaseId: string;
    breachKind: string;
  }> = [];
  const withdrawals: Array<{ workflowId: string; reason: string }> = [];
  return {
    starts,
    withdrawals,
    dispatcher: {
      async start(args) {
        if (opts.startThrows) throw opts.startThrows;
        starts.push({
          tenantId: args.tenantId,
          leaseId: args.leaseId,
          breachKind: args.breachKind,
        });
        return {
          workflowId: `eviction-${args.leaseId}`,
          runId: `run-${starts.length}`,
        };
      },
      async withdraw(args) {
        withdrawals.push({
          workflowId: args.workflowId,
          reason: args.reason,
        });
      },
    },
  };
}

// Note: tenant-reachability requires either `platform:*`, `platform:admin*`,
// or a `platform:foo:*` wildcard scope (see callerCanReachTenant). We add
// `platform:admin` to the role-class scopes so the caller can reach the
// test tenant; tests that specifically exercise tenant-reachability refusal
// drop this and replace it with a TENANT_SCOPED_SCOPES on a different tenant.
const DESTROY_SCOPES = [
  'platform:eviction:write',
  'platform:ops:write',
  'platform:admin',
];

const VALID_INPUT = {
  tenantId: 't-alpha',
  leaseId: 'lse-001',
  evictionDate: '2026-06-01T00:00:00.000Z',
  courtRef: 'DLT-2026-9981',
  breachKind: 'rent-arrears' as const,
  initiatedByUserId: 'admin-user-1',
};

describe('platform.evict_tenant', () => {
  it('happy path — starts the workflow and returns the run handle', async () => {
    const { dispatcher, starts } = stub();
    const tool = createEvictTenantTool({ evictionDispatcher: dispatcher });
    const out = await tool.execute(VALID_INPUT, buildCtx({ scopes: DESTROY_SCOPES }));
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.status).toBe('started');
    expect(out.output.workflowId).toBe('eviction-lse-001');
    expect(starts).toHaveLength(1);
    expect(starts[0]?.breachKind).toBe('rent-arrears');
  });

  it('declares destroy tier and approval-required', () => {
    const { dispatcher } = stub();
    const tool = createEvictTenantTool({ evictionDispatcher: dispatcher });
    expect(tool.riskTier).toBe('destroy');
    expect(tool.approvalRequired).toBe(true);
  });

  it('auth-gated — missing platform:eviction:write refused', async () => {
    const { dispatcher } = stub();
    const tool = createEvictTenantTool({ evictionDispatcher: dispatcher });
    const out = await tool.execute(
      VALID_INPUT,
      buildCtx({ scopes: ['platform:ops:write'] }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('refuses tenant the caller cannot reach', async () => {
    const { dispatcher } = stub();
    const tool = createEvictTenantTool({ evictionDispatcher: dispatcher });
    const out = await tool.execute(
      VALID_INPUT,
      buildCtx({
        // Role-class scopes WITHOUT platform:admin — caller can only
        // reach tenants they have a tenant-prefixed scope on. Here that
        // is t-beta, but VALID_INPUT targets t-alpha.
        scopes: [
          'platform:eviction:write',
          'platform:ops:write',
          ...TENANT_SCOPED_SCOPES('t-beta'),
        ],
      }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('input validation — invalid breach kind rejected', () => {
    const { dispatcher } = stub();
    const tool = createEvictTenantTool({ evictionDispatcher: dispatcher });
    expect(
      tool.inputSchema.safeParse({
        ...VALID_INPUT,
        breachKind: 'not-a-real-breach',
      }).success,
    ).toBe(false);
  });

  it('input validation — non-ISO evictionDate rejected', () => {
    const { dispatcher } = stub();
    const tool = createEvictTenantTool({ evictionDispatcher: dispatcher });
    expect(
      tool.inputSchema.safeParse({
        ...VALID_INPUT,
        evictionDate: 'next tuesday',
      }).success,
    ).toBe(false);
  });

  it('surfaces dispatcher throws as failed result', async () => {
    const { dispatcher } = stub({
      startThrows: new Error('temporal-down'),
    });
    const tool = createEvictTenantTool({ evictionDispatcher: dispatcher });
    const out = await tool.execute(VALID_INPUT, buildCtx({ scopes: DESTROY_SCOPES }));
    if (out.kind !== 'failed') throw new Error('expected failed');
    expect(out.message).toContain('temporal-down');
  });

  it('emits sovereign-ledger row at destroy tier', async () => {
    const { dispatcher } = stub();
    const ledger = makeInMemorySovereignLedger();
    const tool = createEvictTenantTool({ evictionDispatcher: dispatcher });
    await tool.execute(
      VALID_INPUT,
      buildCtx({ scopes: DESTROY_SCOPES, sovereignLedger: ledger }),
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]?.riskTier).toBe('destroy');
    expect(ledger.rows[0]?.approvalRequired).toBe(true);
    expect(ledger.rows[0]?.tenantId).toBe('t-alpha');
  });

  it('rollback signals withdraw on the workflow', async () => {
    const { dispatcher, withdrawals } = stub();
    const tool = createEvictTenantTool({ evictionDispatcher: dispatcher });
    const out = await tool.execute(VALID_INPUT, buildCtx({ scopes: DESTROY_SCOPES }));
    if (out.kind !== 'ok') throw new Error('expected ok');
    await tool.rollback?.(out.output, buildCtx({ scopes: DESTROY_SCOPES }));
    expect(withdrawals).toHaveLength(1);
    expect(withdrawals[0]?.workflowId).toBe('eviction-lse-001');
  });

  it('optional courtRef passes through to dispatcher', async () => {
    let captured: string | null = null;
    const dispatcher: EvictionWorkflowDispatcherPort = {
      async start(args) {
        captured = args.courtRef;
        return { workflowId: 'wf', runId: 'r' };
      },
      async withdraw() {},
    };
    const tool = createEvictTenantTool({ evictionDispatcher: dispatcher });
    await tool.execute(
      { ...VALID_INPUT, courtRef: undefined },
      buildCtx({ scopes: DESTROY_SCOPES }),
    );
    expect(captured).toBeNull();
  });
});
