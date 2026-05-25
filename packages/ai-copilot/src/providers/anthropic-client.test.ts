/**
 * Tests for the shared Anthropic client.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  ModelTier,
  generateStructured,
  StructuredGenerationFailedError,
  type AnthropicClient,
  type AnthropicMessageResponse,
  type AnthropicSdkLike,
} from './anthropic-client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testSchema = z.object({
  riskLevel: z.enum(['low', 'medium', 'high']),
  score: z.number().min(0).max(100),
  reason: z.string(),
});

type TestShape = z.infer<typeof testSchema>;

function buildResponse(text: string): AnthropicMessageResponse {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

function buildClient(
  createFn: ReturnType<typeof vi.fn>,
  defaultModel: string = ModelTier.SONNET
): AnthropicClient {
  const sdk: AnthropicSdkLike = {
    messages: { create: createFn as unknown as AnthropicSdkLike['messages']['create'] },
  };
  return { defaultModel, sdk };
}

const validPayload: TestShape = {
  riskLevel: 'high',
  score: 87,
  reason: 'repeated late payments',
};

// ---------------------------------------------------------------------------
// ModelTier constants
// ---------------------------------------------------------------------------

describe('ModelTier', () => {
  it('pins 2026 Claude model IDs', () => {
    expect(ModelTier.HAIKU).toBe('claude-haiku-4-5-20251001');
    expect(ModelTier.SONNET).toBe('claude-sonnet-4-6');
    expect(ModelTier.OPUS).toBe('claude-opus-4-6');
  });

  it('is frozen-style — three canonical tiers only', () => {
    expect(Object.keys(ModelTier).sort()).toEqual(['HAIKU', 'OPUS', 'SONNET']);
  });
});

// ---------------------------------------------------------------------------
// generateStructured — happy path
// ---------------------------------------------------------------------------

describe('generateStructured — happy path', () => {
  it('returns typed parsed result on first attempt', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(buildResponse(JSON.stringify(validPayload)));
    const client = buildClient(create);

    const result = await generateStructured(client, {
      prompt: 'Score payment risk for customer 123',
      schema: testSchema,
    });

    expect(result.data).toEqual(validPayload);
    expect(result.parseRetriesUsed).toBe(0);
    expect(result.modelId).toBe(ModelTier.SONNET);
    expect(result.usage.totalTokens).toBe(30);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('passes systemPrompt, temperature, and model override to SDK', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(buildResponse(JSON.stringify(validPayload)));
    const client = buildClient(create);

    await generateStructured(client, {
      prompt: 'go',
      schema: testSchema,
      systemPrompt: 'You are a risk analyst.',
      temperature: 0.1,
      model: ModelTier.HAIKU,
    });

    const args = create.mock.calls[0][0];
    expect(args.model).toBe(ModelTier.HAIKU);
    expect(args.system).toBe('You are a risk analyst.');
    expect(args.temperature).toBe(0.1);
    expect(args.messages).toEqual([{ role: 'user', content: 'go' }]);
  });

  it('strips markdown fences before parsing', async () => {
    const fenced = '```json\n' + JSON.stringify(validPayload) + '\n```';
    const create = vi.fn().mockResolvedValueOnce(buildResponse(fenced));
    const client = buildClient(create);

    const result = await generateStructured(client, {
      prompt: 'go',
      schema: testSchema,
    });
    expect(result.data).toEqual(validPayload);
  });
});

// ---------------------------------------------------------------------------
// Retry behavior
// ---------------------------------------------------------------------------

describe('generateStructured — schema parse retry', () => {
  it('retries once when first call returns bad JSON, succeeds on second', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(buildResponse('not json at all'))
      .mockResolvedValueOnce(buildResponse(JSON.stringify(validPayload)));
    const client = buildClient(create);

    const result = await generateStructured(client, {
      prompt: 'score it',
      schema: testSchema,
    });

    expect(result.data).toEqual(validPayload);
    expect(result.parseRetriesUsed).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);

    // Retry prompt reinforces JSON-only directive.
    const retryArgs = create.mock.calls[1][0];
    expect(retryArgs.messages[0].content).toContain('ONLY');
    expect(retryArgs.messages[0].content).toContain('Prior response failed');
  });

  it('retries on schema validation failure, not just JSON parse failure', async () => {
    const wrongShape = { foo: 'bar', notTheRightFields: true };
    const create = vi
      .fn()
      .mockResolvedValueOnce(buildResponse(JSON.stringify(wrongShape)))
      .mockResolvedValueOnce(buildResponse(JSON.stringify(validPayload)));
    const client = buildClient(create);

    const result = await generateStructured(client, {
      prompt: 'go',
      schema: testSchema,
    });
    expect(result.data).toEqual(validPayload);
    expect(result.parseRetriesUsed).toBe(1);
  });

  it('throws StructuredGenerationFailedError after 3 failures (default cap)', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(buildResponse('bad1'))
      .mockResolvedValueOnce(buildResponse('bad2'))
      .mockResolvedValueOnce(buildResponse('bad3'));
    const client = buildClient(create);

    await expect(
      generateStructured(client, { prompt: 'go', schema: testSchema })
    ).rejects.toBeInstanceOf(StructuredGenerationFailedError);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('StructuredGenerationFailedError surfaces attempts and last raw content', async () => {
    const create = vi
      .fn()
      .mockResolvedValue(buildResponse('still not json'));
    const client = buildClient(create);

    try {
      await generateStructured(client, {
        prompt: 'go',
        schema: testSchema,
        maxParseRetries: 2,
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(StructuredGenerationFailedError);
      const e = err as StructuredGenerationFailedError;
      expect(e.attempts).toBe(3);
      expect(e.lastRawContent).toBe('still not json');
    }
  });

  it('respects custom maxParseRetries', async () => {
    const create = vi.fn().mockResolvedValue(buildResponse('bad'));
    const client = buildClient(create);

    await expect(
      generateStructured(client, {
        prompt: 'go',
        schema: testSchema,
        maxParseRetries: 0,
      })
    ).rejects.toBeInstanceOf(StructuredGenerationFailedError);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Advisor gate
// ---------------------------------------------------------------------------

describe('generateStructured — advisor gate', () => {
  it('calls both primary and Opus models when advisorGate is true', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(buildResponse(JSON.stringify(validPayload)))
      .mockResolvedValueOnce(buildResponse(JSON.stringify(validPayload)));
    const client = buildClient(create, ModelTier.SONNET);

    const result = await generateStructured(client, {
      prompt: 'high-stakes decision',
      schema: testSchema,
      advisorGate: true,
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].model).toBe(ModelTier.SONNET);
    expect(create.mock.calls[1][0].model).toBe(ModelTier.OPUS);

    expect(result.advisorAgreement).toBeDefined();
    expect(result.advisorAgreement?.disagreement).toBe(false);
    expect(result.advisorAgreement?.narration).toMatch(/agrees/i);
  });

  it('flags disagreement when Opus returns different structured data', async () => {
    const opusPayload: TestShape = { ...validPayload, riskLevel: 'medium' };
    const create = vi
      .fn()
      .mockResolvedValueOnce(buildResponse(JSON.stringify(validPayload)))
      .mockResolvedValueOnce(buildResponse(JSON.stringify(opusPayload)));
    const client = buildClient(create, ModelTier.SONNET);

    const result = await generateStructured(client, {
      prompt: 'gate me',
      schema: testSchema,
      advisorGate: true,
    });

    expect(result.advisorAgreement?.disagreement).toBe(true);
    expect(result.advisorAgreement?.opusData).toEqual(opusPayload);
    expect(result.advisorAgreement?.narration).toMatch(/disagrees/i);
  });

  it('aggregates token usage across primary + Opus calls', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(buildResponse(JSON.stringify(validPayload)))
      .mockResolvedValueOnce(buildResponse(JSON.stringify(validPayload)));
    const client = buildClient(create);

    const result = await generateStructured(client, {
      prompt: 'go',
      schema: testSchema,
      advisorGate: true,
    });
    expect(result.usage.totalTokens).toBe(60);
  });

  it('does not call Opus when advisorGate is false or omitted', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(buildResponse(JSON.stringify(validPayload)));
    const client = buildClient(create);

    const result = await generateStructured(client, {
      prompt: 'go',
      schema: testSchema,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.advisorAgreement).toBeUndefined();
  });
});
