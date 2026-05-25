/**
 * Shared Anthropic Client
 *
 * A thin, focused wrapper around `@anthropic-ai/sdk`'s `Anthropic` class used
 * by AI services migrating off OpenAI. Key concerns:
 *
 *  - Typed `generateStructured<T>` helper that returns Zod-validated JSON.
 *  - Retry loop on schema parse failure (up to 2 retries with reinforcement).
 *  - Opus "advisor gate" — consult Opus with the same prompt and compare
 *    responses for high-stakes or ambiguous decisions.
 *  - Deterministic `ModelTier` constants pinned to 2026 model IDs.
 *
 * The module is intentionally decoupled from the richer `AIProvider`
 * abstraction in `ai-provider.ts` — downstream services only need a
 * lightweight structured-generation primitive.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Model tier constants (2026 Anthropic Messages API model IDs)
// ---------------------------------------------------------------------------

/**
 * Canonical model IDs used across the copilot. Mirrors `ANTHROPIC_MODELS` in
 * `anthropic.ts` so both modules can co-exist without drift.
 */
export const ModelTier = {
  HAIKU: 'claude-haiku-4-5-20251001',
  SONNET: 'claude-sonnet-4-6',
  OPUS: 'claude-opus-4-6',
} as const;

export type ModelTierId = (typeof ModelTier)[keyof typeof ModelTier];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AnthropicClientConfig {
  /** Required Anthropic API key (typically `process.env.ANTHROPIC_API_KEY`). */
  apiKey: string;
  /**
   * Default model used by `generateStructured` when no `model` is supplied.
   * Prefer `ModelTier.SONNET` for general structured output.
   */
  defaultModel: ModelTierId | string;
  /** Request timeout (ms). Default: 60_000. */
  timeout?: number;
  /**
   * Max SDK-level retries for transient HTTP errors (429, 5xx). Distinct from
   * schema-parse retries (handled by `generateStructured` itself). Default: 2.
   */
  maxRetries?: number;
}

/**
 * Minimal shape of the `@anthropic-ai/sdk` client surface we rely on. Keeping
 * this local lets tests inject a hand-rolled stub without pulling the SDK.
 */
export interface AnthropicClient {
  readonly defaultModel: ModelTierId | string;
  readonly sdk: AnthropicSdkLike;
}

/**
 * Structural type of the Anthropic SDK's `messages.create` surface. Declared
 * here so callers can mock the client in unit tests without a network.
 */
export interface AnthropicSdkLike {
  messages: {
    create(request: AnthropicMessageRequest): Promise<AnthropicMessageResponse>;
  };
}

export interface AnthropicMessageRequest {
  model: string;
  max_tokens: number;
  temperature?: number;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AnthropicMessageResponse {
  content: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build an `AnthropicClient` wrapping `@anthropic-ai/sdk`'s `Anthropic` class.
 *
 * Throws synchronously if `apiKey` is missing so we fail loud at boot time.
 */
export function createAnthropicClient(
  config: AnthropicClientConfig
): AnthropicClient {
  if (!config.apiKey || typeof config.apiKey !== 'string') {
    throw new Error(
      'createAnthropicClient: apiKey is required (set ANTHROPIC_API_KEY).'
    );
  }
  if (!config.defaultModel) {
    throw new Error('createAnthropicClient: defaultModel is required.');
  }

  const sdk = new Anthropic({
    apiKey: config.apiKey,
    timeout: config.timeout ?? 60_000,
    maxRetries: config.maxRetries ?? 2,
  }) as unknown as AnthropicSdkLike;

  return Object.freeze({
    defaultModel: config.defaultModel,
    sdk,
  });
}

// ---------------------------------------------------------------------------
// Structured generation
// ---------------------------------------------------------------------------

export interface GenerateStructuredOptions<T> {
  /** User-facing prompt. Use {@link systemPrompt} for role framing. */
  prompt: string;
  /** Zod schema validating the returned JSON. */
  schema: z.ZodType<T>;
  /** Optional model override. Defaults to `client.defaultModel`. */
  model?: ModelTierId | string;
  /** Sampling temperature. Default: 0.2 (favor determinism for JSON). */
  temperature?: number;
  /** Optional system prompt. */
  systemPrompt?: string;
  /** Max completion tokens. Default: 4096. */
  maxTokens?: number;
  /**
   * When true, consult Opus with the same prompt after the primary model
   * returns. The result includes an `advisorAgreement` narration + boolean
   * disagreement flag so callers can decide how to resolve.
   */
  advisorGate?: boolean;
  /**
   * Max schema-parse retries. Each retry reinforces the JSON-only directive.
   * Default: 2 retries (3 total attempts).
   */
  maxParseRetries?: number;
}

export interface GenerateStructuredResult<T> {
  data: T;
  modelId: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Number of extra attempts used to recover valid JSON. 0 = first try. */
  parseRetriesUsed: number;
  advisorAgreement?: {
    opusData: T;
    disagreement: boolean;
    narration: string;
  };
}

/**
 * Error thrown when structured generation cannot produce schema-valid JSON
 * within the configured retry budget.
 */
export class StructuredGenerationFailedError extends Error {
  readonly attempts: number;
  readonly lastRawContent: string;
  readonly zodIssues?: z.ZodIssue[];

  constructor(params: {
    attempts: number;
    lastRawContent: string;
    zodIssues?: z.ZodIssue[];
    cause?: unknown;
  }) {
    super(
      `Anthropic structured generation failed after ${params.attempts} attempt(s). ` +
        `Response did not match schema.`
    );
    this.name = 'StructuredGenerationFailedError';
    this.attempts = params.attempts;
    this.lastRawContent = params.lastRawContent;
    this.zodIssues = params.zodIssues;
    if (params.cause !== undefined) {
      (this as { cause?: unknown }).cause = params.cause;
    }
  }
}

const DEFAULT_MAX_PARSE_RETRIES = 2;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.2;

const JSON_ONLY_REINFORCEMENT =
  'Return ONLY a single valid JSON object matching the requested schema. ' +
  'No markdown fences, no prose, no commentary. Your entire response must ' +
  'parse as JSON and match the schema exactly.';

/**
 * Generate structured, Zod-validated JSON from Anthropic. Retries on schema
 * parse failure up to `maxParseRetries` times, reinforcing the JSON-only
 * directive. Optionally consults Opus for an advisor gate check.
 */
export async function generateStructured<T>(
  client: AnthropicClient,
  options: GenerateStructuredOptions<T>
): Promise<GenerateStructuredResult<T>> {
  const model = options.model ?? client.defaultModel;
  const maxRetries = options.maxParseRetries ?? DEFAULT_MAX_PARSE_RETRIES;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const temperature = options.temperature ?? DEFAULT_TEMPERATURE;

  const primary = await runWithSchemaRetry({
    client,
    model,
    systemPrompt: options.systemPrompt,
    prompt: options.prompt,
    schema: options.schema,
    temperature,
    maxTokens,
    maxRetries,
  });

  if (!options.advisorGate) {
    return primary;
  }

  // Advisor gate: re-run the same prompt through Opus. Accumulate usage so
  // callers see the true cost of the gated turn.
  const opus = await runWithSchemaRetry({
    client,
    model: ModelTier.OPUS,
    systemPrompt: options.systemPrompt,
    prompt: options.prompt,
    schema: options.schema,
    temperature,
    maxTokens,
    maxRetries,
  });

  const disagreement = !deepEqual(primary.data, opus.data);
  return {
    ...primary,
    usage: {
      promptTokens: primary.usage.promptTokens + opus.usage.promptTokens,
      completionTokens:
        primary.usage.completionTokens + opus.usage.completionTokens,
      totalTokens: primary.usage.totalTokens + opus.usage.totalTokens,
    },
    advisorAgreement: {
      opusData: opus.data,
      disagreement,
      narration: disagreement
        ? 'Advisor (Opus) disagrees with primary model output. Caller should resolve.'
        : 'Advisor (Opus) agrees with primary model output.',
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface RunArgs<T> {
  client: AnthropicClient;
  model: ModelTierId | string;
  systemPrompt?: string;
  prompt: string;
  schema: z.ZodType<T>;
  temperature: number;
  maxTokens: number;
  maxRetries: number;
}

async function runWithSchemaRetry<T>(
  args: RunArgs<T>
): Promise<GenerateStructuredResult<T>> {
  const totalAttempts = args.maxRetries + 1;
  let lastRaw = '';
  let lastIssues: z.ZodIssue[] | undefined;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const userContent =
      attempt === 0
        ? args.prompt
        : `${args.prompt}\n\n${JSON_ONLY_REINFORCEMENT}\n\nPrior response failed validation. Return corrected JSON only.`;

    let response: AnthropicMessageResponse;
    try {
      response = await args.client.sdk.messages.create({
        model: args.model,
        max_tokens: args.maxTokens,
        temperature: args.temperature,
        system: args.systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      });
    } catch (error) {
      throw new Error(
        `Anthropic messages.create failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const rawText = extractText(response);
    lastRaw = rawText;
    totalPromptTokens += response.usage?.input_tokens ?? 0;
    totalCompletionTokens += response.usage?.output_tokens ?? 0;

    const parsed = tryParseSchema(rawText, args.schema);
    if (parsed.ok === true) {
      return {
        data: parsed.value,
        modelId: args.model,
        usage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens: totalPromptTokens + totalCompletionTokens,
        },
        parseRetriesUsed: attempt,
      };
    } else {
      lastIssues = parsed.issues;
    }
  }

  throw new StructuredGenerationFailedError({
    attempts: totalAttempts,
    lastRawContent: lastRaw,
    zodIssues: lastIssues,
  });
}

function extractText(response: AnthropicMessageResponse): string {
  if (!Array.isArray(response.content)) return '';
  return response.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: z.ZodIssue[] };

function tryParseSchema<T>(
  raw: string,
  schema: z.ZodType<T>
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

/**
 * Structural deep equality for JSON-safe values — sufficient for comparing
 * two Zod-parsed results of the same schema.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(bObj, k)) return false;
      if (!deepEqual(aObj[k], bObj[k])) return false;
    }
    return true;
  }
  return false;
}
