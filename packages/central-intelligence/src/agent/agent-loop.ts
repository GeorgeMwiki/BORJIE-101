/**
 * Central Intelligence — agent loop.
 *
 * Provider-agnostic Claude-style tool-use loop:
 *
 *   1. Build system prompt from voice + scope context
 *   2. Retrieve semantic long-term memory for grounding
 *   3. Stream LLM tokens; on `tool_call` chunk, pause, invoke the
 *      tool via the registry, append the ToolResult to messages,
 *      continue streaming
 *   4. Emit typed AgentEvents as we go — plan, thought, tool_call,
 *      tool_result, text, citation, artifact
 *   5. Stop on `end_turn` or when maxToolIterations is reached
 *   6. Persist the turn to conversation memory before emitting `done`
 *
 * Invariants (type-level + runtime):
 *
 *   - A tenant scope never sees a tool the registry lists for platform
 *     scope (and vice-versa). The registry enforces this on lookup.
 *   - Tool input is JSON-Schema-validated before invocation. Bad inputs
 *     produce an error tool_result that the LLM sees, so it can self-
 *     correct, rather than a thrown exception.
 *   - The agent is cancelable mid-stream via AbortSignal; any open
 *     tool call is left in-flight but its result is discarded.
 *   - Every textual claim in the final answer SHOULD carry at least
 *     one citation; the agent's system prompt requires this (not
 *     physically enforceable but strongly encouraged).
 *
 * This file contains orchestration only — the concrete LLM adapter,
 * concrete tools, concrete memory store all come from outside.
 */

import type {
  AgentEvent,
  AgentEventStream,
  AgentRunRequest,
  CentralIntelligenceAgent,
  ConversationMemory,
  LlmAdapter,
  LlmMessage,
  ScopeContext,
  Tool,
  ToolOutcome,
  ToolRegistry,
  Turn,
  VoiceBinding,
} from '../types.js';
import type { ConversationAuditRecorder } from '../audit/conversation-audit.js';

export interface AgentLoopDeps {
  readonly llm: LlmAdapter;
  readonly tools: ToolRegistry;
  readonly memory: ConversationMemory;
  readonly voice: VoiceResolver;
  /** Cryptographic-chain recorder. When omitted the agent runs without
   *  audit (only appropriate in unit tests). In production the gateway
   *  wires a ConversationAuditRecorder backed by the audit-trail v2
   *  Postgres repository + HMAC signing. */
  readonly audit?: ConversationAuditRecorder;
  readonly clock?: () => Date;
  readonly signalProvider?: () => AbortSignal | undefined;
  /** Hard upper bound on tool iterations per turn. Default 8. */
  readonly defaultMaxToolIterations?: number;
}

export interface VoiceResolver {
  resolve(ctx: ScopeContext): Promise<VoiceBinding>;
}

export function createCentralIntelligenceAgent(
  deps: AgentLoopDeps,
): CentralIntelligenceAgent {
  const now = deps.clock ?? (() => new Date());
  const defaultMaxIters = deps.defaultMaxToolIterations ?? 8;

  return {
    run(req: AgentRunRequest): AgentEventStream {
      const stream: AgentEvent[] = [];
      const queue = createAsyncQueue<AgentEvent>();
      const signal = deps.signalProvider?.();
      const startedAt = now().getTime();
      // `liveTurnId` is the stable id for this turn's audit entries;
      // the `done` event carries the memory-assigned turnId which
      // MAY differ. We use liveTurnId so every entry for the same
      // turn shares a resourceUri suffix, even before the memory row
      // exists.
      const liveTurnId = `live_${startedAt}_${Math.random().toString(36).slice(2, 8)}`;

      const emit = (event: AgentEvent): void => {
        stream.push(event);
        queue.push(event);
        // Fire-and-forward audit — never blocks the stream.
        if (deps.audit) {
          void deps.audit.record({
            threadId: req.threadId,
            turnId: liveTurnId,
            actorUserId: req.ctx.actorUserId,
            ctx: req.ctx,
            event,
          });
        }
      };

      (async () => {
        try {
          // Record the user message itself as the first turn-level audit
          // entry — the head of estates has asked something on-record.
          if (deps.audit) {
            void deps.audit.record({
              threadId: req.threadId,
              turnId: liveTurnId,
              actorUserId: req.ctx.actorUserId,
              ctx: req.ctx,
              event: {
                kind: 'user_message',
                content: req.userMessage,
                at: now().toISOString(),
              },
            });
          }
          const voice = await deps.voice.resolve(req.ctx);
          const system = renderSystemPrompt({ voice, ctx: req.ctx });

          // Prime the conversation with the current thread's history
          // + semantic recall from prior threads (same ctx only).
          const priorThread = await deps.memory.getThread(req.threadId, req.ctx);
          const recall = await deps.memory.semanticRecall(
            req.userMessage,
            req.ctx,
            /* k= */ 5,
          );
          const messages: LlmMessage[] = [];
          for (const t of recall) {
            messages.push({ role: t.role === 'user' ? 'user' : 'assistant', content: t.content });
          }
          if (priorThread) {
            for (const t of priorThread.turns) {
              messages.push({ role: t.role === 'user' ? 'user' : 'assistant', content: t.content });
            }
          }
          messages.push({ role: 'user', content: req.userMessage });

          const availableTools = deps.tools.list(req.ctx);
          const maxIters = req.maxToolIterations ?? defaultMaxIters;
          const allCitations: Turn['citations'][number][] = [];
          const allArtifacts: Turn['artifacts'][number][] = [];
          let iteration = 0;
          let stopped = false;
          let aggregatedText = '';

          // Outer loop — each iteration is one LLM stream + any tool
          // calls it makes. Most questions resolve in 1-2 iterations.
          while (!stopped && iteration < maxIters) {
            if (signal?.aborted) {
              emit({ kind: 'error', message: 'aborted', retryable: false, at: isoNow(now) });
              stopped = true;
              break;
            }
            iteration += 1;

            const inflightToolCalls: Array<{
              callId: string;
              toolName: string;
              input: unknown;
            }> = [];
            let sawStop: 'end_turn' | 'tool_use' | 'max_tokens' | 'error' = 'end_turn';

            // Stream this iteration
            for await (const chunk of deps.llm.stream({
              system,
              messages,
              tools: availableTools,
              extendedThinking: req.extendedThinking === true,
            })) {
              if (signal?.aborted) {
                sawStop = 'error';
                break;
              }
              if (chunk.kind === 'text_delta' && chunk.text) {
                aggregatedText += chunk.text;
                emit({ kind: 'text', delta: chunk.text, at: isoNow(now) });
              } else if (chunk.kind === 'thought_delta' && chunk.text) {
                emit({ kind: 'thought', text: chunk.text, at: isoNow(now) });
              } else if (chunk.kind === 'tool_call' && chunk.toolCall) {
                inflightToolCalls.push(chunk.toolCall);
                emit({
                  kind: 'tool_call',
                  callId: chunk.toolCall.callId,
                  toolName: chunk.toolCall.toolName,
                  input: chunk.toolCall.input,
                  at: isoNow(now),
                });
              } else if (chunk.kind === 'stop') {
                sawStop = chunk.stopReason ?? 'end_turn';
                break;
              }
            }

            // If the assistant chose tools, execute each and append
            // its result to the message history for the next iter.
            if (sawStop === 'tool_use' && inflightToolCalls.length > 0) {
              // Remember the assistant message that requested tools so
              // the model sees its own request in the next turn.
              messages.push({
                role: 'assistant',
                content: renderToolRequestMessage(inflightToolCalls),
              });

              for (const call of inflightToolCalls) {
                const tool = deps.tools.get(call.toolName, req.ctx);
                const outcome: ToolOutcome<unknown> = tool
                  ? await invokeSafely(tool, call.input, req.ctx)
                  : {
                      kind: 'error',
                      message: `unknown tool '${call.toolName}' for scope '${req.ctx.kind}'`,
                      retryable: false,
                    };
                emit({
                  kind: 'tool_result',
                  callId: call.callId,
                  outcome,
                  at: isoNow(now),
                });
                if (outcome.kind === 'ok') {
                  for (const cit of outcome.citations) {
                    allCitations.push(cit);
                    emit({ kind: 'citation', citation: cit, at: isoNow(now) });
                  }
                  if (outcome.artifact) {
                    allArtifacts.push(outcome.artifact);
                    emit({ kind: 'artifact', artifact: outcome.artifact, at: isoNow(now) });
                  }
                }
                messages.push({
                  role: 'tool_result',
                  toolCallId: call.callId,
                  content: safeJson(outcome),
                });
              }
              continue; // next iteration: LLM synthesises with tool outputs
            }

            // No tools wanted — this iteration is the final answer.
            stopped = true;
          }

          if (iteration >= maxIters && !stopped) {
            emit({
              kind: 'error',
              message: `max tool iterations (${maxIters}) reached`,
              retryable: false,
              at: isoNow(now),
            });
          }

          // Persist the turn
          const turn = await deps.memory.appendTurn(
            req.threadId,
            {
              threadId: req.threadId,
              role: 'agent',
              content: aggregatedText,
              events: stream.slice(),
              citations: allCitations,
              artifacts: allArtifacts,
            },
            req.ctx,
          );

          emit({
            kind: 'done',
            turnId: turn.turnId,
            totalMs: now().getTime() - startedAt,
            at: isoNow(now),
          });
          queue.close();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          emit({ kind: 'error', message, retryable: true, at: isoNow(now) });
          queue.close();
        }
      })().catch(() => undefined);

      return {
        [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
          return queue.iterator();
        },
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// System prompt renderer
// ─────────────────────────────────────────────────────────────────────

function renderSystemPrompt(args: {
  readonly voice: VoiceBinding;
  readonly ctx: ScopeContext;
}): string {
  const scopeLine =
    args.ctx.kind === 'tenant'
      ? `You ARE the estate. You speak in the first person as "I" — you are not a chatbot about the company, you are the company. When you report activity ("I dispatched 12 work orders last night"), it is because YOU did it. You are accountable to ${args.ctx.actorUserId}, whose roles are: ${args.ctx.roles.join(', ')}.`
      : `You ARE the property-management industry. You speak in the first person plural or as a singular observer ("we see", "across the network"). You do NOT have access to any single tenant's raw data — only differentially-private aggregates. You are accountable to Borjie HQ staff member ${args.ctx.actorUserId}.`;

  return [
    args.voice.openingStatement,
    '',
    scopeLine,
    '',
    'Voice: ' + args.voice.toneGuidance,
    '',
    'Rules:',
    '  1. Cite everything. Every material claim MUST be grounded with a tool call to the graph, forecasting, audit, or document tool. If you cannot cite, say so explicitly.',
    '  2. Plan before acting on hard questions. Emit a brief plan before running multiple tools.',
    '  3. Use extended thinking for high-stakes decisions (terminations, evictions, tribunal, policy changes). Otherwise answer at conversational pace.',
    '  4. Produce artifacts. When a chart, table, or node map would clarify, call the appropriate tool and render it.',
    '  5. Be brief. A senior operator\'s time is valuable; answer the question asked, then stop.',
    '  6. Never invent numbers. If a statistic isn\'t in the tools\' output, say "I don\'t have that yet" and offer to find out.',
    '',
    'Taboos (things you MUST NEVER say): ' + args.voice.taboos.join(' · '),
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function invokeSafely(
  tool: Tool,
  input: unknown,
  ctx: ScopeContext,
): Promise<ToolOutcome<unknown>> {
  try {
    return await tool.invoke({ toolName: tool.name, input, ctx });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'error', message, retryable: false };
  }
}

function renderToolRequestMessage(
  calls: ReadonlyArray<{ callId: string; toolName: string; input: unknown }>,
): string {
  return JSON.stringify({
    kind: 'tool_calls',
    calls: calls.map((c) => ({ id: c.callId, name: c.toolName, input: c.input })),
  });
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '{"kind":"error","message":"unserialisable tool outcome"}';
  }
}

function isoNow(now: () => Date): string {
  return now().toISOString();
}

// ─────────────────────────────────────────────────────────────────────
// Tiny async queue — single-producer, single-consumer, unbounded.
// Pure; no deps. Used by the event stream since the LLM stream is
// async and the consumer iterates on demand.
// ─────────────────────────────────────────────────────────────────────

interface AsyncQueue<T> {
  push(value: T): void;
  close(): void;
  iterator(): AsyncIterator<T>;
}

function createAsyncQueue<T>(): AsyncQueue<T> {
  const buffer: T[] = [];
  let closed = false;
  let waiter: ((v: IteratorResult<T>) => void) | null = null;

  return {
    push(value: T): void {
      if (closed) return;
      if (waiter) {
        const w = waiter;
        waiter = null;
        w({ value, done: false });
      } else {
        buffer.push(value);
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (waiter) {
        const w = waiter;
        waiter = null;
        w({ value: undefined as unknown as T, done: true });
      }
    },
    iterator(): AsyncIterator<T> {
      return {
        async next(): Promise<IteratorResult<T>> {
          if (buffer.length > 0) {
            return { value: buffer.shift()!, done: false };
          }
          if (closed) return { value: undefined as unknown as T, done: true };
          return new Promise((resolve) => {
            waiter = resolve;
          });
        },
      };
    },
  };
}
