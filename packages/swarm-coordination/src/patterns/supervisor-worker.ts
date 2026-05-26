/**
 * Supervisor + Workers coordination pattern.
 *
 * Wave 18HH. The default Borjie swarm pattern. Root MD acts as
 * supervisor; named specialisations are workers.
 *
 * Workflow:
 *   1. Supervisor posts a `plan` blackboard contribution naming
 *      worker agents.
 *   2. Each worker registers itself in `active_agents`, reads the
 *      plan, executes, and posts a `result` contribution.
 *   3. Supervisor aggregates worker results and returns them.
 *
 * This module is a *coordinator* — it orchestrates blackboard +
 * registry calls but does NOT execute worker turns itself. Worker
 * execution is delegated via the `WorkerExecutor` port the caller
 * provides.
 */

import type {
  ActiveAgentsRegistry,
} from '../registry/active-agents-registry.js';
import type {
  BlackboardPoster,
} from '../blackboard/blackboard-poster.js';
import type {
  BlackboardReader,
} from '../blackboard/blackboard-reader.js';
import type { AgentSubject, BlackboardPosting } from '../types.js';

export interface WorkerExecutor {
  execute(args: {
    readonly tenantId: string;
    readonly subject: AgentSubject;
    readonly workerAgentId: string;
    readonly planPayload: Readonly<Record<string, unknown>>;
  }): Promise<Readonly<Record<string, unknown>>>;
}

export interface SupervisorWorkerRunInput {
  readonly tenantId: string;
  readonly supervisorAgentId: string;
  readonly subject: AgentSubject;
  readonly workerAgentIds: ReadonlyArray<string>;
  readonly planPayload: Readonly<Record<string, unknown>>;
  readonly scopeId?: string;
}

export interface SupervisorWorkerRunResult {
  readonly planPosting: BlackboardPosting;
  readonly workerResults: ReadonlyArray<{
    readonly workerAgentId: string;
    readonly resultPosting: BlackboardPosting;
  }>;
}

export interface SupervisorWorkerDeps {
  readonly registry: ActiveAgentsRegistry;
  readonly blackboardPoster: BlackboardPoster;
  readonly blackboardReader: BlackboardReader;
  readonly executor: WorkerExecutor;
}

export function createSupervisorWorker(deps: SupervisorWorkerDeps): {
  run(input: SupervisorWorkerRunInput): Promise<SupervisorWorkerRunResult>;
} {
  return {
    async run(input) {
      // 1. Supervisor posts the plan.
      const planResult = await deps.blackboardPoster.post({
        tenantId: input.tenantId,
        postedByAgentId: input.supervisorAgentId,
        subject: input.subject,
        contributionKind: 'plan',
        payload: {
          ...input.planPayload,
          workers: input.workerAgentIds.slice(),
        },
        ...(input.scopeId !== undefined ? { scopeId: input.scopeId } : {}),
      });

      // 2. Each worker registers, executes, and posts a result.
      const workerResults: Array<{
        readonly workerAgentId: string;
        readonly resultPosting: BlackboardPosting;
      }> = [];

      for (const workerAgentId of input.workerAgentIds) {
        const registered = await deps.registry.register({
          tenantId: input.tenantId,
          agentId: workerAgentId,
          agentKind: 'specialisation',
          parentAgentId: input.supervisorAgentId,
          subject: input.subject,
          ...(input.scopeId !== undefined ? { scopeId: input.scopeId } : {}),
        });
        try {
          const resultPayload = await deps.executor.execute({
            tenantId: input.tenantId,
            subject: input.subject,
            workerAgentId,
            planPayload: input.planPayload,
          });
          const posted = await deps.blackboardPoster.post({
            tenantId: input.tenantId,
            postedByAgentId: workerAgentId,
            subject: input.subject,
            contributionKind: 'result',
            payload: resultPayload,
            supersedesPostingId: planResult.posting.id,
            ...(input.scopeId !== undefined
              ? { scopeId: input.scopeId }
              : {}),
          });
          workerResults.push({
            workerAgentId,
            resultPosting: posted.posting,
          });
        } finally {
          await deps.registry.deregister(
            input.tenantId,
            registered.id,
            'completed',
          );
        }
      }

      return Object.freeze({
        planPosting: planResult.posting,
        workerResults,
      });
    },
  };
}
