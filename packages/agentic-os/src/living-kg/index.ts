/**
 * living-kg — real-time KG updates from agent activity. Every agent
 * action is translated into KG triples and written through the KG port;
 * pre-call, the KG is queried for context relevant to the goal.
 *
 * Pattern: Microsoft GraphRAG (community-summarised KG retrieval) +
 * HippoRAG (hippocampus-style memory consolidation). The KG is the
 * single shared substrate every agent reads and writes through.
 */

import type {
  EnrichedContext,
  Goal,
  KGPort,
  KGTripleDelta,
  LivingKGUpdate,
} from '../types.js';
import { nowIso } from '../types.js';

// ============================================================================
// recordAgentAction — translate action into KG triples and write them
// ============================================================================

/** A coarse-grained action description from any subsystem. */
export interface AgentAction {
  readonly id: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly actionType: string;
  readonly subjectId: string;
  /** Object id when this action targets a single entity (e.g. lease.renew → leaseId). */
  readonly objectId?: string;
  /** Predicate naming. Defaults to actionType. */
  readonly predicate?: string;
  /** Extra deltas to write alongside the primary triple. */
  readonly extraDeltas?: ReadonlyArray<KGTripleDelta>;
}

export interface RecordAgentActionArgs {
  readonly action: AgentAction;
  readonly kg: KGPort;
}

export async function recordAgentAction(
  args: RecordAgentActionArgs,
): Promise<LivingKGUpdate> {
  const deltas: KGTripleDelta[] = [];
  const predicate = args.action.predicate ?? args.action.actionType;
  if (args.action.objectId) {
    deltas.push({
      subjectId: args.action.subjectId,
      predicate,
      objectId: args.action.objectId,
      op: 'add',
    });
  }
  if (args.action.extraDeltas) {
    for (const d of args.action.extraDeltas) deltas.push(d);
  }
  if (deltas.length === 0) {
    // Fallback minimal trace triple
    deltas.push({
      subjectId: args.action.subjectId,
      predicate: 'wasActedOnBy',
      objectId: args.action.agentId,
      op: 'add',
    });
  }
  await args.kg.applyDeltas({
    tenantId: args.action.tenantId,
    deltas,
  });
  return Object.freeze<LivingKGUpdate>({
    id: `kg-${args.action.id}`,
    tenantId: args.action.tenantId,
    triggeredByAgentId: args.action.agentId,
    triggeredByActionId: args.action.id,
    deltas: Object.freeze(deltas),
    propagatedDeltas: [],
    recordedAt: nowIso(),
  });
}

// ============================================================================
// enrichContextFromKG — pre-call subgraph fetch
// ============================================================================

export interface EnrichArgs {
  readonly goal: Goal;
  readonly kg: KGPort;
  /** Subject ids to seed the subgraph query. Default: goal.scope keys. */
  readonly seedSubjectIds?: ReadonlyArray<string>;
  readonly maxDepth?: number;
}

export async function enrichContextFromKG(
  args: EnrichArgs,
): Promise<EnrichedContext> {
  const seeds =
    args.seedSubjectIds ?? extractSubjectIdsFromGoal(args.goal);
  if (seeds.length === 0) {
    return Object.freeze<EnrichedContext>({
      goalId: args.goal.id,
      fragments: [],
      approxTokens: 0,
      assembledAt: nowIso(),
    });
  }
  const triples = await args.kg.fetchSubgraph({
    tenantId: args.goal.tenantId,
    subjectIds: seeds,
    maxDepth: args.maxDepth ?? 2,
  });
  const fragments = triples.map((t) => ({
    subjectId: t.subjectId,
    predicate: t.predicate,
    objectId: t.objectId,
    score: scoreTripleRelevance(t, args.goal),
  }));
  // Sort by relevance score desc
  fragments.sort((a, b) => b.score - a.score);
  const approxTokens = fragments.reduce(
    (acc, f) =>
      acc +
      Math.ceil((f.subjectId.length + f.predicate.length + f.objectId.length) / 4),
    0,
  );
  return Object.freeze<EnrichedContext>({
    goalId: args.goal.id,
    fragments: Object.freeze(fragments),
    approxTokens,
    assembledAt: nowIso(),
  });
}

// ============================================================================
// propagateConsequences — derive downstream facts from a primary action
// ============================================================================

/**
 * Mini consequence rule: a list of "if predicate=X then add Y=Z" hints.
 * Real implementations should wire to graph-sync or a Datalog engine;
 * this stub demonstrates the contract.
 */
export interface ConsequenceRule {
  readonly whenPredicate: string;
  readonly addPredicate: string;
  readonly objectIdSuffix?: string;
}

export interface PropagateArgs {
  readonly update: LivingKGUpdate;
  readonly rules: ReadonlyArray<ConsequenceRule>;
  readonly kg: KGPort;
}

export async function propagateConsequences(
  args: PropagateArgs,
): Promise<LivingKGUpdate> {
  const propagated: KGTripleDelta[] = [];
  for (const d of args.update.deltas) {
    for (const r of args.rules) {
      if (d.predicate !== r.whenPredicate) continue;
      propagated.push({
        subjectId: d.subjectId,
        predicate: r.addPredicate,
        objectId: r.objectIdSuffix
          ? `${d.objectId}${r.objectIdSuffix}`
          : d.objectId,
        op: 'add',
      });
    }
  }
  if (propagated.length > 0) {
    await args.kg.applyDeltas({
      tenantId: args.update.tenantId,
      deltas: propagated,
    });
  }
  return Object.freeze<LivingKGUpdate>({
    ...args.update,
    propagatedDeltas: Object.freeze(propagated),
    recordedAt: nowIso(),
  });
}

// ============================================================================
// internal helpers
// ============================================================================

function extractSubjectIdsFromGoal(goal: Goal): ReadonlyArray<string> {
  const ids = new Set<string>();
  const visit = (v: unknown): void => {
    if (typeof v === 'string' && v.length > 0 && v.length < 200) {
      ids.add(v);
    } else if (Array.isArray(v)) {
      for (const item of v) visit(item);
    } else if (v && typeof v === 'object') {
      for (const item of Object.values(v as Record<string, unknown>)) {
        visit(item);
      }
    }
  };
  visit(goal.scope);
  visit(goal.intent.entities);
  return Array.from(ids);
}

function scoreTripleRelevance(
  t: {
    readonly subjectId: string;
    readonly predicate: string;
    readonly objectId: string;
  },
  goal: Goal,
): number {
  const lowerPred = t.predicate.toLowerCase();
  const lowerIntent = goal.intent.primary.toLowerCase();
  let score = 0.1;
  if (lowerIntent.includes(lowerPred) || lowerPred.includes(lowerIntent.split('.')[0] ?? '')) {
    score += 0.5;
  }
  // Boost if subjectId appears in goal scope
  const scopeStr = JSON.stringify(goal.scope);
  if (scopeStr.includes(t.subjectId)) score += 0.4;
  return Math.min(1, score);
}
