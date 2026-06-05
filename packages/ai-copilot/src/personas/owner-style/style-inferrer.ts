/**
 * Owner-Style Inferrer — bootstrap a first-pass profile from a small set of
 * chat turns (typically ~5). Wraps an optional classifier behind an injectable
 * interface so tests run deterministically.
 *
 * The classifier returns soft votes per dimension. We feed those votes through
 * the same Bayesian blender used by the profiler — so bootstrap and incremental
 * updates stay mathematically consistent.
 */

import { z } from 'zod';
import { logger } from '../../logger.js';
import {
  CATEGORY_VALUES,
  makeDefaultProfile,
  type OwnerStyleProfile,
} from './style-dimensions.js';
import {
  ChatTurnObservationSchema,
  extractEvidence,
  updateProfileBatch,
  type ChatTurnObservation,
} from './profiler.js';

// ---------------------------------------------------------------------------
// Classifier contract
// ---------------------------------------------------------------------------

const ClassifierResultSchema = z.object({
  verbosity: z.record(z.string(), z.number().nonnegative()).optional(),
  detail: z.record(z.string(), z.number().nonnegative()).optional(),
  language: z.record(z.string(), z.number().nonnegative()).optional(),
  formality: z.record(z.string(), z.number().nonnegative()).optional(),
  posture: z.record(z.string(), z.number().nonnegative()).optional(),
});
export type ClassifierResult = z.infer<typeof ClassifierResultSchema>;

export interface StyleClassifier {
  classify(turns: ReadonlyArray<ChatTurnObservation>): Promise<ClassifierResult>;
}

// ---------------------------------------------------------------------------
// Default classifier — purely deterministic, no LLM dependency. Aggregates the
// lexicon-based evidence from each turn. Production can swap in an LLM-backed
// implementation via `inferInitialProfile({ classifier })`.
// ---------------------------------------------------------------------------

function mergeVotes(
  acc: Record<string, number>,
  vs: Record<string, number> | undefined
): Record<string, number> {
  if (!vs) return acc;
  const out: Record<string, number> = { ...acc };
  for (const [k, v] of Object.entries(vs)) {
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

export const lexicalClassifier: StyleClassifier = {
  async classify(turns) {
    const result: Required<ClassifierResult> = {
      verbosity: {},
      detail: {},
      language: {},
      formality: {},
      posture: {},
    };
    for (const t of turns) {
      const ev = extractEvidence(t);
      result.verbosity = mergeVotes(result.verbosity, ev.verbosity);
      result.detail = mergeVotes(result.detail, ev.detail);
      result.language = mergeVotes(result.language, ev.language);
      result.formality = mergeVotes(result.formality, ev.formality);
      result.posture = mergeVotes(result.posture, ev.posture);
    }
    return result;
  },
};

// ---------------------------------------------------------------------------
// LLM prompt — exported so an LLM-backed classifier can be wired at the
// application layer. EN + SW aware.
// ---------------------------------------------------------------------------

export const STYLE_CLASSIFIER_PROMPT = `You are classifying a mining owner's
communication style from chat turns (which may mix English and Swahili). The
owner is a licence holder running a mineral-rights portfolio — sites, pits,
royalties, buyers, vendors. For each dimension below, return a JSON object whose
keys are the listed categories and whose values are non-negative integers
expressing how much evidence each category has. Use 0 when there is no evidence.

DIMENSIONS:
- verbosity: ${CATEGORY_VALUES.verbosity.join(', ')}
- detail: ${CATEGORY_VALUES.detail.join(', ')}
- language: ${CATEGORY_VALUES.language.join(', ')}
- formality: ${CATEGORY_VALUES.formality.join(', ')}
- posture: ${CATEGORY_VALUES.posture.join(', ')}

Return ONLY a JSON object with those five keys. Do not include prose.
`;

// ---------------------------------------------------------------------------
// Public bootstrap
// ---------------------------------------------------------------------------

export interface InferInitialProfileArgs {
  readonly tenantId: string;
  readonly turns: ReadonlyArray<ChatTurnObservation>;
  readonly classifier?: StyleClassifier;
  readonly now?: () => string;
}

export async function inferInitialProfile(
  args: InferInitialProfileArgs
): Promise<OwnerStyleProfile> {
  const validatedTurns: ChatTurnObservation[] = [];
  for (const t of args.turns) {
    const parsed = ChatTurnObservationSchema.safeParse(t);
    if (parsed.success) validatedTurns.push(parsed.data);
    else
      logger.warn('owner-style.bootstrap.invalid-turn', {
        error: parsed.error.message,
      });
  }

  const profileArgs: { tenantId: string; now?: () => string } = {
    tenantId: args.tenantId,
  };
  if (args.now) profileArgs.now = args.now;
  const profile = makeDefaultProfile(profileArgs);
  if (validatedTurns.length === 0) return profile;

  const batchOpts: { now?: () => string } = {};
  if (args.now) batchOpts.now = args.now;

  const classifier = args.classifier ?? lexicalClassifier;
  let bootstrapVotes: ClassifierResult;
  try {
    const raw = await classifier.classify(validatedTurns);
    bootstrapVotes = ClassifierResultSchema.parse(raw);
  } catch (err) {
    logger.error('owner-style.bootstrap.classifier-failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Fall back to the per-turn lexicon profiler.
    return updateProfileBatch(profile, validatedTurns, batchOpts);
  }

  // Replay turns through the profiler (captures reactions / recency), then
  // layer the classifier's aggregated votes on top so bootstrap and
  // incremental models stay consistent.
  const afterTurns = updateProfileBatch(profile, validatedTurns, batchOpts);
  return mergeClassifierVotes(afterTurns, bootstrapVotes);
}

function mergeClassifierVotes(
  profile: OwnerStyleProfile,
  votes: ClassifierResult
): OwnerStyleProfile {
  const out = { ...profile };
  for (const key of [
    'verbosity',
    'detail',
    'language',
    'formality',
    'posture',
  ] as const) {
    const dimVotes = votes[key];
    if (!dimVotes) continue;
    const dim = out[key];
    const allowed = new Set(CATEGORY_VALUES[key]);
    const newWeights: Record<string, number> = { ...dim.weights };
    let best = dim.value;
    let bestVal = -Infinity;
    let total = 0;
    for (const [cat, w] of Object.entries(dimVotes)) {
      if (!allowed.has(cat)) continue;
      newWeights[cat] = (newWeights[cat] ?? 0) + w;
    }
    for (const [cat, w] of Object.entries(newWeights)) {
      total += w;
      if (w > bestVal) {
        bestVal = w;
        best = cat as typeof dim.value;
      }
    }
    (out as Record<string, unknown>)[key] = {
      value: best as typeof dim.value,
      weights: newWeights,
      confidence: total > 0 ? bestVal / total : dim.confidence,
    };
  }
  const dimKeys = [
    'verbosity',
    'detail',
    'language',
    'formality',
    'posture',
  ] as const;
  const agg =
    dimKeys.reduce((s, k) => s + out[k].confidence, 0) / dimKeys.length;
  return { ...out, confidence: agg };
}
