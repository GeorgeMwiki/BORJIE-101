/**
 * Adaptive-thinking wrapper tests.
 *
 *   - 12 fixtures × wire-shape: ensures `thinking: { type: 'adaptive', ...}`
 *     is the only param shape we emit, and `effort` is preserved when
 *     supplied.
 *   - 5 tool-interleave cases: ensures the wrapper accepts and emits
 *     responses with thinking + tool_use blocks in the expected order.
 *   - Telemetry: thinking-token count, block counts, sink invocation.
 *   - Defensive: empty messages array throws; missing client throws;
 *     sink errors do not propagate.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildRequest,
  buildTelemetry,
  createThinkingMessage,
} from '../create-thinking-message.js';
import type {
  AnthropicClientLike,
  AnthropicMessageResponse,
  ThinkingTelemetryEvent,
} from '../types.js';
import { ADAPTIVE_FIXTURES, TOOL_INTERLEAVE_CASES } from './fixtures.js';

function mockResponse(
  overrides?: Partial<AnthropicMessageResponse>,
): AnthropicMessageResponse {
  return {
    id: 'msg_test_001',
    model: 'claude-opus-4-7',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'I should consider the rent prorate.', signature: 'sig-abc' },
      { type: 'text', text: 'Prorated rent is KES 15,200.' },
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 200, output_tokens: 80 },
    ...overrides,
  };
}

function mockClient(
  responder?: (req: unknown) => AnthropicMessageResponse,
): { client: AnthropicClientLike; sent: unknown[] } {
  const sent: unknown[] = [];
  const client: AnthropicClientLike = {
    messages: {
      create: vi.fn().mockImplementation(async (req: unknown) => {
        sent.push(req);
        return responder ? responder(req) : mockResponse();
      }),
    },
  };
  return { client, sent };
}

describe('createThinkingMessage — 12 fixture wire shapes', () => {
  for (const fixture of ADAPTIVE_FIXTURES) {
    it(`fixture '${fixture.id}': ${fixture.description}`, async () => {
      const { client, sent } = mockClient();
      await createThinkingMessage({
        client,
        model: fixture.expectedModel,
        system: 'You are the BORJIE MD.',
        messages: [{ role: 'user', content: fixture.prompt }],
        ...(fixture.effort ? { effort: fixture.effort } : {}),
      });
      expect(sent).toHaveLength(1);
      const req = sent[0] as Record<string, unknown>;
      expect(req.thinking).toEqual(fixture.expectedThinkingParam);
      expect(req.model).toBe(fixture.expectedModel);
      // The legacy manual shape MUST never appear.
      expect(JSON.stringify(req.thinking)).not.toContain('"type":"enabled"');
      expect(JSON.stringify(req.thinking)).not.toContain('budget_tokens');
    });
  }
});

describe('createThinkingMessage — 5 tool-interleave cases', () => {
  for (const tcase of TOOL_INTERLEAVE_CASES) {
    it(`interleave '${tcase.id}': ${tcase.description}`, async () => {
      const interleavedContent = tcase.expectedBlockOrder.map((blockType, idx) => {
        if (blockType === 'thinking') {
          return {
            type: 'thinking' as const,
            thinking: `Step ${idx}: reason about ${tcase.toolName}.`,
            signature: `sig-${tcase.id}-${idx}`,
          };
        }
        if (blockType === 'tool_use') {
          return {
            type: 'tool_use' as const,
            id: `tu_${tcase.id}_${idx}`,
            name: tcase.toolName,
            input: tcase.toolInput,
          };
        }
        return { type: 'text' as const, text: `Final answer for ${tcase.id}.` };
      });
      const { client, sent } = mockClient(() => ({
        id: 'msg_test',
        model: 'claude-opus-4-7',
        role: 'assistant',
        content: interleavedContent,
        stop_reason: tcase.expectedBlockOrder.includes('text') ? 'end_turn' : 'tool_use',
        usage: { input_tokens: 250, output_tokens: 110 },
      }));
      const tools = [
        {
          name: tcase.toolName,
          description: `Test tool for ${tcase.id}.`,
          input_schema: { type: 'object', properties: {} } as Record<string, unknown>,
        },
      ];
      const result = await createThinkingMessage({
        client,
        model: 'claude-opus-4-7',
        system: 'BORJIE MD with tools.',
        messages: [{ role: 'user', content: tcase.prompt }],
        tools,
        effort: 'high',
      });
      expect(sent).toHaveLength(1);
      const req = sent[0] as Record<string, unknown>;
      expect(req.tools).toEqual(tools);
      // Response carries the expected block order — preserved by the wrapper.
      const order = result.response.content.map((b) => b.type);
      expect(order).toEqual(tcase.expectedBlockOrder);
      // Telemetry tracked the tool_use blocks.
      const expectedToolBlocks = tcase.expectedBlockOrder.filter(
        (b) => b === 'tool_use',
      ).length;
      expect(result.telemetry.toolUseBlockCount).toBe(expectedToolBlocks);
      const expectedThinkingBlocks = tcase.expectedBlockOrder.filter(
        (b) => b === 'thinking',
      ).length;
      expect(result.telemetry.thinkingBlockCount).toBe(expectedThinkingBlocks);
    });
  }
});

describe('createThinkingMessage — telemetry', () => {
  it('emits telemetry exactly once on success', async () => {
    const events: ThinkingTelemetryEvent[] = [];
    const { client } = mockClient();
    await createThinkingMessage({
      client,
      model: 'claude-opus-4-7',
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      telemetrySink: { emit: (e) => events.push(e) },
      correlationId: 'turn-42',
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.correlationId).toBe('turn-42');
    expect(events[0]?.thinkingBlockCount).toBe(1);
    expect(events[0]?.stopReason).toBe('end_turn');
  });

  it('swallows sink errors — they must never block the reasoning path', async () => {
    const { client } = mockClient();
    await expect(
      createThinkingMessage({
        client,
        model: 'claude-opus-4-7',
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
        telemetrySink: {
          emit: () => {
            throw new Error('sink down');
          },
        },
      }),
    ).resolves.toBeDefined();
  });

  it('estimates thinking tokens as output_tokens - visible_text_tokens', () => {
    const ev = buildTelemetry({
      response: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'long internal monologue', signature: 'x' },
          { type: 'text', text: 'short answer' }, // 12 chars / 4 = 3 visible tokens
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
        stop_reason: 'end_turn',
      },
      model: 'claude-opus-4-7',
      effort: 'high',
    });
    expect(ev.thinkingTokens).toBe(50 - 3);
    expect(ev.visibleOutputTokens).toBe(3);
    expect(ev.effort).toBe('high');
  });
});

describe('createThinkingMessage — defensive', () => {
  it('throws when client is missing', async () => {
    await expect(
      createThinkingMessage({
        // @ts-expect-error — intentional bad input
        client: undefined,
        model: 'claude-opus-4-7',
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(/client is required/);
  });

  it('throws when model is missing', async () => {
    const { client } = mockClient();
    await expect(
      createThinkingMessage({
        client,
        // @ts-expect-error — intentional bad input
        model: undefined,
        system: 'sys',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(/model is required/);
  });

  it('throws when messages is empty', async () => {
    const { client } = mockClient();
    await expect(
      createThinkingMessage({
        client,
        model: 'claude-opus-4-7',
        system: 'sys',
        messages: [],
      }),
    ).rejects.toThrow(/messages must be non-empty/);
  });
});

describe('buildRequest — wire shape', () => {
  it('emits exactly { type: "adaptive" } with no effort when none supplied', () => {
    const r = buildRequest({
      model: 'claude-sonnet-4-6',
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 4096,
      thinking: { type: 'adaptive' },
    });
    expect(r.thinking).toEqual({ type: 'adaptive' });
    expect(r.max_tokens).toBe(4096);
  });

  it('includes tools, temperature, tool_choice, metadata when provided', () => {
    const r = buildRequest({
      model: 'claude-opus-4-7',
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 4096,
      thinking: { type: 'adaptive', effort: 'high' },
      tools: [{ name: 't1', input_schema: {} }],
      temperature: 1,
      toolChoice: { type: 'any' },
      metadata: { user_id: 'u_1' },
    });
    expect(r.tools).toHaveLength(1);
    expect(r.temperature).toBe(1);
    expect(r.tool_choice).toEqual({ type: 'any' });
    expect(r.metadata).toEqual({ user_id: 'u_1' });
  });
});
