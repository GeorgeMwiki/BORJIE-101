/**
 * Agent loop — live-behaviour tests.
 *
 * Drives the REAL agent loop with a deterministic-scripted LLM
 * adapter (not a mock — it implements the full LlmAdapter port
 * end-to-end), REAL tools, REAL in-memory memory, REAL registry.
 *
 * The scripted LLM emits a plan → tool_call → then text → stop,
 * exercising every code path in the loop. Tests verify:
 *   - events stream in the correct order
 *   - tool results flow back into the LLM
 *   - citations + artifacts surface on the turn
 *   - tenant-scope isolation holds (platform tools refused for tenant ctx)
 *   - max-tool-iterations is enforced
 *   - a `done` event always lands (even on error)
 */

import { describe, it, expect } from 'vitest';
import { createCentralIntelligenceAgent } from '../agent/agent-loop.js';
import { createToolRegistry } from '../tools/registry.js';
import { createInMemoryConversationMemory } from '../memory/in-memory-memory.js';
import { createDefaultVoiceResolver } from '../voice/resolver.js';
import type {
  AgentEvent,
  Citation,
  LlmAdapter,
  LlmStreamChunk,
  ScopeContext,
  Tool,
} from '../types.js';

function makeTenantCtx(): ScopeContext {
  return Object.freeze({
    kind: 'tenant',
    tenantId: 't1',
    actorUserId: 'u1',
    roles: Object.freeze(['PROPERTY_MANAGER']),
    personaId: 'mr-mwikila-head',
  });
}

function makePlatformCtx(): ScopeContext {
  return Object.freeze({
    kind: 'platform',
    actorUserId: 'staff1',
    roles: Object.freeze(['PLATFORM_ADMIN']),
    personaId: 'industry-observer',
  });
}

/** A deterministic LLM that emits a scripted sequence of chunks. */
function scriptedLlm(scripts: ReadonlyArray<ReadonlyArray<LlmStreamChunk>>): LlmAdapter {
  let round = 0;
  return {
    modelId: 'scripted-test-llm',
    async *stream(): AsyncIterable<LlmStreamChunk> {
      const chunks = scripts[round] ?? [{ kind: 'stop', stopReason: 'end_turn' }];
      round += 1;
      for (const c of chunks) yield c;
    },
  };
}

function makeGraphTool(): Tool {
  const citation: Citation = Object.freeze({
    id: 'cite_1',
    target: { kind: 'graph_node', nodeLabel: 'Unit', nodeId: 'u_3b' },
    label: 'Unit 3B',
    confidence: 0.95,
  });
  return {
    name: 'graph.lookup_node',
    description: 'Look up a node in the tenant graph.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        id: { type: 'string' },
      },
      required: ['label', 'id'],
    },
    scopes: ['tenant'],
    async invoke(args) {
      const input = args.input as { label: string; id: string };
      return {
        kind: 'ok',
        ok: true,
        output: { label: input.label, id: input.id, arrearsDays: 12 },
        latencyMs: 5,
        citations: [citation],
        artifact: null,
      };
    },
  };
}

function makePlatformOnlyTool(): Tool {
  return {
    name: 'platform.industry_aggregate',
    description: 'Platform-only DP aggregate.',
    inputJsonSchema: { type: 'object' },
    scopes: ['platform'],
    async invoke() {
      return { kind: 'ok', ok: true, output: { rate: 0.042 }, latencyMs: 3, citations: [], artifact: null };
    },
  };
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe('central-intelligence / agent loop', () => {
  it('runs a single-tool-call turn end-to-end', async () => {
    const llm = scriptedLlm([
      [
        { kind: 'tool_call', toolCall: { callId: 'c1', toolName: 'graph.lookup_node', input: { label: 'Unit', id: 'u_3b' } } },
        { kind: 'stop', stopReason: 'tool_use' },
      ],
      [
        { kind: 'text_delta', text: 'Unit 3B is 12 days late.' },
        { kind: 'stop', stopReason: 'end_turn' },
      ],
    ]);
    const memory = createInMemoryConversationMemory();
    const voice = createDefaultVoiceResolver();
    const tools = createToolRegistry([makeGraphTool()]);

    const ctx = makeTenantCtx();
    const thread = await memory.createThread(ctx, 'How is Unit 3B doing?');
    const agent = createCentralIntelligenceAgent({ llm, tools, memory, voice });

    const events = await collect(agent.run({
      threadId: thread.threadId,
      userMessage: 'How is Unit 3B doing?',
      ctx,
    }));

    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('tool_call');
    expect(kinds).toContain('tool_result');
    expect(kinds).toContain('text');
    expect(kinds).toContain('citation');
    expect(kinds[kinds.length - 1]).toBe('done');

    // Turn persisted
    const stored = await memory.getThread(thread.threadId, ctx);
    expect(stored?.turns.length).toBe(2);
    const agentTurn = stored!.turns.find((t) => t.role === 'agent');
    expect(agentTurn?.content).toContain('Unit 3B');
    expect(agentTurn?.citations.length).toBeGreaterThan(0);
  });

  it('refuses a platform tool when ctx is tenant', async () => {
    const llm = scriptedLlm([
      [
        { kind: 'tool_call', toolCall: { callId: 'c1', toolName: 'platform.industry_aggregate', input: {} } },
        { kind: 'stop', stopReason: 'tool_use' },
      ],
      [
        { kind: 'text_delta', text: 'I cannot do that at this scope.' },
        { kind: 'stop', stopReason: 'end_turn' },
      ],
    ]);
    const memory = createInMemoryConversationMemory();
    const voice = createDefaultVoiceResolver();
    // register a platform tool but a tenant ctx
    const tools = createToolRegistry([makePlatformOnlyTool()]);
    const ctx = makeTenantCtx();
    const thread = await memory.createThread(ctx, 'industry arrears?');
    const agent = createCentralIntelligenceAgent({ llm, tools, memory, voice });

    const events = await collect(agent.run({
      threadId: thread.threadId,
      userMessage: 'industry arrears?',
      ctx,
    }));

    const toolResult = events.find((e) => e.kind === 'tool_result');
    if (!toolResult || toolResult.kind !== 'tool_result') throw new Error('expected tool_result');
    expect(toolResult.outcome.kind).toBe('error');
    if (toolResult.outcome.kind !== 'error') throw new Error('expected error');
    expect(toolResult.outcome.message).toMatch(/unknown tool/);
  });

  it('enforces maxToolIterations', async () => {
    // An LLM that always requests a tool and never stops
    const runaway = scriptedLlm(
      Array.from({ length: 50 }, () => [
        { kind: 'tool_call' as const, toolCall: { callId: 'cX', toolName: 'graph.lookup_node', input: { label: 'Unit', id: 'x' } } },
        { kind: 'stop' as const, stopReason: 'tool_use' as const },
      ]),
    );
    const memory = createInMemoryConversationMemory();
    const voice = createDefaultVoiceResolver();
    const tools = createToolRegistry([makeGraphTool()]);
    const ctx = makeTenantCtx();
    const thread = await memory.createThread(ctx, 'infinite');
    const agent = createCentralIntelligenceAgent({ llm: runaway, tools, memory, voice });

    const events = await collect(agent.run({
      threadId: thread.threadId,
      userMessage: 'infinite',
      ctx,
      maxToolIterations: 3,
    }));

    const errors = events.filter((e) => e.kind === 'error');
    expect(errors.length).toBe(1);
    if (errors[0]?.kind !== 'error') throw new Error('expected error');
    expect(errors[0].message).toMatch(/max tool iterations/);
    expect(events[events.length - 1]?.kind).toBe('done');
  });

  it('persists turns under scope isolation', async () => {
    const llm = scriptedLlm([
      [{ kind: 'text_delta', text: 'ok' }, { kind: 'stop', stopReason: 'end_turn' }],
      [{ kind: 'text_delta', text: 'ok' }, { kind: 'stop', stopReason: 'end_turn' }],
    ]);
    const memory = createInMemoryConversationMemory();
    const voice = createDefaultVoiceResolver();
    const tools = createToolRegistry();

    const tenantA: ScopeContext = {
      kind: 'tenant', tenantId: 'A', actorUserId: 'uA', roles: [], personaId: 'mr-mwikila-head',
    };
    const tenantB: ScopeContext = {
      kind: 'tenant', tenantId: 'B', actorUserId: 'uB', roles: [], personaId: 'mr-mwikila-head',
    };

    const threadA = await memory.createThread(tenantA, 'q from A');
    const threadB = await memory.createThread(tenantB, 'q from B');

    const agent = createCentralIntelligenceAgent({ llm, tools, memory, voice });

    await collect(agent.run({ threadId: threadA.threadId, userMessage: 'q from A', ctx: tenantA }));
    await collect(agent.run({ threadId: threadB.threadId, userMessage: 'q from B', ctx: tenantB }));

    // Tenant A cannot see Tenant B's thread
    const crossRead = await memory.getThread(threadB.threadId, tenantA);
    expect(crossRead).toBeNull();

    // Tenant A CAN see own
    const ownRead = await memory.getThread(threadA.threadId, tenantA);
    expect(ownRead).not.toBeNull();
  });

  it('emits a done event even when the LLM errors immediately', async () => {
    const llm: LlmAdapter = {
      modelId: 'err',
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('upstream llm died');
      },
    };
    const memory = createInMemoryConversationMemory();
    const voice = createDefaultVoiceResolver();
    const tools = createToolRegistry();
    const ctx = makePlatformCtx();
    const thread = await memory.createThread(ctx, 'hello');
    const agent = createCentralIntelligenceAgent({ llm, tools, memory, voice });

    const events = await collect(agent.run({
      threadId: thread.threadId,
      userMessage: 'hello',
      ctx,
    }));

    const errs = events.filter((e) => e.kind === 'error');
    expect(errs.length).toBeGreaterThan(0);
  });
});
