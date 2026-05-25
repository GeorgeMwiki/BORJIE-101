/**
 * Tests for the KE eRITS extension to platform.file_kra_mri.
 *
 * These tests exercise the jurisdiction='KE' input branch added in
 * Phase D D10. The legacy TZ MRI branch is covered by the existing
 * platform.file_kra_mri.test.ts file — we do not duplicate it here.
 */

import { describe, it, expect } from 'vitest';
import {
  createFileKraMriTool,
  type KraEritsFilingWorkflowDispatcherPort,
  type KraMriFilingWorkflowDispatcherPort,
} from '../platform.file_kra_mri.js';
import { buildCtx } from './test-rig.js';

interface StubBundle {
  readonly mriDispatcher: KraMriFilingWorkflowDispatcherPort;
  readonly eritsDispatcher: KraEritsFilingWorkflowDispatcherPort;
  readonly eritsStarts: Array<{ tenantId: string; period: string; ownerCount: number }>;
  readonly eritsRetractions: Array<{ workflowId: string; reason: string }>;
}

function stub(opts: { eritsStartThrows?: Error; missingEritsDispatcher?: boolean } = {}): StubBundle {
  const eritsStarts: Array<{ tenantId: string; period: string; ownerCount: number }> = [];
  const eritsRetractions: Array<{ workflowId: string; reason: string }> = [];
  const mriDispatcher: KraMriFilingWorkflowDispatcherPort = {
    async start() {
      throw new Error('TZ MRI path should not run for KE inputs');
    },
    async requestRetraction() {
      // no-op
    },
  };
  const eritsDispatcher: KraEritsFilingWorkflowDispatcherPort = {
    async start(args) {
      if (opts.eritsStartThrows) throw opts.eritsStartThrows;
      eritsStarts.push({
        tenantId: args.tenantId,
        period: args.taxPeriodMonth,
        ownerCount: args.owners.length,
      });
      return {
        workflowId: `kra-erits-${args.tenantId}-${args.taxPeriodMonth}`,
        runId: `run-${eritsStarts.length}`,
      };
    },
    async requestRetraction(args) {
      eritsRetractions.push({ workflowId: args.workflowId, reason: args.reason });
    },
  };
  return { mriDispatcher, eritsDispatcher, eritsStarts, eritsRetractions };
}

const EXT_COMM_SCOPES = [
  'platform:kra:write',
  'platform:ops:write',
  'platform:admin',
];

const VALID_KE_INPUT = {
  jurisdiction: 'KE' as const,
  tenantId: 't-alpha',
  taxPeriodMonth: '2026-04',
  initiatedByUserId: 'admin-user-1',
  owners: [
    {
      ownerId: 'o-1',
      kraPin: 'A123456789B',
      rentalAmountCents: 50_000_00,
      deductibleCents: 5_000_00,
    },
    {
      ownerId: 'o-2',
      kraPin: 'A234567890C',
      rentalAmountCents: 80_000_00,
      deductibleCents: 8_000_00,
    },
  ],
};

describe('platform.file_kra_mri — KE eRITS branch', () => {
  it('happy path — starts the eRITS workflow', async () => {
    const { mriDispatcher, eritsDispatcher, eritsStarts } = stub();
    const tool = createFileKraMriTool({
      kraMriDispatcher: mriDispatcher,
      kraEritsDispatcher: eritsDispatcher,
    });
    const out = await tool.execute(VALID_KE_INPUT, buildCtx({ scopes: EXT_COMM_SCOPES }));
    if (out.kind !== 'ok') throw new Error(`expected ok, got ${out.kind}`);
    expect(out.output.status).toBe('started');
    expect(out.output.jurisdiction).toBe('KE');
    expect(out.output.entityTin).toBe('');
    expect(out.output.ownerCount).toBe(2);
    expect(out.output.workflowId).toBe('kra-erits-t-alpha-2026-04');
    expect(eritsStarts).toHaveLength(1);
  });

  it('refuses when eRITS dispatcher missing from deps', async () => {
    const { mriDispatcher } = stub();
    const tool = createFileKraMriTool({ kraMriDispatcher: mriDispatcher });
    const out = await tool.execute(VALID_KE_INPUT, buildCtx({ scopes: EXT_COMM_SCOPES }));
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('NOT_IMPLEMENTED');
  });

  it('refuses bad KRA PIN format', () => {
    const { mriDispatcher, eritsDispatcher } = stub();
    const tool = createFileKraMriTool({
      kraMriDispatcher: mriDispatcher,
      kraEritsDispatcher: eritsDispatcher,
    });
    expect(
      tool.inputSchema.safeParse({
        ...VALID_KE_INPUT,
        owners: [{ ...VALID_KE_INPUT.owners[0]!, kraPin: 'bad-pin' }],
      }).success,
    ).toBe(false);
  });

  it('refuses when deductible exceeds rental for any owner', async () => {
    const { mriDispatcher, eritsDispatcher } = stub();
    const tool = createFileKraMriTool({
      kraMriDispatcher: mriDispatcher,
      kraEritsDispatcher: eritsDispatcher,
    });
    const out = await tool.execute(
      {
        ...VALID_KE_INPUT,
        owners: [
          {
            ownerId: 'o-bad',
            kraPin: 'A123456789B',
            rentalAmountCents: 100,
            deductibleCents: 999_999,
          },
        ],
      },
      buildCtx({ scopes: EXT_COMM_SCOPES }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('INVARIANT_VIOLATION');
  });

  it('refuses caller lacking required scopes', async () => {
    const { mriDispatcher, eritsDispatcher } = stub();
    const tool = createFileKraMriTool({
      kraMriDispatcher: mriDispatcher,
      kraEritsDispatcher: eritsDispatcher,
    });
    const out = await tool.execute(
      VALID_KE_INPUT,
      buildCtx({ scopes: ['platform:ops:write'] }),
    );
    if (out.kind !== 'refused') throw new Error('expected refused');
    expect(out.reasonCode).toBe('OUT_OF_SCOPE');
  });

  it('dispatcher throw bubbles up as failed result', async () => {
    const { mriDispatcher, eritsDispatcher } = stub({
      eritsStartThrows: new Error('temporal-down'),
    });
    const tool = createFileKraMriTool({
      kraMriDispatcher: mriDispatcher,
      kraEritsDispatcher: eritsDispatcher,
    });
    const out = await tool.execute(VALID_KE_INPUT, buildCtx({ scopes: EXT_COMM_SCOPES }));
    if (out.kind !== 'failed') throw new Error('expected failed');
    expect(out.message).toContain('temporal-down');
  });

  it('rollback for KE output routes to eRITS dispatcher retraction', async () => {
    const { mriDispatcher, eritsDispatcher, eritsRetractions } = stub();
    const tool = createFileKraMriTool({
      kraMriDispatcher: mriDispatcher,
      kraEritsDispatcher: eritsDispatcher,
    });
    const out = await tool.execute(VALID_KE_INPUT, buildCtx({ scopes: EXT_COMM_SCOPES }));
    if (out.kind !== 'ok') throw new Error('expected ok');
    await tool.rollback!(out.output, buildCtx({ scopes: EXT_COMM_SCOPES }));
    expect(eritsRetractions).toHaveLength(1);
    expect(eritsRetractions[0]!.workflowId).toBe(out.output.workflowId);
  });

  it('4-eye approval still required (external-comm tier)', () => {
    const { mriDispatcher, eritsDispatcher } = stub();
    const tool = createFileKraMriTool({
      kraMriDispatcher: mriDispatcher,
      kraEritsDispatcher: eritsDispatcher,
    });
    expect(tool.riskTier).toBe('external-comm');
    expect(tool.approvalRequired).toBe(true);
  });
});
