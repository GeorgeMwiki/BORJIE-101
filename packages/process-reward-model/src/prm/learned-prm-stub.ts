/**
 * Learned PRM — interface stub (Phase 2).
 *
 * Per §2.2 of the spec, a learned PRM is fine-tuned on
 * `prm_training_examples`. Until the 200-trace floor is cleared, the stub
 * returns a low-confidence neutral score so the aggregator can fall back
 * to the heuristic without code changes.
 *
 * The `load` signature accepts a checkpoint URI; callers supplying a
 * real URI today receive `null` — the stub does not attempt to
 * resolve checkpoints. The 19C work-item attaches a concrete loader.
 */

import type { PrmFn, PrmInput, PrmOutput } from '../types.js';

export interface LearnedPrmHandle {
  readonly checkpointUri: string;
  readonly attached: boolean;
  readonly trainingExampleCount: number;
}

const MIN_TRAINING_FLOOR = 200;

/**
 * Returns a learned-PRM handle. The stub never attaches in this build;
 * the boolean flag exists so the aggregator can detect the case and
 * down-weight the learned signal.
 */
export function loadLearnedPrm(checkpointUri: string): LearnedPrmHandle {
  return Object.freeze({
    checkpointUri,
    attached: false,
    trainingExampleCount: 0,
  });
}

/**
 * Stub PrmFn that satisfies the contract. Score is 0.5 (neutral),
 * confidence is 0 (caller should ignore). The aggregator inspects
 * `confidence` and refuses to vote-weight a stub.
 */
export function createLearnedPrmStub(_handle: LearnedPrmHandle): PrmFn {
  return (_input: PrmInput): PrmOutput =>
    Object.freeze({
      score: 0.5,
      confidence: 0,
      signals: Object.freeze([
        Object.freeze({
          name: 'learned_head',
          score: 0.5,
          weight: 0,
          explanation: 'learned PRM stub — no checkpoint attached',
        }),
      ]),
      explanation:
        'learned PRM stub — confidence 0; aggregator must fall back to heuristic',
    });
}

/** Exposed so callers + tests can assert the published floor. */
export const LEARNED_PRM_MIN_TRAINING_FLOOR = MIN_TRAINING_FLOOR;
