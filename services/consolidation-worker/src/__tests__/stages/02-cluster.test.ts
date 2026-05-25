/**
 * Stage 02 — cluster unit tests.
 *
 * Coverage:
 *   1. groups traces by detected vocab label (late-rent / lease / ...)
 *   2. emits 'unknown' bucket for unmatched text
 *   3. separate clusters per tenantId
 *   4. signal scoring — thumbs-up + copy → success
 *   5. signal scoring — override + correction → failure
 *   6. mixed signals → mixed outcome
 *   7. custom clusterer override is used when supplied
 *   8. clusterer throw → returns []
 */

import { describe, it, expect, vi } from 'vitest';
import { runClusterStage } from '../../stages/02-cluster.js';
import type {
  IngestBundle,
  StageLogger,
  TraceCluster,
} from '../../stages/types.js';

function makeLogger(): StageLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeBundle(traces: number, opts: { tenantId?: string; summary?: string } = {}): IngestBundle {
  return {
    windowStart: new Date(0).toISOString(),
    windowEnd: new Date(1000).toISOString(),
    traces: Array.from({ length: traces }, (_, i) => ({
      traceId: `t${i}`,
      tenantId: opts.tenantId ?? 't-1',
      userId: 'u-1',
      threadId: 'th-1',
      summary: opts.summary ?? 'late rent reminder for unit 4B',
      capturedAt: new Date(i * 1000).toISOString(),
    })),
    implicitSignals: [],
    explicitFeedback: [],
  };
}

describe('runClusterStage — vocab bucketing', () => {
  it('puts late-rent traces into the late-rent-reminder cluster', async () => {
    const clusters = await runClusterStage({
      bundle: makeBundle(3, { summary: 'late rent reminder for 4B' }),
      logger: makeLogger(),
    });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.intentLabel).toBe('late-rent-reminder');
    expect(clusters[0]?.traces).toHaveLength(3);
  });

  it('emits an "unknown" cluster for unmatched text', async () => {
    const clusters = await runClusterStage({
      bundle: makeBundle(2, { summary: 'random conversation' }),
      logger: makeLogger(),
    });
    expect(clusters[0]?.intentLabel).toBe('unknown');
  });

  it('produces separate clusters per tenant', async () => {
    const bundle: IngestBundle = {
      ...makeBundle(0),
      traces: [
        {
          traceId: 'a1',
          tenantId: 't-A',
          userId: 'u-1',
          threadId: 'th-1',
          summary: 'late rent reminder',
          capturedAt: new Date().toISOString(),
        },
        {
          traceId: 'b1',
          tenantId: 't-B',
          userId: 'u-1',
          threadId: 'th-2',
          summary: 'late rent reminder',
          capturedAt: new Date().toISOString(),
        },
      ],
    };
    const clusters = await runClusterStage({
      bundle,
      logger: makeLogger(),
    });
    expect(clusters).toHaveLength(2);
    expect(new Set(clusters.map((c) => c.tenantId))).toEqual(
      new Set(['t-A', 't-B']),
    );
  });
});

describe('runClusterStage — outcome scoring', () => {
  it('thumbs-up + copy → success outcome', async () => {
    const bundle: IngestBundle = {
      ...makeBundle(0),
      traces: [
        {
          traceId: 't1',
          tenantId: 't-1',
          userId: 'u-1',
          threadId: 'th-1',
          summary: 'late rent reminder',
          capturedAt: new Date().toISOString(),
        },
      ],
      implicitSignals: [
        {
          id: 'i1',
          traceId: 't1',
          agentActionId: null,
          tenantId: 't-1',
          userId: 'u-1',
          surface: 'admin-portal',
          signalType: 'copy',
          strength: 1,
          emittedAt: new Date().toISOString(),
        },
      ],
      explicitFeedback: [
        {
          id: 'f1',
          tenantId: 't-1',
          userId: 'u-1',
          thoughtId: 't1',
          signal: 'thumbs-up',
          capturedAt: new Date().toISOString(),
        },
      ],
    };
    const clusters = await runClusterStage({
      bundle,
      logger: makeLogger(),
    });
    expect(clusters[0]?.outcome).toBe('success');
    expect(clusters[0]?.score).toBeGreaterThan(0);
  });

  it('override + correction → failure outcome', async () => {
    const bundle: IngestBundle = {
      ...makeBundle(0),
      traces: [
        {
          traceId: 't1',
          tenantId: 't-1',
          userId: 'u-1',
          threadId: 'th-1',
          summary: 'late rent reminder',
          capturedAt: new Date().toISOString(),
        },
      ],
      implicitSignals: [
        {
          id: 'i1',
          traceId: 't1',
          agentActionId: null,
          tenantId: 't-1',
          userId: 'u-1',
          surface: 'admin-portal',
          signalType: 'override',
          strength: 1,
          emittedAt: new Date().toISOString(),
        },
      ],
      explicitFeedback: [
        {
          id: 'f1',
          tenantId: 't-1',
          userId: 'u-1',
          thoughtId: 't1',
          signal: 'correction',
          capturedAt: new Date().toISOString(),
        },
      ],
    };
    const clusters = await runClusterStage({
      bundle,
      logger: makeLogger(),
    });
    expect(clusters[0]?.outcome).toBe('failure');
    expect(clusters[0]?.score).toBeLessThan(0);
  });

  it('mixed signals → mixed outcome', async () => {
    const bundle: IngestBundle = {
      ...makeBundle(0),
      traces: [
        {
          traceId: 't1',
          tenantId: 't-1',
          userId: 'u-1',
          threadId: 'th-1',
          summary: 'late rent reminder',
          capturedAt: new Date().toISOString(),
        },
      ],
      implicitSignals: [
        {
          id: 'i1',
          traceId: 't1',
          agentActionId: null,
          tenantId: 't-1',
          userId: 'u-1',
          surface: 'admin-portal',
          signalType: 'copy',
          strength: 0.3,
          emittedAt: new Date().toISOString(),
        },
        {
          id: 'i2',
          traceId: 't1',
          agentActionId: null,
          tenantId: 't-1',
          userId: 'u-1',
          surface: 'admin-portal',
          signalType: 're-prompt',
          strength: 0.2,
          emittedAt: new Date().toISOString(),
        },
      ],
      explicitFeedback: [],
    };
    const clusters = await runClusterStage({
      bundle,
      logger: makeLogger(),
    });
    expect(clusters[0]?.outcome).toBe('mixed');
  });
});

describe('runClusterStage — overrides + failure', () => {
  it('uses the custom clusterer when supplied', async () => {
    const staged: TraceCluster[] = [
      {
        clusterId: 'cls-A',
        tenantId: null,
        intentLabel: 'custom',
        traces: [],
        outcome: 'success',
        score: 1,
        signalsInside: 0,
      },
    ];
    const out = await runClusterStage({
      bundle: makeBundle(2),
      logger: makeLogger(),
      clusterer: async () => staged,
    });
    expect(out).toEqual(staged);
  });

  it('returns [] when the override clusterer throws', async () => {
    const out = await runClusterStage({
      bundle: makeBundle(2),
      logger: makeLogger(),
      clusterer: async () => {
        throw new Error('boom');
      },
    });
    expect(out).toEqual([]);
  });
});
