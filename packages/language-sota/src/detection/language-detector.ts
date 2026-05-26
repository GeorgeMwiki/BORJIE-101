/**
 * Ensemble language detector.
 *
 * Wave 19G §3 implementation. Combines multiple `DetectorPort` votes
 * (FastText, LLM, Whisper, regex) into a single language verdict via
 * majority vote weighted by confidence.
 *
 * The package itself provides NO concrete detector implementations —
 * those live in the downstream waves where the real provider clients
 * (FastText binding, Whisper inference, brain-llm-router call) live.
 * The package exposes the ensemble shape so test fixtures can plug in
 * deterministic fake detectors and the orchestrator can verify the
 * routing logic without spending tokens.
 */

import {
  LanguageSotaError,
  type DetectorPort,
  type DetectorVote,
  type Language,
} from '../types.js';

export interface DetectLanguageResult {
  readonly lang: Language;
  readonly confidence: number;
  readonly votes: ReadonlyArray<DetectorVote>;
}

/**
 * Run every detector against the given text in parallel, then combine
 * the votes via confidence-weighted majority.
 *
 * Tie-breaking: when the top two languages share the same weighted
 * score, the one with the higher individual-vote confidence wins. If
 * still tied, the canonical alphabetic order is used so the function
 * is deterministic.
 *
 * Throws `LanguageSotaError` with `code = 'no-detectors'` if the
 * caller supplies an empty ensemble.
 */
export async function detectLanguage(
  detectors: ReadonlyArray<DetectorPort>,
  text: string,
): Promise<DetectLanguageResult> {
  if (detectors.length === 0) {
    throw new LanguageSotaError(
      'no-detectors',
      'detectLanguage requires at least one detector port',
    );
  }
  const votes: ReadonlyArray<DetectorVote> = await Promise.all(
    detectors.map((d) => d.detect(text)),
  );
  return reduceVotes(votes);
}

/**
 * Pure-function vote reduction. Exported separately so the test suite
 * can exercise the tie-break logic without instantiating detectors.
 */
export function reduceVotes(
  votes: ReadonlyArray<DetectorVote>,
): DetectLanguageResult {
  if (votes.length === 0) {
    throw new LanguageSotaError(
      'no-votes',
      'reduceVotes requires at least one vote',
    );
  }
  const weighted = new Map<Language, number>();
  const maxConfidence = new Map<Language, number>();
  for (const v of votes) {
    weighted.set(v.lang, (weighted.get(v.lang) ?? 0) + v.confidence);
    const prev = maxConfidence.get(v.lang) ?? 0;
    if (v.confidence > prev) {
      maxConfidence.set(v.lang, v.confidence);
    }
  }
  let bestLang: Language = votes[0]!.lang;
  let bestScore = -Infinity;
  let bestConfidence = -Infinity;
  // Sort languages so ties resolve deterministically by alpha order.
  const ranked = [...weighted.entries()].sort(([la], [lb]) =>
    la.localeCompare(lb),
  );
  for (const [lang, score] of ranked) {
    const confidence = maxConfidence.get(lang) ?? 0;
    if (
      score > bestScore ||
      (score === bestScore && confidence > bestConfidence)
    ) {
      bestLang = lang;
      bestScore = score;
      bestConfidence = confidence;
    }
  }
  return {
    lang: bestLang,
    confidence: Math.min(1, bestScore / votes.length),
    votes,
  };
}
