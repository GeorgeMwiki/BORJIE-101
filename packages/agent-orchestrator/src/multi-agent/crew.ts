/**
 * Crew workflow (CrewAI 0.50 — Q1 2026).
 *
 * Two processes:
 *
 *   - `sequential`: tasks execute in declaration order; each task's
 *     output becomes context for the next.
 *   - `hierarchical`: a manager agent decomposes the overarching goal
 *     into per-task assignments and routes to specialist workers.
 *
 * Tasks are typed first-class objects (vs. Swarm's pure-handoff and
 * GroupChat's free-form conversation). Each task has an `assignedTo`
 * agent id and an `expectedOutput` contract.
 */

import type {
  AgentSpec,
  BrainPort,
  ExecutionResult,
  ExecutionTraceEntry,
  OrchestratorEvent,
  TokenUsage,
} from '../types.js';
import { addUsage, emptyUsage, nowIso } from '../types.js';
import { action, finalEntry, makeExecutionResult, observation } from '../internal/trace.js';

export interface CrewTask {
  readonly id: string;
  readonly description: string;
  /** Agent id from the crew that should execute this task. */
  readonly assignedTo: string;
  /** Short statement of what the task's output should look like. */
  readonly expectedOutput: string;
  /** Optional input shape. */
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export type CrewProcess = 'sequential' | 'hierarchical';

export interface CreateCrewInput {
  readonly agents: ReadonlyArray<AgentSpec>;
  readonly tasks: ReadonlyArray<CrewTask>;
  readonly process: CrewProcess;
  readonly brain: BrainPort;
  /** Manager id (required when `process === 'hierarchical'`). */
  readonly managerId?: string;
  readonly onEvent?: (event: OrchestratorEvent) => void;
}

export interface CrewTaskResult {
  readonly taskId: string;
  readonly assignedTo: string;
  readonly output: string;
  readonly usage: TokenUsage;
}

export interface CrewRuntime {
  run(): Promise<{ result: ExecutionResult; perTask: ReadonlyArray<CrewTaskResult> }>;
}

export function createCrewWorkflow(input: CreateCrewInput): CrewRuntime {
  if (input.agents.length === 0) throw new Error('agents must be non-empty');
  if (input.tasks.length === 0) throw new Error('tasks must be non-empty');
  const agentMap = new Map(input.agents.map((a) => [a.id, a]));
  if (input.process === 'hierarchical') {
    if (!input.managerId) throw new Error('managerId required for hierarchical process');
    if (!agentMap.has(input.managerId)) throw new Error(`managerId ${input.managerId} not in agents`);
  }
  for (const t of input.tasks) {
    if (!agentMap.has(t.assignedTo)) {
      throw new Error(`task ${t.id} assignedTo ${t.assignedTo} not in agents`);
    }
  }

  function emit(ev: OrchestratorEvent) {
    if (input.onEvent) input.onEvent(ev);
  }

  return {
    async run() {
      const sessionId = `crew-${Date.now()}`;
      emit({ kind: 'session-start', sessionId, at: nowIso() });

      const trace: ExecutionTraceEntry[] = [];
      const perTask: CrewTaskResult[] = [];
      let usage: TokenUsage = emptyUsage();
      let brainCalls = 0;

      const contextSoFar: string[] = [];

      for (const task of input.tasks) {
        const assignee = agentMap.get(task.assignedTo);
        if (!assignee) continue;

        // In hierarchical mode, manager produces a refined assignment prompt.
        let assignment = task.description;
        if (input.process === 'hierarchical' && input.managerId) {
          const manager = agentMap.get(input.managerId);
          if (manager) {
            const mgrResp = await input.brain.call({
              system: `${manager.systemPrompt}\n\nYou route tasks to specialists. Produce a concise, specific instruction for the specialist.`,
              messages: [
                { role: 'user', content: `Task: ${task.description}\nAssigned specialist: ${assignee.name} (role: ${assignee.role})\nExpected output: ${task.expectedOutput}\n\nWrite the instruction for the specialist:` },
              ],
              temperature: 0,
              traceTag: `crew:manager:${task.id}`,
            });
            brainCalls += 1;
            usage = addUsage(usage, mgrResp.usage);
            assignment = mgrResp.text.trim() || task.description;
          }
        }

        trace.push(action(`assign ${task.id} → ${assignee.id}`, input.managerId));

        const contextPrefix = contextSoFar.length > 0
          ? `Context from prior tasks:\n${contextSoFar.join('\n\n')}\n\n`
          : '';
        const inputsBlock = task.inputs
          ? `\n\nInputs:\n${JSON.stringify(task.inputs, null, 2)}`
          : '';
        const workerResp = await input.brain.call({
          system: assignee.systemPrompt,
          messages: [
            { role: 'user', content: `${contextPrefix}Task: ${assignment}\nExpected output: ${task.expectedOutput}${inputsBlock}` },
          ],
          traceTag: `crew:${assignee.id}:${task.id}`,
        });
        brainCalls += 1;
        usage = addUsage(usage, workerResp.usage);
        const output = workerResp.text;
        trace.push(observation(`task ${task.id} output: ${output.slice(0, 240)}`, assignee.id));
        perTask.push({
          taskId: task.id,
          assignedTo: assignee.id,
          output,
          usage: workerResp.usage,
        });
        contextSoFar.push(`[${task.id} by ${assignee.id}]\n${output}`);
      }

      const finalAnswer = contextSoFar.at(-1) ?? '';
      trace.push(finalEntry(finalAnswer));
      emit({ kind: 'session-end', outcome: 'success', at: nowIso() });

      return {
        result: makeExecutionResult({
          outcome: 'success',
          answer: finalAnswer,
          trace,
          usage,
          brainCalls,
        }),
        perTask,
      };
    },
  };
}
