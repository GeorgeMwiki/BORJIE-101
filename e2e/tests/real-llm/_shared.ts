/**
 * Shared helpers for real-LLM E2E specs.
 */

import { test as base } from '@playwright/test';

export const REAL_LLM_ENABLED = process.env.E2E_REAL_LLM === 'true';
export const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? 'http://localhost:4000';
export const HAS_ANTHROPIC = !!process.env.ANTHROPIC_API_KEY;
export const HAS_OPENAI = !!process.env.OPENAI_API_KEY;
export const HAS_ELEVENLABS = !!process.env.ELEVENLABS_API_KEY;

/**
 * Skip the suite when the opt-in flag is off. Prints one line per skip so CI
 * operators know why.
 */
export function skipUnlessRealLlm(): void {
  base.skip(!REAL_LLM_ENABLED, 'Real-LLM suite is opt-in: set E2E_REAL_LLM=true');
}

export function assertMentionsAny(text: string, candidates: readonly string[], minHits = 3): void {
  const lower = text.toLowerCase();
  const hits = candidates.filter((c) => lower.includes(c.toLowerCase())).length;
  if (hits < minHits) {
    throw new Error(
      `Expected ≥${minHits} of [${candidates.join(', ')}] in response, got ${hits}. Response was:\n${text}`,
    );
  }
}

/**
 * Minimal SSE reader — reads `text/event-stream` response body, splits on
 * "\n\n", yields `data: ...` payloads parsed as JSON (unless payload is "[DONE]").
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIdx: number;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        yield JSON.parse(data);
      } catch {
        yield data;
      }
    }
  }
}

/** Fetch JWT for a dummy admin; used against the local dev gateway. */
export async function fetchTestJwt(): Promise<string> {
  return (
    process.env.E2E_TEST_JWT ??
    // Fallback: a dev-only unsigned token the gateway dev-mode accepts.
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJ1c2VySWQiOiJlMmUtYWRtaW4iLCJ0ZW5hbnRJZCI6ImUyZS10ZW4iLCJyb2xlIjoiYWRtaW4ifQ.' +
      'e2e-signature-placeholder'
  );
}
