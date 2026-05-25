/**
 * Advisor Pattern (Anthropic, 2026)
 *
 * A cheap executor model (Sonnet or Haiku) runs a turn. When the executor's
 * self-reported confidence falls below a threshold OR the turn is flagged as
 * a "hard" category (legal, large financial, irreversible action), it
 * consults a more capable advisor (Opus) mid-turn without switching models.
 *
 * Benchmarks from Anthropic's published advisor work (2026) show:
 *  - Sonnet + Opus advisor: ~+2.7pts on SWE-bench Multilingual, -11.9% cost/task.
 *  - Haiku + Opus advisor: 19.7% → 41.2% on BrowseComp.
 *
 * This module is purely a composition over AIProvider; it does not own network
 * calls beyond what the underlying providers do.
 */

import { aiOk, aiErr, AIResult } from '../types/core.types.js';
import {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIProviderError,
} from './ai-provider.js';
import { ANTHROPIC_MODELS } from './anthropic.js';

/**
 * Heuristic categories that always trigger an advisor consultation.
 * Kept explicit and auditable — no ML-flavored "confidence model".
 */
export const ADVISOR_HARD_CATEGORIES = [
  'lease_interpretation',
  'legal_drafting',
  'compliance_ruling',
  'large_financial_posting',
  'tenant_termination',
  'irreversible_action',
] as const;

export type AdvisorHardCategory = (typeof ADVISOR_HARD_CATEGORIES)[number];

export interface AdvisorInvocationContext {
  /** Optional category for hard-gate routing to advisor. */
  category?: AdvisorHardCategory;
  /** Optional executor self-confidence (0–1). */
  executorConfidence?: number;
  /** Threshold below which advisor is consulted. Default 0.7. */
  advisorThreshold?: number;
  /** Short reason string that will be written to the trace. */
  reason?: string;
}

export interface AdvisorOutcome {
  /** Executor model output (always present). */
  executor: AICompletionResponse;
  /** Advisor model output (present iff advisor was invoked). */
  advisor?: AICompletionResponse;
  /** Final merged content — advisor's if consulted, else executor's. */
  finalContent: string;
  /** Whether the advisor was consulted. */
  advisorConsulted: boolean;
  /** Total tokens across executor + advisor. */
  totalTokens: number;
  /** Total processing time across both. */
  totalProcessingTimeMs: number;
  /** Reason the advisor was (or was not) consulted. */
  advisorReason: string;
}

/**
 * Configuration for the Advisor executor.
 */
export interface AdvisorConfig {
  executorProvider: AIProvider;
  advisorProvider: AIProvider;
  executorModel?: string;
  advisorModel?: string;
  /** Threshold below which advisor is consulted for confidence. */
  defaultThreshold?: number;
}

/**
 * Executes a prompt using the Advisor pattern.
 *
 * Contract:
 *  1. Run executor.
 *  2. If (a) `category` is a hard category, or (b) `executorConfidence` is
 *     provided and below threshold, or (c) executor returned no usable content,
 *     run advisor with the executor's draft attached as `additionalContext`.
 *  3. Return both, with `finalContent` = advisor's if consulted, else executor's.
 */
export class AdvisorExecutor {
  constructor(private readonly cfg: AdvisorConfig) {}

  async run(
    request: AICompletionRequest,
    ctx: AdvisorInvocationContext = {}
  ): Promise<AIResult<AdvisorOutcome, AIProviderError>> {
    const executorModel =
      this.cfg.executorModel ?? ANTHROPIC_MODELS.SONNET_4_6;
    const advisorModel =
      this.cfg.advisorModel ?? ANTHROPIC_MODELS.OPUS_4_6;
    const threshold =
      ctx.advisorThreshold ?? this.cfg.defaultThreshold ?? 0.7;

    // 1. Executor turn
    const execResult = await this.cfg.executorProvider.complete({
      ...request,
      modelOverride: executorModel,
    });
    if (!execResult.success) {
      const e = (execResult as { success: false; error: AIProviderError }).error;
      return aiErr(e);
    }
    const executor = execResult.data;

    // 2. Decide whether to consult the advisor
    const hardCategory = ctx.category
      ? (ADVISOR_HARD_CATEGORIES as readonly string[]).includes(ctx.category)
      : false;
    const lowConfidence =
      ctx.executorConfidence !== undefined &&
      ctx.executorConfidence < threshold;
    const emptyExecutor = !executor.content || executor.content.trim().length === 0;

    const mustConsult = hardCategory || lowConfidence || emptyExecutor;

    if (!mustConsult) {
      return aiOk<AdvisorOutcome>({
        executor,
        finalContent: executor.content,
        advisorConsulted: false,
        totalTokens: executor.usage.totalTokens,
        totalProcessingTimeMs: executor.processingTimeMs,
        advisorReason: 'executor_sufficient',
      });
    }

    // 3. Advisor consultation
    const advisorRequest: AICompletionRequest = {
      ...request,
      modelOverride: advisorModel,
      additionalContext: [
        request.additionalContext ?? '',
        '---',
        'EXECUTOR_DRAFT:',
        executor.content,
        '---',
        'INSTRUCTION_TO_ADVISOR:',
        'Review the executor draft above. If it is correct and complete, ',
        'return the same answer with any refinements needed. If it is ',
        'incorrect or incomplete, return the corrected answer. ',
        ctx.reason ? `Context: ${ctx.reason}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };

    const advResult = await this.cfg.advisorProvider.complete(advisorRequest);
    if (!advResult.success) {
      // Advisor failure: gracefully degrade to executor output.
      const failCode = (advResult as { success: false; error: AIProviderError }).error.code;
      return aiOk<AdvisorOutcome>({
        executor,
        finalContent: executor.content,
        advisorConsulted: false,
        totalTokens: executor.usage.totalTokens,
        totalProcessingTimeMs: executor.processingTimeMs,
        advisorReason: `advisor_failed:${failCode}`,
      });
    }
    const advisor = advResult.data;

    return aiOk<AdvisorOutcome>({
      executor,
      advisor,
      finalContent: advisor.content,
      advisorConsulted: true,
      totalTokens: executor.usage.totalTokens + advisor.usage.totalTokens,
      totalProcessingTimeMs:
        executor.processingTimeMs + advisor.processingTimeMs,
      advisorReason: hardCategory
        ? `hard_category:${ctx.category}`
        : lowConfidence
          ? `low_confidence:${ctx.executorConfidence}`
          : 'executor_empty',
    });
  }
}

/**
 * Convenience: decide at call-site whether a turn should route to advisor.
 */
export function shouldAdvisorConsult(
  ctx: AdvisorInvocationContext,
  defaultThreshold = 0.7
): boolean {
  if (ctx.category && (ADVISOR_HARD_CATEGORIES as readonly string[]).includes(ctx.category))
    return true;
  if (
    ctx.executorConfidence !== undefined &&
    ctx.executorConfidence < (ctx.advisorThreshold ?? defaultThreshold)
  )
    return true;
  return false;
}

// Re-export aiErr to suppress unused-import lint in consumers that import the
// barrel and expect error helpers. Not strictly necessary but harmless.
export { aiErr };
