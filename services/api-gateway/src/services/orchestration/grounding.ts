/**
 * Grounding helpers — CE-7 evidence-required invariant.
 *
 * Per CLAUDE.md hard rule:
 *
 *   "Evidence-required AI output. Every junior recommendation cites
 *    >=1 evidence_id from LMBM or intelligence corpus. The Auditor
 *    Agent rejects responses with empty evidence chains."
 *
 * This module ships:
 *
 *   - `EvidenceClaim` — canonical shape for any single citation the
 *     brain produces (evidence_id + chunk anchor + score).
 *   - `validateEvidenceChain(claims)` — runtime check that the
 *     chain is non-empty, every id is well-formed, no duplicates
 *     dilute the chain. Returns a list of problems (empty = valid).
 *   - `attachEvidenceToPlan(plan, evidenceById)` — distributes
 *     evidence ids to a plan-DAG's steps using each step's
 *     `evidenceIds` field, preserving plan immutability.
 *
 * Companion: the existing `services/api-gateway/src/services/
 * decision-journal/recorder.ts` enforces the same invariant when
 * persisting a decision; this module enforces it pre-persistence
 * inside the chat reply pipeline.
 *
 * Discipline:
 *   - Pure data + pure functions only.
 *   - Functions <50 lines.
 *   - Errors surface via problems[]; no throws across the boundary.
 */

import { z } from 'zod';
import type { PlanDag } from './plan-dag';

export const evidenceClaimSchema = z
  .object({
    evidenceId: z.string().min(1).max(120),
    /** Optional anchor: corpus chunk id, lmbm row id, etc. */
    sourceKind: z.enum(['corpus_chunk', 'lmbm', 'decision', 'doc_draft', 'external']),
    sourceRefId: z.string().min(1).max(160).optional(),
    /** Caller-supplied score (0..1) — confidence the citation is on-point. */
    score: z.number().min(0).max(1).optional(),
    /** Free-form quote snippet for UI citation rendering. */
    snippet: z.string().min(1).max(800).optional(),
  })
  .strict();
export type EvidenceClaim = z.infer<typeof evidenceClaimSchema>;

export interface EvidenceChainProblem {
  readonly code:
    | 'empty_chain'
    | 'malformed_claim'
    | 'duplicate_evidence_id'
    | 'unknown_source_kind';
  readonly message: string;
  /** Index in the chain that triggered the problem, when applicable. */
  readonly index?: number;
}

/**
 * Validate an evidence chain. Returns a list of problems; an empty
 * list means the chain is valid.
 *
 * The AuditorAgent calls this synchronously before any junior
 * recommendation is forwarded to the owner.
 */
export function validateEvidenceChain(
  claims: ReadonlyArray<unknown>,
): ReadonlyArray<EvidenceChainProblem> {
  const problems: EvidenceChainProblem[] = [];
  if (claims.length === 0) {
    problems.push({
      code: 'empty_chain',
      message: 'evidence chain is empty — junior output rejected',
    });
    return Object.freeze(problems);
  }
  const seen = new Set<string>();
  for (let i = 0; i < claims.length; i += 1) {
    const raw = claims[i];
    const parsed = evidenceClaimSchema.safeParse(raw);
    if (!parsed.success) {
      problems.push({
        code: 'malformed_claim',
        message: `claim ${i} failed schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        index: i,
      });
      continue;
    }
    if (seen.has(parsed.data.evidenceId)) {
      problems.push({
        code: 'duplicate_evidence_id',
        message: `duplicate evidence id ${parsed.data.evidenceId}`,
        index: i,
      });
      continue;
    }
    seen.add(parsed.data.evidenceId);
  }
  return Object.freeze(problems);
}

/**
 * Attach evidence ids to every step of a plan whose own evidence
 * list is empty. Steps with non-empty evidence are left untouched.
 *
 * Returns a NEW plan (immutability). Use when the brain has a
 * plan-level evidence chain that should backstop every step's
 * citation requirement.
 */
export function attachEvidenceToPlan(
  plan: PlanDag,
  evidenceIds: ReadonlyArray<string>,
): PlanDag {
  if (evidenceIds.length === 0) return plan;
  const steps = plan.steps.map((step) => {
    if (step.evidenceIds.length > 0) return step;
    return { ...step, evidenceIds: [...evidenceIds] };
  });
  return { ...plan, steps };
}

/**
 * Summarise a plan's evidence coverage. Reports counts and any
 * step that is uncited. Used by the CE-7 verification test.
 */
export function summariseEvidenceCoverage(plan: PlanDag): {
  readonly totalSteps: number;
  readonly citedSteps: number;
  readonly uncitedStepIds: ReadonlyArray<string>;
} {
  const uncited: string[] = [];
  let citedCount = 0;
  for (const step of plan.steps) {
    if (step.evidenceIds.length === 0) uncited.push(step.id);
    else citedCount += 1;
  }
  return Object.freeze({
    totalSteps: plan.steps.length,
    citedSteps: citedCount,
    uncitedStepIds: Object.freeze(uncited),
  });
}
