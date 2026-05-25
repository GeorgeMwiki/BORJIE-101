/**
 * Stage 03 — reflect unit tests.
 *
 * Coverage:
 *   1. stub critic produces a deterministic reflection text
 *   2. caller-supplied critic is used when wired
 *   3. critic throw → cluster skipped, others continue
 *   4. empty cluster list → empty results
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createStubCritic,
  runReflectStage,
} from '../../stages/03-reflect.js';
import type {
  ReflectionCritic,
  StageLogger,
  TraceCluster,
} from '../../stages/types.js';

function makeLogger(): StageLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeCluster(
  id: string,
  outcome: TraceCluster['outcome'] = 'success',
  score = 0.7,
): TraceCluster {
  return {
    clusterId: id,
    tenantId: 't-1',
    intentLabel: 'late-rent-reminder',
    traces: [
      {
        traceId: `${id}-t1`,
        tenantId: 't-1',
        userId: 'u-1',
        threadId: 'th',
        summary: 'late rent reminder',
        capturedAt: new Date().toISOString(),
      },
    ],
    outcome,
    score,
    signalsInside: 5,
  };
}

describe('runReflectStage', () => {
  it('uses the stub critic by default', async () => {
    const out = await runReflectStage({
      clusters: [makeCluster('c1', 'success', 0.9)],
      logger: makeLogger(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toMatch(/stub-haiku/);
    expect(out[0]?.outcome).toBe('success');
  });

  it('uses the caller-supplied critic when wired', async () => {
    const critic: ReflectionCritic = {
      async reflect(c) {
        return {
          clusterId: c.clusterId,
          tenantId: c.tenantId,
          text: 'real critic says hello',
          outcome: c.outcome,
          intentLabel: c.intentLabel,
        };
      },
    };
    const out = await runReflectStage({
      clusters: [makeCluster('c1')],
      logger: makeLogger(),
      critic,
    });
    expect(out[0]?.text).toBe('real critic says hello');
  });

  it('skips clusters when the critic throws, continues with the rest', async () => {
    const critic: ReflectionCritic = {
      async reflect(c) {
        if (c.clusterId === 'bad') throw new Error('haiku exploded');
        return {
          clusterId: c.clusterId,
          tenantId: c.tenantId,
          text: 'ok',
          outcome: c.outcome,
          intentLabel: c.intentLabel,
        };
      },
    };
    const out = await runReflectStage({
      clusters: [makeCluster('good'), makeCluster('bad'), makeCluster('also-good')],
      logger: makeLogger(),
      critic,
    });
    expect(out.map((r) => r.clusterId)).toEqual(['good', 'also-good']);
  });

  it('returns [] for empty cluster list', async () => {
    const out = await runReflectStage({
      clusters: [],
      logger: makeLogger(),
    });
    expect(out).toEqual([]);
  });
});

describe('createStubCritic', () => {
  it('produces a deterministic reflection given the same cluster', async () => {
    const critic = createStubCritic();
    const cluster = makeCluster('c1', 'failure', -0.7);
    const a = await critic.reflect(cluster);
    const b = await critic.reflect(cluster);
    expect(a.text).toBe(b.text);
    expect(a.text).toMatch(/failed/);
  });
});

describe('runReflectStage — constitutional critic (RLAIF)', () => {
  it('invokes the constitutional critic for each reflection', async () => {
    const scored: string[] = [];
    const constitutionalCritic = {
      async score(r: { clusterId: string }) {
        scored.push(r.clusterId);
        return {
          clusterId: r.clusterId,
          overall: 0.95,
          passed: true,
          scores: [],
        };
      },
    };
    await runReflectStage({
      clusters: [makeCluster('c1'), makeCluster('c2')],
      logger: makeLogger(),
      constitutionalCritic,
    });
    expect(scored).toEqual(['c1', 'c2']);
  });

  it('survives a constitutional critic throw without dropping reflections', async () => {
    const constitutionalCritic = {
      async score() {
        throw new Error('critic boom');
      },
    };
    const out = await runReflectStage({
      clusters: [makeCluster('c1')],
      logger: makeLogger(),
      constitutionalCritic,
    });
    expect(out).toHaveLength(1);
  });
});
