/**
 * Unit tests — createConsolidationRunnerService.
 *
 * Coverage:
 *   - runTick happy path passes through worker output
 *   - runTick rethrows on worker error
 *   - rollbackToSnapshot happy path
 *   - rollbackToSnapshot refuses empty snapshotId
 *   - rollbackToSnapshot rethrows on worker error
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createConsolidationRunnerService,
  type ConsolidationTickReport,
  type ConsolidationWorkerLike,
} from '../../platform/consolidation-runner.service.js';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

function makeWorker(opts?: {
  report?: ConsolidationTickReport;
  runThrows?: boolean;
  rollbackThrows?: boolean;
}): ConsolidationWorkerLike & { rollbackCalledWith?: string } {
  const w: any = {
    runOnce: async () => {
      if (opts?.runThrows) throw new Error('worker boom');
      return (
        opts?.report ?? {
          tickId: 'tick-1',
          tenantId: null,
          applied: true,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          factsExtracted: 5,
          patternsDetected: 1,
          digestsWritten: 1,
          decayedEntries: 0,
          snapshotId: 'snap-1',
        }
      );
    },
    rollbackSnapshot: async (snapshotId: string) => {
      w.rollbackCalledWith = snapshotId;
      if (opts?.rollbackThrows) throw new Error('rollback boom');
    },
  };
  return w;
}

describe('platform.consolidation — runTick', () => {
  it('returns worker report on happy path', async () => {
    const w = makeWorker();
    const svc = createConsolidationRunnerService(w);
    const out = await svc.runTick({ tenantId: null, dryRun: false });
    expect(out.tickId).toBe('tick-1');
    expect(out.applied).toBe(true);
    expect(out.snapshotId).toBe('snap-1');
  });

  it('passes dryRun and tenantId to worker', async () => {
    const w = makeWorker({
      report: {
        tickId: 't',
        tenantId: 'acme',
        applied: false,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        factsExtracted: 0,
        patternsDetected: 0,
        digestsWritten: 0,
        decayedEntries: 0,
        snapshotId: null,
      },
    });
    const svc = createConsolidationRunnerService(w);
    const out = await svc.runTick({ tenantId: 'acme', dryRun: true });
    expect(out.tenantId).toBe('acme');
    expect(out.applied).toBe(false);
    expect(out.snapshotId).toBeNull();
  });

  it('rethrows on worker error', async () => {
    const svc = createConsolidationRunnerService(makeWorker({ runThrows: true }));
    await expect(
      svc.runTick({ tenantId: null, dryRun: false }),
    ).rejects.toThrow(/worker boom/);
  });
});

describe('platform.consolidation — rollbackToSnapshot', () => {
  it('routes snapshotId to worker.rollbackSnapshot', async () => {
    const w = makeWorker();
    const svc = createConsolidationRunnerService(w);
    await svc.rollbackToSnapshot('snap-42');
    expect(w.rollbackCalledWith).toBe('snap-42');
  });

  it('refuses empty snapshotId', async () => {
    const svc = createConsolidationRunnerService(makeWorker());
    await expect(svc.rollbackToSnapshot('')).rejects.toThrow(/required/);
  });

  it('rethrows on worker error', async () => {
    const svc = createConsolidationRunnerService(
      makeWorker({ rollbackThrows: true }),
    );
    await expect(svc.rollbackToSnapshot('snap-1')).rejects.toThrow(
      /rollback boom/,
    );
  });
});
