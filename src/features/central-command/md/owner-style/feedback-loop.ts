/**
 * Feedback Loop — reinforcement updates triggered by explicit owner
 * reactions ("too long", "more detail", "use Swahili", thumbs-up/down).
 *
 * These are higher-signal than ambient lexicon votes — we apply them
 * directly against the dimension weights with a larger evidence boost.
 */

import { z } from "zod";
import { createLogger } from "@/lib/logger";
import { CATEGORY_VALUES, type OwnerStyleProfile } from "./style-dimensions";
import { _internal as profilerInternal } from "./profiler";

const log = createLogger("md.owner-style");

// ---------------------------------------------------------------------------
// Feedback signal types
// ---------------------------------------------------------------------------

export const FeedbackSignalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("too_long") }),
  z.object({ kind: z.literal("too_short") }),
  z.object({ kind: z.literal("more_detail") }),
  z.object({ kind: z.literal("be_brief") }),
  z.object({ kind: z.literal("use_swahili") }),
  z.object({ kind: z.literal("use_english") }),
  z.object({ kind: z.literal("just_do_it") }),
  z.object({ kind: z.literal("give_me_options") }),
  z.object({ kind: z.literal("more_cautious") }),
  z.object({ kind: z.literal("more_aggressive") }),
  z.object({ kind: z.literal("more_formal") }),
  z.object({ kind: z.literal("more_casual") }),
  z.object({ kind: z.literal("thumbs_up") }),
  z.object({ kind: z.literal("thumbs_down") }),
]);
export type FeedbackSignal = z.infer<typeof FeedbackSignalSchema>;

const REACTION_BOOST = 3; // strong signal weight
const DECAY = 0.98;

// ---------------------------------------------------------------------------
// Free-text → structured signal extraction
// ---------------------------------------------------------------------------

const PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly signal: FeedbackSignal;
}> = [
  { pattern: /too long|tldr|shorter please/i, signal: { kind: "too_long" } },
  { pattern: /too short|too brief/i, signal: { kind: "too_short" } },
  {
    pattern: /more detail|explain more|expand/i,
    signal: { kind: "more_detail" },
  },
  { pattern: /be brief|keep it short|tldr/i, signal: { kind: "be_brief" } },
  {
    pattern: /use swahili|kiswahili|swahili/i,
    signal: { kind: "use_swahili" },
  },
  { pattern: /use english|in english/i, signal: { kind: "use_english" } },
  { pattern: /just do it|go ahead/i, signal: { kind: "just_do_it" } },
  {
    pattern: /give me options|what are my options/i,
    signal: { kind: "give_me_options" },
  },
  {
    pattern: /more cautious|be careful|too risky/i,
    signal: { kind: "more_cautious" },
  },
  {
    pattern: /more aggressive|bolder|push harder/i,
    signal: { kind: "more_aggressive" },
  },
  { pattern: /more formal/i, signal: { kind: "more_formal" } },
  { pattern: /more casual|relax/i, signal: { kind: "more_casual" } },
];

export function parseFeedbackText(text: string): FeedbackSignal | null {
  for (const { pattern, signal } of PATTERNS) {
    if (pattern.test(text)) return signal;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Signal → dimension vote mapping
// ---------------------------------------------------------------------------

function votesForSignal(
  signal: FeedbackSignal,
): Partial<Record<keyof typeof CATEGORY_VALUES, Record<string, number>>> {
  switch (signal.kind) {
    case "too_long":
    case "be_brief":
      return { verbosity: { terse: REACTION_BOOST } };
    case "too_short":
    case "more_detail":
      return { verbosity: { verbose: REACTION_BOOST } };
    case "use_swahili":
      return {
        languagePreference: { swahili_leaning_bilingual: REACTION_BOOST },
      };
    case "use_english":
      return { languagePreference: { english_only: REACTION_BOOST } };
    case "just_do_it":
      return { decisionStyle: { directive: REACTION_BOOST } };
    case "give_me_options":
      return { decisionStyle: { consultative: REACTION_BOOST } };
    case "more_cautious":
      return { riskAppetite: { conservative: REACTION_BOOST } };
    case "more_aggressive":
      return { riskAppetite: { aggressive: REACTION_BOOST } };
    case "more_formal":
      return { tone: { formal: REACTION_BOOST } };
    case "more_casual":
      return { tone: { casual: REACTION_BOOST } };
    case "thumbs_up":
      return {}; // amplification handled via subsequent turn weight
    case "thumbs_down":
      return {}; // suppression handled at next turn
  }
}

// ---------------------------------------------------------------------------
// Public reinforcement API
// ---------------------------------------------------------------------------

export function applyFeedback(
  prior: OwnerStyleProfile,
  signal: FeedbackSignal,
  options: { readonly now?: () => string } = {},
): OwnerStyleProfile {
  const parsed = FeedbackSignalSchema.safeParse(signal);
  if (!parsed.success) {
    log.warn("invalid feedback signal", { error: parsed.error.message });
    return prior;
  }
  const now = (options.now ?? (() => new Date().toISOString()))();
  const votes = votesForSignal(parsed.data);

  const out: OwnerStyleProfile = { ...prior };

  for (const [k, dimVotes] of Object.entries(votes) as Array<
    [keyof typeof CATEGORY_VALUES, Record<string, number>]
  >) {
    const dim = out[k];
    const allowedValues = CATEGORY_VALUES[k] as ReadonlyArray<string>;
    const blended = profilerInternal.injectVotes(
      dim,
      dimVotes,
      DECAY,
      1,
      allowedValues as ReadonlyArray<typeof dim.value>,
    );
    (out as Record<string, unknown>)[k] = blended;
  }

  const updated: OwnerStyleProfile = {
    ...out,
    sampleSize: prior.sampleSize + 1,
    lastUpdatedAt: now,
    confidence: profilerInternal.aggregateConfidence({
      ...prior,
      ...out,
    } as OwnerStyleProfile),
  };
  return updated;
}

export function applyFeedbackText(
  prior: OwnerStyleProfile,
  text: string,
  options: { readonly now?: () => string } = {},
): OwnerStyleProfile {
  const sig = parseFeedbackText(text);
  if (!sig) return prior;
  return applyFeedback(prior, sig, options);
}
