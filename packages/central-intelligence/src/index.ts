/**
 * @borjie/central-intelligence — public surface.
 *
 * The embodied-agent layer. The organization and the industry speak
 * in first person, grounded in their own knowledge graphs, with
 * tool-using extended-thinking agency.
 *
 * Typical composition:
 *
 *   const agent = createCentralIntelligenceAgent({
 *     llm,                      // Claude / Anthropic adapter
 *     tools: createToolRegistry([
 *       makeGraphQueryTool(graphService),
 *       makeForecastTool(forecaster),
 *       makeAuditLookupTool(audit),
 *       makePlatformAggregateTool(dpAggregator),
 *       makeDocsSearchTool(vectorStore),
 *     ]),
 *     memory,                   // pgvector-backed memory in prod
 *     voice: createDefaultVoiceResolver(),
 *   });
 *
 *   for await (const event of agent.run({ threadId, userMessage, ctx })) {
 *     stream.write(event);      // SSE to client
 *   }
 */

export * from './types.js';
export {
  createCentralIntelligenceAgent,
  type AgentLoopDeps,
  type VoiceResolver,
} from './agent/agent-loop.js';
export { createToolRegistry } from './tools/registry.js';
export { createInMemoryConversationMemory } from './memory/in-memory-memory.js';
export {
  createDefaultVoiceResolver,
  createInMemoryVoicePersonaSource,
  DEFAULT_TENANT_BINDING,
  DEFAULT_PLATFORM_BINDING,
  type VoicePersonaSource,
} from './voice/resolver.js';
export {
  createConversationAuditRecorder,
  summariseToolCall,
  PLATFORM_AUDIT_TENANT_ID,
  type AuditSink,
  type AuditSinkInput,
  type ConversationAuditEvent,
  type ConversationAuditRecorder,
  type ConversationAuditRecorderDeps,
  type UserMessageEvent,
  type ToolCallAuditSummary,
  type AuditKnownTool,
} from './audit/conversation-audit.js';
export {
  createInMemoryAuditSinkAndReader,
  type ConversationAuditReader,
  type ConversationAuditRecord,
} from './audit/conversation-audit-reader.js';

// Kernel — disciplined cognitive layer above the streaming agent loop.
// See kernel/index.ts for the full surface; mirrors LITFIN's brain-
// kernel patterns scoped to property management. Flat-exported so
// consumers can `import { composeSovereign, createAnthropicSensor,
// SOVEREIGN_ADMIN_PERSONA } from '@borjie/central-intelligence'`
// without a namespace hop.
export * from './kernel/index.js';

// Namespace exports (`agency`, `autonomy`, `counterModel`,
// `orchestrator`, `powerTools`) must be re-exported explicitly —
// `export * from` does NOT carry over `export * as <ns>` declarations.
export {
  agency,
  autonomy,
  counterModel,
  orchestrator,
  powerTools,
} from './kernel/index.js';

// Durable-execution wrapper around the legacy task-agents executor.
// Opt-in via `DURABLE_EXEC_ENABLED=true`; backward-compatible no-op
// otherwise. Env vars: INNGEST_EVENT_KEY (producer), INNGEST_SIGNING_KEY
// (consumer), DURABLE_EXEC_ENABLED (master kill-switch). See
// `./durable/index.ts` for the full surface.
export * from './durable/index.js';

// V8-isolate JS sandbox — primitive for safely evaluating arbitrary JS
// snippets surfaced by tool calls. See kernel/sandbox/index.ts.
export * from './kernel/sandbox/index.js';

// Policy Gate — Constitution v2 reason-based tier-policy resolver for
// the `md:*` action namespace. See policy-gate/index.ts for the full
// surface (assertTierPolicy, assertApproved, HIGH_RISK_LITERAL_ONLY_PREFIXES).
export * from './policy-gate/index.js';

// Wave KNOWLEDGE-HANDOFF — cross-role @mention handoff chain. Wires the
// brain's `<chat_handoff />` SSE tag through a hash-chained recorder so
// owner ↔ manager ↔ worker ↔ buyer conversations carry context fluidly
// with persona-aware routing and audit-trail guarantees. See
// handoff/index.ts for the full surface (parseChatHandoffs,
// createHandoffRecorder, HandoffError, HANDOFF_PERSONA_ROLES).
export * from './handoff/index.js';

// Brain SSE tag protocol — `<tab_spawn>`, `<tab_update>`,
// `<tab_remove>`, `<tab_proposal>`. CT-1 of the dynamic chat-driven tab
// CRUD surface. The gateway feeds raw model text through
// `extractTabTags(...)` and pipes the result to the owner-tabs route
// for persistence + cockpit bus broadcast. See sse-tags/tab-tags.ts.
export * from './sse-tags/index.js';
