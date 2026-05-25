import { describe, expect, it } from 'vitest';
import {
  emptyDependencyGraph,
  graphStats,
  onFactChange,
  recordDependency,
} from '../cache-invalidation-by-fact.js';
import type { AnswerCacheKey, FactId } from '../types.js';

const f = (s: string) => s as FactId;
const a = (s: string) => s as AnswerCacheKey;

describe('cache-invalidation-by-fact', () => {
  it('emptyDependencyGraph is empty', () => {
    const g = emptyDependencyGraph();
    expect(g.factToAnswers.size).toBe(0);
    expect(g.answerToFacts.size).toBe(0);
  });

  it('recordDependency adds a single answer', () => {
    const g = recordDependency(emptyDependencyGraph(), a('q1'), [f('rent')]);
    expect(g.answerToFacts.get(a('q1'))?.size).toBe(1);
    expect(g.factToAnswers.get(f('rent'))?.has(a('q1'))).toBe(true);
  });

  it('recordDependency is immutable on inputs', () => {
    const g0 = emptyDependencyGraph();
    recordDependency(g0, a('q1'), [f('rent')]);
    expect(g0.answerToFacts.size).toBe(0);
  });

  it('onFactChange invalidates dependent answers', () => {
    let g = emptyDependencyGraph();
    g = recordDependency(g, a('q1'), [f('rent')]);
    g = recordDependency(g, a('q2'), [f('rent'), f('lease')]);
    const out = onFactChange(g, [f('rent')]);
    expect(out.invalidated.has(a('q1'))).toBe(true);
    expect(out.invalidated.has(a('q2'))).toBe(true);
  });

  it('onFactChange leaves unrelated answers alone', () => {
    let g = emptyDependencyGraph();
    g = recordDependency(g, a('q1'), [f('rent')]);
    g = recordDependency(g, a('q3'), [f('owner')]);
    const out = onFactChange(g, [f('rent')]);
    expect(out.invalidated.has(a('q3'))).toBe(false);
    expect(out.graph.answerToFacts.has(a('q3'))).toBe(true);
  });

  it('onFactChange removes invalidated answers from the graph', () => {
    let g = emptyDependencyGraph();
    g = recordDependency(g, a('q1'), [f('rent'), f('lease')]);
    const out = onFactChange(g, [f('rent')]);
    expect(out.graph.answerToFacts.has(a('q1'))).toBe(false);
    expect(out.graph.factToAnswers.has(f('lease'))).toBe(false);
  });

  it('onFactChange is a no-op when no dependencies', () => {
    const g = emptyDependencyGraph();
    const out = onFactChange(g, [f('xx')]);
    expect(out.invalidated.size).toBe(0);
    expect(out.graph).toBe(g);
  });

  it('recordDependency overwrites the prior dep set for the answer', () => {
    let g = emptyDependencyGraph();
    g = recordDependency(g, a('q1'), [f('rent')]);
    g = recordDependency(g, a('q1'), [f('lease')]);
    expect(g.answerToFacts.get(a('q1'))?.has(f('rent'))).toBe(false);
    expect(g.answerToFacts.get(a('q1'))?.has(f('lease'))).toBe(true);
  });

  it('graphStats reports fanout', () => {
    let g = emptyDependencyGraph();
    g = recordDependency(g, a('q1'), [f('rent')]);
    g = recordDependency(g, a('q2'), [f('rent')]);
    const s = graphStats(g);
    expect(s.factCount).toBe(1);
    expect(s.answerCount).toBe(2);
    expect(s.avgFanout).toBe(2);
  });

  it('cascading invalidation of multiple facts', () => {
    let g = emptyDependencyGraph();
    g = recordDependency(g, a('q1'), [f('rent')]);
    g = recordDependency(g, a('q2'), [f('lease')]);
    const out = onFactChange(g, [f('rent'), f('lease')]);
    expect(out.invalidated.size).toBe(2);
    expect(out.graph.factToAnswers.size).toBe(0);
  });
});
