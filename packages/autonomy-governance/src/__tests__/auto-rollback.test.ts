/**
 * Auto-rollback engine tests.
 *
 * Exercises every action branch of `executeAutoRollback` against fake
 * ports — verifies the receipt + the side-effects (canary update, handoff
 * enqueue, revert call) happen for the right verdicts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  executeAutoRollback,
  type CanaryStageStore,
  type HandoffQueuePort,
  type SubMdRevertPort,
  type AutoRollbackDeps,
} from '../slo/auto-rollback.js';
import type {
  CanaryStage,
  HandoffQueueEntry,
  SloMonitorVerdict,
  SubMdSlo,
} from '../types.js';

const TENANT = '11111111-1111-1111-1111-111111111111';

interface CanaryUpdate {
  readonly subMd: string;
  readonly tenantId: string | null;
  readonly stage: CanaryStage;
}

interface RevertCall {
  readonly subMd: string;
  readonly tenantId: string | null;
  readonly reason: string;
}

function mkDeps(): {
  deps: AutoRollbackDeps;
  canaryUpdates: CanaryUpdate[];
  handoffEntries: HandoffQueueEntry[];
  revertCalls: RevertCall[];
} {
  const canaryUpdates: CanaryUpdate[] = [];
  const handoffEntries: HandoffQueueEntry[] = [];
  const revertCalls: RevertCall[] = [];

  const canaryStore: CanaryStageStore = {
    async update(subMd, tenantId, newStage) {
      canaryUpdates.push({ subMd, tenantId, stage: newStage });
    },
  };
  const handoffQueue: HandoffQueuePort = {
    async enqueue(entry) {
      handoffEntries.push(entry);
    },
  };
  const revertPort: SubMdRevertPort = {
    async revert(subMd, tenantId, reason) {
      revertCalls.push({ subMd, tenantId, reason });
    },
  };

  let idCounter = 0;
  const deps: AutoRollbackDeps = {
    canaryStore,
    handoffQueue,
    revertPort,
    now: () => new Date('2026-05-18T00:00:00Z'),
    newId: () => `id-${++idCounter}`,
  };

  return { deps, canaryUpdates, handoffEntries, revertCalls };
}

const baseSlo: SubMdSlo = Object.freeze({
  subMd: 'arrears-triage',
  tenantId: TENANT,
  metric: 'resolution-quality',
  target: 0.85,
  window: 'rolling-24h',
  breachAction: 'reduce-traffic',
  canaryStage: 'canary-25pct',
});

describe('executeAutoRollback', () => {
  let env: ReturnType<typeof mkDeps>;
  beforeEach(() => {
    env = mkDeps();
  });

  it('no-op verdict produces a no-op receipt with no side effects', async () => {
    const verdict: SloMonitorVerdict = Object.freeze({
      subMd: baseSlo.subMd,
      metric: baseSlo.metric,
      breached: false,
      nextStage: null,
      action: 'no-op',
      reason: 'fine',
    });
    const receipt = await executeAutoRollback({ slo: baseSlo, verdict }, env.deps);
    expect(receipt.action).toBe('warn');
    expect(receipt.toStage).toBe(baseSlo.canaryStage);
    expect(env.canaryUpdates).toHaveLength(0);
    expect(env.handoffEntries).toHaveLength(0);
    expect(env.revertCalls).toHaveLength(0);
  });

  it('warn verdict produces receipt but no side effects', async () => {
    const verdict: SloMonitorVerdict = Object.freeze({
      subMd: baseSlo.subMd,
      metric: baseSlo.metric,
      breached: true,
      nextStage: baseSlo.canaryStage,
      action: 'warn',
      reason: 'soft breach',
    });
    const receipt = await executeAutoRollback({ slo: baseSlo, verdict }, env.deps);
    expect(receipt.action).toBe('warn');
    expect(env.canaryUpdates).toHaveLength(0);
  });

  it('reduce-traffic verdict updates the canary store one rung down', async () => {
    const verdict: SloMonitorVerdict = Object.freeze({
      subMd: baseSlo.subMd,
      metric: baseSlo.metric,
      breached: true,
      nextStage: 'canary-5pct',
      action: 'reduce-traffic',
      reason: 'quality drift',
    });
    const receipt = await executeAutoRollback({ slo: baseSlo, verdict }, env.deps);
    expect(receipt.toStage).toBe('canary-5pct');
    expect(env.canaryUpdates).toEqual([
      { subMd: baseSlo.subMd, tenantId: TENANT, stage: 'canary-5pct' },
    ]);
  });

  it('handoff verdict pushes the in-flight request to the human queue', async () => {
    const verdict: SloMonitorVerdict = Object.freeze({
      subMd: baseSlo.subMd,
      metric: baseSlo.metric,
      breached: true,
      nextStage: 'shadow',
      action: 'handoff',
      reason: 'sustained breach',
    });
    const receipt = await executeAutoRollback(
      {
        slo: baseSlo,
        verdict,
        inFlightRequest: {
          tenantId: TENANT,
          payload: { caseId: 'arr-001' },
          priority: 'P1',
        },
      },
      env.deps,
    );
    expect(receipt.toStage).toBe('shadow');
    expect(receipt.handoffQueued).toBe(true);
    expect(env.handoffEntries).toHaveLength(1);
    expect(env.handoffEntries[0]!.priority).toBe('P1');
    expect(env.handoffEntries[0]!.id).toBe('id-1');
    expect(env.canaryUpdates).toHaveLength(1);
    expect(env.canaryUpdates[0]!.stage).toBe('shadow');
  });

  it('handoff verdict with no in-flight request does not enqueue', async () => {
    const verdict: SloMonitorVerdict = Object.freeze({
      subMd: baseSlo.subMd,
      metric: baseSlo.metric,
      breached: true,
      nextStage: 'shadow',
      action: 'handoff',
      reason: 'sustained breach',
    });
    const receipt = await executeAutoRollback({ slo: baseSlo, verdict }, env.deps);
    expect(receipt.handoffQueued).toBe(false);
    expect(env.handoffEntries).toHaveLength(0);
  });

  it('kill-and-rollback verdict calls revert + queues handoff', async () => {
    const verdict: SloMonitorVerdict = Object.freeze({
      subMd: baseSlo.subMd,
      metric: baseSlo.metric,
      breached: true,
      nextStage: 'shadow',
      action: 'kill-and-rollback',
      reason: 'critical drift',
    });
    const receipt = await executeAutoRollback(
      {
        slo: baseSlo,
        verdict,
        inFlightRequest: {
          tenantId: TENANT,
          payload: { caseId: 'arr-002' },
        },
      },
      env.deps,
    );
    expect(receipt.toStage).toBe('disabled');
    expect(receipt.handoffQueued).toBe(true);
    expect(env.canaryUpdates[0]!.stage).toBe('shadow');
    expect(env.revertCalls).toHaveLength(1);
    expect(env.revertCalls[0]!.reason).toBe('critical drift');
  });

  it('kill-and-rollback restores canary stage if revert throws (H9 saga)', async () => {
    // Pre-fix: canaryStore.update(...,'shadow') then revertPort.revert()
    // ran sequentially without a compensation. If revert threw, the
    // sub-MD was stuck quarantined-by-canary but with the broken code
    // still nominally deployed — no rollback. Fix: catch and restore.
    const canaryUpdates: CanaryUpdate[] = [];
    const canaryStore: CanaryStageStore = {
      async update(subMd, tenantId, newStage) {
        canaryUpdates.push({ subMd, tenantId, stage: newStage });
      },
    };
    const revertPort: SubMdRevertPort = {
      async revert() {
        throw new Error('downstream revert API unavailable');
      },
    };
    const deps: AutoRollbackDeps = {
      canaryStore,
      handoffQueue: { async enqueue() { /* no-op */ } },
      revertPort,
      now: () => new Date('2026-05-18T00:00:00Z'),
      newId: () => 'id-x',
    };
    const verdict: SloMonitorVerdict = Object.freeze({
      subMd: baseSlo.subMd,
      metric: baseSlo.metric,
      breached: true,
      nextStage: 'shadow',
      action: 'kill-and-rollback',
      reason: 'critical drift',
    });
    await expect(
      executeAutoRollback({ slo: baseSlo, verdict }, deps),
    ).rejects.toThrow(/revert/);
    // The canary stage saw TWO writes: first to 'shadow', then the
    // compensating restore back to baseSlo.canaryStage ('canary-25pct').
    expect(canaryUpdates).toHaveLength(2);
    expect(canaryUpdates[0]!.stage).toBe('shadow');
    expect(canaryUpdates[1]!.stage).toBe(baseSlo.canaryStage);
  });

  it('kill-and-rollback surfaces both errors when compensating restore also fails (H9 saga)', async () => {
    let firstCall = true;
    const canaryStore: CanaryStageStore = {
      async update() {
        if (firstCall) {
          firstCall = false;
          return; // first write to 'shadow' succeeds
        }
        throw new Error('canary store io error');
      },
    };
    const revertPort: SubMdRevertPort = {
      async revert() {
        throw new Error('revert blew up');
      },
    };
    const deps: AutoRollbackDeps = {
      canaryStore,
      handoffQueue: { async enqueue() { /* no-op */ } },
      revertPort,
      now: () => new Date('2026-05-18T00:00:00Z'),
      newId: () => 'id-x',
    };
    const verdict: SloMonitorVerdict = Object.freeze({
      subMd: baseSlo.subMd,
      metric: baseSlo.metric,
      breached: true,
      nextStage: 'shadow',
      action: 'kill-and-rollback',
      reason: 'critical drift',
    });
    await expect(
      executeAutoRollback({ slo: baseSlo, verdict }, deps),
    ).rejects.toThrow(/inconsistent state/i);
  });
});
