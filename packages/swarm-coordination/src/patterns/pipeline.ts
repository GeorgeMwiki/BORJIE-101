/**
 * Pipeline coordination pattern.
 *
 * Wave 18HH. Sequential handoff. The classic pipeline is
 *   research → cognitive engine → compose → publish
 * Each stage writes an A2A `handoff` message to the next, carrying
 * the subject and a payload snapshot.
 *
 * Dirt-simple, audit-friendly, and dominates production wave-
 * dispatched workloads.
 */

import type { A2ASender } from '../messaging/a2a-sender.js';
import type { AgentMessage, AgentSubject } from '../types.js';

export interface PipelineStage {
  readonly stageAgentId: string;
  execute(args: {
    readonly tenantId: string;
    readonly subject: AgentSubject;
    readonly incomingPayload: Readonly<Record<string, unknown>>;
  }): Promise<Readonly<Record<string, unknown>>>;
}

export interface PipelineRunInput {
  readonly tenantId: string;
  readonly originAgentId: string;
  readonly subject: AgentSubject;
  readonly stages: ReadonlyArray<PipelineStage>;
  readonly initialPayload: Readonly<Record<string, unknown>>;
}

export interface PipelineRunResult {
  readonly handoffs: ReadonlyArray<AgentMessage>;
  readonly finalPayload: Readonly<Record<string, unknown>>;
}

export interface PipelineDeps {
  readonly a2aSender: A2ASender;
}

export function createPipeline(deps: PipelineDeps): {
  run(input: PipelineRunInput): Promise<PipelineRunResult>;
} {
  return {
    async run(input) {
      if (input.stages.length === 0) {
        throw new Error('Pipeline requires at least one stage');
      }

      const handoffs: AgentMessage[] = [];
      let currentPayload = input.initialPayload;
      let previousAgentId = input.originAgentId;

      for (const stage of input.stages) {
        const handoff = await deps.a2aSender.send({
          tenantId: input.tenantId,
          fromAgentId: previousAgentId,
          toAgentId: stage.stageAgentId,
          messageKind: 'handoff',
          payload: {
            subject: input.subject,
            snapshot: currentPayload,
          },
        });
        handoffs.push(handoff);

        currentPayload = await stage.execute({
          tenantId: input.tenantId,
          subject: input.subject,
          incomingPayload: currentPayload,
        });
        previousAgentId = stage.stageAgentId;
      }

      return Object.freeze({
        handoffs,
        finalPayload: currentPayload,
      });
    },
  };
}
