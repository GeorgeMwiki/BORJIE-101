/**
 * provider-fallback/ — iterate a ladder of `BrainLLMClient` adapters with
 * circuit-breaker + exponential backoff.
 *
 * Pattern (research §2.1):
 *   ladder = [Anthropic Direct, Anthropic@Bedrock, Anthropic@Vertex, OpenAI fallback]
 *   on retryable error (429/5xx/timeout): next provider
 *   on non-retryable error (4xx): fail fast
 *   open breaker => skip provider; no waste calls
 *
 * Same Claude weights across Anthropic Direct / Bedrock / Vertex = no
 * quality change on fallback. OpenAI is logged + alerted.
 */

import type {
  BrainLLMClient,
  BrainLLMRequest,
  BrainLLMResponse,
  ModelTier,
  ProviderName,
} from '../types.js';
import { BrainLLMError } from '../types.js';
import { CircuitBreaker, exponentialBackoffMs } from './circuit-breaker.js';

export interface FallbackAttempt {
  readonly provider: ProviderName;
  readonly model: ModelTier;
  readonly error?: string;
  readonly latencyMs?: number;
  readonly succeeded: boolean;
}

export interface FallbackResult {
  readonly response: BrainLLMResponse;
  readonly attempts: readonly FallbackAttempt[];
  /** Depth in the ladder where success occurred (0 = primary). */
  readonly depth: number;
}

export interface ProviderLadderEntry {
  readonly model: ModelTier;
  readonly client: BrainLLMClient;
}

export interface FallbackConfig {
  readonly breaker?: CircuitBreaker;
  /** Sleep function (ms => Promise<void>). Defaults to setTimeout. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Hook called on cross-family fallback (e.g. Claude -> GPT). */
  readonly onCrossFamilyFallback?: (event: { from: ModelTier; to: ModelTier; reason: string }) => void;
  /** Max backoff between attempts (ms). */
  readonly maxBackoffMs?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Walk a ladder of (model, client) pairs, returning the first successful
 * response. Open circuit breakers are skipped. Retryable failures advance
 * to the next provider after backoff. Non-retryable errors fail fast.
 */
export async function runFallback(
  req: BrainLLMRequest,
  ladder: readonly ProviderLadderEntry[],
  config: FallbackConfig = {}
): Promise<FallbackResult> {
  if (ladder.length === 0) {
    throw new BrainLLMError({
      code: 'EMPTY_LADDER',
      message: 'provider-fallback ladder cannot be empty',
      retryable: false,
    });
  }

  const breaker = config.breaker ?? new CircuitBreaker();
  const sleep = config.sleep ?? defaultSleep;
  const attempts: FallbackAttempt[] = [];

  let lastError: unknown;
  let previousFamily: string | undefined;

  for (let depth = 0; depth < ladder.length; depth += 1) {
    const entry = ladder[depth]!;
    const provider = entry.client.provider;

    // Skip open circuit (no waste call).
    if (!breaker.shouldAllow(provider)) {
      attempts.push({
        provider,
        model: entry.model,
        error: 'CIRCUIT_OPEN',
        succeeded: false,
      });
      continue;
    }

    // Cross-family detection (Claude -> GPT etc.) — log + alert hook.
    const currentFamily = modelFamily(entry.model);
    if (previousFamily !== undefined && previousFamily !== currentFamily && config.onCrossFamilyFallback) {
      const prev = ladder[depth - 1]!.model;
      config.onCrossFamilyFallback({ from: prev, to: entry.model, reason: 'CROSS_FAMILY_FALLBACK' });
    }
    previousFamily = currentFamily;

    const started = Date.now();
    try {
      const response = await entry.client.invoke({ ...req, model: entry.model });
      const latencyMs = Date.now() - started;
      breaker.recordSuccess(provider);
      attempts.push({ provider, model: entry.model, succeeded: true, latencyMs });
      return { response, attempts: Object.freeze([...attempts]), depth };
    } catch (err) {
      const latencyMs = Date.now() - started;
      lastError = err;
      breaker.recordFailure(provider);
      const errMsg = err instanceof Error ? err.message : String(err);
      attempts.push({ provider, model: entry.model, error: errMsg, succeeded: false, latencyMs });

      // Non-retryable -> fail fast (don't waste calls on bad request).
      if (err instanceof BrainLLMError && !err.retryable) {
        break;
      }

      // Exponential backoff before next provider.
      if (depth < ladder.length - 1) {
        const backoff = exponentialBackoffMs(depth, { maxMs: config.maxBackoffMs ?? 5_000 });
        if (backoff > 0) await sleep(backoff);
      }
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown');
  throw new BrainLLMError({
    code: 'ALL_PROVIDERS_FAILED',
    message: `All providers in ladder failed. Last error: ${reason}`,
    retryable: false,
  });
}

/** Extract model family from id ("anthropic/claude-opus-4-7" -> "anthropic"). */
function modelFamily(model: ModelTier): string {
  const slash = model.indexOf('/');
  return slash === -1 ? model : model.slice(0, slash);
}
