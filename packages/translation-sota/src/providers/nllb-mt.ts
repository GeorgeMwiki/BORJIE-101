/**
 * Tier-3 provider — NLLB-200 self-host (cost-ceiling + sovereignty
 * fallback).
 *
 * Meta's NLLB-200 covers all 200 languages including Swahili and was
 * specifically designed for low-resource pairs. Fine-tuned NLLB-200
 * 3.3B still beats 7-8B LLMs on three of four directions in the
 * AFRIDOC-MT benchmark:
 *   https://aclanthology.org/2025.emnlp-main.1413.pdf (Jan 2025)
 *   https://nllb.com/best-translation-ai-2026/
 *
 * Self-host becomes cost-effective above ~10 M characters / month:
 *   https://nllb.com/setup-nllb-locally/
 *
 * NLLB does NOT understand placeholder constraints in the same way an
 * LLM does. We treat placeholders as opaque tokens — they survive the
 * NLLB pipeline because the tokenizer rarely fragments the
 * `<<G:NNNN>>` pattern; the runner's adherence check catches any
 * mangling and demotes accordingly.
 *
 * The provider exposes a thin HTTP-fetcher port behind which the
 * caller wires in (a) a HuggingFace Inference Endpoint, (b) a local
 * ctranslate2 service, or (c) a managed batch backend.
 */

import type {
  LanguageCode,
  ProviderId,
  ProviderPort,
  ProviderTranslateRequest,
  ProviderTranslateResult,
} from '../types.js';

export interface NllbFetchRequest {
  readonly url: string;
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface NllbFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
  readonly json: () => Promise<unknown>;
}

export type NllbFetcher = (req: NllbFetchRequest) => Promise<NllbFetchResponse>;

export interface NllbMtConfig {
  readonly endpoint: string;
  readonly apiKey?: string;
  /** Defaults to `facebook/nllb-200-distilled-600M`. */
  readonly model?: string;
  /** Per-character cost estimate (USD cents per 1k characters). */
  readonly costCentsPerKchar?: number;
}

export interface NllbMtDeps {
  readonly config: NllbMtConfig;
  readonly fetcher: NllbFetcher;
  readonly now: () => number;
  readonly healthProbe?: () => Promise<boolean>;
}

export const NLLB_PROVIDER_ID: ProviderId = 'nllb-200';

/** NLLB language codes are different — map ours into theirs. */
export function nllbLangCode(code: LanguageCode): string {
  switch (code) {
    case 'sw':
      return 'swh_Latn';
    case 'en':
      return 'eng_Latn';
  }
}

export function createNllbProvider(deps: NllbMtDeps): ProviderPort {
  return {
    id: NLLB_PROVIDER_ID,

    async translate(req: ProviderTranslateRequest): Promise<ProviderTranslateResult> {
      const start = deps.now();
      const body = JSON.stringify({
        inputs: req.sourceText,
        parameters: {
          src_lang: nllbLangCode(req.sourceLang),
          tgt_lang: nllbLangCode(req.targetLang),
        },
      });
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (deps.config.apiKey !== undefined) {
        headers['authorization'] = `Bearer ${deps.config.apiKey}`;
      }
      const response = await deps.fetcher({
        url: deps.config.endpoint,
        method: 'POST',
        headers: Object.freeze({ ...headers }),
        body,
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(
          `nllb-mt provider failed (${response.status}): ${errText}`,
        );
      }
      const payload = (await response.json()) as NllbInferenceResponse;
      const targetText = extractNllbText(payload);
      const latencyMs = Math.max(0, Math.round(deps.now() - start));
      const costUsdCents = estimateNllbCost(
        req.sourceText,
        targetText,
        deps.config.costCentsPerKchar ?? 0.5,
      );
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

/**
 * HuggingFace Inference response shape — array of objects with
 * `translation_text`. We also accept the alternate shape used by
 * some custom serving stacks: a single object with the same key.
 */
type NllbInferenceResponse =
  | ReadonlyArray<{ readonly translation_text?: string }>
  | { readonly translation_text?: string };

function extractNllbText(payload: NllbInferenceResponse): string {
  if (Array.isArray(payload)) {
    const first = payload[0];
    if (first !== undefined && typeof first.translation_text === 'string') {
      return first.translation_text;
    }
    return '';
  }
  if (
    payload !== null &&
    typeof payload === 'object' &&
    'translation_text' in payload &&
    typeof payload.translation_text === 'string'
  ) {
    return payload.translation_text;
  }
  return '';
}

function estimateNllbCost(
  sourceText: string,
  targetText: string,
  centsPerKchar: number,
): number {
  const totalChars = sourceText.length + targetText.length;
  return Math.max(0, Math.round((totalChars / 1000) * centsPerKchar));
}
