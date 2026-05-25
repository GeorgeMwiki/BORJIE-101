/**
 * Swarm pattern (OpenAI Swarm — Apr 2025 OSS release).
 *
 * Lightweight handoff-based multi-agent runtime. A user message lands
 * on the `defaultAgent`. After each turn the runtime checks the
 * agent's `handoffRules`: if any predicate matches the most recent
 * agent message, the runtime hands off to the named target agent.
 *
 * Looping protection: each handoff is recorded, and the loop is
 * bounded by `maxTurns` + per-pair handoff cycle detection so two
 * agents cannot ping-pong forever.
 */

import type {
  AgentSpec,
  BrainPort,
  ExecutionResult,
  ExecutionTraceEntry,
  Handoff,
  OrchestratorEvent,
  Task,
  TokenUsage,
} from '../types.js';
import { addUsage, emptyUsage, HandoffLoopError, nowIso } from '../types.js';
import { finalEntry, handoffEntry, makeExecutionResult, thought } from '../internal/trace.js';

export type HandoffPredicate = (lastMessage: string, history: ReadonlyArray<{ readonly agentId: string; readonly content: string }>) => Handoff | null;

export interface HandoffRule {
  /** Source agent this rule applies to. */
  readonly fromAgentId: string;
  /** Predicate; null = no handoff. */
  readonly predicate: HandoffPredicate;
}

export interface CreateSwarmInput {
  readonly agents: ReadonlyArray<AgentSpec>;
  readonly defaultAgent: string;
  readonly handoffRules: ReadonlyArray<HandoffRule>;
  readonly brain: BrainPort;
  readonly maxTurns?: number;
  /** Callback for streaming consumer (UI, audit, etc.) */
  readonly onEvent?: (event: OrchestratorEvent) => void;
}

export interface SwarmRuntime {
  run(task: Task): Promise<ExecutionResult>;
}

export const DEFAULT_SWARM_MAX_TURNS = 10;

export function createSwarm(input: CreateSwarmInput): SwarmRuntime {
  const maxTurns = input.maxTurns ?? DEFAULT_SWARM_MAX_TURNS;
  const agentMap = new Map<string, AgentSpec>(input.agents.map((a) => [a.id, a]));
  if (!agentMap.has(input.defaultAgent)) {
    throw new Error(`defaultAgent ${input.defaultAgent} not in agents list`);
  }
  const rulesByAgent = groupBy(input.handoffRules, (r) => r.fromAgentId);

  function emit(ev: OrchestratorEvent) {
    if (input.onEvent) input.onEvent(ev);
  }

  return {
    async run(task: Task): Promise<ExecutionResult> {
      const sessionId = `swarm-${Date.now()}`;
      emit({ kind: 'session-start', sessionId, at: nowIso() });

      const trace: ExecutionTraceEntry[] = [];
      const history: { agentId: string; content: string }[] = [];
      let usage: TokenUsage = emptyUsage();
      let brainCalls = 0;
      let currentAgentId = input.defaultAgent;
      const handoffEdges = new Set<string>();

      let userInput = task.description;

      for (let turn = 0; turn < maxTurns; turn++) {
        const agent = agentMap.get(currentAgentId);
        if (!agent) {
          return makeExecutionResult({
            outcome: 'failed',
            answer: '',
            trace,
            usage,
            brainCalls,
            reason: `agent ${currentAgentId} not found`,
          });
        }

        const resp = await input.brain.call({
          system: agent.systemPrompt,
          messages: [
            ...history.map((h) => ({ role: 'assistant' as const, content: `[${h.agentId}] ${h.content}` })),
            { role: 'user', content: userInput },
          ],
          traceTag: `swarm:${agent.id}:turn-${turn}`,
        });
        brainCalls += 1;
        usage = addUsage(usage, resp.usage);

        const content = resp.text;
        history.push({ agentId: agent.id, content });
        trace.push(thought(content, agent.id));
        emit({ kind: 'message', agentId: agent.id, content, at: nowIso() });

        // Apply handoff rules for this agent.
        const rules = rulesByAgent.get(agent.id) ?? [];
        let handoff: Handoff | null = null;
        for (const r of rules) {
          handoff = r.predicate(content, history);
          if (handoff) break;
        }

        if (!handoff) {
          // No handoff -> terminal.
          trace.push(finalEntry(content, agent.id));
          emit({ kind: 'session-end', outcome: 'success', at: nowIso() });
          return makeExecutionResult({ outcome: 'success', answer: content, trace, usage, brainCalls });
        }

        const edgeKey = `${agent.id}->${handoff.toAgentId}`;
        if (handoffEdges.has(edgeKey)) {
          // Already used this edge — possible loop.
          throw new HandoffLoopError(`handoff loop detected: ${edgeKey}`);
        }
        handoffEdges.add(edgeKey);
        if (!agentMap.has(handoff.toAgentId)) {
          return makeExecutionResult({
            outcome: 'failed',
            answer: content,
            trace,
            usage,
            brainCalls,
            reason: `handoff target ${handoff.toAgentId} not in swarm`,
          });
        }
        trace.push(handoffEntry(`${agent.id} → ${handoff.toAgentId}: ${handoff.reason}`));
        emit({
          kind: 'handoff',
          fromAgentId: agent.id,
          toAgentId: handoff.toAgentId,
          reason: handoff.reason,
          at: nowIso(),
        });
        currentAgentId = handoff.toAgentId;
        userInput = `Handoff from ${agent.id}: ${handoff.reason}`;
      }

      emit({ kind: 'session-end', outcome: 'failed', at: nowIso() });
      return makeExecutionResult({
        outcome: 'failed',
        answer: '',
        trace,
        usage,
        brainCalls,
        reason: `maxTurns ${maxTurns} exceeded`,
      });
    },
  };
}

function groupBy<T, K>(items: ReadonlyArray<T>, keyFn: (t: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}
