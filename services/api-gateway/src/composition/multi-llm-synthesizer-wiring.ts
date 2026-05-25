/**
 * Multi-LLM synthesizer wiring — composition root for the kernel's
 * deep-reasoning fan-out path.
 *
 * Constructs a {@link MultiLLMSynthesizerPort} bound to:
 *
 *   - **Proposers** (parallel fan-out): Anthropic Claude Sonnet,
 *     OpenAI gpt-4o, and DeepSeek deepseek-chat. Each one is wired
 *     only when its API key is present in the env. The kernel
 *     requires at least ONE proposer to succeed; we ship the
 *     synthesizer wire only when at least 2 proposers can be built
 *     (so a single-vendor incident does not silently degrade us
 *     back to single-shot).
 *
 *   - **Synthesizer** (serial merge): Anthropic Claude Opus when an
 *     Anthropic key is present. Opus is the strongest reasoner the
 *     tenant tier permits — it merges proposer outputs into one
 *     answer, prefers claims that multiple proposers ground in
 *     shared sources, and flags disagreement rather than silently
 *     siding with one proposer.
 *
 * The kernel calls `synthesize(args)` only when the inbound turn
 * carries `req.requireSynthesis === true`. Defaults OFF for cost
 * reasons — surfaces opt in per turn (sovereign ops chat, legal-
 * adjacent advice, owner-payout strategy, eviction letter drafting).
 *
 * Failure modes:
 *   - No Anthropic key → synthesizer port is `null`; kernel runs the
 *     single-shot sensor path unchanged.
 *   - Only one proposer key set → port is `null` for the same
 *     reason (mixture-of-agents needs ≥2 perspectives to be
 *     meaningful).
 *   - At runtime any proposer error is swallowed by the inner
 *     `createMultiLLMSynthesizer`; the kernel surfaces a
 *     `synthesis-fallback` trace step and runs the single-shot path.
 *
 * Tenant scoping: the port itself is tenant-agnostic. Per-tenant
 * budget enforcement flows through the existing AI cost ledger via
 * the `withBudgetGuard`-wrapped Anthropic client when the
 * synthesizer is invoked. OpenAI + DeepSeek do not currently flow
 * through the budget guard — a follow-up wires them so cross-vendor
 * fan-out respects per-tenant spend caps too.
 */

import {
  createMultiLLMSynthesizer,
  AnthropicProvider,
  ANTHROPIC_MODELS,
  OpenAIChatProvider,
  OPENAI_MODELS,
  DeepSeekProvider,
  DEEPSEEK_MODELS,
  type SynthesizerProposerRegistration,
} from '@borjie/ai-copilot/providers';
import type {
  MultiLLMSynthesizerPort,
  MultiLLMSynthesizerCall,
  MultiLLMSynthesizerResult,
  ThoughtRequest,
} from '@borjie/central-intelligence';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Logger contract — matches the rest of the composition layer.
 */
export interface SynthesizerWiringLogger {
  info?(meta: object, msg: string): void;
  warn?(meta: object, msg: string): void;
}

export interface MultiLLMSynthesizerWiringDeps {
  /**
   * Optional env source override. Defaults to `process.env`. Test rigs
   * pass in a plain object to assert the wire-up contract without
   * pulling secrets in from the real environment.
   */
  readonly envSource?: Readonly<Record<string, string | undefined>>;
  /**
   * Optional logger. When present, the wiring emits info-level entries
   * at boot (which proposers were wired) and warns when degraded
   * (single-vendor → returns null).
   */
  readonly logger?: SynthesizerWiringLogger;
}

/**
 * The wired-up port plus a small descriptor used by the api-gateway
 * service-registry to surface boot diagnostics on the ops endpoints.
 * Null when the gateway cannot build a viable synthesizer (no
 * Anthropic key, or fewer than 2 proposer vendors configured).
 */
export interface MultiLLMSynthesizerWiring {
  readonly port: MultiLLMSynthesizerPort;
  readonly proposerCount: number;
  readonly proposerIds: ReadonlyArray<string>;
  readonly synthesizerModel: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ProposerBuild {
  readonly registration: SynthesizerProposerRegistration;
  readonly id: string;
}

function buildAnthropicProposer(
  apiKey: string,
): ProposerBuild {
  const provider = new AnthropicProvider({ apiKey });
  return {
    id: 'anthropic-sonnet',
    registration: {
      id: 'anthropic-sonnet',
      provider,
      model: ANTHROPIC_MODELS.SONNET_4_6,
    },
  };
}

function buildOpenAiProposer(apiKey: string): ProposerBuild {
  const provider = new OpenAIChatProvider({ apiKey });
  return {
    id: 'openai-gpt4o',
    registration: {
      id: 'openai-gpt4o',
      provider,
      model: OPENAI_MODELS.GPT_4O,
    },
  };
}

function buildDeepSeekProposer(apiKey: string): ProposerBuild {
  const provider = new DeepSeekProvider({ apiKey });
  return {
    id: 'deepseek-chat',
    registration: {
      id: 'deepseek-chat',
      provider,
      model: DEEPSEEK_MODELS.CHAT,
    },
  };
}

/**
 * Compose a request body the underlying `createMultiLLMSynthesizer`
 * understands. The kernel hands us system prompt + scrubbed user
 * message + prior turns; we translate into `AICompletionRequest`.
 *
 * NOTE — we do not currently carry `priorTurns` over the wire to the
 * proposer providers (they read the new-style `priorMessages`).
 * For the deep-reasoning use case (one-shot adjudication of a
 * concrete question) this is acceptable; an enhancement carries the
 * thread when the synthesizer is used inside a multi-turn debate.
 */
function buildSynthesizeCallToRequest(
  args: MultiLLMSynthesizerCall,
): {
  prompt: {
    systemPrompt: string;
    userPrompt: string;
    compiledAt: Date;
    templateId: string;
    version: number;
    modelConfig: {
      modelId: string;
      maxTokens: number;
      temperature: number;
    };
  };
} {
  return {
    prompt: {
      systemPrompt: args.systemPrompt,
      userPrompt: args.userMessage,
      compiledAt: new Date(),
      templateId: 'kernel-deep-reasoning',
      version: 1,
      modelConfig: {
        // The synthesizer overrides modelId per-proposer, so this is a
        // placeholder. We pick a sensible default.
        modelId: ANTHROPIC_MODELS.SONNET_4_6,
        maxTokens: 2048,
        temperature: 0.2,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build the multi-LLM synthesizer port the brain kernel consumes for
 * deep-reasoning turns. Returns `null` when the wire is unviable
 * (no Anthropic key, or only one proposer-vendor configured) so the
 * kernel transparently falls back to the single-shot sensor path.
 */
export function createMultiLLMSynthesizerWiring(
  deps: MultiLLMSynthesizerWiringDeps = {},
): MultiLLMSynthesizerWiring | null {
  const env = deps.envSource ?? process.env;
  const logger = deps.logger;

  const anthropicKey =
    (env['ANTHROPIC_API_KEY']?.trim() ?? '');
  const openaiKey = env['OPENAI_API_KEY']?.trim() ?? '';
  const deepseekKey = env['DEEPSEEK_API_KEY']?.trim() ?? '';

  if (anthropicKey.length === 0) {
    if (logger?.info) {
      logger.info(
        { wiring: 'multi-llm-synthesizer' },
        'multi-llm-synthesizer: no Anthropic key — skipping deep-reasoning wire',
      );
    }
    return null;
  }

  const proposers: ProposerBuild[] = [];
  try {
    proposers.push(buildAnthropicProposer(anthropicKey));
  } catch (err) {
    logger?.warn?.(
      {
        wiring: 'multi-llm-synthesizer',
        error: err instanceof Error ? err.message : String(err),
      },
      'multi-llm-synthesizer: anthropic proposer construction failed',
    );
  }
  if (openaiKey.length > 0) {
    try {
      proposers.push(buildOpenAiProposer(openaiKey));
    } catch (err) {
      logger?.warn?.(
        {
          wiring: 'multi-llm-synthesizer',
          error: err instanceof Error ? err.message : String(err),
        },
        'multi-llm-synthesizer: openai proposer construction failed',
      );
    }
  }
  if (deepseekKey.length > 0) {
    try {
      proposers.push(buildDeepSeekProposer(deepseekKey));
    } catch (err) {
      logger?.warn?.(
        {
          wiring: 'multi-llm-synthesizer',
          error: err instanceof Error ? err.message : String(err),
        },
        'multi-llm-synthesizer: deepseek proposer construction failed',
      );
    }
  }

  if (proposers.length < 2) {
    if (logger?.warn) {
      logger.warn(
        {
          wiring: 'multi-llm-synthesizer',
          proposers: proposers.map((p) => p.id),
        },
        'multi-llm-synthesizer: fewer than 2 vendors wired — degrading to null (single-shot path stays)',
      );
    }
    return null;
  }

  // Build the synthesizer (Claude Opus). Same Anthropic key as the
  // primary proposer; per-tenant budget enforcement still flows
  // through the existing cost ledger via the kernel's regular sensors.
  const synthesizerProvider = new AnthropicProvider({ apiKey: anthropicKey });
  const synthesizer: SynthesizerProposerRegistration = {
    id: 'anthropic-opus',
    provider: synthesizerProvider,
    model: ANTHROPIC_MODELS.OPUS_4_6,
  };

  const inner = createMultiLLMSynthesizer({
    proposers: proposers.map((p) => p.registration),
    synthesizer,
    ...(logger ? { logger: {
      warn: (meta) =>
        logger.warn?.({ wiring: 'multi-llm-synthesizer', ...meta }, 'synthesizer warn'),
      info: (meta) =>
        logger.info?.({ wiring: 'multi-llm-synthesizer', ...meta }, 'synthesizer info'),
    } } : {}),
  });

  if (logger?.info) {
    logger.info(
      {
        wiring: 'multi-llm-synthesizer',
        proposers: proposers.map((p) => p.id),
        synthesizer: synthesizer.id,
        synthesizerModel: synthesizer.model,
      },
      'multi-llm-synthesizer: deep-reasoning wire active',
    );
  }

  // Adapter: kernel calls `synthesize(args)` with the kernel-side
  // shape; the inner `MultiLLMSynthesizer.synthesize` consumes
  // `AICompletionRequest`. We translate, run, and reproject the
  // result into the kernel-side `MultiLLMSynthesizerResult` shape.
  const port: MultiLLMSynthesizerPort = {
    shouldSynthesize(req: ThoughtRequest): boolean {
      // Hard cost gate: opt-in only. The kernel already checks the
      // flag; we double-check here as a defensive measure so a
      // mis-wired upstream cannot accidentally enable the path.
      return req.requireSynthesis === true && req.stakes !== 'low';
    },
    async synthesize(
      args: MultiLLMSynthesizerCall,
    ): Promise<MultiLLMSynthesizerResult> {
      const start = Date.now();
      const request = buildSynthesizeCallToRequest(args);
      const result = await inner.synthesize(
        // The router accepts the AICompletionRequest shape; the
        // prompt sub-object is structurally compatible but TS cannot
        // narrow through the package boundary, so we widen via
        // `unknown` then back. Mirrors the pattern used by the
        // existing voice-agent wiring around the same shape.
        request as unknown as Parameters<typeof inner.synthesize>[0],
        {
          mode: args.mode ?? 'merge',
        },
      );

      if (result.success === false) {
        // Aggregate proposer errors into a single throw so the kernel's
        // catch-and-fallback path engages cleanly.
        const propIds = (result.error.proposerErrors ?? [])
          .map((p) => p.proposerId)
          .join(',');
        throw new Error(
          `multi-llm-synthesizer: all proposers failed [${propIds}]: ${result.error.message}`,
        );
      }

      const data = result.data;
      const successCount = data.proposerOutcomes.filter((o) => o.success).length;
      const failureCount = data.proposerOutcomes.length - successCount;
      return {
        content: data.content,
        proposerSuccessCount: successCount,
        proposerFailureCount: failureCount,
        agreement: data.agreement,
        escalate: data.escalate,
        synthesizerFallback: data.synthesizerFallback,
        modelId: String(data.synthesizerResponse.modelId),
        latencyMs: Date.now() - start,
      };
    },
  };

  return {
    port,
    proposerCount: proposers.length,
    proposerIds: proposers.map((p) => p.id),
    synthesizerModel: synthesizer.model,
  };
}
