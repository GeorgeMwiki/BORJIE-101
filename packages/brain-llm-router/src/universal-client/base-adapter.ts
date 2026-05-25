/**
 * Shared utilities for adapters.
 * Adapters are duck-typed: they MUST implement `BrainLLMClient`.
 *
 * Each adapter translates an Anthropic-style `BrainLLMRequest` OUT to its
 * provider's native API and back IN to a normalised `BrainLLMResponse`.
 *
 * Adapters never throw raw provider errors — they wrap in `BrainLLMError`
 * so the fallback layer can reason about retryability uniformly.
 */

import type { BrainLLMRequest, BrainLLMResponse, ProviderName } from '../types.js';
import { BrainLLMError } from '../types.js';

/** Generate a stable response id (no crypto dep — fits in 250 lines). */
export function makeResponseId(provider: ProviderName): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `msg_${provider}_${ts}_${rand}`;
}

/** Strip provider prefix from a canonical model id (`anthropic/claude-x` -> `claude-x`). */
export function stripProviderPrefix(model: string): string {
  const slashIdx = model.indexOf('/');
  if (slashIdx === -1) return model;
  return model.slice(slashIdx + 1);
}

/** Strip optional cloud suffix (`claude-x@bedrock` -> `claude-x`). */
export function stripCloudSuffix(model: string): string {
  const atIdx = model.indexOf('@');
  if (atIdx === -1) return model;
  return model.slice(0, atIdx);
}

/** Wrap an HTTP-style error/status into a `BrainLLMError` with retryability flag. */
export function wrapProviderError(
  provider: ProviderName,
  status: number | undefined,
  message: string
): BrainLLMError {
  // Retry on 429 (rate limit) and 5xx (server errors).
  const retryable = status === 429 || (typeof status === 'number' && status >= 500);
  const code =
    status === 429
      ? 'RATE_LIMITED'
      : status !== undefined && status >= 500
        ? 'SERVER_ERROR'
        : status !== undefined && status >= 400
          ? 'CLIENT_ERROR'
          : 'UNKNOWN';
  return new BrainLLMError({ code, message, provider, retryable });
}

/** Type guard — checks whether `obj` is a non-null record. */
export function isRecord(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

/** Default timeout for adapter HTTP calls (overridable per request). */
export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Tiny http JSON helper. Adapters call this so we only need ONE place to
 * mock for tests. Returns parsed JSON + status. Throws BrainLLMError on
 * network failure.
 *
 * Adapters accept an injected `fetchFn` so tests can stub without monkey-
 * patching global fetch.
 */
export type FetchFn = (
  url: string,
  init: { readonly method: string; readonly headers: Readonly<Record<string, string>>; readonly body: string; readonly signal?: AbortSignal }
) => Promise<{ readonly status: number; readonly json: () => Promise<unknown>; readonly text: () => Promise<string> }>;

export async function adapterFetchJson(
  provider: ProviderName,
  url: string,
  init: {
    readonly headers: Readonly<Record<string, string>>;
    readonly body: unknown;
    readonly timeoutMs?: number;
    readonly fetchFn: FetchFn;
  }
): Promise<{ readonly status: number; readonly body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    init.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  try {
    const res = await init.fetchFn(url, {
      method: 'POST',
      headers: init.headers,
      body: JSON.stringify(init.body),
      signal: controller.signal,
    });
    if (res.status >= 400) {
      const txt = await res.text().catch(() => '');
      throw wrapProviderError(provider, res.status, `${provider} ${res.status}: ${txt}`);
    }
    const body = await res.json();
    return { status: res.status, body };
  } catch (err) {
    if (err instanceof BrainLLMError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new BrainLLMError({
      code: 'NETWORK_ERROR',
      message: `${provider} network failure: ${msg}`,
      provider,
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Helper for adapters: assemble base usage when provider returns partial data. */
export function safeUsage(input: number | undefined, output: number | undefined): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: typeof input === 'number' ? input : 0,
    outputTokens: typeof output === 'number' ? output : 0,
  };
}

/** Ensure `req.messages` non-empty. Throws BrainLLMError otherwise. */
export function requireMessages(req: BrainLLMRequest, provider: ProviderName): void {
  if (req.messages.length === 0) {
    throw new BrainLLMError({
      code: 'INVALID_REQUEST',
      message: 'messages array must be non-empty',
      provider,
      retryable: false,
    });
  }
}

/** Helper to build a "blank" response object adapters can spread into. */
export function blankResponse(provider: ProviderName, model: string, latencyMs: number): BrainLLMResponse {
  return {
    id: makeResponseId(provider),
    model,
    provider,
    content: [],
    stopReason: 'end_turn',
    usage: { inputTokens: 0, outputTokens: 0 },
    latencyMs,
  };
}
