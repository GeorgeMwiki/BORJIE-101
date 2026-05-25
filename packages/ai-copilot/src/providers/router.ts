/**
 * Provider router factory (Wave 11)
 *
 * Thin convenience helper that reads env, instantiates the providers that
 * have keys configured, and returns a `MultiLLMRouter` pre-wired with the
 * Wave 10 `CostLedger`.
 *
 * Anthropic is always the default — the other providers activate iff their
 * respective API keys (`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`) are set.
 *
 * The router is returned as a pure object; constructor throws loud if the
 * caller passes an invalid ledger or no Anthropic key.
 */

import {
  AnthropicProvider,
  ANTHROPIC_MODELS,
} from './anthropic.js';
import { OpenAIChatProvider, OPENAI_MODELS } from './openai.js';
import { DeepSeekProvider, DEEPSEEK_MODELS } from './deepseek.js';
import type { CostLedger } from '../cost-ledger.js';
import {
  createMultiLLMRouter,
  type MultiLLMRouter,
  type ProviderRegistration,
} from './multi-llm-router.js';

export interface BuildRouterOptions {
  readonly ledger: CostLedger;
  readonly anthropicApiKey: string;
  readonly openaiApiKey?: string;
  readonly deepseekApiKey?: string;
  /** Override fallback chains (optional). */
  readonly fallbackChains?: Parameters<typeof createMultiLLMRouter>[0]['fallbackChains'];
}

export function buildMultiLLMRouter(opts: BuildRouterOptions): MultiLLMRouter {
  if (!opts.ledger) {
    throw new Error('buildMultiLLMRouter: ledger is required');
  }
  if (!opts.anthropicApiKey) {
    throw new Error(
      'buildMultiLLMRouter: ANTHROPIC_API_KEY is required (Anthropic is the default provider)'
    );
  }

  const providers: Record<string, ProviderRegistration> = {
    anthropic: {
      provider: new AnthropicProvider({
        apiKey: opts.anthropicApiKey,
        defaultModel: ANTHROPIC_MODELS.SONNET_4_6,
      }),
      preferredModels: {
        analysis: ANTHROPIC_MODELS.SONNET_4_6,
        reasoning: ANTHROPIC_MODELS.OPUS_4_6,
        tool_use: ANTHROPIC_MODELS.SONNET_4_6,
        conversation: ANTHROPIC_MODELS.HAIKU_4_5,
        summarization: ANTHROPIC_MODELS.HAIKU_4_5,
        batch: ANTHROPIC_MODELS.HAIKU_4_5,
        bulk_extraction: ANTHROPIC_MODELS.HAIKU_4_5,
      },
      pricing: {
        [ANTHROPIC_MODELS.OPUS_4_6]: { promptPer1k: 0.015, completionPer1k: 0.075 },
        [ANTHROPIC_MODELS.SONNET_4_6]: {
          promptPer1k: 0.003,
          completionPer1k: 0.015,
        },
        [ANTHROPIC_MODELS.HAIKU_4_5]: {
          promptPer1k: 0.0008,
          completionPer1k: 0.004,
        },
      },
    },
  };

  if (opts.openaiApiKey) {
    providers.openai = {
      provider: new OpenAIChatProvider({
        apiKey: opts.openaiApiKey,
        defaultModel: OPENAI_MODELS.GPT_4O_MINI,
      }),
      preferredModels: {
        analysis: OPENAI_MODELS.GPT_4O,
        reasoning: OPENAI_MODELS.GPT_4O,
        tool_use: OPENAI_MODELS.GPT_4O,
        conversation: OPENAI_MODELS.GPT_4O_MINI,
        summarization: OPENAI_MODELS.GPT_4O_MINI,
        batch: OPENAI_MODELS.GPT_4O_MINI,
        bulk_extraction: OPENAI_MODELS.GPT_4O_MINI,
      },
      pricing: {
        [OPENAI_MODELS.GPT_4O]: { promptPer1k: 0.005, completionPer1k: 0.015 },
        [OPENAI_MODELS.GPT_4O_MINI]: {
          promptPer1k: 0.00015,
          completionPer1k: 0.0006,
        },
        [OPENAI_MODELS.GPT_4_TURBO]: { promptPer1k: 0.01, completionPer1k: 0.03 },
      },
    };
  }

  if (opts.deepseekApiKey) {
    providers.deepseek = {
      provider: new DeepSeekProvider({
        apiKey: opts.deepseekApiKey,
        defaultModel: DEEPSEEK_MODELS.CHAT,
      }),
      preferredModels: {
        analysis: DEEPSEEK_MODELS.REASONER,
        reasoning: DEEPSEEK_MODELS.REASONER,
        tool_use: DEEPSEEK_MODELS.CHAT,
        conversation: DEEPSEEK_MODELS.CHAT,
        summarization: DEEPSEEK_MODELS.CHAT,
        batch: DEEPSEEK_MODELS.CHAT,
        bulk_extraction: DEEPSEEK_MODELS.CHAT,
      },
      pricing: {
        [DEEPSEEK_MODELS.CHAT]: {
          promptPer1k: 0.00014,
          completionPer1k: 0.00028,
        },
        [DEEPSEEK_MODELS.REASONER]: {
          promptPer1k: 0.00055,
          completionPer1k: 0.0022,
        },
      },
    };
  }

  return createMultiLLMRouter({
    providers,
    ledger: opts.ledger,
    fallbackChains: opts.fallbackChains,
  });
}

/**
 * Convenience wrapper — reads env vars and builds the router. Throws the
 * same clear errors as `buildMultiLLMRouter`.
 */
export function buildMultiLLMRouterFromEnv(ledger: CostLedger): MultiLLMRouter {
  return buildMultiLLMRouter({
    ledger,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    openaiApiKey: process.env.OPENAI_API_KEY,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  });
}
