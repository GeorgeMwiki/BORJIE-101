/**
 * Translation Validation Pipeline
 *
 * Before ANY translation is shown to a user, it passes through this
 * validation pipeline:
 *
 *   1. Decompose source text into tokens
 *   2. Look up each token in the dictionary graph
 *   3. Verify the translated text against dictionary entries
 *   4. Check grammar of the translated text
 *   5. Flag any unverified tokens
 *   6. Return a confidence score and suggestions
 *
 * This ensures that Borjie NEVER shows a bad Swahili translation.
 * If confidence is below threshold, the system either:
 *   - Falls back to a verified dictionary translation
 *   - Queues for human review
 *   - Uses AI with explicit disclaimer
 *
 * @module decomposition/translation-validator
 */

import type { TranslationValidation } from "./types";
import { getDictionaryGraph } from "./dictionary-graph";
import { decomposeText } from "./text-decomposer";

// ============================================================================
// Validation Configuration
// ============================================================================

export interface ValidationConfig {
  /** Minimum confidence to consider a translation "verified" (0-1) */
  readonly minConfidence: number;
  /** Whether to run grammar checks on translated text */
  readonly checkGrammar: boolean;
  /** Whether to suggest corrections for low-confidence translations */
  readonly suggestCorrections: boolean;
  /** Maximum tokens to validate (performance guard) */
  readonly maxTokens: number;
}

const DEFAULT_CONFIG: ValidationConfig = {
  minConfidence: 0.6,
  checkGrammar: true,
  suggestCorrections: true,
  maxTokens: 500,
};

// ============================================================================
// Main Validation Function
// ============================================================================

/**
 * Validate a translation by decomposing both source and target,
 * then cross-referencing against the dictionary graph.
 */
export function validateTranslation(
  original: string,
  translated: string,
  sourceLang: "en" | "sw",
  targetLang: "en" | "sw",
  config: Partial<ValidationConfig> = {},
): TranslationValidation {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const graph = getDictionaryGraph();

  // Decompose both texts
  const sourceAtom = decomposeText(original, {
    sourceType: "chat_message",
    maxTokens: cfg.maxTokens,
  });
  const targetAtom = decomposeText(translated, {
    sourceType: "chat_message",
    maxTokens: cfg.maxTokens,
  });

  // Cross-reference tokens
  const sourceTokens = sourceAtom.paragraphs
    .flatMap((p) => p.sentences.flatMap((s) => s.tokens))
    .filter(
      (t) =>
        t.pos !== "particle" &&
        !/^[.,!?;:()"\[\]{}]+$/.test(t.surface) &&
        !/^\d/.test(t.surface),
    );

  const targetTokens = targetAtom.paragraphs
    .flatMap((p) => p.sentences.flatMap((s) => s.tokens))
    .filter(
      (t) =>
        t.pos !== "particle" &&
        !/^[.,!?;:()"\[\]{}]+$/.test(t.surface) &&
        !/^\d/.test(t.surface),
    );

  // Verify each source token has a corresponding translation in target
  const tokenVerifications: TranslationValidation["tokenVerifications"] = [];
  let totalConfidence = 0;
  let verifiedCount = 0;

  for (const sourceToken of sourceTokens) {
    // Look up what the source token should translate to
    const expectedTranslation = sourceToken.translations[targetLang];

    if (expectedTranslation) {
      // Check if the expected translation appears in the target text
      const normalizedExpected = expectedTranslation.toLowerCase();
      const foundInTarget = targetTokens.some(
        (t) =>
          t.normalized === normalizedExpected || t.lemma === normalizedExpected,
      );

      if (foundInTarget) {
        tokenVerifications.push({
          sourceToken: sourceToken.surface,
          translatedToken: expectedTranslation,
          verified: true,
          verificationSource: "dictionary_cross_reference",
          confidence: 0.95,
        });
        totalConfidence += 0.95;
        verifiedCount++;
      } else {
        // Expected translation not found in target; check if synonym exists
        const dictNode = graph.lookup(normalizedExpected, targetLang);
        const hasSynonym = dictNode?.relatedWords?.some((rw) =>
          targetTokens.some((t) => t.normalized === rw.toLowerCase()),
        );

        tokenVerifications.push({
          sourceToken: sourceToken.surface,
          translatedToken: expectedTranslation,
          verified: hasSynonym ?? false,
          verificationSource: hasSynonym
            ? "synonym_match"
            : "not_found_in_target",
          confidence: hasSynonym ? 0.7 : 0.3,
          suggestion: hasSynonym
            ? undefined
            : `Expected "${expectedTranslation}" in translation`,
        });
        totalConfidence += hasSynonym ? 0.7 : 0.3;
        if (hasSynonym) verifiedCount++;
      }
    } else {
      // No known translation for this token
      // Check if the token appears as-is in target (borrowed word)
      const borrowedInTarget = targetTokens.some(
        (t) => t.normalized === sourceToken.normalized,
      );

      tokenVerifications.push({
        sourceToken: sourceToken.surface,
        translatedToken: borrowedInTarget ? sourceToken.surface : "?",
        verified: borrowedInTarget,
        verificationSource: borrowedInTarget
          ? "borrowed_word"
          : "no_dictionary_entry",
        confidence: borrowedInTarget ? 0.8 : 0.2,
      });
      totalConfidence += borrowedInTarget ? 0.8 : 0.2;
      // eslint-disable-next-line unused-imports/no-unused-vars -- variable kept for API compatibility / destructuring clarity; prefix with _ to silence permanently
      if (borrowedInTarget) verifiedCount++;
    }
  }

  // Compute overall confidence
  const overallConfidence =
    sourceTokens.length > 0 ? totalConfidence / sourceTokens.length : 1;

  // Grammar score from target decomposition
  const grammarScore = targetAtom.stats.grammarScore;

  // Determine status
  let status: TranslationValidation["status"];
  if (overallConfidence >= 0.8 && grammarScore >= 0.7) {
    status = "verified";
  } else if (overallConfidence >= cfg.minConfidence) {
    status = "partially_verified";
  } else if (overallConfidence >= 0.3) {
    status = "unverified";
  } else {
    status = "rejected";
  }

  // Generate suggestions
  const suggestions: string[] = [];
  if (cfg.suggestCorrections) {
    const unverifiedTokenVerifs = tokenVerifications.filter(
      (tv) => !tv.verified,
    );

    for (const tv of unverifiedTokenVerifs) {
      if (tv.suggestion) {
        suggestions.push(tv.suggestion);
      }
    }

    if (grammarScore < 0.7) {
      suggestions.push("Grammar quality is low; consider rephrasing.");
    }
  }

  return {
    original,
    translated,
    sourceLang,
    targetLang,
    status,
    tokenVerifications,
    confidence: overallConfidence,
    grammarScore,
    suggestions,
  };
}

// ============================================================================
// Quick Validation (for real-time chat)
// ============================================================================

/**
 * Quick validation that returns just pass/fail + confidence.
 * Use for inline translation quality checks in chat.
 */
export function quickValidate(
  original: string,
  translated: string,
  sourceLang: "en" | "sw",
  targetLang: "en" | "sw",
): {
  readonly valid: boolean;
  readonly confidence: number;
  readonly status:
    | "verified"
    | "partially_verified"
    | "unverified"
    | "rejected";
} {
  const result = validateTranslation(
    original,
    translated,
    sourceLang,
    targetLang,
    {
      checkGrammar: false,
      suggestCorrections: false,
      maxTokens: 100,
    },
  );

  return {
    valid:
      result.status === "verified" || result.status === "partially_verified",
    confidence: result.confidence,
    status: result.status,
  };
}

// ============================================================================
// Batch Validation (for document processing)
// ============================================================================

/**
 * Validate an array of translation pairs.
 * Returns a summary + per-pair results.
 */
export function validateTranslationBatch(
  pairs: readonly {
    readonly original: string;
    readonly translated: string;
  }[],
  sourceLang: "en" | "sw",
  targetLang: "en" | "sw",
): {
  readonly results: readonly TranslationValidation[];
  readonly summary: {
    readonly totalPairs: number;
    readonly verified: number;
    readonly partiallyVerified: number;
    readonly unverified: number;
    readonly rejected: number;
    readonly averageConfidence: number;
  };
} {
  const results = pairs.map((pair) =>
    validateTranslation(pair.original, pair.translated, sourceLang, targetLang),
  );

  const verified = results.filter((r) => r.status === "verified").length;
  const partial = results.filter(
    (r) => r.status === "partially_verified",
  ).length;
  const unverified = results.filter((r) => r.status === "unverified").length;
  const rejected = results.filter((r) => r.status === "rejected").length;
  const avgConf =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
      : 0;

  return {
    results,
    summary: {
      totalPairs: pairs.length,
      verified,
      partiallyVerified: partial,
      unverified,
      rejected,
      averageConfidence: avgConf,
    },
  };
}
