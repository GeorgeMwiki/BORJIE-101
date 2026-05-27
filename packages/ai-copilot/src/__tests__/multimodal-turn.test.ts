/**
 * Multimodal Brain-turn regression tests — covers the Brain orchestrator
 * acceptance of `mediaAttachments`, the AnthropicProvider content-array
 * build, and validation guards (>5 MB per image, >20 images per turn).
 *
 * These tests are structural: they exercise the orchestrator + provider
 * wiring without hitting the real Anthropic API. Quality of vision output
 * is scored separately in the eval harness.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createBrainForTesting,
  validateMediaAttachments,
  MAX_MEDIA_ATTACHMENT_BYTES,
  MAX_MEDIA_ATTACHMENTS_PER_TURN,
  anthropicModelSupportsVision,
  buildMultimodalUserMessage,
  ANTHROPIC_MODELS,
  type MediaAttachment,
} from '../index.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { asPromptId } from '../types/core.types.js';
import type { CompiledPrompt } from '../types/prompt.types.js';

const compiled: CompiledPrompt = {
  promptId: asPromptId('test-vision'),
  version: '1.0.0',
  systemPrompt: 'you are test',
  userPrompt: 'describe this image',
  modelConfig: {
    modelId: ANTHROPIC_MODELS.SONNET_4_6,
    maxTokens: 100,
    temperature: 0.5,
  },
  guardrails: {},
};

function tinyBase64(): string {
  return Buffer.from('hello-borjie-vision').toString('base64');
}

function jpegAttachment(): MediaAttachment {
  return {
    mediaType: 'image/jpeg',
    data: tinyBase64(),
  };
}

describe('validateMediaAttachments', () => {
  it('returns null when attachments are within limits', () => {
    expect(validateMediaAttachments([jpegAttachment()])).toBeNull();
  });

  it('rejects more than MAX_MEDIA_ATTACHMENTS_PER_TURN attachments', () => {
    const tooMany = Array.from(
      { length: MAX_MEDIA_ATTACHMENTS_PER_TURN + 1 },
      () => jpegAttachment(),
    );
    const err = validateMediaAttachments(tooMany);
    expect(err?.code).toBe('TOO_MANY_ATTACHMENTS');
    expect(err?.retryable).toBe(false);
  });

  it('rejects an attachment whose decoded size exceeds MAX_MEDIA_ATTACHMENT_BYTES', () => {
    // 5 MB + 1 byte of decoded data, base64-encoded.
    const huge = Buffer.alloc(MAX_MEDIA_ATTACHMENT_BYTES + 1, 0x42).toString(
      'base64',
    );
    const err = validateMediaAttachments([
      { mediaType: 'image/jpeg', data: huge },
    ]);
    expect(err?.code).toBe('ATTACHMENT_TOO_LARGE');
  });

  it('rejects an empty attachment payload', () => {
    const err = validateMediaAttachments([
      { mediaType: 'image/jpeg', data: '' },
    ]);
    expect(err?.code).toBe('ATTACHMENT_EMPTY');
  });

  it('rejects an unsupported mediaType', () => {
    const err = validateMediaAttachments([
      // @ts-expect-error — deliberately bad input
      { mediaType: 'image/webp', data: tinyBase64() },
    ]);
    expect(err?.code).toBe('ATTACHMENT_MEDIA_TYPE_UNSUPPORTED');
  });
});

describe('anthropicModelSupportsVision', () => {
  it('returns true for Opus 4.6, Sonnet 4.6, and Haiku 4.5', () => {
    expect(anthropicModelSupportsVision(ANTHROPIC_MODELS.OPUS_4_6)).toBe(true);
    expect(anthropicModelSupportsVision(ANTHROPIC_MODELS.SONNET_4_6)).toBe(
      true,
    );
    expect(anthropicModelSupportsVision(ANTHROPIC_MODELS.HAIKU_4_5)).toBe(true);
  });

  it('returns false for unknown models', () => {
    expect(anthropicModelSupportsVision('claude-2.1')).toBe(false);
    expect(anthropicModelSupportsVision('gpt-4-turbo-preview')).toBe(false);
  });
});

describe('buildMultimodalUserMessage', () => {
  it('builds a content array with a text block and one image block per attachment', () => {
    const msg = buildMultimodalUserMessage('describe this', [
      jpegAttachment(),
      { mediaType: 'image/png', data: tinyBase64() },
    ]);
    expect(msg.role).toBe('user');
    expect(Array.isArray(msg.content)).toBe(true);
    const blocks = msg.content as ReadonlyArray<Record<string, unknown>>;
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ type: 'text', text: 'describe this' });
    expect(blocks[1]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg' },
    });
    expect(blocks[2]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png' },
    });
  });

  it('returns a fresh array — never mutates the caller attachments list', () => {
    const attachments: MediaAttachment[] = [jpegAttachment()];
    const before = JSON.stringify(attachments);
    buildMultimodalUserMessage('x', attachments);
    expect(JSON.stringify(attachments)).toBe(before);
  });
});

describe('AnthropicProvider multimodal request body', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('forwards image content blocks verbatim when priorMessages carry them', async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_url, init: RequestInit | undefined) => {
      const raw = typeof init?.body === 'string' ? init.body : '';
      capturedBody = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'mineral vein visible' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 30, output_tokens: 10 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof globalThis.fetch;

    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test', maxRetries: 0 });
    const multimodal = buildMultimodalUserMessage('what is in this image?', [
      jpegAttachment(),
    ]);
    const result = await provider.complete({
      prompt: compiled,
      priorMessages: [multimodal],
    });

    expect(result.success).toBe(true);
    const messages = capturedBody.messages as ReadonlyArray<{
      role: string;
      content: ReadonlyArray<Record<string, unknown>>;
    }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
    const blocks = messages[0]?.content ?? [];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: 'text', text: 'what is in this image?' });
    expect(blocks[1]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg' },
    });
  });
});

describe('Brain orchestrator multimodal turn', () => {
  it('accepts a startThread call with mediaAttachments and returns a successful turn', async () => {
    const brain = createBrainForTesting();
    const result = await brain.orchestrator.startThread({
      tenant: {
        tenantId: 'T',
        tenantName: 'Test',
        environment: 'development',
      },
      actor: { type: 'user', id: 'U', roles: ['admin'] },
      viewer: {
        userId: 'U',
        roles: ['admin'],
        teamIds: [],
        isAdmin: true,
      },
      initialUserText: 'describe this drill core sample',
      mediaAttachments: [jpegAttachment()],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.thread.id).toBeTruthy();
      expect(result.data.turn.finalPersonaId).toBeTruthy();
      expect(typeof result.data.turn.responseText).toBe('string');
    }
  });

  it('rejects a turn when oversized attachments are provided', async () => {
    const brain = createBrainForTesting();
    const huge = Buffer.alloc(MAX_MEDIA_ATTACHMENT_BYTES + 1, 0x42).toString(
      'base64',
    );
    const result = await brain.orchestrator.startThread({
      tenant: {
        tenantId: 'T',
        tenantName: 'Test',
        environment: 'development',
      },
      actor: { type: 'user', id: 'U', roles: ['admin'] },
      viewer: {
        userId: 'U',
        roles: ['admin'],
        teamIds: [],
        isAdmin: true,
      },
      initialUserText: 'oversize',
      mediaAttachments: [{ mediaType: 'image/jpeg', data: huge }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('ATTACHMENT_TOO_LARGE');
    }
  });

  it('rejects a turn when more than MAX_MEDIA_ATTACHMENTS_PER_TURN attachments are provided', async () => {
    const brain = createBrainForTesting();
    const tooMany = Array.from(
      { length: MAX_MEDIA_ATTACHMENTS_PER_TURN + 1 },
      () => jpegAttachment(),
    );
    const result = await brain.orchestrator.startThread({
      tenant: {
        tenantId: 'T',
        tenantName: 'Test',
        environment: 'development',
      },
      actor: { type: 'user', id: 'U', roles: ['admin'] },
      viewer: {
        userId: 'U',
        roles: ['admin'],
        teamIds: [],
        isAdmin: true,
      },
      initialUserText: 'too many images',
      mediaAttachments: tooMany,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('TOO_MANY_ATTACHMENTS');
    }
  });

  it('appends the user message to the thread (audit chain) on a multimodal turn', async () => {
    const brain = createBrainForTesting();
    const result = await brain.orchestrator.startThread({
      tenant: {
        tenantId: 'T',
        tenantName: 'Test',
        environment: 'development',
      },
      actor: { type: 'user', id: 'U', roles: ['admin'] },
      viewer: {
        userId: 'U',
        roles: ['admin'],
        teamIds: [],
        isAdmin: true,
      },
      initialUserText: 'describe this sample',
      mediaAttachments: [jpegAttachment()],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const events = await brain.threads.readFull(result.data.thread.id);
    const userMessages = events.filter((e) => e.kind === 'user_message');
    expect(userMessages.length).toBeGreaterThan(0);
    // Persona response is also appended so the audit chain captures the turn.
    const personaMessages = events.filter((e) => e.kind === 'persona_message');
    expect(personaMessages.length).toBeGreaterThan(0);
  });

  it('passes through forcePersonaId when starting a multimodal thread', async () => {
    const brain = createBrainForTesting();
    const result = await brain.orchestrator.startThread({
      tenant: {
        tenantId: 'T',
        tenantName: 'Test',
        environment: 'development',
      },
      actor: { type: 'user', id: 'U', roles: ['admin'] },
      viewer: {
        userId: 'U',
        roles: ['admin'],
        teamIds: [],
        isAdmin: true,
      },
      initialUserText: 'force routing',
      forcePersonaId: 'estate-manager',
      mediaAttachments: [jpegAttachment()],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.thread.primaryPersonaId).toBe('estate-manager');
    }
  });
});
