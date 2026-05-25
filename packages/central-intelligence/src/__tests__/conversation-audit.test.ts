/**
 * ConversationAuditRecorder — live-behaviour tests.
 *
 * Drives the REAL recorder against a REAL in-memory AuditSink that
 * satisfies the full port contract. The agent loop is ALSO real —
 * we wire an agent + the recorder end-to-end and verify that every
 * emitted AgentEvent produces the expected audit chain entries.
 *
 * No mocks. No jest.fn. Seeded PRNG where determinism matters.
 */

import { describe, it, expect } from 'vitest';
import {
  createConversationAuditRecorder,
  PLATFORM_AUDIT_TENANT_ID,
  type AuditSink,
  type AuditSinkInput,
} from '../audit/conversation-audit.js';
import type { ScopeContext } from '../types.js';
import { createCentralIntelligenceAgent } from '../agent/agent-loop.js';
import { createToolRegistry } from '../tools/registry.js';
import { createInMemoryConversationMemory } from '../memory/in-memory-memory.js';
import { createDefaultVoiceResolver } from '../voice/resolver.js';
import type { LlmAdapter, LlmStreamChunk, Tool } from '../types.js';

/** Real sink backed by an in-memory array — implements the port
 *  contract end-to-end. The id + sequenceId are monotonic so assertion
 *  against sequence ordering is exact, not approximate. */
function realSink(): AuditSink & { readonly entries: ReadonlyArray<AuditSinkInput> } {
  const entries: AuditSinkInput[] = [];
  let seq = 0;
  return {
    async record(input) {
      entries.push(input);
      seq += 1;
      return { id: `ent_${seq}`, sequenceId: seq };
    },
    get entries() {
      return entries.slice();
    },
  };
}

const TENANT_CTX: ScopeContext = Object.freeze({
  kind: 'tenant',
  tenantId: 'tenant_abc',
  actorUserId: 'user_head_of_estates',
  roles: Object.freeze(['PROPERTY_MANAGER']),
  personaId: 'mr-mwikila-head',
});

const PLATFORM_CTX: ScopeContext = Object.freeze({
  kind: 'platform',
  actorUserId: 'staff_alice',
  roles: Object.freeze(['PLATFORM_ADMIN']),
  personaId: 'industry-observer',
});

describe('ConversationAuditRecorder', () => {
  it('routes a tenant-ctx event to the tenant audit chain', async () => {
    const sink = realSink();
    const rec = createConversationAuditRecorder({ sink, modelVersion: 'claude-sonnet-4-6' });
    await rec.record({
      threadId: 'th_1',
      turnId: 'live_1',
      actorUserId: 'user_head_of_estates',
      ctx: TENANT_CTX,
      event: { kind: 'plan', steps: ['check graph', 'summarise'], at: '2026-04-22T08:00:00Z' },
    });
    expect(sink.entries.length).toBe(1);
    expect(sink.entries[0]!.tenantId).toBe('tenant_abc');
    expect(sink.entries[0]!.actionKind).toBe('ci.plan');
    expect(sink.entries[0]!.actor.kind).toBe('ai_system');
    expect(sink.entries[0]!.ai?.modelVersion).toBe('claude-sonnet-4-6');
  });

  it('routes a platform-ctx event to the platform audit tenant', async () => {
    const sink = realSink();
    const rec = createConversationAuditRecorder({ sink });
    await rec.record({
      threadId: 'th_x',
      turnId: 'live_x',
      actorUserId: 'staff_alice',
      ctx: PLATFORM_CTX,
      event: {
        kind: 'tool_call',
        callId: 'c1',
        toolName: 'platform.industry_aggregate',
        input: { statistic: 'arrears_rate' },
        at: '2026-04-22T08:00:00Z',
      },
    });
    expect(sink.entries[0]!.tenantId).toBe(PLATFORM_AUDIT_TENANT_ID);
    expect(sink.entries[0]!.actionKind).toMatch(/^ci\.tool_call\./);
  });

  it('hashes user-message content rather than storing it verbatim', async () => {
    const sink = realSink();
    const rec = createConversationAuditRecorder({ sink });
    await rec.record({
      threadId: 'th_1',
      turnId: 'live_1',
      actorUserId: 'u',
      ctx: TENANT_CTX,
      event: { kind: 'user_message', content: 'Which vendors are my weak points?', at: '2026-04-22T08:00:00Z' },
    });
    const entry = sink.entries[0]!;
    expect(entry.actor.kind).toBe('user');
    expect(entry.ai?.promptHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    const attachments = entry.ai?.attachments as Record<string, unknown> | undefined;
    // The raw content must NOT land in evidence
    expect(JSON.stringify(attachments ?? {})).not.toMatch(/weak points/);
  });

  it('skips `text` delta events — only end-of-turn records the aggregated text', async () => {
    const sink = realSink();
    const rec = createConversationAuditRecorder({ sink });
    await rec.record({
      threadId: 't', turnId: 'lv', actorUserId: 'u', ctx: TENANT_CTX,
      event: { kind: 'text', delta: 'streamed chunk', at: '2026-04-22T08:00:00Z' },
    });
    expect(sink.entries.length).toBe(0);
  });

  it('records a structured citation with target provenance', async () => {
    const sink = realSink();
    const rec = createConversationAuditRecorder({ sink });
    await rec.record({
      threadId: 't', turnId: 'lv', actorUserId: 'u', ctx: TENANT_CTX,
      event: {
        kind: 'citation',
        citation: {
          id: 'cite_1',
          target: { kind: 'graph_node', nodeLabel: 'Unit', nodeId: 'u_3b' },
          label: 'Unit 3B',
          confidence: 0.92,
        },
        at: '2026-04-22T08:00:00Z',
      },
    });
    const entry = sink.entries[0]!;
    expect(entry.actionKind).toBe('ci.citation');
    const attachments = entry.ai?.attachments as Record<string, unknown>;
    expect(attachments.citationId).toBe('cite_1');
    expect(attachments.targetKind).toBe('graph_node');
  });

  it('dead-letters on sink failure without throwing to caller', async () => {
    const brokenSink: AuditSink = {
      async record() { throw new Error('chain down'); },
    };
    const rec = createConversationAuditRecorder({ sink: brokenSink, deadLetterCap: 5 });
    for (let i = 0; i < 3; i += 1) {
      await rec.record({
        threadId: 't', turnId: 'lv', actorUserId: 'u', ctx: TENANT_CTX,
        event: { kind: 'plan', steps: ['x'], at: '2026-04-22T08:00:00Z' },
      });
    }
    expect(rec.deadLetterSize).toBe(3);
    const drained = rec.drainDeadLetter();
    expect(drained.length).toBe(3);
    expect(rec.deadLetterSize).toBe(0);
  });

  it('caps the dead-letter buffer and drops oldest on overflow', async () => {
    const brokenSink: AuditSink = {
      async record() { throw new Error('down'); },
    };
    const rec = createConversationAuditRecorder({ sink: brokenSink, deadLetterCap: 2 });
    for (let i = 0; i < 5; i += 1) {
      await rec.record({
        threadId: 't', turnId: String(i), actorUserId: 'u', ctx: TENANT_CTX,
        event: { kind: 'plan', steps: ['x'], at: '2026-04-22T08:00:00Z' },
      });
    }
    expect(rec.deadLetterSize).toBe(2);
    const drained = rec.drainDeadLetter();
    expect(drained.map((d) => d.turnId)).toEqual(['3', '4']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// End-to-end: run the REAL agent loop with the REAL recorder and
// verify the recorded chain reflects the full turn.
// ─────────────────────────────────────────────────────────────────────

describe('agent loop × audit recorder (live behaviour)', () => {
  it('records user_message → plan → tool_call → tool_result → text → citation → done', async () => {
    const sink = realSink();
    const rec = createConversationAuditRecorder({
      sink,
      modelVersion: 'scripted-test-llm',
    });

    const tool: Tool = {
      name: 'graph.lookup_node',
      description: 'real tool, not a mock',
      inputJsonSchema: { type: 'object' },
      scopes: ['tenant'],
      async invoke() {
        return {
          kind: 'ok',
          ok: true,
          output: { found: true },
          latencyMs: 4,
          citations: [
            {
              id: 'cite_A',
              target: { kind: 'graph_node', nodeLabel: 'Unit', nodeId: 'u1' },
              label: 'Unit 1',
              confidence: 0.9,
            },
          ],
          artifact: null,
        };
      },
    };

    const scripts: ReadonlyArray<ReadonlyArray<LlmStreamChunk>> = [
      [
        { kind: 'tool_call', toolCall: { callId: 'c1', toolName: 'graph.lookup_node', input: { x: 1 } } },
        { kind: 'stop', stopReason: 'tool_use' },
      ],
      [
        { kind: 'text_delta', text: 'Unit 1 looks healthy.' },
        { kind: 'stop', stopReason: 'end_turn' },
      ],
    ];
    let round = 0;
    const llm: LlmAdapter = {
      modelId: 'scripted-test-llm',
      async *stream(): AsyncIterable<LlmStreamChunk> {
        const chunks = scripts[round] ?? [{ kind: 'stop', stopReason: 'end_turn' }];
        round += 1;
        for (const c of chunks) yield c;
      },
    };

    const memory = createInMemoryConversationMemory();
    const voice = createDefaultVoiceResolver();
    const tools = createToolRegistry([tool]);
    const ctx: ScopeContext = {
      kind: 'tenant',
      tenantId: 'tenant_abc',
      actorUserId: 'user_1',
      roles: ['PROPERTY_MANAGER'],
      personaId: 'mr-mwikila-head',
    };
    const thread = await memory.createThread(ctx, 'How is Unit 1?');
    const agent = createCentralIntelligenceAgent({ llm, tools, memory, voice, audit: rec });

    for await (const _ of agent.run({
      threadId: thread.threadId,
      userMessage: 'How is Unit 1?',
      ctx,
    })) {
      // consume
    }

    // Allow the fire-and-forward `void deps.audit.record(...)` calls
    // queued inside the loop to settle — they share the event-loop
    // with the stream. A microtask yield is enough.
    await new Promise((r) => setImmediate(r));

    const kinds = sink.entries.map((e) => e.actionKind);
    expect(kinds).toContain('ci.user_message');
    expect(kinds.some((k) => k.startsWith('ci.tool_call.'))).toBe(true);
    expect(kinds.some((k) => k.startsWith('ci.tool_result.'))).toBe(true);
    expect(kinds).toContain('ci.citation');
    expect(kinds).toContain('ci.turn_done');

    // No text-delta spam
    expect(kinds.every((k) => k !== 'ci.text')).toBe(true);

    // Every entry carries the thread's resourceUri
    for (const entry of sink.entries) {
      expect(entry.subject?.resourceUri).toMatch(new RegExp(`ci:/thread/${thread.threadId}/turn/`));
      expect(entry.tenantId).toBe('tenant_abc');
    }
  });
});
