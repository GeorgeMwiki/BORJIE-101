/**
 * Group chat (AutoGen 0.6 / Microsoft).
 *
 * Two routing modes:
 *
 *   - `round-robin`: agents speak in fixed rotation
 *   - `manager-routed`: a manager agent picks the next speaker
 *
 * Termination: `maxRounds` (turns-per-agent), an agent emits a
 * terminator string ("TERMINATE" by default), or `shouldStop`
 * predicate returns true.
 */

import type {
  AgentSpec,
  BrainPort,
  ExecutionResult,
  GroupChatMessage,
  GroupChatState,
  OrchestratorEvent,
  Task,
  TokenUsage,
} from '../types.js';
import { addUsage, emptyUsage, nowIso } from '../types.js';
import { finalEntry, makeExecutionResult, thought } from '../internal/trace.js';

export type GroupChatMode =
  | { readonly kind: 'round-robin' }
  | { readonly kind: 'manager-routed'; readonly managerAgentId: string };

export interface CreateGroupChatInput {
  readonly agents: ReadonlyArray<AgentSpec>;
  readonly mode: GroupChatMode;
  readonly brain: BrainPort;
  /** Inclusive cap on TOTAL turns across the chat (not per-agent). */
  readonly maxRounds: number;
  /** Token an agent emits to end the chat. */
  readonly terminator?: string;
  /** Optional caller-supplied termination predicate. */
  readonly shouldStop?: (state: GroupChatState) => boolean;
  readonly onEvent?: (event: OrchestratorEvent) => void;
}

export interface GroupChatRuntime {
  run(task: Task): Promise<{ result: ExecutionResult; state: GroupChatState }>;
}

export const DEFAULT_TERMINATOR = 'TERMINATE';

export function createGroupChat(input: CreateGroupChatInput): GroupChatRuntime {
  if (input.agents.length === 0) throw new Error('agents must be non-empty');
  if (input.maxRounds < 1) throw new Error('maxRounds must be >= 1');
  const terminator = input.terminator ?? DEFAULT_TERMINATOR;
  const agentMap = new Map(input.agents.map((a) => [a.id, a]));

  if (input.mode.kind === 'manager-routed' && !agentMap.has(input.mode.managerAgentId)) {
    throw new Error(`managerAgentId ${input.mode.managerAgentId} not in agents`);
  }

  function emit(ev: OrchestratorEvent) {
    if (input.onEvent) input.onEvent(ev);
  }

  return {
    async run(task: Task) {
      const sessionId = `groupchat-${Date.now()}`;
      emit({ kind: 'session-start', sessionId, at: nowIso() });

      const messages: GroupChatMessage[] = [];
      let usage: TokenUsage = emptyUsage();
      let brainCalls = 0;
      let round = 0;
      let finished = false;
      let finishReason: string | undefined;

      // Seed user message ascribed to a synthetic "user" agent.
      messages.push({ agentId: 'user', content: task.description, at: nowIso() });

      let speakerIdx = 0;

      while (round < input.maxRounds && !finished) {
        // Choose next speaker.
        let nextAgentId: string;
        if (input.mode.kind === 'round-robin') {
          const a = input.agents[speakerIdx % input.agents.length];
          if (!a) break;
          nextAgentId = a.id;
          speakerIdx += 1;
        } else {
          // Manager-routed: ask the manager who should speak.
          const manager = agentMap.get(input.mode.managerAgentId);
          if (!manager) break;
          const managerResp = await input.brain.call({
            system: `${manager.systemPrompt}\n\nDecide which agent should speak next. Reply with ONLY the agent id from: ${input.agents.map((a) => a.id).join(', ')}.`,
            messages: [
              { role: 'user', content: renderTranscript(messages) },
            ],
            temperature: 0,
            traceTag: `groupchat:manager:round-${round}`,
          });
          brainCalls += 1;
          usage = addUsage(usage, managerResp.usage);
          const trimmed = managerResp.text.trim();
          const found = input.agents.find((a) => a.id === trimmed);
          if (!found) {
            // Fall back to first agent if manager picks an unknown id.
            const fallback = input.agents[0];
            if (!fallback) break;
            nextAgentId = fallback.id;
          } else {
            nextAgentId = found.id;
          }
        }

        const agent = agentMap.get(nextAgentId);
        if (!agent) break;
        const agentResp = await input.brain.call({
          system: agent.systemPrompt,
          messages: [
            { role: 'user', content: renderTranscript(messages) },
          ],
          traceTag: `groupchat:${agent.id}:round-${round}`,
        });
        brainCalls += 1;
        usage = addUsage(usage, agentResp.usage);

        const content = agentResp.text;
        messages.push({ agentId: agent.id, content, at: nowIso() });
        emit({ kind: 'message', agentId: agent.id, content, at: nowIso() });

        round += 1;

        if (content.includes(terminator)) {
          finished = true;
          finishReason = `terminator '${terminator}' found`;
        }

        if (!finished && input.shouldStop) {
          if (input.shouldStop({ messages, round, finished: false })) {
            finished = true;
            finishReason = 'shouldStop predicate returned true';
          }
        }
      }

      if (!finished) {
        finishReason = `maxRounds ${input.maxRounds} reached`;
      }

      const state: GroupChatState = {
        messages,
        round,
        finished,
        ...(finishReason !== undefined ? { finishReason } : {}),
      };
      const finalMessage = messages.at(-1);
      const answer = finalMessage ? finalMessage.content : '';
      const trace = messages.map((m) => thought(m.content, m.agentId));
      trace.push(finalEntry(answer, finalMessage?.agentId));

      emit({ kind: 'session-end', outcome: 'success', at: nowIso() });
      const result = makeExecutionResult({
        outcome: 'success',
        answer,
        trace,
        usage,
        brainCalls,
        ...(finishReason !== undefined ? { reason: finishReason } : {}),
      });
      return { result, state };
    },
  };
}

function renderTranscript(messages: ReadonlyArray<GroupChatMessage>): string {
  return messages.map((m) => `[${m.agentId}] ${m.content}`).join('\n');
}
