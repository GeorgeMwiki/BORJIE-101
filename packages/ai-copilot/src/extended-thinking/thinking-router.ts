/**
 * Thinking Router — Wave 28 Agent THINK.
 *
 * Composes the decision-stakes classifier with an Anthropic thinking-capable
 * client and a fallback LLM. For `high` / `critical` stakes, the router
 * engages Claude's extended-thinking feature with the budget the classifier
 * recommends, captures the raw thinking block for the audit trail, and
 * returns a strongly-typed result.
 *
 * For `low` / `medium` stakes (unless `auditMediumStakes` is enabled) the
 * router delegates to the non-thinking fallback — cheaper, faster, and
 * still deterministic.
 *
 * This module NEVER calls Anthropic directly in tests; all network is
 * behind the `ThinkingCapableClient` port, mocked in unit tests.
 */

import { classifyStakes } from './decision-stakes-classifier.js';
import { ModelTier } from '../providers/anthropic-client.js';
import type {
  DecisionContext,
  FallbackLLM,
  ModelTierResolver,
  ReasoningAuditRecorder,
  StakesClassification,
  ThinkAndDecideOptions,
  ThinkingCapableClient,
  ThinkingMessageResponse,
  ThinkingModelTier,
  ThinkingResponseBlock,
  ThinkingResult,
  ThinkingRouter,
  ThinkingRouterDeps,
} from './types.js';

// ---------------------------------------------------------------------------
// Default tier → model-id resolver (mirrors `ModelTier` constants).
// ---------------------------------------------------------------------------

const DEFAULT_TIER_RESOLVER: ModelTierResolver = {
  resolve(tier: ThinkingModelTier): string {
    switch (tier) {
      case 'opus':
        return ModelTier.OPUS;
      case 'sonnet':
        return ModelTier.SONNET;
      case 'haiku':
      default:
        return ModelTier.HAIKU;
    }
  },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createThinkingRouter(deps: ThinkingRouterDeps): ThinkingRouter {
  if (!deps.anthropic) {
    throw new Error('createThinkingRouter: anthropic client is required');
  }
  if (!deps.fallbackLLM) {
    throw new Error('createThinkingRouter: fallbackLLM is required');
  }
  const resolver = deps.modelTierResolver ?? DEFAULT_TIER_RESOLVER;
  const now = deps.now ?? (() => new Date());

  async function thinkAndDecide(
    prompt: string,
    context: DecisionContext,
    options: ThinkAndDecideOptions = {},
  ): Promise<ThinkingResult> {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('thinkAndDecide: prompt is required');
    }
    if (!context || typeof context !== 'object') {
      throw new Error('thinkAndDecide: context is required');
    }

    const classification: StakesClassification =
      options.classificationOverride ?? classifyStakes(context);

    const engageThinking = classification.thinkingBudgetTokens > 0;
    const modelId = resolver.resolve(classification.recommendedModel);

    // Low-stakes — straight to fallback, no thinking, no audit.
    if (!engageThinking) {
      return runFallback(prompt, options, classification, modelId);
    }

    // Attempt extended-thinking path. If it fails (older model, network,
    // missing thinking support), degrade gracefully to the fallback.
    try {
      const response = await deps.anthropic.messages.create({
        model: modelId,
        max_tokens: Math.max(
          classification.thinkingBudgetTokens + 1024,
          2048,
        ),
        temperature: 1, // extended-thinking requires temperature=1
        system: options.systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        thinking: {
          type: 'enabled',
          budget_tokens: classification.thinkingBudgetTokens,
        },
      });

      const parsed = parseThinkingResponse(response);
      const result: ThinkingResult = Object.freeze({
        decision: parsed.decision,
        reasoning: parsed.reasoning,
        thinkingTrace: parsed.thinkingTrace,
        thinkingTokensUsed:
          parsed.thinkingTrace.length > 0
            ? response.usage?.output_tokens ?? 0
            : 0,
        confidence: parsed.confidence,
        stakesClassification: classification,
        modelIdUsed: modelId,
        thinkingEngaged: parsed.thinkingTrace.length > 0,
      });

      await maybeAudit(deps, options, context, classification, result);
      return result;
    } catch (err) {
      // Degrade gracefully — still produce a decision via fallback, but
      // mark thinkingEngaged=false so the caller (and audit) knows the
      // deep path did not run. Never swallow errors silently for
      // critical stakes — re-throw so upstream can surface the gap.
      if (classification.stakes === 'critical') {
        throw new Error(
          `thinkAndDecide: extended-thinking failed for CRITICAL decision and cannot degrade: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      const degraded = await runFallback(
        prompt,
        options,
        classification,
        modelId,
      );
      await maybeAudit(deps, options, context, classification, degraded);
      return degraded;
    }
  }

  return { thinkAndDecide };

  // -------------------------------------------------------------------------
  // Fallback path — used for low stakes AND for graceful degradation.
  // -------------------------------------------------------------------------
  async function runFallback(
    prompt: string,
    options: ThinkAndDecideOptions,
    classification: StakesClassification,
    modelId: string,
  ): Promise<ThinkingResult> {
    const fallback = await deps.fallbackLLM.decide(prompt, options.systemPrompt);
    return Object.freeze({
      decision: fallback.decision,
      reasoning: fallback.reasoning,
      thinkingTrace: '',
      thinkingTokensUsed: 0,
      confidence: fallback.confidence ?? 0.6,
      stakesClassification: classification,
      modelIdUsed: fallback.modelId || modelId,
      thinkingEngaged: false,
    });
  }

  async function maybeAudit(
    d: ThinkingRouterDeps,
    options: ThinkAndDecideOptions,
    context: DecisionContext,
    classification: StakesClassification,
    result: ThinkingResult,
  ): Promise<void> {
    if (!d.auditRecorder) return;
    const stakes = classification.stakes;
    const shouldAudit =
      stakes === 'critical' ||
      stakes === 'high' ||
      (stakes === 'medium' && d.auditMediumStakes === true);
    if (!shouldAudit) return;
    if (!options.tenantId) return;

    try {
      await d.auditRecorder.record({
        tenantId: options.tenantId,
        context,
        classification,
        thinkingTrace: result.thinkingTrace,
        decision: result.decision,
        reasoning: result.reasoning,
        modelIdUsed: result.modelIdUsed,
        thinkingTokensUsed: result.thinkingTokensUsed,
        occurredAt: now(),
      });
    } catch {
      // Audit failures must never block an autonomous action — log
      // would go here, but pino is out of scope for this pure module.
    }
  }
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface ParsedThinkingResponse {
  readonly decision: string;
  readonly reasoning: string;
  readonly thinkingTrace: string;
  readonly confidence: number;
}

function parseThinkingResponse(
  response: ThinkingMessageResponse,
): ParsedThinkingResponse {
  const blocks: ReadonlyArray<ThinkingResponseBlock> = response.content ?? [];
  const thinkingTrace = blocks
    .filter((b): b is ThinkingResponseBlock & { thinking: string } =>
      b.type === 'thinking' && typeof (b as { thinking?: unknown }).thinking === 'string',
    )
    .map((b) => (b as unknown as { thinking: string }).thinking)
    .join('\n')
    .trim();

  const textOut = blocks
    .filter((b): b is ThinkingResponseBlock & { text: string } =>
      b.type === 'text' && typeof (b as { text?: unknown }).text === 'string',
    )
    .map((b) => (b as unknown as { text: string }).text)
    .join('\n')
    .trim();

  // Try to split the text into decision vs reasoning. Convention: if the
  // text parses as JSON with {decision, reasoning, confidence?}, use it.
  // Otherwise treat the first sentence as the decision and the rest as
  // reasoning — callers who want structured output should request it in
  // the system prompt.
  const structured = tryParseStructured(textOut);
  if (structured) {
    return {
      decision: structured.decision,
      reasoning: structured.reasoning,
      thinkingTrace,
      confidence: clampConfidence(structured.confidence ?? 0.8),
    };
  }

  const firstSentenceEnd = textOut.search(/[.!?](\s|$)/);
  const decision =
    firstSentenceEnd > 0 ? textOut.slice(0, firstSentenceEnd + 1).trim() : textOut;
  const reasoning =
    firstSentenceEnd > 0 ? textOut.slice(firstSentenceEnd + 1).trim() : '';

  return {
    decision,
    reasoning,
    thinkingTrace,
    confidence: 0.75,
  };
}

function tryParseStructured(
  raw: string,
): { decision: string; reasoning: string; confidence?: number } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.decision === 'string' &&
      typeof parsed.reasoning === 'string'
    ) {
      return {
        decision: parsed.decision,
        reasoning: parsed.reasoning,
        confidence:
          typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
      };
    }
  } catch {
    // fall through — not JSON
  }
  return null;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// Convenience — wrap an `FallbackLLM` around an existing multi-llm-router.
// Exported so the api-gateway composition root can avoid a one-off adapter.
// ---------------------------------------------------------------------------

export function fallbackFromDecider(
  decide: (prompt: string, systemPrompt?: string) => Promise<{
    decision: string;
    reasoning: string;
    modelId: string;
    confidence?: number;
  }>,
): FallbackLLM {
  return { decide };
}
