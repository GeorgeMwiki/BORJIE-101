import { describe, expect, it } from 'vitest';
import { runSoT, __test_helpers } from './sot-runner.js';
import type { ModelAdapter } from '../shared/types.js';
import type { SoTEvent } from './types.js';

/**
 * Build a deterministic virtual clock so we can measure SoT's FMP improvement
 * against a synthetic single-pass baseline without flaky wall-clock timing.
 *
 * Each model call advances the clock by the model's configured latency.
 * Parallel point expansions are emulated by tracking the max of concurrent
 * scheduled completions (Promise.all under runSoT awaits them concurrently;
 * we just need our virtual `now` to reflect the wall-clock max, not sum).
 */
function makeVirtualClock(): {
  now: () => number;
  advanceConcurrent: (latencies: ReadonlyArray<number>) => Promise<void>;
  advance: (ms: number) => void;
} {
  let t = 0;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    advanceConcurrent: async (latencies) => {
      // Just bump the clock by the max — see scheduleAt comment below
      t += Math.max(...latencies);
    },
  };
}

/**
 * Tiered model factory: returns a `ModelAdapter` that completes after a
 * configurable latency on the virtual clock. Real tests don't need true
 * concurrency — they need to assert *what FMP would be* on the wall clock
 * given the model's contracts. We track this by capturing the virtual
 * timestamps the harness queries.
 *
 * For the parallel point-model, we model each call as instantaneous on the
 * virtual clock but expose a `tick()` helper the test runs once `Promise.all`
 * starts to advance the clock by the max latency.
 */
type ScheduledModel = {
  readonly adapter: ModelAdapter;
  readonly latencyMs: number;
};

function tieredModel(
  latencyMs: number,
  respond: (prompt: string) => string,
  clock: { now: () => number; advance: (ms: number) => void },
): ScheduledModel {
  const adapter: ModelAdapter = async (input) => {
    clock.advance(latencyMs);
    return respond(input.prompt);
  };
  return { adapter, latencyMs };
}

describe('runSoT — skeleton-of-thought mobile FMP path', () => {
  it('throws when skeleton parse yields zero points', async () => {
    await expect(
      runSoT({
        question: 'Q',
        skeletonModel: async () => 'no list here, just prose',
        pointModel: async () => 'x',
        nowMs: () => 0,
      }),
    ).rejects.toThrow(/no usable points/);
  });

  it('Scenario 1 — Q2 owner briefing (5-point skeleton, parallel expansion)', async () => {
    const clock = makeVirtualClock();
    const skeleton = tieredModel(150, () =>
      JSON.stringify([
        'Q2 occupancy',
        'Top-line revenue',
        'Maintenance spend',
        'Tenant churn',
        'Forecast for Q3',
      ]),
      clock,
    );
    const pointModel: ModelAdapter = async (input) => {
      // each point: virtual 600ms, but Promise.all means max-not-sum on
      // wall clock — we model that by advancing the clock once when the
      // *first* concurrent point starts, not per call
      return `Detailed answer for: ${input.prompt.slice(-40)}`;
    };
    const synthesis = tieredModel(200, () => 'Stitched final briefing.', clock);
    const events: SoTEvent[] = [];
    const result = await runSoT({
      question: 'Give me a Q2 owner briefing for property 12B',
      skeletonModel: skeleton.adapter,
      pointModel,
      synthesisModel: synthesis.adapter,
      maxBranches: 5,
      branchTimeoutMs: 1000,
      onEvent: (e) => events.push(e),
      nowMs: clock.now,
    });
    expect(result.skeleton).toHaveLength(5);
    expect(result.points).toHaveLength(5);
    expect(events[0]?.kind).toBe('skeleton-ready');
    expect(events.at(-1)?.kind).toBe('synthesis-ready');
    // FMP should equal the skeleton latency (150ms)
    expect(result.fmpMs).toBe(150);
  });

  it('Scenario 2 — FMP improvement vs single-pass CoT baseline', async () => {
    // Baseline single-pass model: 1500ms latency for a long answer.
    const baselineLatencyMs = 1500;

    // SoT model: 150ms skeleton + max(point latency) + 200ms synthesis.
    const clock = makeVirtualClock();
    const skeleton = tieredModel(
      150,
      () => JSON.stringify(['p1', 'p2', 'p3', 'p4']),
      clock,
    );
    // Point model: each takes 350ms but in parallel — wall clock is max(350)
    // = 350ms total for the parallel batch. We model that by advancing the
    // clock by 350 once after the points "start" using a custom Promise.all
    // wrapper — instead we just emulate by giving every pointModel call a
    // small per-call advance (the runner uses Promise.all under the hood and
    // our virtual clock advances inside each — same as wall-clock for the
    // max). We achieve true max semantics by having the pointModel itself
    // *not* advance the clock and instead bump once at the end.
    let pointAdvanced = false;
    const pointModel: ModelAdapter = async () => {
      if (!pointAdvanced) {
        clock.advance(350);
        pointAdvanced = true;
      }
      return 'point content';
    };
    const synthesis = tieredModel(200, () => 'synthesised', clock);
    const result = await runSoT({
      question: 'long-form question',
      skeletonModel: skeleton.adapter,
      pointModel,
      synthesisModel: synthesis.adapter,
      branchTimeoutMs: 2000,
      nowMs: clock.now,
    });
    // FMP = skeleton latency = 150ms.
    expect(result.fmpMs).toBe(150);
    // FMP improvement multiplier (lower bound — real prod likely larger)
    const fmpImprovement = baselineLatencyMs / result.fmpMs;
    expect(fmpImprovement).toBeGreaterThanOrEqual(10);
  });

  it('Scenario 3 — timed-out point gets <timeout> placeholder, not a crash', async () => {
    const clock = makeVirtualClock();
    const skeleton = tieredModel(50, () => JSON.stringify(['fast', 'slow']), clock);
    let firstCallSeen = false;
    const pointModel: ModelAdapter = async (input) => {
      if (input.prompt.includes('slow')) {
        // Pretend to hang forever — Promise.race against timeout will pick
        // the placeholder.
        return new Promise(() => {});
      }
      firstCallSeen = true;
      return 'fast answer';
    };
    const result = await runSoT({
      question: 'q',
      skeletonModel: skeleton.adapter,
      pointModel,
      branchTimeoutMs: 25,
      nowMs: clock.now,
    });
    expect(firstCallSeen).toBe(true);
    expect(result.points[1]?.content).toBe('<timeout>');
  });

  it('Scenario 4 — fallback markdown stitch when no synthesisModel provided', async () => {
    const clock = makeVirtualClock();
    const result = await runSoT({
      question: 'q',
      skeletonModel: async () => JSON.stringify(['a', 'b']),
      pointModel: async (i) => (i.prompt.includes('"a"') ? 'A body' : 'B body'),
      nowMs: clock.now,
    });
    expect(result.text).toContain('**a** — A body');
    expect(result.text).toContain('**b** — B body');
  });

  it('Scenario 5 — clamps maxBranches into [1, 12]', async () => {
    const clock = makeVirtualClock();
    const out = await runSoT({
      question: 'q',
      skeletonModel: async () =>
        JSON.stringify(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13']),
      pointModel: async () => 'x',
      maxBranches: 999,
      nowMs: clock.now,
    });
    expect(out.skeleton).toHaveLength(12);
  });

  it('Scenario 6 — parseSkeleton handles bullet/numbered lists', () => {
    const numbered = __test_helpers.parseSkeleton('1. Foo\n2) Bar\n- Baz\n* Qux', 10);
    expect(numbered).toEqual(['Foo', 'Bar', 'Baz', 'Qux']);
    const json = __test_helpers.parseSkeleton('["A", "B"]', 10);
    expect(json).toEqual(['A', 'B']);
    const empty = __test_helpers.parseSkeleton('just prose with no structure', 10);
    expect(empty).toEqual([]);
  });
});
