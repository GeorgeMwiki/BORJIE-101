/**
 * AI Providers
 */

export * from './ai-provider.js';
export * from './anthropic.js';
export * from './advisor.js';
export * from './anthropic-client.js';

// Production OpenAI + DeepSeek providers — wired by the multi-LLM
// router AND by the multi-LLM synthesizer at the composition root.
export {
  OpenAIChatProvider,
  OPENAI_MODELS,
  type OpenAIChatProviderConfig,
  type OpenAIModelId,
} from './openai.js';
export {
  DeepSeekProvider,
  DEEPSEEK_MODELS,
  type DeepSeekProviderConfig,
  type DeepSeekModelId,
} from './deepseek.js';

// Wave-26 Agent Z4 — public exports for the three previously-unwired AI
// brain utilities so the api-gateway composition root can import them
// without reaching into deep module paths.
export {
  buildMultiLLMRouter,
  buildMultiLLMRouterFromEnv,
  type BuildRouterOptions,
} from './router.js';

export {
  createMultiLLMRouter,
  DEFAULT_FALLBACK_CHAINS,
  type MultiLLMRouter,
  type MultiLLMRouterDeps,
  type MultiLLMContext,
  type RouteHints,
  type RouteDecision,
  type TaskType,
  type CostBudget,
  type LatencyBudget,
  type TenantTier,
  type ProviderRegistration,
} from './multi-llm-router.js';

export {
  withBudgetGuard,
  type BudgetGuardContext,
  type BudgetGuardOptions,
  type BudgetGuardedAnthropicClient,
  type PriceEstimator,
} from './budget-guard.js';

// Multi-LLM fan-out synthesizer (Mixture-of-Agents pattern). Pair with the
// single-best `multi-llm-router` for deep reasoning / document creation
// where 3 perspectives reduce blind spots.
export {
  createMultiLLMSynthesizer,
  type MultiLLMSynthesizerDeps,
  type ProposerRegistration as SynthesizerProposerRegistration,
  type SynthesizeOptions,
  type SynthesisMode,
  type SynthesisResult,
  type SynthesisError,
  type ProposerOutcome,
} from './multi-llm-synthesizer.js';
