/**
 * Tier-2 provider — Gemini 2.5 Pro with glossary-conditioned prompt.
 *
 * WMT25 human evaluation places Gemini 2.5 Pro at or near the top of
 * the rankings for 14 of 16 evaluated language pairs:
 *   https://slator.com/wmt25-preliminary-results-gemini-2-5-pro-gpt-4-1-lead-ai-translation/
 *   https://blog.laratranslate.com/translation-model-benchmark/
 *
 * The actual HTTP call to Google's Generative-Language API is behind
 * an injected `fetcher` port so the unit-test suite never hits the
 * network.
 *
 * Persona: Mr. Mwikila. Brand: Borjie. Tanzanian formal register.
 */

import type {
  ProviderId,
  ProviderPort,
  ProviderTranslateRequest,
  ProviderTranslateResult,
} from '../types.js';

export interface GeminiFetchRequest {
  readonly url: string;
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface GeminiFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
  readonly json: () => Promise<unknown>;
}

export type GeminiFetcher = (req: GeminiFetchRequest) => Promise<GeminiFetchResponse>;

export interface GeminiMtConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

export interface GeminiMtDeps {
  readonly config: GeminiMtConfig;
  readonly fetcher: GeminiFetcher;
  readonly now: () => number;
  readonly healthProbe?: () => Promise<boolean>;
}

export const GEMINI_PROVIDER_ID: ProviderId = 'gemini-2-5-pro';

export function buildGeminiPrompt(req: ProviderTranslateRequest): {
  readonly systemInstruction: string;
  readonly user: string;
} {
  const langName = (code: 'sw' | 'en'): string =>
    code === 'sw' ? 'Tanzanian Kiswahili (formal register)' : 'English';
  const placeholderList =
    req.placeholders.length === 0
      ? '(none)'
      : req.placeholders.join(', ');
  const honorific =
    req.register.honorific !== undefined
      ? ` (source uses honorific "${req.register.honorific}")`
      : '';
  const systemInstruction = [
    'You are Mr. Mwikila, the Borjie translation specialist.',
    `Translate the source text from ${langName(req.sourceLang)} to ${langName(req.targetLang)}.`,
    `Source register: ${req.register.level}${honorific}. Mirror the register.`,
    'CRITICAL: keep every <<G:NNNN>> placeholder token verbatim.',
    `Placeholders present in source: ${placeholderList}.`,
    'Output the translated text only — no explanations.',
  ].join('\n');
  return Object.freeze({
    systemInstruction,
    user: req.sourceText,
  });
}

export function createGeminiProvider(deps: GeminiMtDeps): ProviderPort {
  return {
    id: GEMINI_PROVIDER_ID,

    async translate(req: ProviderTranslateRequest): Promise<ProviderTranslateResult> {
      const start = deps.now();
      const prompt = buildGeminiPrompt(req);
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: prompt.systemInstruction }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt.user }],
          },
        ],
        generationConfig: {
          temperature: deps.config.temperature ?? 0,
          maxOutputTokens: deps.config.maxOutputTokens ?? 1024,
        },
      });
      const response = await deps.fetcher({
        url: deps.config.endpoint,
        method: 'POST',
        headers: Object.freeze({
          'content-type': 'application/json',
          'x-goog-api-key': deps.config.apiKey,
        }),
        body,
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(
          `gemini-mt provider failed (${response.status}): ${errText}`,
        );
      }
      const payload = (await response.json()) as GeminiGenerateResponse;
      const targetText = extractGeminiText(payload);
      const latencyMs = Math.max(0, Math.round(deps.now() - start));
      const costUsdCents = estimateGeminiCost(req.sourceText, targetText);
      return Object.freeze({
        targetText,
        latencyMs,
        costUsdCents,
      });
    },

    async isHealthy(): Promise<boolean> {
      if (deps.healthProbe !== undefined) {
        return deps.healthProbe();
      }
      return true;
    },
  };
}

interface GeminiGenerateResponse {
  readonly candidates?: ReadonlyArray<{
    readonly content?: { readonly parts?: ReadonlyArray<{ readonly text?: string }> };
  }>;
}

function extractGeminiText(payload: GeminiGenerateResponse): string {
  if (payload.candidates === undefined) {
    return '';
  }
  const parts: string[] = [];
  for (const candidate of payload.candidates) {
    if (candidate.content === undefined) {
      continue;
    }
    const partList = candidate.content.parts;
    if (partList === undefined) {
      continue;
    }
    for (const part of partList) {
      if (typeof part.text === 'string') {
        parts.push(part.text);
      }
    }
  }
  return parts.join('');
}

/**
 * Gemini 2.5 Pro pricing is roughly comparable to Opus on a per-token
 * basis (~$3.50 / 1M input, ~$10.50 / 1M output as of early 2026):
 *   https://openrouter.ai/google/gemini-2.5-pro
 */
function estimateGeminiCost(sourceText: string, targetText: string): number {
  const inputTokens = Math.ceil(sourceText.length / 3.5);
  const outputTokens = Math.ceil(targetText.length / 3.5);
  const inputCents = (inputTokens / 1_000_000) * 350;
  const outputCents = (outputTokens / 1_000_000) * 1_050;
  return Math.max(0, Math.round(inputCents + outputCents));
}
