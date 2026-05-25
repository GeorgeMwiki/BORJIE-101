/**
 * Unit tests — createDecisionTraceQueryService.
 *
 * Coverage:
 *   - listRecent passes through happy path
 *   - capability filter
 *   - scoreMin filter
 *   - tenantId filter
 *   - limit clamping
 *   - recorder error → []
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createDecisionTraceQueryService,
  type DecisionTraceRecorderLike,
  type DecisionTraceRow,
} from '../../platform/decision-trace-query.service.js';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

function makeRecorder(rows: ReadonlyArray<DecisionTraceRow>): DecisionTraceRecorderLike {
  return { listRecent: () => rows };
}

const sample: ReadonlyArray<DecisionTraceRow> = [
  {
    traceId: 't1',
    threadId: 'th1',
    tenantId: 'tenant-a',
    capability: 'navigate',
    score: 0.9,
    stepCount: 3,
    startedAt: '2026-05-01T00:00:00Z',
    finishedAt: '2026-05-01T00:00:10Z',
  },
  {
    traceId: 't2',
    threadId: 'th2',
    tenantId: 'tenant-b',
    capability: 'navigate',
    score: 0.3,
    stepCount: 1,
    startedAt: '2026-05-02T00:00:00Z',
    finishedAt: null,
  },
  {
    traceId: 't3',
    threadId: 'th3',
    tenantId: 'tenant-a',
    capability: 'reflect',
    score: null,
    stepCount: 4,
    startedAt: '2026-05-03T00:00:00Z',
    finishedAt: '2026-05-03T00:00:20Z',
  },
];

describe('platform.decisionTraces — listRecent', () => {
  it('returns all rows when no filter supplied', async () => {
    const svc = createDecisionTraceQueryService(makeRecorder(sample));
    const out = await svc.listRecent({
      limit: 10,
      capability: null,
      scoreMin: null,
      tenantId: null,
    });
    expect(out).toHaveLength(3);
  });

  it('filters by capability', async () => {
    const svc = createDecisionTraceQueryService(makeRecorder(sample));
    const out = await svc.listRecent({
      limit: 10,
      capability: 'navigate',
      scoreMin: null,
      tenantId: null,
    });
    expect(out).toHaveLength(2);
  });

  it('filters by scoreMin (drops null + below threshold)', async () => {
    const svc = createDecisionTraceQueryService(makeRecorder(sample));
    const out = await svc.listRecent({
      limit: 10,
      capability: null,
      scoreMin: 0.5,
      tenantId: null,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.traceId).toBe('t1');
  });

  it('filters by tenantId', async () => {
    const svc = createDecisionTraceQueryService(makeRecorder(sample));
    const out = await svc.listRecent({
      limit: 10,
      capability: null,
      scoreMin: null,
      tenantId: 'tenant-a',
    });
    expect(out.every((r) => r.tenantId === 'tenant-a')).toBe(true);
  });

  it('clamps limit to MAX_LIMIT (100)', async () => {
    const big = Array.from({ length: 200 }).map((_, i) => ({
      ...sample[0]!,
      traceId: `t${i}`,
    }));
    const svc = createDecisionTraceQueryService(makeRecorder(big));
    const out = await svc.listRecent({
      limit: 9999,
      capability: null,
      scoreMin: null,
      tenantId: null,
    });
    expect(out).toHaveLength(100);
  });

  it('returns [] when recorder throws', async () => {
    const recorder: DecisionTraceRecorderLike = {
      listRecent: () => {
        throw new Error('boom');
      },
    };
    const svc = createDecisionTraceQueryService(recorder);
    expect(
      await svc.listRecent({
        limit: 10,
        capability: null,
        scoreMin: null,
        tenantId: null,
      }),
    ).toEqual([]);
  });
});
