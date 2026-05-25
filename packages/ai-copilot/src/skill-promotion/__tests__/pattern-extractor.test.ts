/**
 * Tests for skill-promotion/pattern-extractor.
 *
 * Coverage:
 *   - finds a recurring 3-call pattern across multiple traces
 *   - groups identical sequences via codeHash (de-dupe)
 *   - de-duplicates within a single trace (same n-gram twice in one
 *     trace counts as one occurrence)
 *   - respects MIN_NGRAM / MAX_NGRAM bounds (no 1-grams)
 *   - aggregates success/failure counts correctly
 *   - returns deterministic ordering (n asc, occurrences desc, codeHash asc)
 *   - returns [] for empty input
 */

import { describe, it, expect } from 'vitest';
import { extractCandidates } from '../pattern-extractor.js';
import type { ProceduralTrace } from '../types.js';

function trace(
  id: string,
  toolNames: readonly string[],
  outcome: 'success' | 'failure' = 'success',
  observedAt = '2026-05-24T00:00:00.000Z',
  tenantId: string | null = 'tenant_a',
): ProceduralTrace {
  return {
    traceId: id,
    tenantId,
    toolSequence: toolNames.map((name) => ({ toolName: name })),
    outcome,
    observedAt,
  };
}

describe('extractCandidates — recurring 3-call pattern', () => {
  it('finds the same 3-tool sequence across 5 traces', () => {
    const pattern = ['ledger.fetch', 'mpesa.match', 'ledger.post'];
    const traces: ProceduralTrace[] = [
      trace('t1', pattern),
      trace('t2', pattern),
      trace('t3', ['noise.a', ...pattern, 'noise.b']),
      trace('t4', [...pattern, 'noise.c']),
      trace('t5', ['noise.d', ...pattern]),
    ];

    const candidates = extractCandidates(traces);

    // The 3-gram pattern should appear in every trace.
    const target = candidates.find(
      (c) =>
        c.toolSequence.length === 3 &&
        c.toolSequence.map((s) => s.toolName).join(',') === pattern.join(','),
    );
    expect(target).toBeDefined();
    expect(target?.occurrences).toBe(5);
    expect(target?.successCount).toBe(5);
    expect(target?.failureCount).toBe(0);
  });

  it('aggregates success and failure counts across traces', () => {
    const pattern = ['a', 'b'];
    const traces: ProceduralTrace[] = [
      trace('t1', pattern, 'success'),
      trace('t2', pattern, 'success'),
      trace('t3', pattern, 'failure'),
      trace('t4', pattern, 'failure'),
      trace('t5', pattern, 'success'),
    ];

    const candidates = extractCandidates(traces);
    const ab = candidates.find(
      (c) =>
        c.toolSequence.length === 2 &&
        c.toolSequence[0]?.toolName === 'a' &&
        c.toolSequence[1]?.toolName === 'b',
    );
    expect(ab).toBeDefined();
    expect(ab?.occurrences).toBe(5);
    expect(ab?.successCount).toBe(3);
    expect(ab?.failureCount).toBe(2);
  });

  it('counts a pattern that recurs inside a single trace as ONE occurrence', () => {
    const traces: ProceduralTrace[] = [
      trace('only-one', ['a', 'b', 'a', 'b', 'a', 'b']),
    ];

    const candidates = extractCandidates(traces);
    const ab = candidates.find(
      (c) =>
        c.toolSequence.length === 2 &&
        c.toolSequence[0]?.toolName === 'a' &&
        c.toolSequence[1]?.toolName === 'b',
    );
    expect(ab).toBeDefined();
    expect(ab?.occurrences).toBe(1); // ONE trace contributed, not three
  });

  it('never emits 1-grams (MIN_NGRAM = 2)', () => {
    const traces: ProceduralTrace[] = [trace('t1', ['a', 'b', 'c'])];
    const candidates = extractCandidates(traces);
    expect(candidates.every((c) => c.toolSequence.length >= 2)).toBe(true);
  });

  it('caps n-gram length at MAX_NGRAM (5) by default', () => {
    const long = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const traces: ProceduralTrace[] = [trace('t1', long), trace('t2', long)];
    const candidates = extractCandidates(traces);
    expect(candidates.every((c) => c.toolSequence.length <= 5)).toBe(true);
  });

  it('groups identical sequences from different traces into one CandidateSkill', () => {
    const traces: ProceduralTrace[] = [
      trace('t1', ['a', 'b']),
      trace('t2', ['a', 'b']),
      trace('t3', ['a', 'b']),
    ];
    const candidates = extractCandidates(traces);
    const ab = candidates.filter(
      (c) =>
        c.toolSequence.length === 2 &&
        c.toolSequence[0]?.toolName === 'a' &&
        c.toolSequence[1]?.toolName === 'b',
    );
    expect(ab).toHaveLength(1);
    expect(ab[0]?.occurrences).toBe(3);
  });

  it('partitions identical sequences across tenants into separate candidates', () => {
    const traces: ProceduralTrace[] = [
      trace('t1', ['a', 'b'], 'success', '2026-05-24T00:00:00.000Z', 'tenant_a'),
      trace('t2', ['a', 'b'], 'success', '2026-05-24T00:00:00.000Z', 'tenant_b'),
    ];
    const candidates = extractCandidates(traces);
    const ab = candidates.filter((c) => c.toolSequence.length === 2);
    expect(ab).toHaveLength(2); // one per tenant
    expect(new Set(ab.map((c) => c.tenantId))).toEqual(
      new Set(['tenant_a', 'tenant_b']),
    );
  });

  it('returns [] for empty input', () => {
    expect(extractCandidates([])).toEqual([]);
  });

  it('returns shorter n-grams first (deterministic sort)', () => {
    const traces: ProceduralTrace[] = [
      trace('t1', ['a', 'b', 'c']),
      trace('t2', ['a', 'b', 'c']),
    ];
    const candidates = extractCandidates(traces);
    expect(candidates.length).toBeGreaterThan(0);
    // First entry's n must be ≤ last entry's n.
    const ns = candidates.map((c) => c.toolSequence.length);
    const sorted = [...ns].sort((a, b) => a - b);
    expect(ns).toEqual(sorted);
  });

  it('records firstSeenAt and lastSeenAt across observations', () => {
    const traces: ProceduralTrace[] = [
      trace('t1', ['a', 'b'], 'success', '2026-05-20T00:00:00.000Z'),
      trace('t2', ['a', 'b'], 'success', '2026-05-22T00:00:00.000Z'),
      trace('t3', ['a', 'b'], 'success', '2026-05-24T00:00:00.000Z'),
    ];
    const candidates = extractCandidates(traces);
    const ab = candidates.find((c) => c.toolSequence.length === 2);
    expect(ab?.firstSeenAt).toBe('2026-05-20T00:00:00.000Z');
    expect(ab?.lastSeenAt).toBe('2026-05-24T00:00:00.000Z');
  });
});
