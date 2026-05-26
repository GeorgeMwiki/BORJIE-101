/**
 * Audit chain integration — produce `audit_hash` values for the four
 * `graph_rag.*` tables via `@borjie/audit-hash-chain`.
 *
 * Every row in the four tables carries an `audit_hash` derived from
 * the canonical JSON of its payload + the tenant id. The hashes are
 * not chained across rows (each row is independently verifiable);
 * the nightly `audit-chain-verify` sleep pass walks them.
 *
 * Pure functions, no I/O.
 */

import { hashChainEntry } from '@borjie/audit-hash-chain';
import type {
  Community,
  CommunitySummary,
  GraphEdge,
  GraphNode,
} from '../types.js';

interface HashEntityArgs {
  readonly tenantId: string;
  readonly entity: GraphNode;
}

export function hashEntityRow(args: HashEntityArgs): string {
  return hashChainEntry({
    payload: {
      table: 'knowledge_graph_entities',
      tenantId: args.tenantId,
      id: args.entity.id,
      name: args.entity.name,
      type: args.entity.type,
      description: args.entity.description,
    },
  });
}

interface HashRelationArgs {
  readonly tenantId: string;
  readonly edge: GraphEdge;
}

export function hashRelationRow(args: HashRelationArgs): string {
  return hashChainEntry({
    payload: {
      table: 'knowledge_graph_relations',
      tenantId: args.tenantId,
      id: args.edge.id,
      fromId: args.edge.fromId,
      toId: args.edge.toId,
      kind: args.edge.kind,
      weight: args.edge.weight,
    },
  });
}

interface HashCommunityArgs {
  readonly tenantId: string;
  readonly community: Community;
}

export function hashCommunityRow(args: HashCommunityArgs): string {
  return hashChainEntry({
    payload: {
      table: 'kg_communities',
      tenantId: args.tenantId,
      id: args.community.id,
      level: args.community.level,
      memberEntityIds: [...args.community.memberEntityIds],
      signatureHash: args.community.signatureHash,
    },
  });
}

interface HashSummaryArgs {
  readonly tenantId: string;
  readonly summary: CommunitySummary;
}

export function hashSummaryRow(args: HashSummaryArgs): string {
  return hashChainEntry({
    payload: {
      table: 'kg_community_summaries',
      tenantId: args.tenantId,
      id: args.summary.id,
      communityId: args.summary.communityId,
      modelId: args.summary.modelId,
      signatureHash: args.summary.signatureHash,
      tokenCount: args.summary.tokenCount,
      summaryMd: args.summary.summaryMd,
    },
  });
}
