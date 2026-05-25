/**
 * Workflow Step Executor — runs a single step and returns its result.
 *
 * Keeps the three kinds of step execution cleanly separated:
 *   - ai: dispatch to a persona (in production), stub in tests
 *   - tool: dispatch to a named tool via the ToolDispatcher
 *   - human: pause (do not execute); engine marks awaiting_approval
 *   - notify: dispatch a notification
 */

import { z } from 'zod';
import type { WorkflowStep } from './workflow-registry.js';

export const StepOutcomeSchema = z.object({
  status: z.enum(['completed', 'failed', 'awaiting_approval', 'skipped']),
  output: z.record(z.unknown()).default({}),
  errorMessage: z.string().optional(),
  durationMs: z.number().int().nonnegative().default(0),
});
export type StepOutcome = z.infer<typeof StepOutcomeSchema>;

export interface StepExecutionContext {
  readonly tenantId: string;
  readonly initiatedBy: string;
  readonly runId: string;
  readonly stepIndex: number;
  readonly priorOutput: Record<string, unknown>;
  readonly input: Record<string, unknown>;
}

export interface StepExecutor {
  execute(step: WorkflowStep, ctx: StepExecutionContext): Promise<StepOutcome>;
}

/**
 * Default executor — structured stub. Production deployments swap in
 * a composite executor that routes to PersonaRegistry / ToolDispatcher /
 * NotificationService. Keeps the engine testable in complete isolation.
 */
export class DefaultStepExecutor implements StepExecutor {
  async execute(step: WorkflowStep, _ctx: StepExecutionContext): Promise<StepOutcome> {
    const start = Date.now();
    if (step.kind === 'human' && step.blocksUntilApproved) {
      return {
        status: 'awaiting_approval',
        output: { step: step.id, target: step.target },
        durationMs: Date.now() - start,
      };
    }
    if (step.kind === 'ai') {
      return {
        status: 'completed',
        output: { persona: step.target, simulated: true },
        durationMs: Date.now() - start,
      };
    }
    if (step.kind === 'tool') {
      return {
        status: 'completed',
        output: { tool: step.target, simulated: true },
        durationMs: Date.now() - start,
      };
    }
    if (step.kind === 'notify') {
      return {
        status: 'completed',
        output: { channel: step.target, dispatched: true },
        durationMs: Date.now() - start,
      };
    }
    return {
      status: 'failed',
      errorMessage: `unknown step kind: ${step.kind}`,
      output: {},
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Override executor — pass a map of stepId -> outcome to force specific
 * outcomes for testing rejection paths, retries, etc.
 */
export class ScriptedStepExecutor implements StepExecutor {
  private readonly scripts: Map<string, StepOutcome>;
  private readonly fallback: StepExecutor;

  constructor(
    scripts: Record<string, StepOutcome>,
    fallback: StepExecutor = new DefaultStepExecutor()
  ) {
    this.scripts = new Map(Object.entries(scripts));
    this.fallback = fallback;
  }

  async execute(step: WorkflowStep, ctx: StepExecutionContext): Promise<StepOutcome> {
    const scripted = this.scripts.get(step.id);
    if (scripted) return scripted;
    return this.fallback.execute(step, ctx);
  }
}
