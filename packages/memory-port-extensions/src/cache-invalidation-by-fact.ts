/**
 * Cache-invalidation-by-fact — when a structured fact changes, invalidate
 * every cached answer whose derivation cited that fact.
 *
 * LITFIN ref: src/core/memory/{semantic-store,reflective-store}.ts —
 * keeps a reverse index from fact-id to answer-cache-key. When a fact
 * mutates, all dependent cache keys are dropped atomically.
 */

import type { AnswerCacheKey, FactId } from './types.js';

export interface FactDependencyGraph {
  /** factId -> set of cache keys that depend on the fact. */
  readonly factToAnswers: ReadonlyMap<FactId, ReadonlySet<AnswerCacheKey>>;
  /** cache key -> set of fact ids it consumed. Useful for trimming. */
  readonly answerToFacts: ReadonlyMap<AnswerCacheKey, ReadonlySet<FactId>>;
}

export const emptyDependencyGraph = (): FactDependencyGraph => ({
  factToAnswers: new Map(),
  answerToFacts: new Map(),
});

const cloneSetWith = <T>(set: ReadonlySet<T> | undefined, add: T): Set<T> => {
  const next = new Set<T>(set ?? []);
  next.add(add);
  return next;
};

const cloneSetWithout = <T>(set: ReadonlySet<T> | undefined, remove: T): Set<T> => {
  const next = new Set<T>(set ?? []);
  next.delete(remove);
  return next;
};

export const recordDependency = (
  graph: FactDependencyGraph,
  cacheKey: AnswerCacheKey,
  facts: readonly FactId[],
): FactDependencyGraph => {
  const factToAnswers = new Map(graph.factToAnswers);
  const answerToFacts = new Map(graph.answerToFacts);
  for (const fact of facts) {
    factToAnswers.set(fact, cloneSetWith(factToAnswers.get(fact), cacheKey));
  }
  answerToFacts.set(cacheKey, new Set(facts));
  return { factToAnswers, answerToFacts };
};

/**
 * Returns the set of cache keys to invalidate plus a new graph with
 * all references to those answers removed.
 */
export const onFactChange = (
  graph: FactDependencyGraph,
  changedFacts: readonly FactId[],
): {
  readonly invalidated: ReadonlySet<AnswerCacheKey>;
  readonly graph: FactDependencyGraph;
} => {
  const invalidated = new Set<AnswerCacheKey>();
  for (const f of changedFacts) {
    const dependents = graph.factToAnswers.get(f);
    if (!dependents) continue;
    for (const k of dependents) invalidated.add(k);
  }
  if (invalidated.size === 0) {
    return { invalidated, graph };
  }
  const factToAnswers = new Map(graph.factToAnswers);
  const answerToFacts = new Map(graph.answerToFacts);
  for (const k of invalidated) {
    const facts = answerToFacts.get(k);
    if (!facts) continue;
    for (const f of facts) {
      const next = cloneSetWithout(factToAnswers.get(f), k);
      if (next.size === 0) {
        factToAnswers.delete(f);
      } else {
        factToAnswers.set(f, next);
      }
    }
    answerToFacts.delete(k);
  }
  return { invalidated, graph: { factToAnswers, answerToFacts } };
};

/**
 * Stats helper — easy to wire to dashboards.
 */
export const graphStats = (
  graph: FactDependencyGraph,
): {
  readonly factCount: number;
  readonly answerCount: number;
  readonly avgFanout: number;
} => {
  let total = 0;
  for (const set of graph.factToAnswers.values()) total += set.size;
  return {
    factCount: graph.factToAnswers.size,
    answerCount: graph.answerToFacts.size,
    avgFanout: graph.factToAnswers.size === 0 ? 0 : total / graph.factToAnswers.size,
  };
};
