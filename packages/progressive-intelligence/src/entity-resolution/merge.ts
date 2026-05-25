/**
 * Entity merging — given a chosen winner + losers, produce a single
 * `MergeProposal` that the caller can apply atomically. Strategies:
 *
 *   - `prefer_winner` — keep all winner attributes; only adopt loser
 *     attributes that the winner does not have.
 *   - `union` — start from the winner, union in every loser attribute,
 *     keeping the first non-null value encountered (winner first).
 *   - `most_recent` — for each attribute, pick the value from whichever
 *     entity has the latest `updatedAt`.
 *
 * Idempotent: same input → same `proposalKey` → same `merged`.
 */
import { createHash } from 'crypto';
import type { Entity, MergeProposal, MergeStrategy } from '../types.js';

export interface MergeEntitiesArgs {
  readonly winner: Entity;
  readonly losers: ReadonlyArray<Entity>;
  readonly strategy: MergeStrategy;
}

function stableProposalKey(
  winnerId: string,
  loserIds: ReadonlyArray<string>,
  strategy: MergeStrategy,
): string {
  const sorted = [...loserIds].sort();
  const payload = `${winnerId}|${sorted.join(',')}|${strategy}`;
  return createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

function preferWinner(
  winner: Entity,
  losers: ReadonlyArray<Entity>,
): { attrs: Record<string, unknown>; origins: Record<string, string> } {
  const attrs: Record<string, unknown> = { ...winner.attributes };
  const origins: Record<string, string> = {};
  for (const k of Object.keys(attrs)) origins[k] = winner.id;
  for (const loser of losers) {
    for (const [k, v] of Object.entries(loser.attributes)) {
      if (!(k in attrs) || attrs[k] == null) {
        attrs[k] = v;
        origins[k] = loser.id;
      }
    }
  }
  return { attrs, origins };
}

function union(
  winner: Entity,
  losers: ReadonlyArray<Entity>,
): { attrs: Record<string, unknown>; origins: Record<string, string> } {
  const attrs: Record<string, unknown> = {};
  const origins: Record<string, string> = {};
  const all = [winner, ...losers];
  for (const e of all) {
    for (const [k, v] of Object.entries(e.attributes)) {
      if (!(k in attrs) || attrs[k] == null) {
        attrs[k] = v;
        origins[k] = e.id;
      }
    }
  }
  return { attrs, origins };
}

function mostRecent(
  winner: Entity,
  losers: ReadonlyArray<Entity>,
): { attrs: Record<string, unknown>; origins: Record<string, string> } {
  const attrs: Record<string, unknown> = {};
  const origins: Record<string, string> = {};
  const all = [winner, ...losers];
  const collected: Record<string, { value: unknown; ts: string; sourceId: string }> = {};
  for (const e of all) {
    for (const [k, v] of Object.entries(e.attributes)) {
      const prior = collected[k];
      if (!prior || e.updatedAt > prior.ts) {
        collected[k] = { value: v, ts: e.updatedAt, sourceId: e.id };
      }
    }
  }
  for (const [k, { value, sourceId }] of Object.entries(collected)) {
    attrs[k] = value;
    origins[k] = sourceId;
  }
  return { attrs, origins };
}

export function mergeEntities(args: MergeEntitiesArgs): MergeProposal {
  const { winner, strategy } = args;
  // Sort losers by id so the merge result is identical regardless of
  // caller-supplied order — keeps the proposal idempotent for
  // `prefer_winner` + `union` (which are otherwise order-sensitive on
  // collisions between losers).
  const sortedLosers = [...args.losers].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const loserIds = sortedLosers.map((l) => l.id);
  const proposalKey = stableProposalKey(winner.id, loserIds, strategy);

  let merge: ReturnType<typeof preferWinner>;
  switch (strategy) {
    case 'prefer_winner':
      merge = preferWinner(winner, sortedLosers);
      break;
    case 'union':
      merge = union(winner, sortedLosers);
      break;
    case 'most_recent':
      merge = mostRecent(winner, sortedLosers);
      break;
    default:
      throw new Error(`Unknown merge strategy: ${String(strategy)}`);
  }

  // Pick the most recent updatedAt across winner + losers.
  const latestUpdatedAt = [winner, ...sortedLosers].reduce(
    (acc, e) => (e.updatedAt > acc ? e.updatedAt : acc),
    winner.updatedAt,
  );

  const merged: Entity = {
    id: winner.id,
    kind: winner.kind,
    tenantId: winner.tenantId,
    attributes: merge.attrs,
    updatedAt: latestUpdatedAt,
    schemaVersion: Math.max(
      winner.schemaVersion,
      ...sortedLosers.map((l) => l.schemaVersion),
    ),
    ...(winner.source !== undefined ? { source: winner.source } : {}),
  };

  return {
    winnerId: winner.id,
    loserIds,
    merged,
    strategy,
    fieldOrigins: merge.origins,
    proposalKey,
  };
}
