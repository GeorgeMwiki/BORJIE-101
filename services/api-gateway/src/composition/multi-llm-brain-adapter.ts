/**
 * Multi-LLM brain adapter.
 *
 * Wraps the existing `createMultiLLMSynthesizer` from
 * `@borjie/ai-copilot/providers` so the role-aware advisor can call
 * it through the simple `BrainPort.respond({ systemPrompt, question,
 * contextSnippets, maxTokens })` shape.
 *
 * The adapter is intentionally a thin translation layer — it neither
 * routes nor caches. Responsibilities:
 *
 *   1. Pick the right set of proposers from env keys
 *      (Anthropic/OpenAI/DeepSeek) and the synthesizer (Anthropic
 *      Claude Opus). At least 2 proposers must be wireable, otherwise
 *      we degrade to the single-shot Anthropic completion path.
 *   2. Compose the advisor's BrainRequest into the synthesizer's
 *      `AICompletionRequest` shape (system prompt + user prompt + cap).
 *   3. Run `synthesize()` with mode='merge'.
 *   4. Re-project the merged result into the advisor's `BrainResponse`
 *      shape, deriving citations from the inbound context snippets so
 *      the orchestrator can render footnotes even when the underlying
 *      provider didn't surface them.
 *
 * Failure modes:
 *   - No Anthropic key → `wireMultiLLMBrain` returns null; the caller
 *     falls back to `createEchoBrain()`.
 *   - Only one vendor wireable AND only one proposer succeeded at
 *     runtime → still returns the proposer answer (the synthesizer
 *     short-circuits to the fastest proposer in race-verify mode).
 *   - All proposers failed at runtime → throws so the caller can
 *     surface a structured ADVISOR_ERROR back to the route handler.
 */

import {
  AnthropicProvider,
  ANTHROPIC_MODELS,
  OpenAIChatProvider,
  OPENAI_MODELS,
  DeepSeekProvider,
  DEEPSEEK_MODELS,
  createMultiLLMSynthesizer,
  type SynthesizerProposerRegistration,
} from '@borjie/ai-copilot/providers';
import type { BrainPort, BrainRequest, BrainResponse, BrainCitation } from '@borjie/role-aware-advisor';

export interface WireMultiLLMBrainOpts {
  /** Env source — defaults to `process.env`. Tests pass overrides. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Optional structured logger. When unset we keep silent (the
   * advisor-wiring layer logs the fallback decision itself).
   */
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
  };
}

interface ProposerBuild {
  readonly id: string;
  readonly registration: SynthesizerProposerRegistration;
}

function buildProposers(env: Readonly<Record<string, string | undefined>>): ProposerBuild[] {
  const proposers: ProposerBuild[] = [];
  const anthropicKey = env['ANTHROPIC_API_KEY']?.trim() ?? '';
  const openaiKey = env['OPENAI_API_KEY']?.trim() ?? '';
  const deepseekKey = env['DEEPSEEK_API_KEY']?.trim() ?? '';

  if (anthropicKey.length > 0) {
    proposers.push({
      id: 'anthropic-sonnet',
      registration: {
        id: 'anthropic-sonnet',
        provider: new AnthropicProvider({ apiKey: anthropicKey }),
        model: ANTHROPIC_MODELS.SONNET_4_6,
      },
    });
  }
  if (openaiKey.length > 0) {
    proposers.push({
      id: 'openai-gpt4o',
      registration: {
        id: 'openai-gpt4o',
        provider: new OpenAIChatProvider({ apiKey: openaiKey }),
        model: OPENAI_MODELS.GPT_4O,
      },
    });
  }
  if (deepseekKey.length > 0) {
    proposers.push({
      id: 'deepseek-chat',
      registration: {
        id: 'deepseek-chat',
        provider: new DeepSeekProvider({ apiKey: deepseekKey }),
        model: DEEPSEEK_MODELS.CHAT,
      },
    });
  }
  return proposers;
}

/**
 * Build the BrainPort backed by the multi-LLM synthesizer. Returns
 * null when we cannot wire ≥ 2 proposers OR no Anthropic key is set
 * (the synthesizer requires Anthropic Opus as the merge LLM).
 *
 * The caller MUST handle the null return — `advisor-wiring.ts` falls
 * back to `createEchoBrain()` in that case.
 */
export function wireMultiLLMBrain(opts: WireMultiLLMBrainOpts = {}): BrainPort | null {
  const env = opts.env ?? process.env;
  const logger = opts.logger;

  const anthropicKey = env['ANTHROPIC_API_KEY']?.trim() ?? '';
  if (anthropicKey.length === 0) {
    logger?.info?.('multi-llm-brain-adapter: no ANTHROPIC_API_KEY — caller should fall back', {});
    return null;
  }

  const proposers = buildProposers(env);
  if (proposers.length < 2) {
    logger?.warn?.(
      'multi-llm-brain-adapter: fewer than 2 proposer vendors configured — caller should fall back',
      { vendors: proposers.map((p) => p.id) },
    );
    return null;
  }

  const synthesizer: SynthesizerProposerRegistration = {
    id: 'anthropic-opus',
    provider: new AnthropicProvider({ apiKey: anthropicKey }),
    model: ANTHROPIC_MODELS.OPUS_4_6,
  };

  const synth = createMultiLLMSynthesizer({
    proposers: proposers.map((p) => p.registration),
    synthesizer,
    ...(logger
      ? {
          logger: {
            warn: (meta) => logger.warn?.('multi-llm-brain-adapter: synthesizer warn', meta),
            info: (meta) => logger.info?.('multi-llm-brain-adapter: synthesizer info', meta),
          },
        }
      : {}),
  });

  return {
    async respond(req: BrainRequest): Promise<BrainResponse> {
      // Compose an AICompletionRequest from the advisor's BrainRequest.
      // The provider stack reads `prompt.systemPrompt` + `prompt.userPrompt`
      // and applies the `modelConfig.maxTokens` cap.
      const evidenceBlock =
        req.contextSnippets.length === 0
          ? ''
          : '\n\nEvidence:\n' +
            req.contextSnippets
              .map(
                (s, idx) =>
                  `[${idx + 1}] (${s.resource}) ${s.summary}` +
                  (s.body ? `\n${s.body}` : ''),
              )
              .join('\n\n');

      const userPrompt = `${req.question}${evidenceBlock}`;
      const synthRequest = {
        prompt: {
          systemPrompt: req.systemPrompt,
          userPrompt,
          compiledAt: new Date(),
          templateId: 'role-aware-advisor',
          version: 1,
          modelConfig: {
            modelId: ANTHROPIC_MODELS.SONNET_4_6,
            maxTokens: Math.min(Math.max(req.maxTokens ?? 600, 64), 4096),
            temperature: 0.2,
          },
        },
      };

      const result = await synth.synthesize(synthRequest as never, { mode: 'merge' });

      if (result.success === false) {
        const ids = (result.error.proposerErrors ?? []).map((p) => p.proposerId).join(',');
        throw new Error(
          `multi-llm-brain-adapter: all proposers failed [${ids}]: ${result.error.message}`,
        );
      }

      // Derive citations from the inbound snippets so the orchestrator
      // can render footnotes. The synthesizer itself doesn't return a
      // structured citation list — its job is the merged answer text.
      const citations: ReadonlyArray<BrainCitation> = req.contextSnippets.map((s) => ({
        id: s.id,
        label: s.summary.slice(0, 60),
        source: `snippet:${s.id}`,
      }));

      return {
        text: result.data.content,
        citations,
      };
    },
  };
}
