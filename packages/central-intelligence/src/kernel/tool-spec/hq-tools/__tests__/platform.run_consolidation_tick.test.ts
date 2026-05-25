import { describe, it, expect } from 'vitest';
import {
  createRunConsolidationTickTool,
  type ConsolidationRunnerPort,
  type RunConsolidationTickOutput,
} from '../platform.run_consolidation_tick.js';
import { buildCtx, TENANT_SCOPED_SCOPES } from './test-rig.js';

function stub(): {
  port: ConsolidationRunnerPort;
  rollbacks: string[];
} {
  const rollbacks: string[] = [];
  return {
    rollbacks,
    port: {
      async runTick(args): Promise<RunConsolidationTickOutput> {
        return {
          tickId: 'tick-abc',
          tenantId: args.tenantId,
          applied: !args.dryRun,
          startedAt: '2026-05-15T09:00:00.000Z',
          finishedAt: '2026-05-15T09:00:05.000Z',
          factsExtracted: 12,
          patternsDetected: 3,
          digestsWritten: 1,
          decayedEntries: 7,
          snapshotId: args.dryRun ? null : 'snap-xyz',
        };
      },
      async rollbackToSnapshot(snapshotId) {
        rollbacks.push(snapshotId);
      },
    },
  };
}

describe('platform.run_consolidation_tick', () => {
  it('happy path — runs tick + applies', async () => {
    const { port } = stub();
    const tool = createRunConsolidationTickTool({ consolidation: port });
    const out = await tool.execute({}, buildCtx());
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.applied).toBe(true);
    expect(out.output.factsExtracted).toBe(12);
  });

  it('dryRun=true skips application', async () => {
    const { port } = stub();
    const tool = createRunConsolidationTickTool({ consolidation: port });
    const out = await tool.execute({ dryRun: true }, buildCtx());
    if (out.kind !== 'ok') throw new Error('expected ok');
    expect(out.output.applied).toBe(false);
    expect(out.output.snapshotId).toBeNull();
  });

  it('auth-gated — caller missing scope refused', async () => {
    const { port } = stub();
    const tool = createRunConsolidationTickTool({ consolidation: port });
    const out = await tool.execute(
      {},
      buildCtx({ scopes: ['platform:tenants:read'] }),
    );
    expect(out.kind).toBe('refused');
  });

  it('refuses tenant caller cannot reach', async () => {
    const { port } = stub();
    const tool = createRunConsolidationTickTool({ consolidation: port });
    const out = await tool.execute(
      { tenantId: 't-beta' },
      buildCtx({
        scopes: ['platform:consolidation:run', ...TENANT_SCOPED_SCOPES('t-alpha')],
      }),
    );
    expect(out.kind).toBe('refused');
  });

  it('rollback restores from snapshotId when applied', async () => {
    const { port, rollbacks } = stub();
    const tool = createRunConsolidationTickTool({ consolidation: port });
    const out = await tool.execute({}, buildCtx());
    if (out.kind !== 'ok') throw new Error('expected ok');
    await tool.rollback?.(out.output, buildCtx());
    expect(rollbacks).toEqual(['snap-xyz']);
  });

  it('rollback is no-op for dryRun', async () => {
    const { port, rollbacks } = stub();
    const tool = createRunConsolidationTickTool({ consolidation: port });
    const out = await tool.execute({ dryRun: true }, buildCtx());
    if (out.kind !== 'ok') throw new Error('expected ok');
    await tool.rollback?.(out.output, buildCtx());
    expect(rollbacks).toEqual([]);
  });
});
