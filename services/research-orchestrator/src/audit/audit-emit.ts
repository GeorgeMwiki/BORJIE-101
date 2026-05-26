/**
 * Audit emitter — wires every ResearchResult into the tenant's
 * audit-hash-chain (DEEP_RESEARCH_SPEC §4.5).
 *
 * On every Synthesizer emit:
 *
 *   1. Canonical-JSON-hash the result's `{ result_id, plan_id,
 *      summary_md_sha, citation_ids, model_id, cost, elapsed_ms }`
 *      payload.
 *   2. Append to the tenant's chain via `appendEntry()` from
 *      `@borjie/audit-hash-chain`.
 *   3. Return the new chain (caller persists).
 *
 * Spec anti-pattern §12.5 — the Synthesizer MUST refuse to emit a
 * ResearchResult until `audit_hash` is computed AND the chain row
 * appended. We expose two functions:
 *   - `buildAuditPayload` — pure, builds the canonical row.
 *   - `emitToChain` — applies `appendEntry` against a caller-supplied
 *     previous-chain snapshot.
 *
 * The chain persistence (Postgres row write) is owned by storage layer
 * — this module is pure-functional.
 *
 * @module research-orchestrator/audit/audit-emit
 */

import { appendEntry } from '@borjie/audit-hash-chain';
import type {
  AuditPayload,
  ChainEntry,
} from '@borjie/audit-hash-chain';
import type { ResearchResult } from '../types.js';

export interface BuildAuditPayloadInput {
  readonly result: ResearchResult;
  readonly tenantId: string;
  readonly model_id?: string;
}

/**
 * Build the canonical `AuditPayload` for a ResearchResult. The payload
 * is what `chainHash()` operates on; identical inputs always produce
 * identical hashes, so regulators or owners can later re-verify.
 */
export function buildAuditPayload(input: BuildAuditPayloadInput): AuditPayload {
  const base: Record<string, unknown> = {
    kind: 'research_result_v1',
    tenant_id: input.tenantId,
    result_id: input.result.id,
    plan_id: input.result.plan_id,
    summary_hash: input.result.audit_hash,
    citation_ids: input.result.span_citations.map((c) => c.citation_id),
    confidence: input.result.confidence,
    disagreement_count: input.result.disagreements.length,
    cost_usd_cents: input.result.total_cost_usd_cents,
    elapsed_ms: input.result.total_duration_ms,
    generated_at: input.result.generated_at,
  };
  if (input.model_id) base['model_id'] = input.model_id;
  return Object.freeze(base);
}

export interface EmitToChainInput {
  readonly chain: ReadonlyArray<ChainEntry>;
  readonly result: ResearchResult;
  readonly tenantId: string;
  readonly model_id?: string;
  readonly secret_id?: string;
  readonly secret_value?: string;
}

export interface EmitToChainResult {
  readonly chain: ReadonlyArray<ChainEntry>;
  readonly appendedEntry: ChainEntry;
}

/**
 * Append a research result to an existing chain. Returns the NEW chain
 * (immutable per project rule) plus the newly-appended entry for
 * convenience.
 */
export function emitToChain(input: EmitToChainInput): EmitToChainResult {
  const payload = buildAuditPayload({
    result: input.result,
    tenantId: input.tenantId,
    ...(input.model_id ? { model_id: input.model_id } : {}),
  });

  const newChain = appendEntry(input.chain, payload, {
    ...(input.secret_id ? { secretId: input.secret_id } : {}),
    ...(input.secret_value ? { secretValue: input.secret_value } : {}),
  });

  const appended = newChain[newChain.length - 1];
  if (!appended) {
    throw new Error('audit-emit: appendEntry returned empty chain');
  }
  return { chain: newChain, appendedEntry: appended };
}

/**
 * Persistence port — the storage layer implements this to write the
 * audit row to Postgres. Kept here as a port so the audit emitter is
 * decoupled from the DB.
 */
export interface AuditChainPersistencePort {
  /**
   * Append a new entry to the tenant's persisted chain. Returns the
   * inserted row's id.
   */
  appendChainEntry(args: {
    readonly tenantId: string;
    readonly entry: ChainEntry;
  }): Promise<string>;
}
