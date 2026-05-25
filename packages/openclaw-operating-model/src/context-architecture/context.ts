/**
 * Context architecture — Pillar 1 of the OpenClaw operating model.
 *
 * Defines context sources, assembles per-agent contexts with tenant-
 * scope filters and PII redaction, and prunes to fit token budgets.
 *
 * Pulled fragments are categorised into four layers:
 *   - persistent : org-mission, brand-voice, constitution clauses
 *   - structured : relevant DB rows
 *   - retrieved  : RAG/knowledge-graph snippets
 *   - ephemeral  : current conversation
 *
 * Higher-priority layers are kept first when pruning.
 */

import type {
  AgentContext,
  ContextFragment,
  ContextSource,
  ContextSourceKind,
  ContextScope,
  PiiClearanceLevel,
  RefreshPolicy,
} from '../types.js';
import { hasClearance } from './pii-redaction.js';

/** A registered context source the runtime may pull from. */
export interface DefineContextSourceArgs {
  readonly id: string;
  readonly name: string;
  readonly kind: ContextSourceKind;
  readonly tenantScope: ContextScope;
  readonly refreshPolicy: RefreshPolicy;
  readonly piiClearanceRequired: PiiClearanceLevel;
}

export function defineContextSource(
  args: DefineContextSourceArgs,
): ContextSource {
  return {
    id: args.id,
    name: args.name,
    kind: args.kind,
    tenantScope: args.tenantScope,
    refreshPolicy: args.refreshPolicy,
    piiClearanceRequired: args.piiClearanceRequired,
  };
}

/**
 * Fragment + provenance metadata for the layered shape (which bucket
 * to drop it into when assembling).
 */
export interface ContextFragmentWithLayer extends ContextFragment {
  readonly layer: 'persistent' | 'structured' | 'retrieved' | 'ephemeral';
  readonly tenantId?: string;
  readonly userId?: string;
}

/**
 * Port: the runtime composer supplies these fragments by querying live
 * sources. This package does not perform any I/O.
 */
export interface ContextFragmentFetcher {
  fetch(args: {
    readonly source: ContextSource;
    readonly tenantId: string;
    readonly userId?: string | undefined;
    readonly query: string;
  }): Promise<ReadonlyArray<ContextFragmentWithLayer>>;
}

/** Args for `assembleAgentContext`. */
export interface AssembleAgentContextArgs {
  readonly agentId: string;
  readonly taskId: string;
  readonly tenantId: string;
  readonly userId?: string | undefined;
  readonly agentPiiClearance: PiiClearanceLevel;
  readonly sources: ReadonlyArray<ContextSource>;
  readonly fetcher: ContextFragmentFetcher;
  readonly query: string;
  readonly budgetTokens: number;
  readonly now?: () => Date;
}

const LAYER_PRIORITY = ['persistent', 'ephemeral', 'structured', 'retrieved'] as const;

/**
 * Assemble agent context. Pure orchestration around the supplied
 * fetcher port. Applies tenant-scope filters, redacts fragments the
 * agent lacks clearance for, prunes to fit `budgetTokens` keeping
 * higher-priority layers first.
 */
export async function assembleAgentContext(
  args: AssembleAgentContextArgs,
): Promise<AgentContext> {
  const now = (args.now ?? (() => new Date()))();
  const all: ContextFragmentWithLayer[] = [];
  const redactedFragmentIds: string[] = [];

  for (const source of args.sources) {
    // Tenant-scope filter: 'global' visible to all; 'tenant' must match;
    // 'user' must match user (and tenant) — drop if user not given.
    if (source.tenantScope === 'user' && args.userId === undefined) continue;

    const fragments = await args.fetcher.fetch({
      source,
      tenantId: args.tenantId,
      userId: args.userId,
      query: args.query,
    });

    for (const fragment of fragments) {
      // Cross-tenant leakage guard: if a fragment is tagged with a
      // different tenantId than ours, drop it entirely (never even
      // attempt to redact — defence in depth).
      if (
        fragment.tenantId !== undefined &&
        fragment.tenantId !== args.tenantId
      ) {
        redactedFragmentIds.push(fragment.id);
        continue;
      }

      if (
        !hasClearance({
          agentClearance: args.agentPiiClearance,
          fragmentRequires: fragment.piiClearanceRequired,
        })
      ) {
        redactedFragmentIds.push(fragment.id);
        continue;
      }
      all.push(fragment);
    }
  }

  // Layer + prune
  const layered: Record<typeof LAYER_PRIORITY[number], ContextFragment[]> = {
    persistent: [],
    ephemeral: [],
    structured: [],
    retrieved: [],
  };
  for (const f of all) {
    layered[f.layer].push({
      id: f.id,
      sourceId: f.sourceId,
      kind: f.kind,
      content: f.content,
      approxTokens: f.approxTokens,
      piiClearanceRequired: f.piiClearanceRequired,
    });
  }

  // Pack respecting budget — higher-priority layers first.
  let used = 0;
  const packed: Record<typeof LAYER_PRIORITY[number], ContextFragment[]> = {
    persistent: [],
    ephemeral: [],
    structured: [],
    retrieved: [],
  };
  for (const layer of LAYER_PRIORITY) {
    for (const f of layered[layer]) {
      if (used + f.approxTokens > args.budgetTokens) {
        redactedFragmentIds.push(f.id);
        continue;
      }
      packed[layer].push(f);
      used += f.approxTokens;
    }
  }

  return {
    agentId: args.agentId,
    tenantId: args.tenantId,
    taskId: args.taskId,
    ...(args.userId !== undefined && { userId: args.userId }),
    persistent: packed.persistent,
    structured: packed.structured,
    retrieved: packed.retrieved,
    ephemeral: packed.ephemeral,
    approxTokens: used,
    budgetTokens: args.budgetTokens,
    redactedFragmentIds,
    assembledAt: now.toISOString(),
  };
}
