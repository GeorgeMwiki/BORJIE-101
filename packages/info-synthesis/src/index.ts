/**
 * `@borjie/info-synthesis` — public surface.
 *
 * Wave M7. The diorize pipeline: distill + categorise + synthesize.
 * Given a corpus of artifacts (journal entries, research results,
 * tacit-knowledge transcripts, ingested documents), the synthesizer
 * runs a multi-stage pipeline — chunk → score → cluster → reconcile
 * → write → cite → calibrate — and emits a calibrated, multi-
 * perspective synthesis with citations, disagreements, and confidence.
 *
 * Spec: Docs/DESIGN/INFORMATION_SYNTHESIS_SOTA_SPEC.md.
 * Persona: Mr. Mwikila. Brand: Borjie.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  CalibratedScore,
  CalibrationFactor,
  Chunk,
  Citation,
  Cluster,
  Contradiction,
  CorpusArtifact,
  Disagreement,
  DisagreementPosition,
  ReconciledCluster,
  ScoredChunk,
  SynthOutput,
  SynthOutputRepository,
  SynthRequest,
  SynthRun,
  SynthRunRepository,
  SynthRunStatus,
  WriterPort,
  WriterRequest,
} from './types.js';

export { INFO_SYNTHESIS_CONSTANTS } from './types.js';

// ---------------------------------------------------------------------------
// Pipeline stages — each stage exported as a pure function
// ---------------------------------------------------------------------------

export { chunkArtifact, chunkCorpus } from './pipeline/chunker.js';
export { scoreChunks } from './pipeline/scorer.js';
export { clusterChunks } from './pipeline/clusterer.js';
export {
  reconcileClusters,
  type ReconcilerInput,
  type ReconcilerOutput,
} from './pipeline/reconciler.js';
export {
  writeSynthesis,
  renderFallbackSynthesis,
  buildWriterRequest,
} from './pipeline/writer.js';
export { attachCitations, type CiterInput } from './pipeline/citer.js';
export { calibrate, type CalibratorInput } from './pipeline/calibrator.js';

// ---------------------------------------------------------------------------
// Runner — full-pipeline orchestrator
// ---------------------------------------------------------------------------

export {
  createSynthRunner,
  type RunSynthesisResult,
  type SynthRunnerDeps,
} from './runner/synth-runner.js';

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export { createInMemorySynthRunRepository } from './repositories/synth-run.js';
export { createInMemorySynthOutputRepository } from './repositories/synth-output.js';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export {
  computeSynthAuditHash,
  GENESIS_HASH,
} from './audit/audit-chain-link.js';
