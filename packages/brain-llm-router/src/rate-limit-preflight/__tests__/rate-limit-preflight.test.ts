/**
 * Tests for the rate-limit pre-flight gate.
 *
 * Covers: Anthropic + OpenAI header parsing, retry-after seconds + HTTP-date,
 * stale-window detection, error-from-error extraction, snapshot immutability.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RateLimitNearExhaustionError,
  checkRateLimitFloor,
  extractRetryAfterMsFromError,
} from '../preflight-gate.js';
import {
  parseRetryAfterMs,
  updateRateLimitFromHeaders,
} from '../header-parser.js';
import {
  getProviderRateLimitState,
  resetProviderRateLimitState,
} from '../rate-limit-state.js';

function buildHeaders(map: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(map)) h.set(k, v);
  return h;
}

beforeEach(() => {
  resetProviderRateLimitState();
});

afterEach(() => {
  resetProviderRateLimitState();
});

describe('checkRateLimitFloor — initial state', () => {
  it('noops for anthropic before any header observed', () => {
    expect(() => checkRateLimitFloor('anthropic')).not.toThrow();
  });

  it('noops for openai before any header observed', () => {
    expect(() => checkRateLimitFloor('openai')).not.toThrow();
  });
});

describe('updateRateLimitFromHeaders + checkRateLimitFloor — Anthropic', () => {
  it('parses requests-remaining + requests-reset', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    updateRateLimitFromHeaders(
      'anthropic',
      buildHeaders({
        'anthropic-ratelimit-requests-remaining': '42',
        'anthropic-ratelimit-requests-reset': future,
      }),
    );
    const state = getProviderRateLimitState();
    expect(state.anthropic.requestsRemaining).toBe(42);
    expect(state.anthropic.requestsResetMs).toBe(Date.parse(future));
  });

  it('throws RateLimitNearExhaustionError when requestsRemaining <= 1', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    updateRateLimitFromHeaders(
      'anthropic',
      buildHeaders({
        'anthropic-ratelimit-requests-remaining': '1',
        'anthropic-ratelimit-requests-reset': future,
      }),
    );
    expect(() => checkRateLimitFloor('anthropic')).toThrowError(
      RateLimitNearExhaustionError,
    );
  });

  it('throws when tokensRemaining <= 1', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    updateRateLimitFromHeaders(
      'anthropic',
      buildHeaders({
        'anthropic-ratelimit-tokens-remaining': '0',
        'anthropic-ratelimit-tokens-reset': future,
      }),
    );
    expect(() => checkRateLimitFloor('anthropic')).toThrowError(
      RateLimitNearExhaustionError,
    );
  });

  it('does NOT throw when reset window has passed (stale floor)', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    updateRateLimitFromHeaders(
      'anthropic',
      buildHeaders({
        'anthropic-ratelimit-requests-remaining': '0',
        'anthropic-ratelimit-requests-reset': past,
      }),
    );
    expect(() => checkRateLimitFloor('anthropic')).not.toThrow();
  });

  it('ignores malformed numeric headers', () => {
    updateRateLimitFromHeaders(
      'anthropic',
      buildHeaders({
        'anthropic-ratelimit-requests-remaining': 'not-a-number',
      }),
    );
    expect(getProviderRateLimitState().anthropic.requestsRemaining).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('updateRateLimitFromHeaders — OpenAI', () => {
  it('parses x-ratelimit-* headers with seconds suffix', () => {
    const start = Date.now();
    updateRateLimitFromHeaders(
      'openai',
      buildHeaders({
        'x-ratelimit-remaining-requests': '5',
        'x-ratelimit-reset-requests': '30s',
      }),
      () => start,
    );
    const s = getProviderRateLimitState().openai;
    expect(s.requestsRemaining).toBe(5);
    expect(s.requestsResetMs).toBe(start + 30_000);
  });

  it('parses ms suffix', () => {
    const start = Date.now();
    updateRateLimitFromHeaders(
      'openai',
      buildHeaders({
        'x-ratelimit-remaining-tokens': '99',
        'x-ratelimit-reset-tokens': '500ms',
      }),
      () => start,
    );
    expect(getProviderRateLimitState().openai.tokensResetMs).toBe(start + 500);
  });

  it('parses bare-number duration as seconds', () => {
    const start = Date.now();
    updateRateLimitFromHeaders(
      'openai',
      buildHeaders({
        'x-ratelimit-reset-requests': '7',
      }),
      () => start,
    );
    expect(getProviderRateLimitState().openai.requestsResetMs).toBe(start + 7000);
  });
});

describe('parseRetryAfterMs', () => {
  it('parses integer seconds (RFC 7231)', () => {
    const ms = parseRetryAfterMs(buildHeaders({ 'retry-after': '30' }));
    expect(ms).toBe(30_000);
  });

  it('caps at 5 minutes', () => {
    const ms = parseRetryAfterMs(buildHeaders({ 'retry-after': '3600' }));
    expect(ms).toBe(5 * 60 * 1000);
  });

  it('parses HTTP-date relative to now()', () => {
    const start = 1_000_000;
    const futureMs = start + 120_000;
    const ms = parseRetryAfterMs(
      buildHeaders({ 'retry-after': new Date(futureMs).toUTCString() }),
      () => start,
    );
    expect(ms).toBeGreaterThanOrEqual(119_000);
    expect(ms).toBeLessThanOrEqual(121_000);
  });

  it('returns null on absent header', () => {
    expect(parseRetryAfterMs(buildHeaders({}))).toBeNull();
  });

  it('returns null on garbage', () => {
    expect(parseRetryAfterMs(buildHeaders({ 'retry-after': 'banana' }))).toBeNull();
  });

  it('returns null when headers is undefined', () => {
    expect(parseRetryAfterMs(undefined)).toBeNull();
  });
});

describe('extractRetryAfterMsFromError', () => {
  it('extracts from real Headers instance', () => {
    const err = { headers: buildHeaders({ 'retry-after': '15' }) };
    expect(extractRetryAfterMsFromError(err)).toBe(15_000);
  });

  it('extracts from plain-object header dictionary', () => {
    const err = { headers: { 'Retry-After': '12' } };
    expect(extractRetryAfterMsFromError(err)).toBe(12_000);
  });

  it('returns undefined on non-object', () => {
    expect(extractRetryAfterMsFromError('boom')).toBeUndefined();
  });

  it('returns undefined when err lacks headers', () => {
    expect(extractRetryAfterMsFromError({ foo: 1 })).toBeUndefined();
  });
});

describe('getProviderRateLimitState — snapshot immutability', () => {
  it('returns shallow clones (mutating snapshot does not affect live state)', () => {
    updateRateLimitFromHeaders(
      'anthropic',
      buildHeaders({ 'anthropic-ratelimit-requests-remaining': '50' }),
    );
    const snap = getProviderRateLimitState();
    (snap.anthropic as { requestsRemaining: number }).requestsRemaining = 9999;
    expect(getProviderRateLimitState().anthropic.requestsRemaining).toBe(50);
  });
});
