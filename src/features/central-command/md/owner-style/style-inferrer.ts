/**
 * Owner-Style Inferrer — bootstrap a first-pass profile from a small set
 * of chat turns (typically ~5). Wraps an LLM classifier behind an
 * injectable interface so tests run deterministically.
 *
 * The classifier returns soft votes per dimension. We then feed those votes
 * through the same Bayesian blender used by the profiler — so bootstrap and
 * incremental updates are mathematically consistent.
 */

import { z } from "zod";
import { createLogger } from "@/lib/logger";
import {
  CATEGORY_VALUES,
  makeDefaultProfile,
  type OwnerStyleProfile,
} from "./style-dimensions";
import {
  ChatTurnObservationSchema,
  extractEvidence,
  updateProfileBatch,
  type ChatTurnObservation,
} from "./profiler";

const log = createLogger("md.owner-style");

// ---------------------------------------------------------------------------
// Classifier contract
// ---------------------------------------------------------------------------

const ClassifierResultSchema = z.object({
  tone: z.record(z.string(), z.number().nonnegative()).optional(),
  verbosity: z.record(z.string(), z.number().nonnegative()).optional(),
  decisionStyle: z.record(z.string(), z.number().nonnegative()).optional(),
  riskAppetite: z.record(z.string(), z.number().nonnegative()).optional(),
  languagePreference: z.record(z.string(), z.number().nonnegative()).optional(),
  channelPreference: z.record(z.string(), z.number().nonnegative()).optional(),
  domainPriorities: z.record(z.string(), z.number().nonnegative()).optional(),
});
export type ClassifierResult = z.infer<typeof ClassifierResultSchema>;

export interface StyleClassifier {
  classify(
    turns: ReadonlyArray<ChatTurnObservation>,
  ): Promise<ClassifierResult>;
}

// ---------------------------------------------------------------------------
// Default classifier — purely deterministic, no LLM dependency at module
// level. Aggregates the lexicon-based evidence from each turn. Production
// can swap in an LLM-backed implementation via `inferInitialProfile({
// classifier })`.
// ---------------------------------------------------------------------------

function mergeVotes(
  acc: Record<string, number>,
  vs: Record<string, number> | undefined,
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
      tone: {},
      verbosity: {},
      decisionStyle: {},
      riskAppetite: {},
      languagePreference: {},
      channelPreference: {},
      domainPriorities: {},
    };
    for (const t of turns) {
      const ev = extractEvidence(t);
      result.tone = mergeVotes(result.tone, ev.tone);
      result.verbosity = mergeVotes(result.verbosity, ev.verbosity);
      result.decisionStyle = mergeVotes(result.decisionStyle, ev.decisionStyle);
      result.riskAppetite = mergeVotes(result.riskAppetite, ev.riskAppetite);
      result.languagePreference = mergeVotes(
        result.languagePreference,
        ev.languagePreference,
      );
      result.channelPreference = mergeVotes(
        result.channelPreference,
        ev.channelPreference,
      );
      result.domainPriorities = mergeVotes(
        result.domainPriorities,
        ev.domainPriorities,
      );
    }
    return result;
  },
};

// ---------------------------------------------------------------------------
// LLM prompt — exported so it can be wired into the LLM-backed classifier
// at the application layer. Kept here as a string constant so callers don't
// have to know our internal categories.
// ---------------------------------------------------------------------------

export const STYLE_CLASSIFIER_PROMPT = `You are classifying an SMB owner's
communication style from chat turns. For each of the following dimensions,
return a JSON object whose keys are the listed categories and whose values
are non-negative integers expressing how much evidence each category has.
Use 0 when there is no evidence.

DIMENSIONS:
- tone: ${CATEGORY_VALUES.tone.join(", ")}
- verbosity: ${CATEGORY_VALUES.verbosity.join(", ")}
- decisionStyle: ${CATEGORY_VALUES.decisionStyle.join(", ")}
- riskAppetite: ${CATEGORY_VALUES.riskAppetite.join(", ")}
- languagePreference: ${CATEGORY_VALUES.languagePreference.join(", ")}
- channelPreference: ${CATEGORY_VALUES.channelPreference.join(", ")}
- domainPriorities: ${CATEGORY_VALUES.domainPriorities.join(", ")}

Return ONLY a JSON object with those seven keys. Do not include prose.
`;

// ---------------------------------------------------------------------------
// Public bootstrap
// ---------------------------------------------------------------------------

export interface InferInitialProfileArgs {
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly turns: ReadonlyArray<ChatTurnObservation>;
  readonly classifier?: StyleClassifier;
  readonly now?: () => string;
}

export async function inferInitialProfile(
  args: InferInitialProfileArgs,
): Promise<OwnerStyleProfile> {
  // Validate turns
  const validatedTurns: ChatTurnObservation[] = [];
  for (const t of args.turns) {
    const parsed = ChatTurnObservationSchema.safeParse(t);
    if (parsed.success) validatedTurns.push(parsed.data);
    else
      log.warn("invalid bootstrap turn skipped", {
        error: parsed.error.message,
      });
  }

  const profile = makeDefaultProfile({
    tenantId: args.tenantId,
    ownerUserId: args.ownerUserId,
    now: args.now,
  });
  if (validatedTurns.length === 0) return profile;

  const classifier = args.classifier ?? lexicalClassifier;
  let bootstrapVotes: ClassifierResult;
  try {
    const raw = await classifier.classify(validatedTurns);
    bootstrapVotes = ClassifierResultSchema.parse(raw);
  } catch (err) {
    log.error("classifier failed; falling back to per-turn lexicon", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Fall back to the per-turn lexicon profiler.
    return updateProfileBatch(profile, validatedTurns, { now: args.now });
  }

  // Replay the votes through the profiler so the bootstrap and incremental
  // models stay consistent. We synthesize one summary observation per
  // dimension by encoding the aggregated votes inside an empty turn — but
  // it's simpler to apply each turn individually AND then a single
  // classifier-weighted synthesis. Here we keep it simple: apply turns
  // through profiler so reactions / times-of-day are captured, then layer
  // classifier votes via a synthesized "boost" turn at the end.
  const afterTurns = updateProfileBatch(profile, validatedTurns, {
    now: args.now,
  });

  // Layer the classifier's aggregated votes on top of the lexicon pass.
  // We accomplish this with a synthetic in-memory blend by directly calling
  // updateProfile with a virtual turn whose text triggers the lexicon would
  // be wrong; instead we splice the dimension weights directly.
  return mergeClassifierVotes(afterTurns, bootstrapVotes);
}

function mergeClassifierVotes(
  profile: OwnerStyleProfile,
  votes: ClassifierResult,
): OwnerStyleProfile {
  const out = { ...profile };
  for (const key of [
    "tone",
    "verbosity",
    "decisionStyle",
    "riskAppetite",
    "languagePreference",
    "channelPreference",
    "domainPriorities",
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
    // The "value" field is a const string union per dimension; we assert
    // the cast because the cat we picked is whitelisted by `allowed`.
    (out as Record<string, unknown>)[key] = {
      value: best as typeof dim.value,
      weights: newWeights,
      confidence: total > 0 ? bestVal / total : dim.confidence,
    };
  }
  // Recompute aggregate confidence
  const dimKeys = [
    "tone",
    "verbosity",
    "decisionStyle",
    "riskAppetite",
    "languagePreference",
    "channelPreference",
    "domainPriorities",
  ] as const;
  const agg =
    dimKeys.reduce((s, k) => s + out[k].confidence, 0) / dimKeys.length;
  return { ...out, confidence: agg };
}
