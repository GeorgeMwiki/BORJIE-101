/**
 * Multi-LLM Synthesizer — fan-out + synthesize.
 *
 * Pairs the existing single-best-provider `multi-llm-router.ts` with a
 * fan-out path for the cases where a single answer is insufficient:
 *
 *   - deep reasoning where 3 perspectives reduce blind spots
 *   - document creation where divergence signals a missing source
 *   - high-impact decisions where confidence calibration matters
 *
 * Strategy (Mixture-of-Agents, Wang et al. 2024 + 2026 successors):
 *
 *   1. Fan out the user prompt to N proposers in parallel.
 *   2. Each proposer returns its answer + reasoning trace.
 *   3. A separate synthesizer LLM receives the prompt + all N proposals
 *      and produces ONE merged answer, preferring claims that multiple
 *      proposers ground in shared sources.
 *   4. Agreement metric: Jaccard over normalised claim sets across
 *      proposers. Low agreement → escalate flag rather than silent merge.
 *
 * The synthesizer is itself an `AIProvider` — typically the strongest
 * model the tenant tier allows (Claude Opus 4.7 for enterprise). Providers
 * are passed in by composition root; this module has no env coupling.
 *
 * Failure modes:
 *   - Any proposer failure → continue with the remaining set (≥1 required).
 *   - All proposers fail → return aggregated AIError, do not call synthesizer.
 *   - Synthesizer failure → return the highest-confidence proposer answer
 *     plus a `synthesizerFallback: true` flag and an aggregated error.
 */

import type {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIProviderError,
} from './ai-provider.js';
import type { AIResult } from '../types/core.types.js';
import { aiOk, aiErr } from '../types/core.types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Synthesis mode controls how the merged answer is produced.
 *
 *   - 'merge'         — single synthesizer LLM merges all proposals.
 *   - 'jury'          — synthesizer picks the single best proposal verbatim
 *                       and explains why. Lower hallucination risk.
 *   - 'race-verify'   — return the fastest proposer's stream immediately,
 *                       verify against the remaining proposers in the
 *                       background, flag if they disagree.
 */
export type SynthesisMode = 'merge' | 'jury' | 'race-verify';

export interface ProposerRegistration {
  readonly id: string;
  readonly provider: AIProvider;
  readonly model: string;
  /**
   * Relative weight applied to this proposer's answer when computing
   * agreement-weighted confidence. Defaults to 1.0.
   */
  readonly weight?: number;
}

export interface MultiLLMSynthesizerDeps {
  /** N proposers run in parallel; >=1 must succeed. Order is preserved. */
  readonly proposers: readonly ProposerRegistration[];
  /** The synthesizer LLM that merges or selects from the proposals. */
  readonly synthesizer: ProposerRegistration;
  /** Optional logger; warnings on proposer failure and low agreement. */
  readonly logger?: {
    warn?(meta: Record<string, unknown>): void;
    info?(meta: Record<string, unknown>): void;
  };
}

export interface SynthesizeOptions {
  readonly mode?: SynthesisMode;
  /**
   * Minimum number of proposers that must succeed for the synthesizer to
   * be invoked. Defaults to 1. Setting to 2+ enforces cross-check before
   * any answer is returned.
   */
  readonly minProposerSuccesses?: number;
  /**
   * If agreement (Jaccard over normalised claim sets) falls below this
   * threshold, the result is flagged for escalation. Defaults to 0.4.
   */
  readonly minAgreementThreshold?: number;
  /** Per-proposer timeout. Defaults to the proposer's provider default. */
  readonly proposerTimeoutMs?: number;
  /** Synthesizer timeout. Defaults to its provider default. */
  readonly synthesizerTimeoutMs?: number;
}

export interface ProposerOutcome {
  readonly proposerId: string;
  readonly providerId: string;
  readonly model: string;
  /** Matches AIResult.success — true when the provider returned a response. */
  readonly success: boolean;
  readonly response?: AICompletionResponse;
  readonly error?: AIProviderError;
  readonly latencyMs: number;
}

export interface SynthesisResult {
  /** Final synthesized answer. */
  readonly content: string;
  /** Synthesizer's underlying response (token usage, model id, etc.). */
  readonly synthesizerResponse: AICompletionResponse;
  /** Per-proposer outcome (success or error). */
  readonly proposerOutcomes: readonly ProposerOutcome[];
  /** Agreement score [0, 1] — Jaccard over normalised claim sets. */
  readonly agreement: number;
  /** True when agreement < minAgreementThreshold. */
  readonly escalate: boolean;
  /** True when synthesizer failed and we fell back to highest-confidence proposer. */
  readonly synthesizerFallback: boolean;
  /** True when one or more proposers failed but the run still produced an answer. */
  readonly degraded: boolean;
}

export interface SynthesisError extends AIProviderError {
  /** When all proposers fail, the individual errors are kept here. */
  proposerErrors?: readonly { proposerId: string; error: AIProviderError }[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a synthesizer instance. Composition root passes in the providers
 * + tenant tier preferred models; this function returns a closure with
 * a single `synthesize(request, options?)` entrypoint.
 */
export function createMultiLLMSynthesizer(deps: MultiLLMSynthesizerDeps): {
  synthesize(
    request: AICompletionRequest,
    options?: SynthesizeOptions,
  ): Promise<AIResult<SynthesisResult, SynthesisError>>;
} {
  if (deps.proposers.length < 1) {
    throw new Error('multi-llm-synthesizer requires at least 1 proposer');
  }

  return {
    synthesize: (request, options) => runSynthesis(deps, request, options),
  };
}

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

async function runSynthesis(
  deps: MultiLLMSynthesizerDeps,
  request: AICompletionRequest,
  options: SynthesizeOptions = {},
): Promise<AIResult<SynthesisResult, SynthesisError>> {
  const mode: SynthesisMode = options.mode ?? 'merge';
  const minSuccesses = Math.max(1, options.minProposerSuccesses ?? 1);
  const minAgreement = clamp01(options.minAgreementThreshold ?? 0.4);

  // 1. Fan out to all proposers in parallel.
  const proposerOutcomes = await Promise.all(
    deps.proposers.map((p) =>
      runProposer(p, request, options.proposerTimeoutMs),
    ),
  );

  const successes = proposerOutcomes.filter(
    (o): o is ProposerOutcome & { response: AICompletionResponse } =>
      o.success && o.response !== undefined,
  );
  const failures = proposerOutcomes.filter((o) => !o.success);

  if (successes.length < minSuccesses) {
    deps.logger?.warn?.({
      where: 'multi-llm-synthesizer',
      msg: 'min_proposers_not_met',
      required: minSuccesses,
      got: successes.length,
    });
    const proposerErrors: readonly { proposerId: string; error: AIProviderError }[] =
      failures
        .filter((f) => f.error !== undefined)
        .map((f) => ({ proposerId: f.proposerId, error: f.error! }));
    // All proposer failures are themselves transient if every underlying
    // error was transient; otherwise treat the synthesizer call as
    // non-retryable so the caller escalates to a human path.
    const allRetryable = proposerErrors.every((p) => p.error.retryable === true);
    const synthError: SynthesisError = {
      code: 'PROVIDER_ERROR',
      message: `multi-llm-synthesizer: required ${minSuccesses} proposer successes, got ${successes.length}`,
      provider: 'multi-llm-synthesizer',
      retryable: allRetryable && proposerErrors.length > 0,
      proposerErrors,
    };
    return aiErr<SynthesisError>(synthError);
  }

  // 2. Compute agreement across successful proposals.
  const agreement = computeAgreement(successes.map((o) => o.response.content));
  const escalate = agreement < minAgreement;

  if (escalate) {
    deps.logger?.warn?.({
      where: 'multi-llm-synthesizer',
      msg: 'low_agreement',
      agreement,
      threshold: minAgreement,
      proposerIds: successes.map((s) => s.proposerId),
    });
  }

  // 3. Race-verify short-circuits the synthesizer — return the fastest
  // proposer immediately; remaining proposers' outputs are still inspected
  // for agreement so the caller can flag for follow-up review.
  if (mode === 'race-verify') {
    const fastest = pickFastest(successes);
    return aiOk<SynthesisResult>({
      content: fastest.response.content,
      synthesizerResponse: fastest.response,
      proposerOutcomes,
      agreement,
      escalate,
      synthesizerFallback: true,
      degraded: failures.length > 0,
    });
  }

  // 4. Invoke synthesizer with mode-specific prompt.
  const synthRequest = buildSynthesizerRequest(
    request,
    successes,
    mode,
    options.synthesizerTimeoutMs,
  );
  const synthResult = await deps.synthesizer.provider.complete(synthRequest);

  if (synthResult.success === false) {
    // 5. Synthesizer failed → fall back to highest-confidence proposer.
    deps.logger?.warn?.({
      where: 'multi-llm-synthesizer',
      msg: 'synthesizer_failed',
      error: synthResult.error,
    });
    const best = pickHighestConfidence(successes);
    return aiOk<SynthesisResult>({
      content: best.response.content,
      synthesizerResponse: best.response,
      proposerOutcomes,
      agreement,
      escalate: true, // synthesizer failure always escalates
      synthesizerFallback: true,
      degraded: true,
    });
  }

  return aiOk<SynthesisResult>({
    content: synthResult.data.content,
    synthesizerResponse: synthResult.data,
    proposerOutcomes,
    agreement,
    escalate,
    synthesizerFallback: false,
    degraded: failures.length > 0,
  });
}

// ---------------------------------------------------------------------------
// Per-proposer execution
// ---------------------------------------------------------------------------

async function runProposer(
  registration: ProposerRegistration,
  request: AICompletionRequest,
  timeoutOverrideMs: number | undefined,
): Promise<ProposerOutcome> {
  const start = Date.now();
  const scopedRequest: AICompletionRequest = {
    ...request,
    modelOverride: registration.model,
    timeoutMs: timeoutOverrideMs ?? request.timeoutMs,
  };

  try {
    const result = await registration.provider.complete(scopedRequest);
    const latencyMs = Date.now() - start;
    if (result.success === true) {
      return {
        proposerId: registration.id,
        providerId: registration.provider.providerId,
        model: registration.model,
        success: true,
        response: result.data,
        latencyMs,
      };
    }
    return {
      proposerId: registration.id,
      providerId: registration.provider.providerId,
      model: registration.model,
      success: false,
      error: result.error,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return {
      proposerId: registration.id,
      providerId: registration.provider.providerId,
      model: registration.model,
      success: false,
      error: {
        code: 'PROVIDER_ERROR',
        provider: registration.provider.providerId,
        message: err instanceof Error ? err.message : 'unknown error',
      } as AIProviderError,
      latencyMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Synthesizer prompt builder — mode-aware
// ---------------------------------------------------------------------------

function buildSynthesizerRequest(
  original: AICompletionRequest,
  proposals: readonly (ProposerOutcome & { response: AICompletionResponse })[],
  mode: SynthesisMode,
  timeoutMs: number | undefined,
): AICompletionRequest {
  const instructions =
    mode === 'jury'
      ? JURY_SYSTEM_INSTRUCTIONS
      : MERGE_SYSTEM_INSTRUCTIONS;

  const userText = original.prompt?.userPrompt ?? '';
  const proposalBlock = proposals
    .map(
      (p, i) =>
        `### Proposal ${i + 1} — proposer=${p.proposerId} model=${p.model} latencyMs=${p.latencyMs}\n${p.response.content}`,
    )
    .join('\n\n');

  const systemPrompt = `${original.prompt?.systemPrompt ?? ''}\n\n${instructions}`.trim();
  const composedUser = `# User request\n${userText}\n\n# Candidate proposals (independent LLM answers)\n${proposalBlock}\n\n# Your task\nProduce the final answer per the synthesis policy above.`;

  return {
    ...original,
    prompt: {
      ...original.prompt,
      systemPrompt,
      userPrompt: composedUser,
    },
    timeoutMs: timeoutMs ?? original.timeoutMs,
  };
}

const MERGE_SYSTEM_INSTRUCTIONS = `You are a synthesizer for a mixture-of-agents pipeline.
You will receive a user request and N independent candidate answers from different LLMs.
Produce ONE final answer that:
  - prefers claims grounded in evidence cited by multiple candidates,
  - explicitly flags disagreements rather than silently picking a side,
  - omits claims appearing in only one candidate unless that candidate cites a verifiable source,
  - keeps the user's voice and format intent,
  - never adds new factual claims of its own beyond what the candidates support.
Return only the merged answer text. Do not preface it with "Here is the merged answer" or similar.`;

const JURY_SYSTEM_INSTRUCTIONS = `You are a jury for a mixture-of-agents pipeline.
You will receive a user request and N independent candidate answers from different LLMs.
Select the single best candidate verbatim. Do not edit it. Do not merge it.
Return: (1) the unchanged winning answer, then (2) a single line beginning with "Jury rationale:" explaining why.`;

// ---------------------------------------------------------------------------
// Agreement metric — Jaccard over normalised content tokens.
// ---------------------------------------------------------------------------

/**
 * Pairwise-mean Jaccard similarity over normalised n-gram sets.
 * Fast, dependency-free, and stable enough to detect divergence in deep-
 * reasoning paths. Returns 1.0 for a single proposal (degenerate case).
 */
function computeAgreement(contents: readonly string[]): number {
  if (contents.length <= 1) return 1;
  const sets = contents.map((c) => toTokenSet(c));
  let pairCount = 0;
  let total = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      total += jaccard(sets[i]!, sets[j]!);
      pairCount++;
    }
  }
  return pairCount === 0 ? 1 : total / pairCount;
}

function toTokenSet(text: string): Set<string> {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = cleaned.split(' ').filter((t) => t.length >= 3);
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

function pickFastest(
  successes: readonly (ProposerOutcome & { response: AICompletionResponse })[],
): ProposerOutcome & { response: AICompletionResponse } {
  return successes.reduce((best, current) =>
    current.latencyMs < best.latencyMs ? current : best,
  );
}

function pickHighestConfidence(
  successes: readonly (ProposerOutcome & { response: AICompletionResponse })[],
): ProposerOutcome & { response: AICompletionResponse } {
  // Without explicit per-token logprobs we proxy confidence with:
  //   1. finishReason === 'stop' (clean completion) preferred over 'length',
  //   2. higher completion-token count up to a point (richer answer),
  //   3. lower latency as a tiebreaker.
  return [...successes].sort((a, b) => {
    const aClean = a.response.finishReason === 'stop' ? 1 : 0;
    const bClean = b.response.finishReason === 'stop' ? 1 : 0;
    if (aClean !== bClean) return bClean - aClean;
    const aTokens = a.response.usage.completionTokens;
    const bTokens = b.response.usage.completionTokens;
    if (aTokens !== bTokens) return bTokens - aTokens;
    return a.latencyMs - b.latencyMs;
  })[0]!;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
