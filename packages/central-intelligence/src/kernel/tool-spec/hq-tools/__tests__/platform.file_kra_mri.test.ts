import { describe, it, expect } from 'vitest';
import {
  createFileKraMriTool,
  type KraMriFilingWorkflowDispatcherPort,
} from '../platform.file_kra_mri.js';
import {
  buildCtx,
  makeInMemorySovereignLedger,
  TENANT_SCOPED_SCOPES,
} from './test-rig.js';

interface StubBundle {
  readonly dispatcher: KraMriFilingWorkflowDispatcherPort;
  readonly starts: Array<{ tenantId: string; taxPeriodMonth: string }>;
  readonly retractions: Array<{ workflowId: string; reason: string }>;
}

function stub(opts: { startThrows?: Error } = {}): StubBundle {
  const starts: Array<{ tenantId: string; taxPeriodMonth: string }> = [];
  const retractions: Array<{ workflowId: string; reason: string }> = [];
  return {
    starts,
    retractions,
    dispatcher: {
      async start(args) {
        if (opts.startThrows) throw opts.startThrows;
        starts.push({
          tenantId: args.tenantId,
          taxPeriodMonth: args.taxPeriodMonth,
        });
        return {
          workflowId: `kra-mri-${args.tenantId}-${args.taxPeriodMonth}`,
          runId: `run-${starts.length}`,
        };
      },
      async requestRetraction(args) {
        retractions.push({
          workflowId: args.workflowId,
          reason: args.reason,
        });
      },
    },
  };
}

// platform:admin gives tenant reachability — see callerCanReachTenant.
// Tests that specifically exercise tenant-reachability refusal drop this.
const EXT_COMM_SCOPES = [
  'platform:kra:write',
  'platform:ops:write',
  'platform:admin',
];

const VALID_INPUT = {
  tenantId: 't-alpha',
  taxPeriodMonth: '2026-04',
  returnPayload: {
    entityTin: '123456789',
    grossRent: 5_000_000, // TZS cents
    deductibleExpenses: 1_000_000,
    taxableIncome: 4_000_000,
    taxDue: 400_000, // 10% of 4M
  },
  initiatedByUserId: 'admin-user-1',
};

describe('platform.file_kra_mri', () => {
  it('happy path — starts the workflow', async () => {
    const { dispatcher, starts } = stub();
    const tool = createFileKraMriTool({ kraMriDispatcher: dispatcher });
    const out = await tool.execute(VALID_INPUT, buildCtx({ scopes: EXT_COMM_SCOPES }));
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.status).toBe('started');
    expect(out.output.workflowId).toBe('kra-mri-t-alpha-2026-04');
    expect(out.output.entityTin).toBe('123456789');
    expect(starts).toHaveLength(1);
  });

  it('declares external-comm tier with approval-required', () => {
    const { dispatcher } = stub();
    const tool = createFileKraMriTool({ kraMriDispatcher: dispatcher });
    expect(tool.riskTier).toBe('external-comm');
    expect(tool.approvalRequired).toBe(true);
  });

  it('auth-gated — missing kra:write refused', async () => {
    const { dispatcher } = stub();
    const tool = createFileKraMriTool({ kraMriDispatcher: dispatcher });
    const out = await tool.execute(
      VALID_INPUT,
      buildCtx({ scopes: ['platform:ops:write'] }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('refuses tenant the caller cannot reach', async () => {
    const { dispatcher } = stub();
    const tool = createFileKraMriTool({ kraMriDispatcher: dispatcher });
    const out = await tool.execute(
      VALID_INPUT,
      buildCtx({
        // Drop platform:admin — caller can only reach t-other.
        scopes: [
          'platform:kra:write',
          'platform:ops:write',
          ...TENANT_SCOPED_SCOPES('t-other'),
        ],
      }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('input validation — bad taxPeriodMonth format rejected', () => {
    const { dispatcher } = stub();
    const tool = createFileKraMriTool({ kraMriDispatcher: dispatcher });
    expect(
      tool.inputSchema.safeParse({
        ...VALID_INPUT,
        taxPeriodMonth: '2026-13', // bad month
      }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({
        ...VALID_INPUT,
        taxPeriodMonth: '04-2026', // wrong order
      }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({
        ...VALID_INPUT,
        taxPeriodMonth: '1999-04', // year < 2000
      }).success,
    ).toBe(false);
  });

  it('input validation — bad TIN format rejected', () => {
    const { dispatcher } = stub();
    const tool = createFileKraMriTool({ kraMriDispatcher: dispatcher });
    expect(
      tool.inputSchema.safeParse({
        ...VALID_INPUT,
        returnPayload: {
          ...VALID_INPUT.returnPayload,
          entityTin: 'ABC-NOT-NUMERIC',
        },
      }).success,
    ).toBe(false);
  });

  it('refuses payload where taxableIncome ≠ gross - deductibles', async () => {
    const { dispatcher } = stub();
    const tool = createFileKraMriTool({ kraMriDispatcher: dispatcher });
    const out = await tool.execute(
      {
        ...VALID_INPUT,
        returnPayload: {
          ...VALID_INPUT.returnPayload,
          taxableIncome: 99, // not gross - deductibles
        },
      },
      buildCtx({ scopes: EXT_COMM_SCOPES }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('INVARIANT_VIOLATION');
  });

  it('refuses payload where taxDue ≠ 10% of taxableIncome', async () => {
    const { dispatcher } = stub();
    const tool = createFileKraMriTool({ kraMriDispatcher: dispatcher });
    const out = await tool.execute(
      {
        ...VALID_INPUT,
        returnPayload: {
          ...VALID_INPUT.returnPayload,
          taxDue: 1, // wildly wrong
        },
      },
      buildCtx({ scopes: EXT_COMM_SCOPES }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('INVARIANT_VIOLATION');
  });

  it('surfaces dispatcher throws as failed result', async () => {
    const { dispatcher } = stub({ startThrows: new Error('kra-gateway-down') });
    const tool = createFileKraMriTool({ kraMriDispatcher: dispatcher });
    const out = await tool.execute(VALID_INPUT, buildCtx({ scopes: EXT_COMM_SCOPES }));
    if (out.kind !== 'failed') throw new Error('expected failed');
    expect(out.message).toContain('kra-gateway-down');
  });

  it('emits sovereign-ledger row at external-comm tier', async () => {
    const { dispatcher } = stub();
    const ledger = makeInMemorySovereignLedger();
    const tool = createFileKraMriTool({ kraMriDispatcher: dispatcher });
    await tool.execute(
      VALID_INPUT,
      buildCtx({ scopes: EXT_COMM_SCOPES, sovereignLedger: ledger }),
    );
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]?.riskTier).toBe('external-comm');
    expect(ledger.rows[0]?.approvalRequired).toBe(true);
  });

  it('rollback signals retraction on the workflow', async () => {
    const { dispatcher, retractions } = stub();
    const tool = createFileKraMriTool({ kraMriDispatcher: dispatcher });
    const out = await tool.execute(VALID_INPUT, buildCtx({ scopes: EXT_COMM_SCOPES }));
    if (out.kind !== 'ok') throw new Error('expected ok');
    await tool.rollback?.(out.output, buildCtx({ scopes: EXT_COMM_SCOPES }));
    expect(retractions).toHaveLength(1);
    expect(retractions[0]?.workflowId).toBe(out.output.workflowId);
  });

  it('accepts hyphenated TIN format', async () => {
    const { dispatcher } = stub();
    const tool = createFileKraMriTool({ kraMriDispatcher: dispatcher });
    const out = await tool.execute(
      {
        ...VALID_INPUT,
        returnPayload: {
          ...VALID_INPUT.returnPayload,
          entityTin: '123-456-789',
        },
      },
      buildCtx({ scopes: EXT_COMM_SCOPES }),
    );
    expect(out.kind).toBe('ok');
  });
});
