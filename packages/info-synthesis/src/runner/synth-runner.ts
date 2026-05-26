/**
 * The diorize pipeline orchestrator.
 *
 * Wires the seven stages — chunker → scorer → clusterer → reconciler
 * → writer → citer → calibrator — and persists the result via the
 * injected repositories. Returns the final SynthOutput.
 *
 * Persona: Mr. Mwikila. The orchestrator never invents data; it
 * faithfully reports the calibrated confidence + the disagreements
 * that the corpus actually contained.
 *
 * INFORMATION_SYNTHESIS_SOTA_SPEC §8: failure recovery — any stage
 * exception marks the run as `failed` and re-throws so the caller
 * sees the underlying error.
 */

import type {
  Chunk,
  CorpusArtifact,
  SynthOutput,
  SynthOutputRepository,
  SynthRequest,
  SynthRunRepository,
  WriterPort,
} from '../types.js';
import { chunkCorpus } from '../pipeline/chunker.js';
import { scoreChunks } from '../pipeline/scorer.js';
import { clusterChunks } from '../pipeline/clusterer.js';
import { reconcileClusters } from '../pipeline/reconciler.js';
import {
  buildWriterRequest,
  writeSynthesis,
} from '../pipeline/writer.js';
import { attachCitations } from '../pipeline/citer.js';
import { calibrate } from '../pipeline/calibrator.js';

export interface SynthRunnerDeps {
  readonly runs: SynthRunRepository;
  readonly outputs: SynthOutputRepository;
  readonly writerPort?: WriterPort;
  /** Override now() for deterministic tests. */
  readonly now?: () => Date;
}

export interface RunSynthesisResult {
  readonly output: SynthOutput;
}

export function createSynthRunner(deps: SynthRunnerDeps) {
  return {
    /**
     * Run the full pipeline. Throws if any stage fails; the run row
     * will have been transitioned to `failed` before the throw.
     */
    async run(request: SynthRequest): Promise<RunSynthesisResult> {
      const corpusIds = request.corpus.map((a) => a.id);
      const synthRun = await deps.runs.start({
        tenantId: request.tenantId,
        query: request.query,
        corpusIds,
      });
      await deps.runs.markRunning(request.tenantId, synthRun.id);

      try {
        const chunkerOptions =
          request.chunkWordBudget !== undefined
            ? { wordBudget: request.chunkWordBudget }
            : {};
        const chunks = chunkCorpus(request.corpus, chunkerOptions);

        const corpusById = buildCorpusIndex(request.corpus);
        const chunksById = buildChunkIndex(chunks);

        const scored = scoreChunks({
          query: request.query,
          chunks,
          corpusById,
        });

        const clustererOptions =
          request.maxClusters !== undefined
            ? { maxClusters: request.maxClusters }
            : {};
        const clusters = clusterChunks(scored, clustererOptions);

        const reconcile = reconcileClusters({
          clusters,
          chunksById,
        });

        const writerRequest = buildWriterRequest({
          query: request.query,
          tenantId: request.tenantId,
          clusters: reconcile.reconciled,
          disagreements: reconcile.disagreements,
        });
        const body = await writeSynthesis(
          writerRequest,
          deps.writerPort !== undefined ? { port: deps.writerPort } : {},
        );

        const citations = attachCitations({
          clusters: reconcile.reconciled,
          chunksById,
          corpusById,
        });

        const calibrated = calibrate({
          clusters: reconcile.reconciled,
          disagreements: reconcile.disagreements,
          citations,
          chunkCount: chunks.length,
          sourceCount: request.corpus.length,
        });

        const output = await deps.outputs.insert({
          synthRunId: synthRun.id,
          tenantId: request.tenantId,
          output: body,
          citations,
          calibratedConfidence: calibrated.calibrated,
          disagreements: reconcile.disagreements,
        });

        await deps.runs.markSucceeded(request.tenantId, synthRun.id);

        return { output };
      } catch (error) {
        await deps.runs.markFailed(request.tenantId, synthRun.id);
        throw error;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCorpusIndex(
  corpus: ReadonlyArray<CorpusArtifact>,
): ReadonlyMap<string, CorpusArtifact> {
  const m = new Map<string, CorpusArtifact>();
  for (const a of corpus) {
    m.set(a.id, a);
  }
  return m;
}

function buildChunkIndex(
  chunks: ReadonlyArray<Chunk>,
): ReadonlyMap<string, Chunk> {
  const m = new Map<string, Chunk>();
  for (const c of chunks) {
    m.set(c.id, c);
  }
  return m;
}
