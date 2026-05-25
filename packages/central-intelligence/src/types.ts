/**
 * @borjie/central-intelligence — public types.
 *
 * The Central Intelligence is the embodied first-person agent that
 * lets a head of estates "talk to their company" and lets Borjie
 * HQ "talk to the industry." Same architecture; two polymorphic
 * grounding scopes enforced at the type system.
 *
 * Core abstractions:
 *
 *   - ScopeContext       tenant | platform — determines which tools,
 *                        voice, and memory index the agent sees
 *   - Tool               a typed, auth-scoped operation the agent may
 *                        invoke (graph query, vector search, forecast,
 *                        audit lookup, SQL read, etc.)
 *   - ToolRegistry       supplies the tools available for a given ctx
 *   - AgentEvent         the streaming protocol — every thing the
 *                        agent emits is one of a closed set of typed
 *                        events (plan, thought, tool_call, tool_result,
 *                        text, citation, artifact, error, done)
 *   - Citation           a verifiable pointer to a graph node, a
 *                        forecast, an audit entry, a document, or a
 *                        platform-aggregate result. Every textual claim
 *                        SHOULD carry citations.
 *   - Artifact           a structured object (chart, table, plan,
 *                        node-map) the client renders alongside text
 *   - ConversationMemory short-term thread memory + long-term semantic
 *                        memory (vector store) + episodic (audit trail)
 *
 * Everything here is TYPES ONLY — no runtime, no side-effects.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Scope — the single lever that decides what the Central Intelligence
// can see. Re-uses the same kind discriminator as forecasting + graph-
// privacy so an AuthContext from any of those packages is directly
// assignable here.
// ─────────────────────────────────────────────────────────────────────

export type ScopeContext =
  | {
      readonly kind: 'tenant';
      readonly tenantId: string;
      readonly actorUserId: string;
      readonly roles: ReadonlyArray<string>;
      /** Persona id for first-person voice. E.g. 'mr-mwikila-head'. */
      readonly personaId: string;
    }
  | {
      readonly kind: 'platform';
      readonly actorUserId: string;
      readonly roles: ReadonlyArray<string>;
      /** Persona id for the industry's voice. E.g. 'industry-observer'. */
      readonly personaId: string;
    };

export const ScopeContextSchema: z.ZodType<ScopeContext> = z.discriminatedUnion(
  'kind',
  [
    z.object({
      kind: z.literal('tenant'),
      tenantId: z.string().min(1),
      actorUserId: z.string().min(1),
      roles: z.array(z.string()).readonly(),
      personaId: z.string().min(1),
    }),
    z.object({
      kind: z.literal('platform'),
      actorUserId: z.string().min(1),
      roles: z.array(z.string()).readonly(),
      personaId: z.string().min(1),
    }),
  ],
);

// ─────────────────────────────────────────────────────────────────────
// Citation — every textual claim SHOULD cite one or more grounded
// sources. The UI turns these into clickable chips that deep-link into
// the graph explorer, the audit trail, the document viewer, etc.
// ─────────────────────────────────────────────────────────────────────

export type CitationTarget =
  | { readonly kind: 'graph_node';         readonly nodeLabel: string; readonly nodeId: string }
  | { readonly kind: 'graph_edge';         readonly fromId: string; readonly edgeType: string; readonly toId: string }
  | { readonly kind: 'forecast';           readonly forecastId: string }
  | { readonly kind: 'audit_entry';        readonly entryId: string }
  | { readonly kind: 'document';           readonly documentId: string; readonly anchor?: string }
  | { readonly kind: 'conversation';       readonly threadId: string; readonly turnId: string }
  | { readonly kind: 'statute';            readonly jurisdiction: string; readonly statuteRef: string; readonly section: string }
  | { readonly kind: 'platform_aggregate'; readonly statistic: string; readonly sliceFingerprint: string };

export interface Citation {
  readonly id: string;
  readonly target: CitationTarget;
  /** Short human-readable label the UI renders inline. */
  readonly label: string;
  /** Confidence in [0,1] — how strongly this citation supports the
   *  preceding sentence. <0.6 renders as "maybe", ≥0.8 as solid. */
  readonly confidence: number;
}

// ─────────────────────────────────────────────────────────────────────
// Artifacts — rich structured objects the agent produces to show, not
// tell. The client renders them beside the text stream.
// ─────────────────────────────────────────────────────────────────────

export type ArtifactKind =
  | 'line_chart'
  | 'bar_chart'
  | 'scrubbable_chart'
  | 'node_map'
  | 'table'
  | 'plan'
  | 'forecast_card'
  | 'cohort_breakdown';

export interface Artifact {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly title: string;
  /** Opaque JSON the client schema-validates at the render boundary. */
  readonly data: unknown;
  /** Citations that collectively ground this artifact. */
  readonly citations: ReadonlyArray<Citation>;
  readonly createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────
// Tools — the agent's vocabulary of verbs. Each tool is typed end-to-
// end so an LLM tool-use schema is deterministic. Tools are
// registered per-ScopeContext: tenant ctx sees the tenant-tools; a
// platform ctx sees the platform-tools. NO tool is shared across
// scopes — enforced by the registry.
// ─────────────────────────────────────────────────────────────────────

export interface ToolInput<I> {
  readonly toolName: string;
  readonly input: I;
  readonly ctx: ScopeContext;
}

export interface ToolResult<O> {
  readonly ok: boolean;
  readonly output: O;
  readonly latencyMs: number;
  readonly citations: ReadonlyArray<Citation>;
  /** Optional artifact produced as a side effect. */
  readonly artifact: Artifact | null;
}

export type ToolOutcome<O> =
  | ({ readonly kind: 'ok' } & ToolResult<O>)
  | { readonly kind: 'error'; readonly message: string; readonly retryable: boolean };

export interface Tool<I = unknown, O = unknown> {
  readonly name: string;
  readonly description: string;
  /** JSON Schema (Draft-7) that the LLM uses to generate valid inputs. */
  readonly inputJsonSchema: Readonly<Record<string, unknown>>;
  /** Which ScopeContext kinds may invoke this tool. */
  readonly scopes: ReadonlyArray<ScopeContext['kind']>;
  /** Execute. MUST enforce any tenant-isolation / budget / audit
   *  invariants internally; the registry won't check them for you. */
  invoke(args: ToolInput<I>): Promise<ToolOutcome<O>>;
}

export interface ToolRegistry {
  /** List the tools allowed for the given ScopeContext. */
  list(ctx: ScopeContext): ReadonlyArray<Tool>;
  get(toolName: string, ctx: ScopeContext): Tool | null;
}

// ─────────────────────────────────────────────────────────────────────
// Conversation memory — short-term (current thread), long-term
// (semantic vector recall over past threads), episodic (audit trail
// of what the agent has DONE, not just said).
// ─────────────────────────────────────────────────────────────────────

export interface Thread {
  readonly threadId: string;
  readonly scope: ScopeContext;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly turnCount: number;
}

export interface Turn {
  readonly turnId: string;
  readonly threadId: string;
  readonly role: 'user' | 'agent';
  readonly content: string;
  readonly events: ReadonlyArray<AgentEvent>;
  readonly citations: ReadonlyArray<Citation>;
  readonly artifacts: ReadonlyArray<Artifact>;
  readonly createdAt: string;
}

export interface ConversationMemory {
  createThread(
    ctx: ScopeContext,
    seedUserMessage: string,
  ): Promise<Thread>;
  appendTurn(threadId: string, turn: Omit<Turn, 'turnId' | 'createdAt'>, ctx: ScopeContext): Promise<Turn>;
  listThreads(ctx: ScopeContext, limit: number): Promise<ReadonlyArray<Thread>>;
  getThread(threadId: string, ctx: ScopeContext): Promise<{ thread: Thread; turns: ReadonlyArray<Turn> } | null>;
  /** Semantic recall over past threads within the same ctx. Returns
   *  the top-k most relevant prior turns as grounding material. */
  semanticRecall(query: string, ctx: ScopeContext, k: number): Promise<ReadonlyArray<Turn>>;
}

// ─────────────────────────────────────────────────────────────────────
// Agent events — the streaming protocol. Every event is typed; the
// client and server speak the same closed union.
// ─────────────────────────────────────────────────────────────────────

export type AgentEvent =
  | { readonly kind: 'plan';         readonly steps: ReadonlyArray<string>; readonly at: string }
  | { readonly kind: 'thought';      readonly text: string; readonly at: string }
  | { readonly kind: 'tool_call';    readonly callId: string; readonly toolName: string; readonly input: unknown; readonly at: string }
  | { readonly kind: 'tool_result';  readonly callId: string; readonly outcome: ToolOutcome<unknown>; readonly at: string }
  | { readonly kind: 'text';         readonly delta: string; readonly at: string }
  | { readonly kind: 'citation';     readonly citation: Citation; readonly at: string }
  | { readonly kind: 'artifact';     readonly artifact: Artifact; readonly at: string }
  | { readonly kind: 'error';        readonly message: string; readonly retryable: boolean; readonly at: string }
  | { readonly kind: 'done';         readonly turnId: string; readonly totalMs: number; readonly at: string };

export interface AgentEventStream {
  /** Async iterator over events for a single turn. */
  [Symbol.asyncIterator](): AsyncIterator<AgentEvent>;
}

// ─────────────────────────────────────────────────────────────────────
// The agent itself — a function that turns (userMessage + thread
// context + scope) into a stream of events.
// ─────────────────────────────────────────────────────────────────────

export interface AgentRunRequest {
  readonly threadId: string;
  readonly userMessage: string;
  readonly ctx: ScopeContext;
  /** Optional override of the default max-iterations budget. */
  readonly maxToolIterations?: number;
  /** Engage extended thinking for this turn (high-stakes questions). */
  readonly extendedThinking?: boolean;
}

export interface CentralIntelligenceAgent {
  run(req: AgentRunRequest): AgentEventStream;
}

// ─────────────────────────────────────────────────────────────────────
// LLM port — the model provider. Keep this thin so Claude / Opus /
// Haiku / a fallback OSS model can all satisfy it.
// ─────────────────────────────────────────────────────────────────────

export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool_result';
  readonly content: string;
  /** For tool_result messages, the originating call id. */
  readonly toolCallId?: string;
}

export interface LlmToolCallRequest {
  readonly callId: string;
  readonly toolName: string;
  readonly input: unknown;
}

export interface LlmStreamChunk {
  readonly kind: 'text_delta' | 'thought_delta' | 'tool_call' | 'stop';
  readonly text?: string;
  readonly toolCall?: LlmToolCallRequest;
  readonly stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
}

export interface LlmAdapter {
  /** Stream a completion. The adapter handles tool-use formatting
   *  specific to its model provider; the agent loop is provider-
   *  agnostic. */
  stream(args: {
    readonly system: string;
    readonly messages: ReadonlyArray<LlmMessage>;
    readonly tools: ReadonlyArray<Tool>;
    readonly extendedThinking: boolean;
  }): AsyncIterable<LlmStreamChunk>;
  readonly modelId: string;
}

// ─────────────────────────────────────────────────────────────────────
// Voice — the first-person persona. At runtime, the system prompt is
// rendered from a pinned VoicePersona (pre-existing in voice-persona-
// dna) plus scope-specific opening conditions ("You are the estate of
// <tenantName>" vs. "You are the industry observer").
// ─────────────────────────────────────────────────────────────────────

export interface VoiceBinding {
  readonly personaId: string;
  readonly displayName: string;
  readonly openingStatement: string;
  readonly toneGuidance: string;
  readonly taboos: ReadonlyArray<string>;
}
