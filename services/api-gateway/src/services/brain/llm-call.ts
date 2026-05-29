/**
 * Brain LLM call helper — G-FIX-2 (R15/R16/R17 brain paths).
 *
 * A thin Anthropic SDK wrapper for the three "heuristic stub" brain
 * paths the audit flagged in Gap-2 (inspection narrator, negotiation
 * counter-offer, RAG citation parser). Provides:
 *
 *   - createBrainLlmClient(): lazy-instantiates an Anthropic SDK
 *     instance from `ANTHROPIC_API_KEY` (read once at bootstrap by
 *     dotenv per CLAUDE.md). Returns `null` when the key is missing
 *     so callers can degrade gracefully.
 *   - callBrainLlmJson(): a structured-output call with
 *     5-minute ephemeral `cache_control` markers on the system prompt
 *     (matches Anthropic prompt-caching docs — single highest-ROI
 *     marker per request). Parses the response into the caller's
 *     Zod schema with two retries on parse failure.
 *   - withLlmOrHeuristic(): graceful-degradation wrapper that runs
 *     the heuristic when the LLM is unavailable, errors out, or
 *     returns evidence-empty output (per CLAUDE.md grounding rule).
 *
 * The cache_control marker is placed on the system prompt because
 * across consecutive narrator/counter-offer/citation calls within a
 * session the system + tenant context block is stable while the
 * user payload changes — this is the canonical Anthropic caching
 * pattern (https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching).
 *
 * Per CLAUDE.md:
 *   - Pino logger only (callers pass their service-scoped logger).
 *   - No `process.env` reads outside this bootstrap helper itself.
 *   - Evidence-required wrapper — output without ≥1 `evidence_id`
 *     marker is rejected and the heuristic is used as fallback.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Model constants (2026 Anthropic IDs)
// ---------------------------------------------------------------------------

export const BRAIN_LLM_MODELS = {
  HAIKU: 'claude-haiku-4-5-20251001',
  SONNET: 'claude-sonnet-4-6',
  OPUS: 'claude-opus-4-6',
} as const;

export type BrainLlmModelId =
  (typeof BRAIN_LLM_MODELS)[keyof typeof BRAIN_LLM_MODELS];

// ---------------------------------------------------------------------------
// Client surface — thin facade so tests can inject a hand-rolled stub
// ---------------------------------------------------------------------------

export interface BrainLlmClient {
  readonly model: BrainLlmModelId | string;
  readonly sdk: BrainLlmSdkLike;
}

export interface BrainLlmSdkLike {
  readonly messages: {
    create(
      request: BrainLlmMessageRequest,
    ): Promise<BrainLlmMessageResponse>;
  };
}

export interface BrainLlmCacheControl {
  readonly type: 'ephemeral';
}

export const EPHEMERAL_CACHE: BrainLlmCacheControl = Object.freeze({
  type: 'ephemeral',
});

export interface BrainLlmTextBlock {
  readonly type: 'text';
  readonly text: string;
  readonly cache_control?: BrainLlmCacheControl;
}

export interface BrainLlmMessageRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly temperature?: number;
  readonly system?: string | ReadonlyArray<BrainLlmTextBlock>;
  readonly messages: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly content: string;
  }>;
}

export interface BrainLlmMessageResponse {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly stop_reason?: string;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
}

// ---------------------------------------------------------------------------
// Factory — lazy, env-gated
// ---------------------------------------------------------------------------

export interface CreateBrainLlmClientOptions {
  readonly apiKey?: string | undefined;
  readonly model?: BrainLlmModelId | string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly logger?: Logger | undefined;
}

/**
 * Create an Anthropic-backed brain LLM client. Returns `null` when the
 * API key is missing — callers MUST handle this and fall back to the
 * heuristic. We deliberately do NOT read `process.env` here; the
 * caller passes the key from the api-gateway bootstrap dotenv pass.
 */
export function createBrainLlmClient(
  options: CreateBrainLlmClientOptions = {},
): BrainLlmClient | null {
  const apiKey =
    options.apiKey ?? (typeof process !== 'undefined'
      ? process.env['ANTHROPIC_API_KEY']
      : undefined);
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length === 0) {
    options.logger?.warn(
      { module: 'brain-llm-call' },
      'ANTHROPIC_API_KEY missing — brain LLM paths will use heuristic fallback',
    );
    return null;
  }
  const sdk = new Anthropic({
    apiKey,
    timeout: options.timeoutMs ?? 60_000,
    maxRetries: options.maxRetries ?? 2,
  }) as unknown as BrainLlmSdkLike;
  return Object.freeze({
    model: options.model ?? BRAIN_LLM_MODELS.SONNET,
    sdk,
  });
}

// ---------------------------------------------------------------------------
// Structured-output call with cache_control + Zod parse + 2 retries
// ---------------------------------------------------------------------------

export interface CallBrainLlmJsonOptions<T> {
  readonly client: BrainLlmClient;
  readonly system: string;
  readonly user: string;
  readonly schema: z.ZodType<T>;
  readonly model?: BrainLlmModelId | string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly maxParseRetries?: number;
  readonly logger?: Logger | undefined;
}

export interface BrainLlmJsonResult<T> {
  readonly data: T;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly parseRetriesUsed: number;
}

const JSON_REINFORCEMENT =
  'Return ONLY a single valid JSON object matching the requested schema. ' +
  'No markdown fences, no prose, no commentary. Your entire response must ' +
  'parse as JSON and match the schema exactly.';

export async function callBrainLlmJson<T>(
  options: CallBrainLlmJsonOptions<T>,
): Promise<BrainLlmJsonResult<T>> {
  const model = options.model ?? options.client.model;
  const maxTokens = options.maxTokens ?? 2048;
  const temperature = options.temperature ?? 0.2;
  const maxRetries = options.maxParseRetries ?? 2;

  let lastRaw = '';
  let lastIssues: z.ZodIssue[] | undefined;
  let promptTokens = 0;
  let completionTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const userContent =
      attempt === 0
        ? options.user
        : `${options.user}\n\n${JSON_REINFORCEMENT}\n\nPrior response failed schema validation. Return corrected JSON only.`;

    const response = await options.client.sdk.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      // System prompt as a single text block with `cache_control:
      // ephemeral`. Anthropic caches everything UP TO AND INCLUDING
      // this block for ~5 minutes — see prompt-caching docs.
      system: [
        {
          type: 'text',
          text: options.system,
          cache_control: EPHEMERAL_CACHE,
        },
      ],
      messages: [{ role: 'user', content: userContent }],
    });

    const text = extractText(response);
    lastRaw = text;
    promptTokens += response.usage?.input_tokens ?? 0;
    completionTokens += response.usage?.output_tokens ?? 0;
    cacheReadTokens += response.usage?.cache_read_input_tokens ?? 0;
    cacheWriteTokens += response.usage?.cache_creation_input_tokens ?? 0;

    const parsed = tryParseSchema(text, options.schema);
    if (parsed.ok) {
      return {
        data: parsed.value,
        model,
        promptTokens,
        completionTokens,
        cacheReadTokens,
        cacheWriteTokens,
        parseRetriesUsed: attempt,
      };
    }
    lastIssues = parsed.issues;
  }

  const issues = lastIssues ?? [];
  const err = new Error(
    `Brain LLM JSON parse failed after ${maxRetries + 1} attempts (model=${model})`,
  ) as Error & {
    readonly lastRaw: string;
    readonly zodIssues: z.ZodIssue[];
  };
  Object.defineProperty(err, 'lastRaw', { value: lastRaw, enumerable: true });
  Object.defineProperty(err, 'zodIssues', { value: issues, enumerable: true });
  throw err;
}

// ---------------------------------------------------------------------------
// Evidence-required graceful-degradation wrapper
// ---------------------------------------------------------------------------

export interface WithLlmOrHeuristicOptions<TOut> {
  readonly llmAttempt: () => Promise<TOut>;
  readonly heuristic: () => Promise<TOut>;
  readonly hasEvidence: (out: TOut) => boolean;
  readonly logger?: Logger | undefined;
  readonly pathName: string;
}

/**
 * Run the LLM attempt. On any error, or if the LLM result fails the
 * evidence-required check, log a Pino warn and fall back to the
 * heuristic. The heuristic always wins on the no-LLM path — this is
 * the "wiring is what we ship, activation happens when key is set"
 * contract from the gap brief.
 */
export async function withLlmOrHeuristic<TOut>(
  options: WithLlmOrHeuristicOptions<TOut>,
): Promise<TOut> {
  try {
    const llmOut = await options.llmAttempt();
    if (!options.hasEvidence(llmOut)) {
      options.logger?.warn(
        { path: options.pathName },
        'brain LLM output missing evidence — falling back to heuristic',
      );
      return await options.heuristic();
    }
    return llmOut;
  } catch (err) {
    options.logger?.warn(
      { err, path: options.pathName },
      'brain LLM call failed — falling back to heuristic',
    );
    return await options.heuristic();
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function extractText(response: BrainLlmMessageResponse): string {
  if (!Array.isArray(response.content)) return '';
  return response.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}

type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: z.ZodIssue[] };

function tryParseSchema<T>(
  raw: string,
  schema: z.ZodType<T>,
): ParseResult<T> {
  const candidate = stripFences(raw).trim();
  if (!candidate) return { ok: false, issues: [] };
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(candidate);
  } catch {
    return { ok: false, issues: [] };
  }
  const result = schema.safeParse(parsedJson);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, issues: result.error.issues };
}

function stripFences(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenceMatch ? (fenceMatch[1] ?? '') : raw;
}
