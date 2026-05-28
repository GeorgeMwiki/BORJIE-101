/**
 * Swahili gauntlet runner.
 *
 * Drives any object satisfying the small `GauntletSttProvider` shape (mock or
 * production STT) against the 50 reference utterances, scores each result
 * with WER, persists the per-utterance + aggregate summary into the result
 * repository, and returns the summary to the caller.
 *
 * Design choice — the runner does not depend on the full `SttProvider`
 * interface from `providers/types.ts`. It takes a narrow function-style port
 * so unit tests can stub it with a one-liner. Production callers wrap the
 * real STT provider in a thin adapter.
 *
 * No raw console statements — caller can pass a logger; the smoke-test default is silent.
 */

import { wordErrorRate, WER_AGGREGATE_TARGET, WER_PER_UTTERANCE_TARGET } from './metrics/wer.js';
import { aggregateMos, type MosRating, MOS_AGGREGATE_TARGET } from './metrics/mos.js';
import {
  SWAHILI_GAUNTLET_UTTERANCES,
  type SwahiliUtterance,
} from './test-utterances.js';
import type {
  ResultRepository,
  RunSummary,
  UtteranceResult,
} from './storage/result-repository.js';

/**
 * Narrow port — a function that, given an utterance, returns the STT
 * hypothesis transcript. The runner does NOT care how it got there.
 */
export type GauntletSttProvider = (
  utterance: SwahiliUtterance,
) => Promise<{ readonly hypothesis: string; readonly latencyMs: number }>;

export interface GauntletRunOptions {
  readonly tenantId: string;
  readonly provider: string;
  readonly modelVersion: string;
  /** Optional subset; defaults to the full 50. */
  readonly utterances?: ReadonlyArray<SwahiliUtterance>;
  /** Optional human ratings if available; otherwise MOS stays null. */
  readonly mosRatings?: ReadonlyArray<MosRating>;
  /** RFC 4122 run id; caller decides so traceability is end-to-end. */
  readonly runId: string;
}

export interface GauntletRunResult {
  readonly summary: RunSummary;
  readonly perUtterance: ReadonlyArray<UtteranceResult>;
  readonly violations: ReadonlyArray<{ readonly utteranceId: string; readonly wer: number }>;
  readonly passed: boolean;
}

/**
 * Run the gauntlet end-to-end. Pure orchestration — all side effects are
 * delegated to the STT port and the repository.
 */
export async function runGauntlet(
  stt: GauntletSttProvider,
  repository: ResultRepository,
  options: GauntletRunOptions,
): Promise<GauntletRunResult> {
  const set = options.utterances ?? SWAHILI_GAUNTLET_UTTERANCES;
  const createdAt = new Date().toISOString();
  const perUtterance: UtteranceResult[] = [];
  const violations: Array<{ utteranceId: string; wer: number }> = [];

  for (const utterance of set) {
    const sttResult = await stt(utterance);
    const wer = wordErrorRate(utterance.referenceTranscript, sttResult.hypothesis).wer;
    const mosAggregate = options.mosRatings
      ? aggregateMos(utterance.id, options.mosRatings)
      : null;

    const record: UtteranceResult = {
      runId: options.runId,
      tenantId: options.tenantId,
      provider: options.provider,
      modelVersion: options.modelVersion,
      utteranceId: utterance.id,
      referenceTranscript: utterance.referenceTranscript,
      hypothesisTranscript: sttResult.hypothesis,
      wer,
      mos: mosAggregate?.mean ?? null,
      latencyMs: sttResult.latencyMs,
      createdAt,
    };
    perUtterance.push(record);
    await repository.saveUtterance(record);

    if (wer > WER_PER_UTTERANCE_TARGET) {
      violations.push({ utteranceId: utterance.id, wer });
    }
  }

  const totalWer = perUtterance.reduce((acc, r) => acc + r.wer, 0);
  const aggregateWer = perUtterance.length === 0 ? 0 : totalWer / perUtterance.length;
  const maxUtteranceWer = perUtterance.reduce((max, r) => (r.wer > max ? r.wer : max), 0);

  const mosScores = perUtterance.map((r) => r.mos).filter((m): m is number => m !== null);
  const aggregateMosScore =
    mosScores.length === 0 ? null : mosScores.reduce((a, b) => a + b, 0) / mosScores.length;

  const summary: RunSummary = {
    runId: options.runId,
    tenantId: options.tenantId,
    provider: options.provider,
    modelVersion: options.modelVersion,
    utteranceCount: perUtterance.length,
    aggregateWer,
    aggregateMos: aggregateMosScore,
    maxUtteranceWer,
    createdAt,
  };
  await repository.saveRunSummary(summary);

  const passed =
    aggregateWer <= WER_AGGREGATE_TARGET &&
    violations.length === 0 &&
    (aggregateMosScore === null || aggregateMosScore >= MOS_AGGREGATE_TARGET);

  return { summary, perUtterance, violations, passed };
}
