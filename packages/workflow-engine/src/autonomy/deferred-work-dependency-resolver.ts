/**
 * DeferredWorkDependencyResolver — traverse the `blocked_by` DAG when a gap's
 * blocker clears (Loop A, P0; `Docs/research/THE_METACOGNITIVE_SELF_MODEL.md`
 * §3.5).
 *
 * PURE CORE. Given a cleared gap id + the `blocked_by` edges of every open gap,
 * it returns the dependent gaps that are now READY — i.e. whose blockers are
 * ALL satisfied. For P0 this resolves a single `blocked_by` edge: a gap blocked
 * solely on the just-cleared gap becomes READY; a gap with additional
 * still-unsatisfied blockers stays blocked.
 *
 * It has NO IO and NO store handle — the composition root feeds it the cleared
 * id + the open-gap edge set (read from `md_commitments`), and acts on the
 * returned READY ids (advance blocked→scheduled, run the verifier-gated
 * re-attempt). Keeping it pure makes the dependency math unit-testable in
 * isolation and free of replay/idempotency hazards.
 *
 * SOVEREIGN SAFETY: this resolver only computes readiness. It NEVER actuates.
 * A READY sovereign gap is still parked HITL by the completion path — readiness
 * is a necessary, not sufficient, condition for completion.
 */

/** The minimal projection of an open gap the resolver needs (DAG node + edges). */
export interface DeferredGapNode {
  readonly id: string;
  /** Blocking gap ids — this gap is READY only when ALL of them are satisfied. */
  readonly blockedBy: ReadonlyArray<string>;
}

/** A dependent gap that is now READY because every blocker is satisfied. */
export interface ReadyGap {
  readonly gapId: string;
  /** The cleared blocker that made it ready (the edge that just resolved). */
  readonly clearedBy: string;
}

/** The result of resolving one cleared blocker against the open-gap DAG. */
export interface DependencyResolution {
  /** Dependent gaps whose blockers are now ALL satisfied. */
  readonly ready: ReadonlyArray<ReadyGap>;
  /** Dependent gaps still blocked on at least one other unsatisfied edge. */
  readonly stillBlocked: ReadonlyArray<string>;
}

/**
 * Resolve a single cleared blocker against the open-gap DAG.
 *
 * @param clearedGapId  the gap whose blocker just cleared (now satisfied).
 * @param openGaps      every still-open gap (its `blocked_by` edges).
 * @param satisfiedIds  the set of already-satisfied gap ids (cleared earlier
 *                      this sweep + `clearedGapId`). A dependent is READY only
 *                      when EVERY edge is in this set. Defaults to just the one
 *                      cleared id (single-edge P0 resolution).
 */
export function resolveDependents(
  clearedGapId: string,
  openGaps: ReadonlyArray<DeferredGapNode>,
  satisfiedIds?: ReadonlySet<string>,
): DependencyResolution {
  const satisfied = satisfiedIds ?? new Set<string>([clearedGapId]);
  // Defence in depth: the cleared id is always satisfied.
  const allSatisfied = satisfied.has(clearedGapId)
    ? satisfied
    : new Set<string>([...satisfied, clearedGapId]);

  const ready: ReadyGap[] = [];
  const stillBlocked: string[] = [];

  for (const node of openGaps) {
    // Only consider dependents that actually wait on the cleared blocker.
    if (!node.blockedBy.includes(clearedGapId)) continue;

    const everyBlockerSatisfied = node.blockedBy.every((b) =>
      allSatisfied.has(b),
    );
    if (everyBlockerSatisfied) {
      ready.push(Object.freeze({ gapId: node.id, clearedBy: clearedGapId }));
    } else {
      stillBlocked.push(node.id);
    }
  }

  return Object.freeze({
    ready: Object.freeze(ready),
    stillBlocked: Object.freeze(stillBlocked),
  });
}
