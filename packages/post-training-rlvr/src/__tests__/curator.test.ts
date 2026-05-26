/**
 * Curator — dedupe + exclusion reasons + reward floor + synthetic
 * guard.
 */

import { describe, expect, it } from 'vitest';
import { curate } from '../pipeline/curator.js';
import { DEFAULT_CURATOR_CONFIG } from '../types.js';
import type {
  RewardShape,
  RlvrRunKind,
  RlvrTrace,
  VerificationResult,
} from '../types.js';

function synthTrace(id: string, prompt: string, synthetic = true): RlvrTrace {
  return Object.freeze({
    id,
    runId: 'run-1',
    tenantId: 'tenant-A',
    prompt,
    completion: 'x',
    toolCalls: [],
    metadata: Object.freeze({ synthetic }),
    capturedAt: '2026-05-26T00:00:00.000Z',
  });
}

function reward(
  traceId: string,
  aggregate: number,
  anyFail = false,
): RewardShape {
  const result: VerificationResult = Object.freeze({
    verifierName: 'mock',
    verdict: anyFail ? 'fail' : 'pass',
    reward: aggregate,
    evidence: {},
    confidence: 1,
  });
  return Object.freeze({
    traceId,
    perVerifier: Object.freeze([result]),
    aggregate,
    effectiveWeight: 1,
    anyFail,
  });
}

let idCounter = 0;
const idGen = (): string => `id-${++idCounter}`;
const clock = (): Date => new Date('2026-05-26T00:00:00.000Z');

describe('curate', () => {
  it('excludes duplicates (same canonical prompt)', () => {
    const trace1 = synthTrace('t1', 'same prompt');
    const trace2 = synthTrace('t2', 'same prompt');
    const examples = curate({
      runId: 'run-1',
      runKind: 'synthetic_test',
      entries: [
        { trace: trace1, reward: reward('t1', 0.9) },
        { trace: trace2, reward: reward('t2', 0.9) },
      ],
      config: DEFAULT_CURATOR_CONFIG,
      idGen,
      clock,
    });
    expect(examples.filter((e) => e.included)).toHaveLength(1);
    expect(
      examples.find((e) => e.traceId === 't2')?.exclusionReason,
    ).toBe('duplicate_prompt');
  });

  it('excludes traces below the reward floor', () => {
    const examples = curate({
      runId: 'run-1',
      runKind: 'synthetic_test',
      entries: [
        {
          trace: synthTrace('low', 'unique low'),
          reward: reward('low', 0.2),
        },
      ],
      config: DEFAULT_CURATOR_CONFIG,
      idGen,
      clock,
    });
    expect(examples[0]?.included).toBe(false);
    expect(examples[0]?.exclusionReason).toBe('reward_below_floor');
  });

  it('excludes synthetic traces in non-synthetic runs', () => {
    const examples = curate({
      runId: 'run-1',
      runKind: 'tra_filings' satisfies RlvrRunKind,
      entries: [
        {
          trace: synthTrace('t', 'unique', true),
          reward: reward('t', 0.9),
        },
      ],
      config: DEFAULT_CURATOR_CONFIG,
      idGen,
      clock,
    });
    expect(examples[0]?.included).toBe(false);
    expect(examples[0]?.exclusionReason).toBe('synthetic_in_production');
  });

  it('excludes traces with any verifier fail (default)', () => {
    const examples = curate({
      runId: 'run-1',
      runKind: 'synthetic_test',
      entries: [
        {
          trace: synthTrace('t', 'unique', true),
          reward: reward('t', 0.9, /*anyFail*/ true),
        },
      ],
      config: DEFAULT_CURATOR_CONFIG,
      idGen,
      clock,
    });
    expect(examples[0]?.included).toBe(false);
    expect(examples[0]?.exclusionReason).toBe('any_fail');
  });

  it('includes failures when includeFailures = true', () => {
    const examples = curate({
      runId: 'run-1',
      runKind: 'synthetic_test',
      entries: [
        {
          trace: synthTrace('t', 'unique', true),
          reward: reward('t', 0.9, true),
        },
      ],
      config: { ...DEFAULT_CURATOR_CONFIG, includeFailures: true },
      idGen,
      clock,
    });
    expect(examples[0]?.included).toBe(true);
  });
});
