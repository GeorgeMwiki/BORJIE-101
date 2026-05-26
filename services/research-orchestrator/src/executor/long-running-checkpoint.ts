/**
 * Long-running checkpoint — per-step state persistence.
 *
 * Per DEEP_RESEARCH_SPEC §10 (Long-running session model):
 *   - Every step's started_at / finished_at is persisted to research_steps.
 *   - Every artifact is persisted to research_artifacts immediately.
 *   - A crash mid-dive resumes from the last completed step on next pickup.
 *
 * This module owns the contract the plan-runner uses to ask the
 * orchestrator's storage layer to "record where you are". The storage
 * implementation (storage/session-repository.ts + step-repository.ts)
 * implements the StepCheckpointer interface; the runner doesn't care
 * how persistence works, only that a checkpoint was taken.
 *
 * Pure interface module. No I/O.
 *
 * @module research-orchestrator/executor/long-running-checkpoint
 */

import type { ResearchArtifact } from '../types.js';
import type { StepRunResult } from './step-runner.js';

export interface StepCheckpointer {
  /**
   * Persist the result of a single step. Implementations write the
   * step row, the artifact rows, and update research_sessions.state
   * (the long-running checkpoint payload).
   */
  checkpoint(args: {
    readonly plan_id: string;
    readonly step_id: string;
    readonly step_seq: number;
    readonly result: StepRunResult;
  }): Promise<void>;
}

export interface ResumeSnapshot {
  readonly plan_id: string;
  readonly last_completed_seq: number;
  readonly artifacts_so_far: ReadonlyArray<ResearchArtifact>;
  readonly spent_usd_cents: number;
  readonly elapsed_ms: number;
}

export interface ResumeStore {
  /**
   * Load the resume snapshot for a plan_id. Returns null when no
   * prior checkpoint exists (fresh start).
   */
  load(plan_id: string): Promise<ResumeSnapshot | null>;
}

/**
 * Convenience wrapper — the plan-runner calls this after each step.
 * Centralised so any future cross-cutting concern (metrics, OTel span,
 * dlq) lives in one place.
 */
export async function checkpointAfterStep(args: {
  readonly checkpointer: StepCheckpointer;
  readonly plan_id: string;
  readonly step_id: string;
  readonly step_seq: number;
  readonly result: StepRunResult;
}): Promise<void> {
  await args.checkpointer.checkpoint({
    plan_id: args.plan_id,
    step_id: args.step_id,
    step_seq: args.step_seq,
    result: args.result,
  });
}

/**
 * In-memory checkpointer — used by tests + the dry-run mode. Records
 * every checkpoint in an internal array so tests can assert ordering.
 */
export interface InMemoryCheckpointer extends StepCheckpointer {
  readonly history: ReadonlyArray<{
    readonly plan_id: string;
    readonly step_id: string;
    readonly step_seq: number;
    readonly status: StepRunResult['status'];
    readonly cost_usd_cents: number;
  }>;
}

export function createInMemoryCheckpointer(): InMemoryCheckpointer {
  const history: Array<{
    plan_id: string;
    step_id: string;
    step_seq: number;
    status: StepRunResult['status'];
    cost_usd_cents: number;
  }> = [];
  return {
    history,
    async checkpoint(args) {
      history.push({
        plan_id: args.plan_id,
        step_id: args.step_id,
        step_seq: args.step_seq,
        status: args.result.status,
        cost_usd_cents: args.result.cost_usd_cents,
      });
    },
  };
}
