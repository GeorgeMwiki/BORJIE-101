/**
 * speculative-decoding/draft-then-verify — SCAFFOLD (LP-12, experimental tail).
 *
 * Ported (shape) from LITFIN `src/core/ai/speculative-decoding/draft-then-verify.ts`.
 *
 * Speeds up generation by drafting a window of tokens with a cheap model then
 * verifying with the strong model: when the verifier's output shares the
 * draft's prefix, we pay one strong-model decode for a burst instead of N
 * sequential decodes.
 *
 * STATUS: typed interface + a minimal, correct-but-unoptimised single-round
 * implementation that always lets the verifier produce the final answer. The
 * true multi-round token-window acceptance loop is deferred.
 *
 * TODO(LP-12): implement the real multi-round draft/verify loop with token-level
 *   (not whole-string) acceptance, AbortSignal propagation through both calls,
 *   and an acceptance-rate-driven adaptive draft window. See LITFIN ref.
 *
 * Provider-agnostic: both models are injected ports; no client import here.
 */

/** A model that can emit a completion for a single prompt (draft or verifier). */
export interface SpeculativeModelClient {
  /** Stable model id for telemetry + acceptance bookkeeping. */
  readonly modelId: string;
  generate(args: {
    readonly prompt: string;
    readonly maxTokens: number;
    readonly temperature?: number;
  }): Promise<string>;
}

export interface SpeculativeDecodeArgs {
  readonly prompt: string;
  readonly modelMain: SpeculativeModelClient;
  readonly modelDraft: SpeculativeModelClient;
  /** Tokens the draft may propose per round. Default 32. */
  readonly draftWindowTokens?: number;
  /** Total completion cap. Default 512. */
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export interface SpeculativeDecodeStats {
  readonly rounds: number;
  readonly draftedCharsApprox: number;
  readonly acceptedCharsApprox: number;
  /** acceptedCharsApprox / draftedCharsApprox, in [0,1]. */
  readonly acceptRate: number;
  readonly draftModelId: string;
  readonly mainModelId: string;
  readonly fellBackToMainOnly: boolean;
}

export interface SpeculativeDecodeResult {
  readonly text: string;
  readonly stats: SpeculativeDecodeStats;
}

const DEFAULT_DRAFT_WINDOW = 32;
const DEFAULT_MAX_TOKENS = 512;

/** Longest common prefix length of two strings. */
function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

/**
 * Minimal single-round speculative decode (SCAFFOLD). Drafts once with the
 * cheap model, then has the strong model produce the authoritative answer;
 * reports how much of the draft the verifier's answer happened to match (the
 * acceptance signal the full loop will exploit).
 *
 * The verifier ALWAYS produces the returned text, so correctness never depends
 * on the draft — this is safe to wire as a pure latency optimisation.
 */
export async function speculativeDecode(args: SpeculativeDecodeArgs): Promise<SpeculativeDecodeResult> {
  const draftWindow = args.draftWindowTokens ?? DEFAULT_DRAFT_WINDOW;
  const maxTokens = args.maxTokens ?? DEFAULT_MAX_TOKENS;

  let draft = '';
  let fellBack = false;
  try {
    draft = await args.modelDraft.generate({
      prompt: args.prompt,
      maxTokens: draftWindow,
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
    });
  } catch {
    fellBack = true; // draft unavailable — verifier-only path
  }

  // TODO(LP-12): feed the accepted draft prefix back as a continuation seed
  //   and loop until stop, instead of a single straight verifier call.
  const verified = await args.modelMain.generate({
    prompt: args.prompt,
    maxTokens,
    ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
  });

  const draftedChars = draft.length;
  const acceptedChars = fellBack ? 0 : commonPrefixLen(draft, verified);
  const acceptRate = draftedChars > 0 ? acceptedChars / draftedChars : 0;

  return {
    text: verified,
    stats: {
      rounds: 1,
      draftedCharsApprox: draftedChars,
      acceptedCharsApprox: acceptedChars,
      acceptRate,
      draftModelId: args.modelDraft.modelId,
      mainModelId: args.modelMain.modelId,
      fellBackToMainOnly: fellBack,
    },
  };
}

/** Opt-in flag (off unless explicitly enabled). */
export function isSpeculativeDecodingEnabled(): boolean {
  return process.env.BORJIE_SPECULATIVE_DECODING === '1';
}
