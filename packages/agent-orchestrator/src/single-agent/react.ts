/**
 * ReAct (Reasoning + Acting) — Yao et al. 2022, still the 2026 default
 * baseline for tool-using agents (BFCL v4).
 *
 * Loop:
 *   thought → action (tool call) → observation → thought → ...
 *
 * Termination conditions:
 *   - brain emits `stopReason === 'end_turn'` with no tool calls
 *   - maxSteps reached
 *   - tool throws after retries (caller decides whether to fail)
 *
 * Pure function. Injects `BrainPort` + `ToolPort[]`. No side-effects
 * other than calling those ports.
 */

import type {
  AgentSpec,
  BrainCallRequest,
  BrainMessage,
  BrainPort,
  BrainTool,
  ExecutionResult,
  ExecutionTraceEntry,
  Task,
  ToolPort,
  TokenUsage,
} from '../types.js';
import { addUsage, emptyUsage } from '../types.js';
import {
  action,
  finalEntry,
  makeExecutionResult,
  observation,
  thought,
} from '../internal/trace.js';

export interface RunReActInput {
  readonly agent: AgentSpec;
  readonly task: Task;
  readonly tools: ReadonlyArray<ToolPort>;
  readonly brain: BrainPort;
  readonly maxSteps?: number;
  /** Optional initial assistant context (e.g. retrieved memory). */
  readonly preamble?: string;
}

export const DEFAULT_REACT_MAX_STEPS = 12;

export async function runReAct(input: RunReActInput): Promise<ExecutionResult> {
  const maxSteps = input.maxSteps ?? DEFAULT_REACT_MAX_STEPS;
  const trace: ExecutionTraceEntry[] = [];
  let usage: TokenUsage = emptyUsage();
  let brainCalls = 0;

  const toolMap = new Map<string, ToolPort>(input.tools.map((t) => [t.name, t]));
  const brainTools: ReadonlyArray<BrainTool> = input.tools
    .filter((t) => input.agent.toolAllowlist.includes(t.name))
    .map((t) => Object.freeze({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

  const messages: BrainMessage[] = [];
  if (input.preamble) {
    messages.push({ role: 'assistant', content: input.preamble });
  }
  messages.push({
    role: 'user',
    content: renderTask(input.task),
  });

  for (let step = 0; step < maxSteps; step++) {
    const req: BrainCallRequest = {
      system: input.agent.systemPrompt,
      messages,
      tools: brainTools,
      traceTag: `react:${input.agent.id}:step-${step}`,
    };
    const response = await input.brain.call(req);
    brainCalls += 1;
    usage = addUsage(usage, response.usage);

    if (response.text) {
      trace.push(thought(response.text, input.agent.id));
    }

    if (response.stopReason === 'budget_exceeded') {
      return finish(trace, response.text, usage, brainCalls, 'budget-exhausted', 'brain reported budget exceeded');
    }

    if (response.toolCalls.length === 0) {
      // End-of-turn: the model gave a final answer.
      trace.push(finalEntry(response.text, input.agent.id));
      return finish(trace, response.text, usage, brainCalls, 'success');
    }

    // Append the assistant's tool-calling turn so subsequent ones see history.
    messages.push({
      role: 'assistant',
      content: response.text,
    });

    for (const call of response.toolCalls) {
      const tool = toolMap.get(call.name);
      trace.push(action(`${call.name}(${stringify(call.input)})`, input.agent.id));
      if (!tool) {
        const errMsg = `tool not found: ${call.name}`;
        trace.push(observation(`error: ${errMsg}`, input.agent.id));
        messages.push({
          role: 'tool',
          content: errMsg,
          name: call.name,
          toolCallId: call.id,
        });
        continue;
      }
      try {
        const out = await tool.execute(call.input);
        const outStr = stringify(out);
        trace.push(observation(outStr, input.agent.id));
        messages.push({
          role: 'tool',
          content: outStr,
          name: call.name,
          toolCallId: call.id,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        trace.push(observation(`error: ${errMsg}`, input.agent.id));
        messages.push({
          role: 'tool',
          content: `error: ${errMsg}`,
          name: call.name,
          toolCallId: call.id,
        });
      }
    }
  }

  return finish(
    trace,
    extractLastAssistant(trace) ?? '',
    usage,
    brainCalls,
    'failed',
    `maxSteps ${maxSteps} exhausted without terminal answer`,
  );
}

function renderTask(task: Task): string {
  if (!task.inputs || Object.keys(task.inputs).length === 0) {
    return task.description;
  }
  return `${task.description}\n\nInputs:\n${JSON.stringify(task.inputs, null, 2)}`;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractLastAssistant(trace: ReadonlyArray<ExecutionTraceEntry>): string | null {
  for (let i = trace.length - 1; i >= 0; i--) {
    const entry = trace[i];
    if (entry && entry.kind === 'thought') return entry.detail;
  }
  return null;
}

function finish(
  trace: ReadonlyArray<ExecutionTraceEntry>,
  answer: string,
  usage: TokenUsage,
  brainCalls: number,
  outcome: ExecutionResult['outcome'],
  reason?: string,
): ExecutionResult {
  return reason !== undefined
    ? makeExecutionResult({ outcome, answer, trace, usage, brainCalls, reason })
    : makeExecutionResult({ outcome, answer, trace, usage, brainCalls });
}
