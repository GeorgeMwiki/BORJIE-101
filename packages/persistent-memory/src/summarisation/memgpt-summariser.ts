/**
 * MemGPT-style summariser (Wave 18GG).
 *
 * Identifies the oldest contiguous turn-block whose token-count
 * exceeds `SUMMARISE_BLOCK_TOKENS` and produces a `ThreadSummary`
 * record. The summarisation prompt itself is host-owned (the
 * cognitive engine drives it); this module's job is the
 * orchestration scaffolding around it — selecting the range,
 * checkpointing the summary, and emitting the audit row.
 *
 * Losslessness contract: the original turns remain in
 * `cognitive_turns` and `agent_turns`. The summary is treated as
 * authoritative for *the next prompt*, never as a replacement for
 * the audit trail.
 */

import {
  PersistentMemoryError,
  SUMMARISE_BLOCK_TOKENS,
  type AuditChainPort,
  type ThreadSummary,
  type ThreadSummaryRepository,
} from '../types.js';

export interface TurnSummary {
  readonly seq: number;
  readonly token_count: number;
}

export interface SummarisationPlan {
  readonly start_seq: number;
  readonly end_seq: number;
  readonly token_count_original: number;
}

export function planSummarisation(
  turns: ReadonlyArray<TurnSummary>,
  block_tokens: number = SUMMARISE_BLOCK_TOKENS,
): SummarisationPlan | null {
  if (block_tokens <= 0) {
    throw new Error('block_tokens must be positive');
  }
  if (turns.length === 0) return null;

  const sorted = [...turns].sort((a, b) => a.seq - b.seq);

  let accumulated = 0;
  let startSeq: number | null = null;
  let endSeq: number | null = null;
  for (const turn of sorted) {
    if (startSeq === null) startSeq = turn.seq;
    endSeq = turn.seq;
    accumulated += turn.token_count;
    if (accumulated >= block_tokens) {
      return {
        start_seq: startSeq,
        end_seq: endSeq,
        token_count_original: accumulated,
      };
    }
  }
  return null;
}

export interface SummariseDeps {
  readonly repo: ThreadSummaryRepository;
  readonly audit: AuditChainPort;
}

export interface SummariseInput {
  readonly tenant_id: string;
  readonly thread_id: string;
  readonly summary_md: string;
  readonly plan: SummarisationPlan;
  readonly token_count_summary: number;
  readonly now: Date;
}

export type SummariseFn = (input: SummariseInput) => Promise<ThreadSummary>;

export function createSummarise(deps: SummariseDeps): SummariseFn {
  return async (input) => {
    if (!input.summary_md) {
      throw new PersistentMemoryError(
        'summary_md must not be empty',
        'INVALID_INPUT',
      );
    }
    if (input.plan.start_seq > input.plan.end_seq) {
      throw new PersistentMemoryError(
        'plan.start_seq must be ≤ plan.end_seq',
        'INVALID_INPUT',
      );
    }

    const id = `ts_${input.now.getTime().toString(16)}_${Math.floor(Math.random() * 0xffff).toString(16)}`;
    const auditHash = await deps.audit.append({
      tenant_id: input.tenant_id,
      event_kind: 'summary.generate',
      entity_id: id,
      recorded_at: input.now.toISOString(),
      payload_digest: `sum_${input.thread_id}_${input.plan.start_seq}-${input.plan.end_seq}`,
    });

    const row: ThreadSummary = {
      id,
      tenant_id: input.tenant_id,
      thread_id: input.thread_id,
      summary_md: input.summary_md,
      summarised_turn_range: [input.plan.start_seq, input.plan.end_seq],
      token_count_original: input.plan.token_count_original,
      token_count_summary: input.token_count_summary,
      generated_at: input.now.toISOString(),
      audit_hash: auditHash,
    };
    await deps.repo.insert(row);
    return row;
  };
}
