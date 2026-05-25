import { describe, it, expect } from 'vitest';
import { validatePlanDag } from '../dag.js';
import type { Plan, Step } from '../types.js';

function step(id: string): Step {
  return {
    id,
    description: `step ${id}`,
    toolName: 't',
    input: null,
    estimatedCost: null,
    citations: [],
  };
}

function plan(steps: Step[], deps: ReadonlyArray<readonly [string, string]>): Plan {
  return {
    id: 'p',
    goal: 'g',
    steps,
    deps,
    planCitations: [],
    createdAt: '2026-05-23T00:00:00.000Z',
    generation: 1,
  };
}

describe('validatePlanDag', () => {
  it('batches a linear chain step-by-step', () => {
    const p = plan(
      [step('a'), step('b'), step('c')],
      [['a', 'b'], ['b', 'c']],
    );
    const r = validatePlanDag(p);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.batches.map((b) => b.map((s) => s.id))).toEqual([['a'], ['b'], ['c']]);
  });

  it('parallelises independent steps into one batch', () => {
    const p = plan([step('a'), step('b'), step('c')], []);
    const r = validatePlanDag(p);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.batches).toHaveLength(1);
    expect(r.batches[0]!.map((s) => s.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('handles fan-out / fan-in correctly (diamond)', () => {
    const p = plan(
      [step('top'), step('left'), step('right'), step('bot')],
      [
        ['top', 'left'],
        ['top', 'right'],
        ['left', 'bot'],
        ['right', 'bot'],
      ],
    );
    const r = validatePlanDag(p);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.batches).toHaveLength(3);
    expect(r.batches[0]!.map((s) => s.id)).toEqual(['top']);
    expect(r.batches[1]!.map((s) => s.id).sort()).toEqual(['left', 'right']);
    expect(r.batches[2]!.map((s) => s.id)).toEqual(['bot']);
  });

  it('rejects duplicate step ids', () => {
    const p = plan([step('a'), step('a')], []);
    const r = validatePlanDag(p);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('duplicate-step-id');
  });

  it('rejects edges referencing unknown steps', () => {
    const p = plan([step('a')], [['a', 'b']]);
    const r = validatePlanDag(p);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('unknown-step');
  });

  it('rejects cycles', () => {
    const p = plan(
      [step('a'), step('b'), step('c')],
      [['a', 'b'], ['b', 'c'], ['c', 'a']],
    );
    const r = validatePlanDag(p);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('cycle');
  });

  it('returns an empty batch list for an empty plan', () => {
    const p = plan([], []);
    const r = validatePlanDag(p);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.batches).toEqual([]);
  });
});
