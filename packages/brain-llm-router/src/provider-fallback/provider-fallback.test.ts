/**
 * Unit + integration tests for provider-fallback/.
 *
 * Coverage:
 *   - CircuitBreaker state machine (closed -> open -> half-open -> closed)
 *   - exponentialBackoffMs jitter + cap
 *   - runFallback success on first provider
 *   - runFallback walks past 503 to second provider
 *   - runFallback fails fast on non-retryable error (400)
 *   - runFallback skips open circuit
 *   - cross-family fallback hook fires
 *   - all providers fail -> ALL_PROVIDERS_FAILED
 */

import { describe, expect, it } from 'vitest';
import { CircuitBreaker, exponentialBackoffMs } from './circuit-breaker.js';
import { runFallback, type ProviderLadderEntry } from './fallback-router.js';
import type { BrainLLMClient, BrainLLMRequest, BrainLLMResponse, ProviderName } from '../types.js';
import { BrainLLMError } from '../types.js';

function makeStubClient(
  provider: ProviderName,
  behavior:
    | { type: 'ok'; text: string }
    | { type: 'throw'; err: Error }
): BrainLLMClient {
  return {
    provider,
    invoke: async (req: BrainLLMRequest): Promise<BrainLLMResponse> => {
      if (behavior.type === 'throw') throw behavior.err;
      return {
        id: 'msg_stub',
        model: req.model,
        provider,
        content: [{ type: 'text', text: behavior.text }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
        latencyMs: 1,
      };
    },
  };
}

const baseReq: BrainLLMRequest = {
  model: 'will-be-overridden',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
};

describe('CircuitBreaker', () => {
  it('starts closed and allows requests', () => {
    const cb = new CircuitBreaker();
    expect(cb.shouldAllow('anthropic')).toBe(true);
    expect(cb.health('anthropic')).toBe('healthy');
  });

  it('opens after threshold consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.recordFailure('anthropic');
    cb.recordFailure('anthropic');
    expect(cb.health('anthropic')).toBe('degraded');
    cb.recordFailure('anthropic');
    expect(cb.health('anthropic')).toBe('open');
    expect(cb.shouldAllow('anthropic')).toBe(false);
  });

  it('resets to closed on success', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2 });
    cb.recordFailure('openai');
    cb.recordSuccess('openai');
    expect(cb.health('openai')).toBe('healthy');
  });

  it('transitions to half-open after cooldown', () => {
    let now = 1000;
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 5000, now: () => now });
    cb.recordFailure('google');
    expect(cb.shouldAllow('google')).toBe(false);
    now = 7000; // 6s elapsed > cooldown
    // First call after cooldown -> half-open trial allowed.
    expect(cb.shouldAllow('google')).toBe(true);
    // Subsequent call before resolution -> blocked.
    expect(cb.shouldAllow('google')).toBe(false);
    // Success closes the breaker.
    cb.recordSuccess('google');
    expect(cb.health('google')).toBe('healthy');
  });
});

describe('exponentialBackoffMs', () => {
  it('returns 0..baseMs for attempt 0', () => {
    const v = exponentialBackoffMs(0, { baseMs: 100, rng: () => 0.5 });
    expect(v).toBe(50);
  });

  it('doubles cap each attempt', () => {
    const v = exponentialBackoffMs(3, { baseMs: 100, rng: () => 1, maxMs: 10_000 });
    // baseMs * 2^3 = 800 < 10_000 cap; with rng=1 returns 800 (floor of 1*800).
    expect(v).toBeLessThanOrEqual(800);
  });

  it('caps at maxMs', () => {
    const v = exponentialBackoffMs(20, { baseMs: 100, maxMs: 500, rng: () => 1 });
    expect(v).toBeLessThanOrEqual(500);
  });
});

describe('runFallback', () => {
  it('returns success on primary when healthy', async () => {
    const ladder: ProviderLadderEntry[] = [
      { model: 'anthropic/claude-haiku-4-5', client: makeStubClient('anthropic', { type: 'ok', text: 'primary' }) },
      { model: 'openai/gpt-5', client: makeStubClient('openai', { type: 'ok', text: 'fallback' }) },
    ];
    const res = await runFallback(baseReq, ladder, { sleep: async () => undefined });
    expect(res.depth).toBe(0);
    expect((res.response.content[0] as { text: string }).text).toBe('primary');
    expect(res.attempts).toHaveLength(1);
  });

  it('walks past 503 to next provider', async () => {
    const err = new BrainLLMError({ code: 'SERVER_ERROR', message: '503', provider: 'anthropic', retryable: true });
    const ladder: ProviderLadderEntry[] = [
      { model: 'anthropic/claude-haiku-4-5', client: makeStubClient('anthropic', { type: 'throw', err }) },
      { model: 'anthropic/claude-haiku-4-5@bedrock', client: makeStubClient('anthropic-bedrock', { type: 'ok', text: 'bedrock-ok' }) },
    ];
    const res = await runFallback(baseReq, ladder, { sleep: async () => undefined });
    expect(res.depth).toBe(1);
    expect((res.response.content[0] as { text: string }).text).toBe('bedrock-ok');
    expect(res.attempts).toHaveLength(2);
    expect(res.attempts[0]!.error).toMatch(/503/);
  });

  it('fails fast on non-retryable 400', async () => {
    const err = new BrainLLMError({ code: 'CLIENT_ERROR', message: '400 bad request', provider: 'anthropic', retryable: false });
    const ladder: ProviderLadderEntry[] = [
      { model: 'anthropic/claude-haiku-4-5', client: makeStubClient('anthropic', { type: 'throw', err }) },
      { model: 'openai/gpt-5', client: makeStubClient('openai', { type: 'ok', text: 'never-called' }) },
    ];
    await expect(runFallback(baseReq, ladder, { sleep: async () => undefined })).rejects.toMatchObject({
      code: 'ALL_PROVIDERS_FAILED',
    });
  });

  it('skips open circuit and uses next provider', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 999_999 });
    cb.recordFailure('anthropic'); // trip
    const ladder: ProviderLadderEntry[] = [
      { model: 'anthropic/claude-haiku-4-5', client: makeStubClient('anthropic', { type: 'ok', text: 'never' }) },
      { model: 'openai/gpt-5', client: makeStubClient('openai', { type: 'ok', text: 'fallback-ok' }) },
    ];
    const res = await runFallback(baseReq, ladder, { breaker: cb, sleep: async () => undefined });
    expect(res.depth).toBe(1);
    expect(res.attempts[0]!.error).toBe('CIRCUIT_OPEN');
  });

  it('fires cross-family fallback hook on Claude -> GPT transition', async () => {
    const events: Array<{ from: string; to: string }> = [];
    const err = new BrainLLMError({ code: 'SERVER_ERROR', message: '503', provider: 'anthropic', retryable: true });
    const ladder: ProviderLadderEntry[] = [
      { model: 'anthropic/claude-haiku-4-5', client: makeStubClient('anthropic', { type: 'throw', err }) },
      { model: 'openai/gpt-5', client: makeStubClient('openai', { type: 'ok', text: 'gpt' }) },
    ];
    await runFallback(baseReq, ladder, {
      sleep: async () => undefined,
      onCrossFamilyFallback: (e) => events.push({ from: e.from, to: e.to }),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.from).toBe('anthropic/claude-haiku-4-5');
    expect(events[0]!.to).toBe('openai/gpt-5');
  });

  it('throws EMPTY_LADDER on empty ladder', async () => {
    await expect(runFallback(baseReq, [])).rejects.toMatchObject({ code: 'EMPTY_LADDER' });
  });

  it('reports ALL_PROVIDERS_FAILED when every provider fails', async () => {
    const err = new BrainLLMError({ code: 'SERVER_ERROR', message: '503', provider: 'anthropic', retryable: true });
    const ladder: ProviderLadderEntry[] = [
      { model: 'anthropic/claude-haiku-4-5', client: makeStubClient('anthropic', { type: 'throw', err }) },
      { model: 'openai/gpt-5', client: makeStubClient('openai', { type: 'throw', err }) },
    ];
    await expect(runFallback(baseReq, ladder, { sleep: async () => undefined })).rejects.toMatchObject({
      code: 'ALL_PROVIDERS_FAILED',
    });
  });
});
