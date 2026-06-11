/**
 * anthropic-llm.ts — Anthropic-backed implementation of `BenchLlmPort`.
 *
 * Loaded only when `ANTHROPIC_API_KEY` is set. We avoid a hard dependency
 * on the Anthropic SDK so the bench package stays small + CI-friendly;
 * instead we drive the REST API directly via `fetch` (Node 18+).
 *
 * Default model: Sonnet 4.6 (configurable via `BENCH_ANTHROPIC_MODEL`).
 * Phase F may swap this for the `@borjie/ai-copilot` multi-LLM router
 * once the eval package is workspace-linked.
 */

import type { BenchLlmPort, BenchLlmRequest, BenchLlmResponse } from './llm-port.js';

interface AnthropicMessage {
  readonly role: 'user';
  readonly content: string;
}

interface AnthropicResponseBlock {
  readonly type: string;
  readonly text?: string;
}

interface AnthropicResponse {
  readonly content: ReadonlyArray<AnthropicResponseBlock>;
  readonly usage?: {
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
  readonly model?: string;
}

/**
 * In-code floor — mirrors the dynamic-registry L3 sonnet baseline
 * (`packages/brain-llm-router/src/dynamic-registry/baselines.ts`).
 */
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 1024;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Intelligence-Elasticity: the bench tracks the DEPLOYED brain's
 * standard tier so nightly evals exercise the same model the gateway
 * composition resolves. This package is not workspace-linked, so we
 * honor the SAME env knobs instead of importing the registry:
 *
 *   1. `explicit` (opts.model)         — programmatic pin (tests)
 *   2. `BENCH_ANTHROPIC_MODEL`         — explicit bench override
 *   3. `BORJIE_MODEL_TIER_STANDARD`    — the composition-root tier map
 *   4. `BORJIE_MODEL_BASELINE_SONNET`  — the dynamic-registry L3 override
 *   5. `DEFAULT_MODEL`                 — in-code floor (= shipped baseline)
 */
export function resolveBenchModel(explicit?: string): string {
  return (
    nonEmpty(explicit) ??
    nonEmpty(process.env.BENCH_ANTHROPIC_MODEL) ??
    nonEmpty(process.env.BORJIE_MODEL_TIER_STANDARD) ??
    nonEmpty(process.env.BORJIE_MODEL_BASELINE_SONNET) ??
    DEFAULT_MODEL
  );
}

// Sonnet 4.6 list pricing as of 2026-04: $3/MTok input, $15/MTok output.
// Used purely as a per-call cost estimator for the cost-efficiency scorer.
const INPUT_USD_PER_MTOK = 3;
const OUTPUT_USD_PER_MTOK = 15;

export interface AnthropicLlmOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly endpoint?: string;
}

export function createAnthropicLlm(opts: AnthropicLlmOptions): BenchLlmPort {
  const model = resolveBenchModel(opts.model);
  const endpoint = opts.endpoint ?? 'https://api.anthropic.com/v1/messages';
  const apiKey = opts.apiKey;

  return Object.freeze({
    async complete(req: BenchLlmRequest): Promise<BenchLlmResponse> {
      const userMsg: AnthropicMessage = { role: 'user', content: req.user };
      const body = {
        model,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: req.system,
        messages: [userMsg],
        temperature: 0.2,
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '<no body>');
        throw new Error(
          `Anthropic API ${res.status} for task ${req.taskId}: ${errText}`,
        );
      }

      const parsed = (await res.json()) as AnthropicResponse;
      const text = (parsed.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('\n')
        .trim();

      const inTok = parsed.usage?.input_tokens ?? 0;
      const outTok = parsed.usage?.output_tokens ?? 0;
      const usdCost =
        (inTok * INPUT_USD_PER_MTOK) / 1_000_000 +
        (outTok * OUTPUT_USD_PER_MTOK) / 1_000_000;
      const costUsdCents = Math.max(1, Math.round(usdCost * 100));

      return Object.freeze({
        text,
        costUsdCents,
        provider: 'anthropic',
        model: parsed.model ?? model,
      });
    },
  });
}
