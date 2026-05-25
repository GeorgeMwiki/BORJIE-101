/**
 * Supervisor team (CEO → department-managers → workers).
 *
 * The supervisor decomposes a user task into worker assignments + a
 * single composer step. Each worker handles its slice and returns to
 * the supervisor, which then composes the final answer.
 *
 * The `handoffPolicy` decides which worker handles each subtask. The
 * default heuristic matches workers by role + tool overlap.
 */

import type {
  AgentSpec,
  BrainPort,
  ExecutionResult,
  ExecutionTraceEntry,
  OrchestratorEvent,
  Task,
  TokenUsage,
} from '../types.js';
import { addUsage, emptyUsage, nowIso } from '../types.js';
import {
  action,
  finalEntry,
  handoffEntry,
  makeExecutionResult,
  observation,
  planEntry,
} from '../internal/trace.js';
import { tryParseJson } from '../internal/trace.js';

export interface SupervisorPlan {
  /** Ordered subtasks each routed to a specific worker. */
  readonly subtasks: ReadonlyArray<{ readonly description: string; readonly workerId: string }>;
}

export type HandoffPolicy = (subtask: string, candidates: ReadonlyArray<AgentSpec>) => string | null;

export interface CreateSupervisorTeamInput {
  readonly supervisor: AgentSpec;
  readonly workers: ReadonlyArray<AgentSpec>;
  readonly brain: BrainPort;
  /** Override the supervisor's worker-picking; null = use LLM plan. */
  readonly handoffPolicy?: HandoffPolicy;
  readonly maxSubtasks?: number;
  readonly onEvent?: (event: OrchestratorEvent) => void;
}

export interface TeamRuntime {
  run(task: Task): Promise<ExecutionResult>;
}

export const DEFAULT_SUPERVISOR_MAX_SUBTASKS = 10;

const PLAN_PROMPT = `Decompose the user's request into a numbered list of subtasks. For EACH subtask choose ONE worker from the team that should handle it.

Return ONLY valid JSON in this shape:
{
  "subtasks": [
    { "description": "<what to do>", "workerId": "<worker id>" }
  ]
}
`;

export function createSupervisorTeam(input: CreateSupervisorTeamInput): TeamRuntime {
  if (input.workers.length === 0) throw new Error('workers must be non-empty');
  const maxSubtasks = input.maxSubtasks ?? DEFAULT_SUPERVISOR_MAX_SUBTASKS;
  const workerMap = new Map(input.workers.map((w) => [w.id, w]));

  function emit(ev: OrchestratorEvent) {
    if (input.onEvent) input.onEvent(ev);
  }

  return {
    async run(task: Task): Promise<ExecutionResult> {
      const sessionId = `team-${Date.now()}`;
      emit({ kind: 'session-start', sessionId, at: nowIso() });

      const trace: ExecutionTraceEntry[] = [];
      let usage: TokenUsage = emptyUsage();
      let brainCalls = 0;

      // 1. Supervisor plans.
      const workerCatalogue = input.workers
        .map((w) => `- ${w.id} (${w.role}): ${w.name}`)
        .join('\n');

      const planResp = await input.brain.call({
        system: `${input.supervisor.systemPrompt}\n\n${PLAN_PROMPT}\nAvailable workers:\n${workerCatalogue}`,
        messages: [{ role: 'user', content: task.description }],
        temperature: 0,
        structuredOutput: true,
        traceTag: `team:${input.supervisor.id}:plan`,
      });
      brainCalls += 1;
      usage = addUsage(usage, planResp.usage);

      const parsed = tryParseJson<SupervisorPlan>(planResp.text);
      if (!parsed || !Array.isArray(parsed.subtasks) || parsed.subtasks.length === 0) {
        return makeExecutionResult({
          outcome: 'failed',
          answer: '',
          trace,
          usage,
          brainCalls,
          reason: 'supervisor did not produce a parseable plan',
        });
      }
      if (parsed.subtasks.length > maxSubtasks) {
        return makeExecutionResult({
          outcome: 'failed',
          answer: '',
          trace,
          usage,
          brainCalls,
          reason: `supervisor produced ${parsed.subtasks.length} subtasks > maxSubtasks ${maxSubtasks}`,
        });
      }

      trace.push(planEntry(`${parsed.subtasks.length} subtask(s)`, input.supervisor.id));

      // 2. Execute each subtask via the chosen worker.
      const results: { workerId: string; description: string; output: string }[] = [];
      for (const sub of parsed.subtasks) {
        let workerId = sub.workerId;
        if (input.handoffPolicy) {
          const override = input.handoffPolicy(sub.description, input.workers);
          if (override) workerId = override;
        }
        const worker = workerMap.get(workerId);
        if (!worker) {
          return makeExecutionResult({
            outcome: 'failed',
            answer: '',
            trace,
            usage,
            brainCalls,
            reason: `unknown workerId ${workerId}`,
          });
        }
        trace.push(handoffEntry(`${input.supervisor.id} → ${worker.id}: ${sub.description}`));
        emit({
          kind: 'handoff',
          fromAgentId: input.supervisor.id,
          toAgentId: worker.id,
          reason: sub.description,
          at: nowIso(),
        });
        trace.push(action(sub.description, worker.id));
        const workerResp = await input.brain.call({
          system: worker.systemPrompt,
          messages: [{ role: 'user', content: sub.description }],
          traceTag: `team:${worker.id}:subtask`,
        });
        brainCalls += 1;
        usage = addUsage(usage, workerResp.usage);
        const output = workerResp.text;
        trace.push(observation(output.slice(0, 240), worker.id));
        results.push({ workerId: worker.id, description: sub.description, output });
      }

      // 3. Supervisor composes final answer.
      const compResp = await input.brain.call({
        system: `${input.supervisor.systemPrompt}\n\nCompose a final answer to the user using the worker results. Be concise.`,
        messages: [
          { role: 'user', content: `Original request: ${task.description}\n\nWorker outputs:\n${results.map((r) => `[${r.workerId}] ${r.description}\n→ ${r.output}`).join('\n\n')}` },
        ],
        traceTag: `team:${input.supervisor.id}:compose`,
      });
      brainCalls += 1;
      usage = addUsage(usage, compResp.usage);
      trace.push(finalEntry(compResp.text, input.supervisor.id));

      emit({ kind: 'session-end', outcome: 'success', at: nowIso() });
      return makeExecutionResult({
        outcome: 'success',
        answer: compResp.text,
        trace,
        usage,
        brainCalls,
      });
    },
  };
}
