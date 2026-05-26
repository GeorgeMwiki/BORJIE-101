/**
 * In-memory + future-Postgres-backed repository for gauntlet run results.
 *
 * The in-memory adapter is the only implementation today — it keeps the
 * gauntlet smoke-runnable without a database. The Postgres adapter (calling
 * into the `swahili_gauntlet_results` table from migration 0033) lands as
 * part of the Phase-2 integration described in the spec doc §7.
 *
 * Returns frozen copies of records to honour the project-wide immutability
 * rule from `~/.claude/rules/coding-style.md`.
 */

export interface UtteranceResult {
  readonly runId: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly modelVersion: string;
  readonly utteranceId: string;
  readonly referenceTranscript: string;
  readonly hypothesisTranscript: string;
  readonly wer: number;
  readonly mos: number | null;
  readonly latencyMs: number;
  readonly createdAt: string; // ISO timestamp
}

export interface RunSummary {
  readonly runId: string;
  readonly tenantId: string;
  readonly provider: string;
  readonly modelVersion: string;
  readonly utteranceCount: number;
  readonly aggregateWer: number;
  readonly aggregateMos: number | null;
  readonly maxUtteranceWer: number;
  readonly createdAt: string;
}

export interface ResultRepository {
  saveUtterance(result: UtteranceResult): Promise<void>;
  saveRunSummary(summary: RunSummary): Promise<void>;
  listUtterancesForRun(runId: string): Promise<ReadonlyArray<UtteranceResult>>;
  listRunSummaries(tenantId: string): Promise<ReadonlyArray<RunSummary>>;
}

/**
 * Single-process in-memory repository. State lives in private maps that the
 * factory function returns; never exposed as a mutable reference.
 */
export function createInMemoryResultRepository(): ResultRepository {
  const utterances = new Map<string, UtteranceResult[]>(); // runId → results
  const summaries = new Map<string, RunSummary[]>(); // tenantId → summaries

  return {
    async saveUtterance(result: UtteranceResult): Promise<void> {
      const frozen = Object.freeze({ ...result });
      const list = utterances.get(result.runId) ?? [];
      utterances.set(result.runId, [...list, frozen]);
    },
    async saveRunSummary(summary: RunSummary): Promise<void> {
      const frozen = Object.freeze({ ...summary });
      const list = summaries.get(summary.tenantId) ?? [];
      summaries.set(summary.tenantId, [...list, frozen]);
    },
    async listUtterancesForRun(runId: string): Promise<ReadonlyArray<UtteranceResult>> {
      return utterances.get(runId)?.slice() ?? [];
    },
    async listRunSummaries(tenantId: string): Promise<ReadonlyArray<RunSummary>> {
      return summaries.get(tenantId)?.slice() ?? [];
    },
  };
}
