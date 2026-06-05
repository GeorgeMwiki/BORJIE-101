/**
 * Feedback Loop — reinforcement updates triggered by explicit owner reactions
 * ("too long", "more detail", "use Swahili", thumbs-up/down).
 *
 * These are higher-signal than ambient lexicon votes — we apply them directly
 * against the dimension weights with a larger evidence boost.
 *
 * EN + SW signal detection: every signal carries both an English phrase set
 * and Swahili idioms (e.g. "fanya tu" = just do it, "kwa Kiswahili" = in
 * Swahili). Detection is locale-agnostic — a Swahili idiom moves the profile
 * even when the active UI locale is English, because the owner is telling us
 * how they want to be spoken to. Ported from the BossNyumba feedback loop and
 * retargeted real-estate → mining (the idiom set adds mining-owner phrasing).
 */

import { z } from 'zod';
import { logger } from '../../logger.js';
import { CATEGORY_VALUES, type OwnerStyleProfile } from './style-dimensions.js';
import { _internal as profilerInternal } from './profiler.js';

// ---------------------------------------------------------------------------
// Feedback signal types
// ---------------------------------------------------------------------------

export const FeedbackSignalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('too_long') }),
  z.object({ kind: z.literal('be_brief') }),
  z.object({ kind: z.literal('more_detail') }),
  z.object({ kind: z.literal('use_swahili') }),
  z.object({ kind: z.literal('use_english') }),
  z.object({ kind: z.literal('more_cautious') }),
  z.object({ kind: z.literal('more_aggressive') }),
  z.object({ kind: z.literal('more_formal') }),
  z.object({ kind: z.literal('more_casual') }),
  z.object({ kind: z.literal('just_do_it') }),
  z.object({ kind: z.literal('give_me_options') }),
  z.object({ kind: z.literal('thumbs_up') }),
  z.object({ kind: z.literal('thumbs_down') }),
]);
export type FeedbackSignal = z.infer<typeof FeedbackSignalSchema>;
export type FeedbackSignalKind = FeedbackSignal['kind'];

const REACTION_BOOST = 3; // strong signal weight
const DECAY = 0.98;

// ---------------------------------------------------------------------------
// Free-text -> structured signal extraction (EN + SW)
// ---------------------------------------------------------------------------

const PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly signal: FeedbackSignal;
}> = [
  // too long / be brief — EN + SW ("ndefu sana" = too long, "fupisha" = shorten)
  {
    pattern: /too long|tl;?dr|shorter please|ndefu sana|fupisha/i,
    signal: { kind: 'too_long' },
  },
  {
    pattern: /be brief|keep it short|kwa ufupi|kifupi/i,
    signal: { kind: 'be_brief' },
  },
  // more detail — EN + SW ("eleza zaidi" = explain more, "kwa undani" = in detail)
  {
    pattern: /more detail|explain more|expand|eleza zaidi|kwa undani|fafanua/i,
    signal: { kind: 'more_detail' },
  },
  // language switches — EN + SW
  {
    pattern: /use swahili|in swahili|kiswahili|kwa kiswahili|tumia kiswahili|sema kiswahili/i,
    signal: { kind: 'use_swahili' },
  },
  {
    pattern: /use english|in english|kwa kiingereza|tumia kiingereza|sema kiingereza/i,
    signal: { kind: 'use_english' },
  },
  // posture — cautious — EN + SW ("kuwa makini" = be careful, "pole pole" = slowly)
  {
    pattern: /more cautious|be careful|too risky|kuwa makini|pole pole|angalia/i,
    signal: { kind: 'more_cautious' },
  },
  // posture — bold — EN + SW ("kuwa jasiri" = be bold, "songa mbele" = push forward)
  {
    pattern: /more aggressive|bolder|push harder|kuwa jasiri|songa mbele|thubutu/i,
    signal: { kind: 'more_aggressive' },
  },
  // formality — EN + SW ("rasmi zaidi" = more formal)
  {
    pattern: /more formal|rasmi zaidi|kwa heshima zaidi/i,
    signal: { kind: 'more_formal' },
  },
  // formality — casual — EN + SW ("tulia" = relax, "kawaida" = casual/normal)
  {
    pattern: /more casual|relax|tulia|kawaida zaidi/i,
    signal: { kind: 'more_casual' },
  },
  // decision — directive — EN + SW ("fanya tu" = just do it, "endelea" = proceed)
  {
    pattern: /just do it|go ahead|fanya tu|endelea|fanya hivyo/i,
    signal: { kind: 'just_do_it' },
  },
  // decision — consultative — EN + SW ("nipe chaguo" = give me options)
  {
    pattern: /give me options|what are my options|nipe chaguo|nipe machaguo/i,
    signal: { kind: 'give_me_options' },
  },
];

export function parseFeedbackText(text: string): FeedbackSignal | null {
  for (const { pattern, signal } of PATTERNS) {
    if (pattern.test(text)) return signal;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Signal -> dimension vote mapping
// ---------------------------------------------------------------------------

function votesForSignal(
  signal: FeedbackSignal
): Partial<Record<keyof typeof CATEGORY_VALUES, Record<string, number>>> {
  switch (signal.kind) {
    case 'too_long':
    case 'be_brief':
      return { verbosity: { terse: REACTION_BOOST } };
    case 'more_detail':
      return {
        verbosity: { verbose: REACTION_BOOST },
        detail: { high: REACTION_BOOST },
      };
    case 'use_swahili':
      return { language: { sw_leaning_bilingual: REACTION_BOOST } };
    case 'use_english':
      return { language: { en: REACTION_BOOST } };
    case 'more_cautious':
      return { posture: { cautious: REACTION_BOOST } };
    case 'more_aggressive':
      return { posture: { bold: REACTION_BOOST } };
    case 'just_do_it':
      return { posture: { bold: REACTION_BOOST } };
    case 'give_me_options':
      return { posture: { cautious: REACTION_BOOST } };
    case 'more_formal':
      return { formality: { formal: REACTION_BOOST } };
    case 'more_casual':
      return { formality: { casual: REACTION_BOOST } };
    case 'thumbs_up':
      return {}; // amplification handled via subsequent-turn weight
    case 'thumbs_down':
      return {}; // suppression handled at next turn
  }
}

// ---------------------------------------------------------------------------
// Public reinforcement API
// ---------------------------------------------------------------------------

export function applyFeedback(
  prior: OwnerStyleProfile,
  signal: FeedbackSignal,
  options: { readonly now?: () => string } = {}
): OwnerStyleProfile {
  const parsed = FeedbackSignalSchema.safeParse(signal);
  if (!parsed.success) {
    logger.warn('owner-style.feedback.invalid-signal', {
      error: parsed.error.message,
    });
    return prior;
  }
  const now = (options.now ?? (() => new Date().toISOString()))();
  const votes = votesForSignal(parsed.data);

  // Blend each dimension immutably. A dimension with no vote for this signal is
  // returned unchanged. Allowed-value arrays are narrowed per dimension so the
  // blended `value` keeps its precise literal type.
  const out: OwnerStyleProfile = {
    ...prior,
    verbosity: votes.verbosity
      ? profilerInternal.injectVotes(
          prior.verbosity,
          votes.verbosity,
          DECAY,
          1,
          CATEGORY_VALUES.verbosity as ReadonlyArray<
            OwnerStyleProfile['verbosity']['value']
          >
        )
      : prior.verbosity,
    detail: votes.detail
      ? profilerInternal.injectVotes(
          prior.detail,
          votes.detail,
          DECAY,
          1,
          CATEGORY_VALUES.detail as ReadonlyArray<
            OwnerStyleProfile['detail']['value']
          >
        )
      : prior.detail,
    language: votes.language
      ? profilerInternal.injectVotes(
          prior.language,
          votes.language,
          DECAY,
          1,
          CATEGORY_VALUES.language as ReadonlyArray<
            OwnerStyleProfile['language']['value']
          >
        )
      : prior.language,
    formality: votes.formality
      ? profilerInternal.injectVotes(
          prior.formality,
          votes.formality,
          DECAY,
          1,
          CATEGORY_VALUES.formality as ReadonlyArray<
            OwnerStyleProfile['formality']['value']
          >
        )
      : prior.formality,
    posture: votes.posture
      ? profilerInternal.injectVotes(
          prior.posture,
          votes.posture,
          DECAY,
          1,
          CATEGORY_VALUES.posture as ReadonlyArray<
            OwnerStyleProfile['posture']['value']
          >
        )
      : prior.posture,
  };

  const updated: OwnerStyleProfile = {
    ...out,
    feedbackCount: prior.feedbackCount + 1,
    lastUpdatedAt: now,
    updatedBySignal: parsed.data.kind,
    confidence: profilerInternal.aggregateConfidence(out),
  };
  return updated;
}

export function applyFeedbackText(
  prior: OwnerStyleProfile,
  text: string,
  options: { readonly now?: () => string } = {}
): OwnerStyleProfile {
  const sig = parseFeedbackText(text);
  if (!sig) return prior;
  return applyFeedback(prior, sig, options);
}
