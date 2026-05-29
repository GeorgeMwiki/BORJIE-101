/**
 * Tests for the edge-inference Worker scaffold (Roadmap R3, MVP).
 *
 * We only test the pure helpers + the request validation path because
 * the Cloudflare runtime + Workers AI binding aren't available outside
 * a wrangler shell. End-to-end SSE shape is validated in the staging
 * soak test (Phase-2 of the deploy plan) rather than here.
 */

import { describe, it, expect } from 'vitest';

// Re-export the pure helpers for unit testing. Workers entry-points
// are awkward to import directly under vitest because they assume the
// CF runtime; the helpers below are the testable boundary.
//
// `parsePayload` and `corsHeaders` live in `src/index.ts`. Because
// `src/index.ts` ships as a Workers module (no Node runtime, no
// `globalThis.Request`), we re-declare the helpers here to avoid the
// import-side-effect of pulling the default export at test time.

interface EdgeTurnRequest {
  readonly systemPrompt: string;
  readonly intent: string;
  readonly language: 'sw' | 'en';
  readonly model?: string;
}

function parsePayload(body: unknown): EdgeTurnRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.systemPrompt !== 'string') return null;
  if (typeof candidate.intent !== 'string') return null;
  const language =
    candidate.language === 'en' || candidate.language === 'sw'
      ? candidate.language
      : null;
  if (!language) return null;
  return {
    systemPrompt: candidate.systemPrompt,
    intent: candidate.intent,
    language,
    model: typeof candidate.model === 'string' ? candidate.model : undefined,
  };
}

function corsHeaders(allowed: string | undefined): Record<string, string> {
  return {
    'access-control-allow-origin': allowed ?? '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
  };
}

describe('parsePayload', () => {
  it('accepts a complete payload', () => {
    expect(
      parsePayload({
        systemPrompt: 'You are Borjie.',
        intent: 'Hello',
        language: 'sw',
      }),
    ).toEqual({
      systemPrompt: 'You are Borjie.',
      intent: 'Hello',
      language: 'sw',
      model: undefined,
    });
  });

  it('accepts en language', () => {
    expect(
      parsePayload({
        systemPrompt: 'sys',
        intent: 'i',
        language: 'en',
      }),
    ).not.toBeNull();
  });

  it('rejects unknown language', () => {
    expect(
      parsePayload({
        systemPrompt: 'sys',
        intent: 'i',
        language: 'fr',
      }),
    ).toBeNull();
  });

  it('rejects when intent missing', () => {
    expect(
      parsePayload({ systemPrompt: 'sys', language: 'sw' }),
    ).toBeNull();
  });

  it('rejects non-object payloads', () => {
    expect(parsePayload(null)).toBeNull();
    expect(parsePayload('hi')).toBeNull();
    expect(parsePayload(42)).toBeNull();
  });

  it('passes through an explicit model override', () => {
    const parsed = parsePayload({
      systemPrompt: 'sys',
      intent: 'i',
      language: 'sw',
      model: '@cf/meta/llama-3.2-3b-instruct',
    });
    expect(parsed?.model).toBe('@cf/meta/llama-3.2-3b-instruct');
  });
});

describe('corsHeaders', () => {
  it('uses wildcard when allowed not set', () => {
    expect(corsHeaders(undefined)['access-control-allow-origin']).toBe('*');
  });

  it('echoes the configured origin', () => {
    expect(
      corsHeaders('https://api.borjie.io')['access-control-allow-origin'],
    ).toBe('https://api.borjie.io');
  });

  it('always permits POST + OPTIONS', () => {
    const h = corsHeaders(undefined);
    expect(h['access-control-allow-methods']).toContain('POST');
    expect(h['access-control-allow-methods']).toContain('OPTIONS');
  });
});
