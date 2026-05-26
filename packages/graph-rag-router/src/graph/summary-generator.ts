/**
 * Summary generator — orchestrate `CommunitySummariserPort` over a
 * community, producing a `CommunitySummary` row ready for storage.
 *
 * Pure orchestration: the actual LLM call lives behind the port.
 * This module is responsible for:
 *
 *   1. Resolving the community's members to actual `GraphNode`s.
 *   2. Resolving the *internal* edges (both endpoints in the
 *      community).
 *   3. Short-circuiting when the community signature is unchanged
 *      against a previous summary (cheap drift detection).
 *   4. Producing a fresh `id` and ISO timestamp on every regen.
 */

import { createHash } from 'node:crypto';
import type {
  Community,
  CommunitySummariserPort,
  CommunitySummary,
  GraphEdge,
  GraphNode,
  Id,
  IsoTimestamp,
} from '../types.js';

export interface SummariseArgs {
  readonly community: Community;
  readonly allNodes: ReadonlyArray<GraphNode>;
  readonly allEdges: ReadonlyArray<GraphEdge>;
  readonly summariser: CommunitySummariserPort;
  readonly modelId: string;
  readonly previousSummary?: CommunitySummary | null;
  readonly now?: () => Date;
}

export interface SummariseResult {
  readonly summary: CommunitySummary | null;
  readonly skipped: boolean;
  readonly reason: string;
}

/** Stable id for a summary row — `(communityId, signature)`-derived. */
export function summaryId(communityId: Id, signatureHash: string): Id {
  return createHash('sha256')
    .update(`summary:${communityId}:${signatureHash}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Generate a community summary IF the signature has drifted since
 * the last summary, otherwise return `{ skipped: true }` so the
 * caller can skip the LLM call.
 */
export async function summariseCommunity(
  args: SummariseArgs,
): Promise<SummariseResult> {
  if (
    args.previousSummary !== undefined &&
    args.previousSummary !== null &&
    args.previousSummary.signatureHash === args.community.signatureHash
  ) {
    return {
      summary: null,
      skipped: true,
      reason: 'signature-unchanged',
    };
  }
  const memberSet = new Set(args.community.memberEntityIds);
  const nodes = args.allNodes.filter((n) => memberSet.has(n.id));
  if (nodes.length === 0) {
    return {
      summary: null,
      skipped: true,
      reason: 'no-member-nodes',
    };
  }
  const edges = args.allEdges.filter(
    (e) => memberSet.has(e.fromId) && memberSet.has(e.toId),
  );
  const llmOut = await args.summariser.summarise({
    community: args.community,
    nodes,
    edges,
  });
  const generatedAt: IsoTimestamp = (args.now ?? (() => new Date()))()
    .toISOString();
  const summary: CommunitySummary = {
    id: summaryId(args.community.id, args.community.signatureHash),
    communityId: args.community.id,
    summaryMd: llmOut.summaryMd,
    tokenCount: llmOut.tokenCount,
    modelId: args.modelId,
    signatureHash: args.community.signatureHash,
    generatedAt,
  };
  return { summary, skipped: false, reason: 'generated' };
}
