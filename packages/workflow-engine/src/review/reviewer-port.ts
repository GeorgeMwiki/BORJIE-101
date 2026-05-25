/**
 * AIReviewerPort — the boundary the engine talks to when a run reaches
 * `in_review`. The actual implementation lives in `@borjie/ai-reviewer`
 * (policy-based + multi-LLM brain). The engine only needs the shape.
 *
 * Decoupling rationale:
 *   - The engine MUST work in tests without the LLM dependency. We pass
 *     a stub that returns a deterministic verdict.
 *   - The reviewer evolves on its own cadence; bumping its policies
 *     should not require a workflow-engine release.
 */

import type {
  ProposedChange,
  ReviewDecision,
  WorkflowDefinition,
  WorkflowRun,
} from '../types.js';

export interface AIReviewerPort {
  review(input: {
    readonly run: WorkflowRun;
    readonly definition: WorkflowDefinition;
    readonly proposedChange: ProposedChange;
  }): Promise<Omit<ReviewDecision, 'id' | 'runId' | 'decidedAt'>>;

  /**
   * Real-time coaching — returns one short hint while the worker is
   * still editing. Optional; engine no-ops if the implementation is
   * absent.
   */
  coach?(input: {
    readonly run: WorkflowRun;
    readonly definition: WorkflowDefinition;
    readonly partialProposedChange: ProposedChange;
  }): Promise<{ readonly hint: string }>;
}
