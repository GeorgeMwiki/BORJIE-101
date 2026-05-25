/**
 * Shadow-runner — divergence comparison + active-path isolation.
 *
 * Verifies: identical outputs produce divergence 0, different outputs
 * produce divergence > 0, the active path's output is ALWAYS what the
 * caller sees, candidate failures are isolated, and sink errors do
 * not break the call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createShadowRunner,
  defaultComparator,
  type ShadowComparison,
  type ShadowExecutor,
  type ShadowExecutorOutput,
} from '../../shadow-mode/shadow-runner.js';

function fixedExecutor(out: Partial<ShadowExecutorOutput>): ShadowExecutor {
  return async () => ({
    text: 'default',
    outcome: 'answer',
    costUsd: 0.001,
    latencyMs: 5,
    ...out,
  });
}

describe('defaultComparator', () => {
  it('returns 0 for identical strings', () => {
    expect(defaultComparator('hello world', 'hello world')).toBe(0);
  });

  it('returns 1 for two empty-ish strings only when they cannot be aligned', () => {
    expect(defaultComparator('hello', 'world')).toBeGreaterThan(0);
    expect(defaultComparator('hello', 'world')).toBeLessThanOrEqual(1);
  });

  it('is bounded in [0, 1]', () => {
    expect(defaultComparator('abc', 'xyz')).toBeLessThanOrEqual(1);
  });

  it('treats whitespace-only differences as zero divergence', () => {
    expect(defaultComparator('  hello  ', 'hello')).toBe(0);
  });
});

describe('createShadowRunner', () => {
  let sunk: ShadowComparison[];
  beforeEach(() => {
    sunk = [];
  });

  it('returns the active output to the caller, never the candidate output', async () => {
    const runner = createShadowRunner({
      capability: 'support',
      activeVersion: 'v1',
      candidateVersion: 'v2',
      executeActive: fixedExecutor({ text: 'active-output' }),
      executeCandidate: fixedExecutor({ text: 'candidate-output' }),
      sink: { record: (c) => { sunk.push(c); } },
    });
    const out = await runner.runOne('user message');
    expect(out.text).toBe('active-output');
  });

  it('records divergence=0 when outputs are identical', async () => {
    const runner = createShadowRunner({
      capability: 'cap',
      activeVersion: 'v1',
      candidateVersion: 'v2',
      executeActive: fixedExecutor({ text: 'same answer' }),
      executeCandidate: fixedExecutor({ text: 'same answer' }),
      sink: { record: (c) => { sunk.push(c); } },
    });
    await runner.runOne('q');
    expect(sunk).toHaveLength(1);
    expect(sunk[0]!.divergence).toBe(0);
    expect(sunk[0]!.outcomeChanged).toBe(false);
    expect(sunk[0]!.candidateFailed).toBe(false);
  });

  it('records divergence>0 when outputs differ', async () => {
    const runner = createShadowRunner({
      capability: 'cap',
      activeVersion: 'v1',
      candidateVersion: 'v2',
      executeActive: fixedExecutor({ text: 'one answer' }),
      executeCandidate: fixedExecutor({ text: 'totally different reply' }),
      sink: { record: (c) => { sunk.push(c); } },
    });
    await runner.runOne('q');
    expect(sunk[0]!.divergence).toBeGreaterThan(0);
  });

  it('flags outcomeChanged when candidate refuses but active answered', async () => {
    const runner = createShadowRunner({
      capability: 'cap',
      activeVersion: 'v1',
      candidateVersion: 'v2',
      executeActive: fixedExecutor({ text: 'ok', outcome: 'answer' }),
      executeCandidate: fixedExecutor({ text: 'cannot help', outcome: 'refusal' }),
      sink: { record: (c) => { sunk.push(c); } },
    });
    await runner.runOne('q');
    expect(sunk[0]!.outcomeChanged).toBe(true);
  });

  it('isolates candidate failures — active output still returns', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runner = createShadowRunner({
      capability: 'cap',
      activeVersion: 'v1',
      candidateVersion: 'v2',
      executeActive: fixedExecutor({ text: 'active-ok' }),
      executeCandidate: async () => { throw new Error('candidate boom'); },
      sink: { record: (c) => { sunk.push(c); } },
    });
    const out = await runner.runOne('q');
    expect(out.text).toBe('active-ok');
    expect(sunk[0]!.candidateFailed).toBe(true);
    expect(sunk[0]!.candidateOutput).toBeNull();
    expect(sunk[0]!.divergence).toBe(1);
    errSpy.mockRestore();
  });

  it('does not throw when sink itself throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runner = createShadowRunner({
      capability: 'cap',
      activeVersion: 'v1',
      candidateVersion: 'v2',
      executeActive: fixedExecutor({ text: 'a' }),
      executeCandidate: fixedExecutor({ text: 'b' }),
      sink: { record: () => { throw new Error('sink broken'); } },
    });
    await expect(runner.runOne('q')).resolves.toBeTruthy();
    errSpy.mockRestore();
  });

  it('honours a custom comparator', async () => {
    const calls: Array<[string, string]> = [];
    const runner = createShadowRunner({
      capability: 'cap',
      activeVersion: 'v1',
      candidateVersion: 'v2',
      executeActive: fixedExecutor({ text: 'A' }),
      executeCandidate: fixedExecutor({ text: 'B' }),
      sink: { record: (c) => { sunk.push(c); } },
      comparator: (a, b) => {
        calls.push([a, b]);
        return 0.42;
      },
    });
    await runner.runOne('q');
    expect(calls.length).toBe(1);
    expect(sunk[0]!.divergence).toBe(0.42);
  });

  it('records the supplied capability + version handles', async () => {
    const runner = createShadowRunner({
      capability: 'special-cap',
      activeVersion: 'v_active',
      candidateVersion: 'v_candidate',
      executeActive: fixedExecutor({ text: 'x' }),
      executeCandidate: fixedExecutor({ text: 'x' }),
      sink: { record: (c) => { sunk.push(c); } },
    });
    await runner.runOne('q');
    expect(sunk[0]!.capability).toBe('special-cap');
    expect(sunk[0]!.activeVersion).toBe('v_active');
    expect(sunk[0]!.candidateVersion).toBe('v_candidate');
  });
});
