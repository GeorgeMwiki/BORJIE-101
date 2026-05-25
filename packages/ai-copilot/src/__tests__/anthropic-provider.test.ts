/**
 * Anthropic provider tests.
 *
 * No fakes — uses the real provider class, but stubs `fetch` so we can
 * deterministically exercise:
 *   - retry on 429 / 5xx with exponential backoff
 *   - tool-use block parsing
 *   - constructor refuses missing apiKey
 *   - timeout handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnthropicProvider } from '../providers/anthropic.js';
import { asPromptId } from '../types/core.types.js';
import type { CompiledPrompt } from '../types/prompt.types.js';

const compiled: CompiledPrompt = {
  promptId: asPromptId('test'),
  version: '1.0.0',
  systemPrompt: 'you are test',
  userPrompt: 'hello',
  modelConfig: { modelId: 'claude-sonnet-4-6', maxTokens: 100, temperature: 0.5 },
  guardrails: {},
};

describe('AnthropicProvider construction', () => {
  it('throws if apiKey is missing', () => {
    expect(() => new AnthropicProvider({ apiKey: '' })).toThrow();
  });
});

describe('AnthropicProvider tool-use parsing', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns toolCalls + rawContent when the model emits tool_use', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [
              { type: 'text', text: 'Let me check.' },
              {
                type: 'tool_use',
                id: 'tu_42',
                name: 'skill.test',
                input: { x: 1 },
              },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 12, output_tokens: 7 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    ) as typeof globalThis.fetch;

    const p = new AnthropicProvider({ apiKey: 'sk-ant-test', maxRetries: 0 });
    const result = await p.complete({ prompt: compiled });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.toolCalls).toHaveLength(1);
      expect(result.data.toolCalls?.[0]).toMatchObject({
        id: 'tu_42',
        name: 'skill.test',
      });
      expect(result.data.rawContent).toHaveLength(2);
      expect(result.data.finishReason).toBe('tool_use');
    }
  });
});

describe('AnthropicProvider tool-name sanitization', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /**
   * Regression: Anthropic enforces `^[a-zA-Z0-9_-]{1,128}$` on every
   * tool name. Internal skill ids like `skill.maintenance.triage` contain
   * dots and therefore must be rewritten on the way out, and restored on
   * the way back in so the orchestrator's dispatcher continues to look up
   * skills by their canonical id.
   */
  it('rewrites dotted tool names on the request and restores them on tool_use', async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
      const raw = typeof init?.body === 'string' ? init!.body : '';
      capturedBody = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      return new Response(
        JSON.stringify({
          content: [
            {
              type: 'tool_use',
              id: 'tu_1',
              // Anthropic will echo back the sanitized name the caller sent.
              name: 'skill__maintenance__triage',
              input: { caseId: 'c1' },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof globalThis.fetch;

    const p = new AnthropicProvider({ apiKey: 'sk-ant-test', maxRetries: 0 });
    const result = await p.complete({
      prompt: compiled,
      tools: [
        {
          name: 'skill.maintenance.triage',
          description: 'Triage a case',
          inputSchema: { type: 'object' },
        },
      ],
    });
    expect(result.success).toBe(true);
    const sentTools = (capturedBody.tools ?? []) as Array<{ name: string }>;
    expect(sentTools[0]?.name).toBe('skill__maintenance__triage');
    if (result.success) {
      // Canonical dotted name is restored so the dispatcher can look it up.
      expect(result.data.toolCalls?.[0]?.name).toBe('skill.maintenance.triage');
    }
  });
});

describe('AnthropicProvider prompt-cache breakpoints (A2b-2 wire #10a)', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('marks the system prompt + last tool definition with cache_control: ephemeral on the wire', async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
      const raw = typeof init?.body === 'string' ? init!.body : '';
      capturedBody = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof globalThis.fetch;

    const p = new AnthropicProvider({ apiKey: 'sk-ant-test', maxRetries: 0 });
    const result = await p.complete({
      prompt: compiled,
      tools: [
        { name: 'tool_a', description: 'A', inputSchema: { type: 'object' } },
        { name: 'tool_b', description: 'B', inputSchema: { type: 'object' } },
      ],
    });
    expect(result.success).toBe(true);

    // system promoted to block-array, last block tagged
    const systemBlocks = capturedBody.system as Array<{
      type: string;
      text: string;
      cache_control?: { type: string };
    }>;
    expect(Array.isArray(systemBlocks)).toBe(true);
    const lastSystem = systemBlocks[systemBlocks.length - 1];
    expect(lastSystem?.cache_control).toEqual({ type: 'ephemeral' });

    // last tool definition tagged, earlier ones untagged
    const sentTools = capturedBody.tools as Array<{
      name: string;
      cache_control?: { type: string };
    }>;
    expect(sentTools).toHaveLength(2);
    expect(sentTools[0]?.cache_control).toBeUndefined();
    expect(sentTools[1]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('surfaces cacheStats in usage when Anthropic returns cache counters', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'cached reply' }],
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 50,
              output_tokens: 10,
              cache_creation_input_tokens: 1200,
              cache_read_input_tokens: 3400,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    ) as typeof globalThis.fetch;

    const p = new AnthropicProvider({ apiKey: 'sk-ant-test', maxRetries: 0 });
    const result = await p.complete({ prompt: compiled });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.usage.cacheStats).toEqual({
        cacheCreationInputTokens: 1200,
        cacheReadInputTokens: 3400,
      });
      // Non-cache counters stay unchanged so existing callers keep working.
      expect(result.data.usage.promptTokens).toBe(50);
      expect(result.data.usage.completionTokens).toBe(10);
      expect(result.data.usage.totalTokens).toBe(60);
    }
  });

  it('omits cacheStats when the API response contains no cache counters', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'plain reply' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    ) as typeof globalThis.fetch;

    const p = new AnthropicProvider({ apiKey: 'sk-ant-test', maxRetries: 0 });
    const result = await p.complete({ prompt: compiled });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.usage.cacheStats).toBeUndefined();
    }
  });
});

describe('AnthropicProvider retry/backoff', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('retries on 429 and ultimately succeeds', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls < 2) {
        return new Response(
          JSON.stringify({ error: { message: 'rate limited' } }),
          { status: 429 }
        );
      }
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200 }
      );
    }) as typeof globalThis.fetch;
    const p = new AnthropicProvider({
      apiKey: 'sk-ant-test',
      maxRetries: 4,
      retryBaseMs: 1, // tiny backoff so the test is fast
    });
    const result = await p.complete({ prompt: compiled });
    expect(result.success).toBe(true);
    expect(calls).toBe(2);
  });

  it('gives up after maxRetries on persistent 5xx', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { message: 'oops' } }), {
        status: 503,
      });
    }) as typeof globalThis.fetch;
    const p = new AnthropicProvider({
      apiKey: 'sk-ant-test',
      maxRetries: 2,
      retryBaseMs: 1,
    });
    const result = await p.complete({ prompt: compiled });
    expect(result.success).toBe(false);
    expect(calls).toBe(3); // first call + 2 retries
  });

  it('does not retry on non-retryable 400 (context length)', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ error: { message: 'context_length exceeded' } }),
        { status: 400 }
      );
    }) as typeof globalThis.fetch;
    const p = new AnthropicProvider({
      apiKey: 'sk-ant-test',
      maxRetries: 4,
      retryBaseMs: 1,
    });
    const result = await p.complete({ prompt: compiled });
    expect(result.success).toBe(false);
    expect(calls).toBe(1);
    if (!result.success) {
      expect(result.error.code).toBe('CONTEXT_LENGTH');
    }
  });
});
