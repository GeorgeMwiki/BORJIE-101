/**
 * Tests for the online LLM-judge sampler.
 *
 * Covers:
 *   - hash-based sampling is deterministic per traceId
 *   - the effective sample rate matches the configured rate
 *     (within a small tolerance) for a uniform traceId distribution
 *   - extremes: 0 and 1 short-circuit correctly
 *   - score() is non-blocking and fire-and-forget
 *   - backpressure: queue >maxQueueDepth drops new samples
 *   - judgeFn / sink errors do not propagate to the caller
 *   - 10 dimensions exported with the expected shape
 *   - getEvalDimension returns the dimension for a known id
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createOnlineJudge,
  isTraceSampled,
  traceIdToSampleValue,
  type JudgeFn,
  type JudgeScore,
  type ScoreSink,
} from '../online-judge.js';
import {
  EVAL_DIMENSIONS,
  EVAL_DIMENSION_COUNT,
  getEvalDimension,
  type EvalDimensionId,
} from '../dimensions.js';

// ---------------------------------------------------------------------------
// Helpers: in-memory sink + deterministic judge stub
// ---------------------------------------------------------------------------

function makeInMemorySink(): {
  sink: ScoreSink;
  writes: JudgeScore[];
} {
  const writes: JudgeScore[] = [];
  const sink: ScoreSink = {
    write(score) {
      writes.push(score);
    },
  };
  return { sink, writes };
}

function dummyScore(traceId: string): JudgeScore {
  return {
    traceId,
    dimensions: EVAL_DIMENSIONS.map((d) => ({
      dimensionId: d.id,
      score: 1.0,
    })),
    judgeLatencyMs: 5,
  };
}

const okJudge: JudgeFn = async (t) => dummyScore(t.traceId);

// ---------------------------------------------------------------------------
// Sampling determinism + fairness
// ---------------------------------------------------------------------------

describe('traceIdToSampleValue', () => {
  it('returns a value in [0, 1)', () => {
    for (const id of ['a', 'trace-1', 'trace-2', 'some-very-long-id']) {
      const v = traceIdToSampleValue(id);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic for the same input', () => {
    expect(traceIdToSampleValue('abc')).toBe(traceIdToSampleValue('abc'));
  });
});

describe('isTraceSampled — hash-based determinism', () => {
  it('returns the same answer for the same (traceId, rate) — no flapping', () => {
    for (let i = 0; i < 50; i++) {
      const id = `trace-${i}`;
      const first = isTraceSampled(id, 0.5);
      const second = isTraceSampled(id, 0.5);
      const third = isTraceSampled(id, 0.5);
      expect(first).toBe(second);
      expect(second).toBe(third);
    }
  });

  it('rate=0 always skips', () => {
    for (let i = 0; i < 20; i++) {
      expect(isTraceSampled(`trace-${i}`, 0)).toBe(false);
    }
  });

  it('rate=1 always samples', () => {
    for (let i = 0; i < 20; i++) {
      expect(isTraceSampled(`trace-${i}`, 1)).toBe(true);
    }
  });

  it('the effective rate over a large set matches the configured rate', () => {
    const N = 5000;
    const targetRate = 0.1;
    let hits = 0;
    for (let i = 0; i < N; i++) {
      if (isTraceSampled(`trace-${i}`, targetRate)) hits += 1;
    }
    const observed = hits / N;
    // Loose tolerance — 5pp window is comfortably wider than the
    // standard error for N=5000, p=0.1 (~0.004).
    expect(Math.abs(observed - targetRate)).toBeLessThan(0.05);
  });
});

// ---------------------------------------------------------------------------
// Online judge — end-to-end sampling, backpressure, isolation
// ---------------------------------------------------------------------------

describe('createOnlineJudge — sampling honours sampleRate', () => {
  it('sampleRate=0 never enqueues a judge call', async () => {
    const { sink, writes } = makeInMemorySink();
    let judgeCalled = 0;
    const judge: JudgeFn = async (t) => {
      judgeCalled += 1;
      return dummyScore(t.traceId);
    };
    const oj = createOnlineJudge({ sampleRate: 0, judgeFn: judge, sink });
    for (let i = 0; i < 100; i++) {
      await oj.score(`trace-${i}`, 'req', 'res');
    }
    await oj.drain();
    expect(judgeCalled).toBe(0);
    expect(writes).toHaveLength(0);
    expect(oj.getStats().skipped).toBe(100);
    expect(oj.getStats().sampled).toBe(0);
  });

  it('sampleRate=1 calls judge for every trace', async () => {
    const { sink, writes } = makeInMemorySink();
    const oj = createOnlineJudge({ sampleRate: 1, judgeFn: okJudge, sink });
    for (let i = 0; i < 25; i++) {
      await oj.score(`trace-${i}`, 'req', 'res');
    }
    await oj.drain();
    expect(writes).toHaveLength(25);
    expect(oj.getStats().sampled).toBe(25);
    expect(oj.getStats().completed).toBe(25);
  });

  it('default rate (0.03) yields ~3% sampled across a large trace set', async () => {
    const { sink } = makeInMemorySink();
    const oj = createOnlineJudge({ judgeFn: okJudge, sink });
    const N = 1000;
    for (let i = 0; i < N; i++) {
      await oj.score(`trace-${i}`, 'req', 'res');
    }
    await oj.drain();
    const stats = oj.getStats();
    expect(stats.skipped + stats.sampled).toBe(N);
    const observedRate = stats.sampled / N;
    // ±3pp window — wide enough not to flake but tight enough to catch
    // a regression that disables sampling entirely.
    expect(Math.abs(observedRate - 0.03)).toBeLessThan(0.03);
  });
});

describe('createOnlineJudge — backpressure', () => {
  it('drops new samples when in-flight queue >= maxQueueDepth', async () => {
    // Hold each judge call open until we release it.
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowJudge: JudgeFn = async (t) => {
      await gate;
      return dummyScore(t.traceId);
    };
    const { sink } = makeInMemorySink();
    const oj = createOnlineJudge({
      sampleRate: 1,
      judgeFn: slowJudge,
      sink,
      maxQueueDepth: 5,
    });
    // Fire 12 samples — 5 fill the queue, 7 must be dropped.
    for (let i = 0; i < 12; i++) {
      await oj.score(`trace-${i}`, 'req', 'res');
    }
    expect(oj.getStats().sampled).toBe(5);
    expect(oj.getStats().dropped).toBe(7);
    expect(oj.getStats().queueDepth).toBe(5);
    // Release the gate so the queue drains for cleanup.
    release?.();
    await oj.drain();
    expect(oj.getStats().completed).toBe(5);
  });

  it('drop counter increments above the 1000 default threshold', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowJudge: JudgeFn = async (t) => {
      await gate;
      return dummyScore(t.traceId);
    };
    const { sink } = makeInMemorySink();
    const oj = createOnlineJudge({
      sampleRate: 1,
      judgeFn: slowJudge,
      sink,
    });
    // 1005 samples — first 1000 fill the default queue, last 5 dropped.
    for (let i = 0; i < 1005; i++) {
      await oj.score(`trace-${i}`, 'req', 'res');
    }
    expect(oj.getStats().sampled).toBe(1000);
    expect(oj.getStats().dropped).toBe(5);
    release?.();
    await oj.drain();
  });
});

describe('createOnlineJudge — error isolation', () => {
  it('judge throws never propagate; failed counter increments; onError fires', async () => {
    const errors: Array<{ err: unknown; traceId: string }> = [];
    const judge: JudgeFn = async () => {
      throw new Error('llm rate limited');
    };
    const { sink } = makeInMemorySink();
    const oj = createOnlineJudge({
      sampleRate: 1,
      judgeFn: judge,
      sink,
      onError: (err, traceId) => {
        errors.push({ err, traceId });
      },
    });
    await oj.score('trace-fail-1', 'req', 'res');
    await oj.drain();
    expect(oj.getStats().failed).toBe(1);
    expect(errors).toHaveLength(1);
    expect((errors[0]?.err as Error).message).toContain('llm rate limited');
  });

  it('sink throws are absorbed too', async () => {
    const errSink: ScoreSink = {
      write() {
        throw new Error('sink down');
      },
    };
    const oj = createOnlineJudge({
      sampleRate: 1,
      judgeFn: okJudge,
      sink: errSink,
    });
    await oj.score('trace-sink-fail', 'req', 'res');
    await oj.drain();
    expect(oj.getStats().failed).toBe(1);
  });
});

describe('createOnlineJudge — non-blocking', () => {
  it('score() returns before the judge resolves', async () => {
    let resolveJudge: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      resolveJudge = resolve;
    });
    const slowJudge: JudgeFn = async (t) => {
      await gate;
      return dummyScore(t.traceId);
    };
    const { sink, writes } = makeInMemorySink();
    const oj = createOnlineJudge({
      sampleRate: 1,
      judgeFn: slowJudge,
      sink,
    });
    await oj.score('trace-non-blocking', 'req', 'res');
    // Sink should not yet have a write — judge is still gated.
    expect(writes).toHaveLength(0);
    expect(oj.getStats().queueDepth).toBe(1);
    resolveJudge?.();
    await oj.drain();
    expect(writes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Dimensions module shape
// ---------------------------------------------------------------------------

describe('EVAL_DIMENSIONS', () => {
  it('exports exactly 10 dimensions', () => {
    expect(EVAL_DIMENSIONS).toHaveLength(EVAL_DIMENSION_COUNT);
    expect(EVAL_DIMENSION_COUNT).toBe(10);
  });

  it('every dimension has the required shape', () => {
    for (const d of EVAL_DIMENSIONS) {
      expect(typeof d.id).toBe('string');
      expect(d.id.length).toBeGreaterThan(0);
      expect(typeof d.name).toBe('string');
      expect(d.name.length).toBeGreaterThan(0);
      expect(typeof d.prompt).toBe('string');
      expect(d.prompt.length).toBeGreaterThan(20);
      expect(d.scoreScale).toBe('0-1');
      expect(['critical', 'high', 'medium', 'low']).toContain(d.severity);
    }
  });

  it('ids are unique', () => {
    const ids = new Set<string>();
    for (const d of EVAL_DIMENSIONS) {
      expect(ids.has(d.id), `duplicate dimension id ${d.id}`).toBe(false);
      ids.add(d.id);
    }
  });

  it('includes the expected R-MOAT-6 canonical ids', () => {
    const expected: ReadonlyArray<EvalDimensionId> = [
      'tenant-intent-accuracy',
      'jurisdiction-correctness',
      'currency-fx-correctness',
      'pii-redaction-recall',
      'cross-tenant-isolation',
      'vendor-grounding',
      'kiswahili-english-codeswitch',
      'action-confirmation-accuracy',
      'hallucination-rate-financials',
      'latency-quality-frontier',
    ];
    const actual = EVAL_DIMENSIONS.map((d) => d.id);
    for (const id of expected) {
      expect(actual).toContain(id);
    }
  });

  it('the four critical dimensions are tagged severity=critical', () => {
    const criticalIds = new Set(
      EVAL_DIMENSIONS.filter((d) => d.severity === 'critical').map((d) => d.id),
    );
    // jurisdiction, currency-fx, pii-redaction, cross-tenant,
    // action-confirmation, hallucination — all critical per R-MOAT-6.
    expect(criticalIds.has('jurisdiction-correctness')).toBe(true);
    expect(criticalIds.has('currency-fx-correctness')).toBe(true);
    expect(criticalIds.has('pii-redaction-recall')).toBe(true);
    expect(criticalIds.has('cross-tenant-isolation')).toBe(true);
    expect(criticalIds.has('action-confirmation-accuracy')).toBe(true);
    expect(criticalIds.has('hallucination-rate-financials')).toBe(true);
  });
});

describe('getEvalDimension', () => {
  it('returns the dimension for a known id', () => {
    const d = getEvalDimension('pii-redaction-recall');
    expect(d).toBeDefined();
    expect(d?.severity).toBe('critical');
  });

  it('returns undefined for an unknown id', () => {
    // Cast through any to bypass the union check — we want runtime safety.
    const d = getEvalDimension('not-a-real-dimension' as EvalDimensionId);
    expect(d).toBeUndefined();
  });
});
