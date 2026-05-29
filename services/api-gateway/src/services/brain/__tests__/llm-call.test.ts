/**
 * Tests for the shared brain LLM call helper (G-FIX-2).
 *
 *   1. callBrainLlmJson sends `cache_control: ephemeral` on the system
 *      prompt and parses Zod-valid JSON.
 *   2. callBrainLlmJson retries on parse failure and surfaces the raw
 *      content + issues in the error when the budget is exhausted.
 *   3. callBrainLlmJson surfaces cache-hit token counters from the
 *      Anthropic response so the caller can prove caching is live.
 *   4. withLlmOrHeuristic returns the LLM output on the happy path.
 *   5. withLlmOrHeuristic falls back to the heuristic when LLM
 *      output has no evidence markers.
 *   6. withLlmOrHeuristic falls back to the heuristic when the LLM
 *      attempt throws (graceful degradation contract).
 *   7. createBrainLlmClient returns null when no API key is supplied.
 */

import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { z } from 'zod';

import {
  callBrainLlmJson,
  createBrainLlmClient,
  withLlmOrHeuristic,
  type BrainLlmClient,
  type BrainLlmMessageRequest,
  type BrainLlmMessageResponse,
} from '../llm-call';

const SCHEMA = z.object({
  summary: z.string(),
  evidenceIds: z.array(z.string()),
});

function makeStubClient(
  responses: Array<Partial<BrainLlmMessageResponse>>,
): BrainLlmClient & {
  readonly capturedRequests: BrainLlmMessageRequest[];
} {
  const capturedRequests: BrainLlmMessageRequest[] = [];
  let i = 0;
  return Object.freeze({
    model: 'test-model-id',
    capturedRequests,
    sdk: {
      async messages_create_unused() {
        // shim; SDK shape requires the nested `messages.create`.
      },
      messages: {
        async create(req: BrainLlmMessageRequest) {
          capturedRequests.push(req);
          const r = responses[i] ?? responses[responses.length - 1] ?? {};
          i += 1;
          return {
            content: r.content ?? [],
            usage: r.usage ?? {
              input_tokens: 1,
              output_tokens: 1,
            },
            stop_reason: r.stop_reason ?? 'end_turn',
          } as BrainLlmMessageResponse;
        },
      },
    },
  }) as BrainLlmClient & {
    readonly capturedRequests: BrainLlmMessageRequest[];
  };
}

describe('createBrainLlmClient', () => {
  it('returns null when ANTHROPIC_API_KEY is missing', () => {
    const logger = pino({ level: 'silent' });
    const warn = vi.spyOn(logger, 'warn');
    const original = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    try {
      const client = createBrainLlmClient({ logger });
      expect(client).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      if (original !== undefined) process.env['ANTHROPIC_API_KEY'] = original;
    }
  });

  it('builds a client when an explicit apiKey is supplied', () => {
    const client = createBrainLlmClient({ apiKey: 'sk-test-fake' });
    expect(client).not.toBeNull();
    expect(client?.model).toBeTruthy();
  });
});

describe('callBrainLlmJson', () => {
  it('sends cache_control on the system prompt and parses Zod-valid JSON', async () => {
    const client = makeStubClient([
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              summary: 'ok',
              evidenceIds: ['ev_1', 'ev_2'],
            }),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ]);

    const result = await callBrainLlmJson({
      client,
      system: 'You are a tester.',
      user: 'Echo the schema.',
      schema: SCHEMA,
    });

    expect(result.data.summary).toBe('ok');
    expect(result.data.evidenceIds).toEqual(['ev_1', 'ev_2']);
    expect(client.capturedRequests).toHaveLength(1);
    const req = client.capturedRequests[0]!;
    expect(Array.isArray(req.system)).toBe(true);
    const sys = req.system as ReadonlyArray<{
      readonly type: string;
      readonly text: string;
      readonly cache_control?: { readonly type: string };
    }>;
    expect(sys[0]?.type).toBe('text');
    expect(sys[0]?.cache_control?.type).toBe('ephemeral');
    expect(result.parseRetriesUsed).toBe(0);
  });

  it('reports cache-hit token counters when Anthropic returns them', async () => {
    const client = makeStubClient([
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ summary: 'cached', evidenceIds: ['ev'] }),
          },
        ],
        usage: {
          input_tokens: 2,
          output_tokens: 1,
          cache_read_input_tokens: 1024,
          cache_creation_input_tokens: 0,
        },
      },
    ]);

    const result = await callBrainLlmJson({
      client,
      system: 'sys',
      user: 'usr',
      schema: SCHEMA,
    });
    expect(result.cacheReadTokens).toBe(1024);
    expect(result.cacheWriteTokens).toBe(0);
  });

  it('retries on parse failure then throws with the raw content', async () => {
    const client = makeStubClient([
      { content: [{ type: 'text', text: 'not json' }] },
      { content: [{ type: 'text', text: '{"invalid": true}' }] },
      { content: [{ type: 'text', text: 'still not json' }] },
    ]);

    await expect(
      callBrainLlmJson({
        client,
        system: 'sys',
        user: 'usr',
        schema: SCHEMA,
        maxParseRetries: 2,
      }),
    ).rejects.toThrow(/Brain LLM JSON parse failed/);
    expect(client.capturedRequests).toHaveLength(3);
  });
});

describe('withLlmOrHeuristic', () => {
  it('returns the LLM output on the happy path', async () => {
    const result = await withLlmOrHeuristic<{
      readonly text: string;
      readonly evidence: string[];
    }>({
      pathName: 'unit-test',
      llmAttempt: async () => ({
        text: 'from-llm',
        evidence: ['ev_a'],
      }),
      heuristic: async () => ({
        text: 'from-heuristic',
        evidence: [],
      }),
      hasEvidence: (o) => o.evidence.length > 0,
    });
    expect(result.text).toBe('from-llm');
  });

  it('falls back to heuristic when LLM output has no evidence', async () => {
    const logger = pino({ level: 'silent' });
    const warn = vi.spyOn(logger, 'warn');
    const result = await withLlmOrHeuristic<{
      readonly text: string;
      readonly evidence: string[];
    }>({
      pathName: 'unit-test',
      logger,
      llmAttempt: async () => ({
        text: 'from-llm',
        evidence: [],
      }),
      heuristic: async () => ({
        text: 'from-heuristic',
        evidence: ['ev_h'],
      }),
      hasEvidence: (o) => o.evidence.length > 0,
    });
    expect(result.text).toBe('from-heuristic');
    expect(warn).toHaveBeenCalled();
  });

  it('falls back to heuristic when LLM throws', async () => {
    const logger = pino({ level: 'silent' });
    const warn = vi.spyOn(logger, 'warn');
    const result = await withLlmOrHeuristic<{
      readonly text: string;
      readonly evidence: string[];
    }>({
      pathName: 'unit-test',
      logger,
      llmAttempt: async () => {
        throw new Error('network down');
      },
      heuristic: async () => ({
        text: 'fallback',
        evidence: ['ev_h'],
      }),
      hasEvidence: (o) => o.evidence.length > 0,
    });
    expect(result.text).toBe('fallback');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'unit-test' }),
      expect.stringMatching(/brain LLM call failed/),
    );
  });
});
