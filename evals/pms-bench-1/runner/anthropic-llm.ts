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

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 1024;

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
  const model = opts.model ?? process.env.BENCH_ANTHROPIC_MODEL ?? DEFAULT_MODEL;
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
