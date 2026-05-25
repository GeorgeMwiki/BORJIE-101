/**
 * slo-stream.test.ts — exercises `subscribeSloStream` end-to-end.
 *
 * Confirms:
 *   1. Events that don't match any registered SLO are dropped.
 *   2. The consumer batches into the window buffer and only evaluates
 *      every N events (default 10).
 *   3. On a sustained breach, the configured `AutoRollbackDeps` is
 *      invoked and the right receipt is emitted.
 *   4. Below the sample-size floor, the consumer is a no-op.
 *   5. The 'no-op' verdict path does NOT invoke rollback.
 */

import { describe, it, expect } from 'vitest';
import {
  subscribeSloStream,
  type SloResolver,
  type SloWindowBuffer,
} from '../slo-monitor.js';
import type {
  AutoRollbackDeps,
  CanaryStageStore,
  HandoffQueuePort,
  SubMdRevertPort,
} from '../auto-rollback.js';
import type {
  AutoRollbackReceipt,
  CanaryStage,
  SloEvent,
  SubMdSlo,
} from '../../types.js';

const TENANT = '11111111-1111-1111-1111-111111111111';

const SLO: SubMdSlo = Object.freeze({
  subMd: 'maintenance.dispatch',
  tenantId: TENANT,
  metric: 'resolution-quality',
  target: 0.85,
  window: 'rolling-7d',
  breachAction: 'reduce-traffic',
  canaryStage: 'canary-25pct',
});

function buildResolver(slo: SubMdSlo | null): SloResolver {
  return Object.freeze({
    async resolve(): Promise<SubMdSlo | null> {
      return slo;
    },
  });
}

function buildBuffer(): {
  buffer: SloWindowBuffer;
  store: Map<string, SloEvent[]>;
  counter: Map<string, number>;
} {
  const store = new Map<string, SloEvent[]>();
  const counter = new Map<string, number>();
  const buffer: SloWindowBuffer = {
    async append(key, event) {
      const list = store.get(key) ?? [];
      list.push(event);
      store.set(key, list);
      counter.set(key, (counter.get(key) ?? 0) + 1);
    },
    async read(key) {
      return store.get(key) ?? [];
    },
    async sinceLastEvaluate(key) {
      return counter.get(key) ?? 0;
    },
    async markEvaluated(key) {
      counter.set(key, 0);
    },
  };
  return { buffer, store, counter };
}

interface CanaryUpdate {
  readonly subMd: string;
  readonly tenantId: string | null;
  readonly stage: CanaryStage;
}

function buildRollbackDeps(): {
  deps: AutoRollbackDeps;
  canaryUpdates: CanaryUpdate[];
} {
  const canaryUpdates: CanaryUpdate[] = [];
  const canaryStore: CanaryStageStore = {
    async update(subMd, tenantId, stage) {
      canaryUpdates.push({ subMd, tenantId, stage });
    },
  };
  const handoffQueue: HandoffQueuePort = {
    async enqueue() {
      /* not exercised here */
    },
  };
  const revertPort: SubMdRevertPort = {
    async revert() {
      /* not exercised here */
    },
  };
  return {
    canaryUpdates,
    deps: {
      canaryStore,
      handoffQueue,
      revertPort,
      now: () => new Date('2026-05-18T00:00:00Z'),
      newId: () => 'fixed-id',
    },
  };
}

function buildEvent(delta: number, idx: number): SloEvent {
  return Object.freeze({
    subMd: SLO.subMd,
    tenantId: TENANT,
    timestamp: new Date(Date.UTC(2026, 4, 18, 0, idx)).toISOString(),
    metric: SLO.metric,
    actualValue: SLO.target + delta,
    delta,
  });
}

describe('subscribeSloStream', () => {
  it('drops events that don\'t resolve to a registered SLO', async () => {
    const resolver = buildResolver(null);
    const { buffer, store } = buildBuffer();
    const { deps, canaryUpdates } = buildRollbackDeps();

    const consumer = subscribeSloStream({ resolver, buffer, rollbackDeps: deps });
    const verdict = await consumer.consume(buildEvent(-0.5, 0));
    expect(verdict).toBeNull();
    expect(store.size).toBe(0);
    expect(canaryUpdates).toEqual([]);
  });

  it('only evaluates every N events; no rollback on breach below sample floor', async () => {
    const resolver = buildResolver(SLO);
    const { buffer } = buildBuffer();
    const { deps, canaryUpdates } = buildRollbackDeps();

    const consumer = subscribeSloStream({
      resolver,
      buffer,
      rollbackDeps: deps,
      evaluateEveryNEvents: 5,
    });

    // 4 events — below the evaluation threshold; consumer should not
    // evaluate or rollback.
    for (let i = 0; i < 4; i++) {
      const v = await consumer.consume(buildEvent(-0.3, i));
      expect(v).toBeNull();
    }
    expect(canaryUpdates).toEqual([]);
  });

  it('evaluates after Nth event and triggers reduce-traffic on sustained breach', async () => {
    const resolver = buildResolver(SLO);
    const { buffer } = buildBuffer();
    const { deps, canaryUpdates } = buildRollbackDeps();

    const receipts: AutoRollbackReceipt[] = [];
    const consumer = subscribeSloStream({
      resolver,
      buffer,
      rollbackDeps: deps,
      evaluateEveryNEvents: 10,
      monitorOptions: { minSampleSize: 10, toleranceFraction: 0.05 },
      onReceipt: (r) => {
        receipts.push(r);
      },
    });

    // 10 events with significant negative delta — sustained breach far
    // outside the 5% tolerance band.
    let lastVerdict = null;
    for (let i = 0; i < 10; i++) {
      lastVerdict = await consumer.consume(buildEvent(-0.4, i));
    }

    expect(lastVerdict).not.toBeNull();
    expect(lastVerdict?.breached).toBe(true);
    expect(lastVerdict?.action).toBe('reduce-traffic');
    expect(canaryUpdates.length).toBe(1);
    expect(canaryUpdates[0].subMd).toBe(SLO.subMd);
    expect(canaryUpdates[0].stage).toBe('canary-5pct'); // demoted one rung from canary-25pct
    expect(receipts.length).toBe(1);
    expect(receipts[0].action).toBe('reduce-traffic');
  });

  it('does not invoke rollback when the verdict is no-op (within SLO)', async () => {
    const resolver = buildResolver(SLO);
    const { buffer } = buildBuffer();
    const { deps, canaryUpdates } = buildRollbackDeps();

    const receipts: AutoRollbackReceipt[] = [];
    const consumer = subscribeSloStream({
      resolver,
      buffer,
      rollbackDeps: deps,
      evaluateEveryNEvents: 10,
      onReceipt: (r) => {
        receipts.push(r);
      },
    });

    // 10 events with positive deltas — comfortably inside SLO.
    let lastVerdict = null;
    for (let i = 0; i < 10; i++) {
      lastVerdict = await consumer.consume(buildEvent(0.05, i));
    }
    expect(lastVerdict).not.toBeNull();
    expect(lastVerdict?.breached).toBe(false);
    expect(lastVerdict?.action).toBe('no-op');
    expect(canaryUpdates).toEqual([]);
    expect(receipts).toEqual([]);
  });

  it('resets the sinceLastEvaluate counter after every evaluation', async () => {
    const resolver = buildResolver(SLO);
    const { buffer, counter } = buildBuffer();
    const { deps } = buildRollbackDeps();

    const consumer = subscribeSloStream({
      resolver,
      buffer,
      rollbackDeps: deps,
      evaluateEveryNEvents: 3,
    });
    for (let i = 0; i < 3; i++) await consumer.consume(buildEvent(0.1, i));
    // After the 3rd event the consumer evaluated and reset the counter.
    const key = `${SLO.subMd}::${SLO.metric}::${TENANT}`;
    expect(counter.get(key)).toBe(0);
  });
});
