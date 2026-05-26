/**
 * Intent recognition (Anticipatory UX Layer 1).
 *
 * Source of truth: `Docs/DESIGN/ANTICIPATORY_UX_SPEC.md` §2, Layer 1.
 *
 * This is a deliberately small, pure-function recogniser that converts
 * a turn (chat-text + light context signals) into a typed `Intent`. It
 * does NOT invoke an LLM. The heavy classifier lives upstream in
 * `tab-need-detector` + `central-intelligence`; this function exists so
 * the registry has a predictable, unit-testable entry point.
 *
 * Confidence floor mirrors the detector contract (§1):
 *
 *   ≥ MIN_INTENT_CONFIDENCE → return Intent
 *   <  MIN_INTENT_CONFIDENCE → return null (stay silent rather than nag)
 *
 * The default keyword patterns ship the two reference intents bound to
 * the example recipes in `./recipes/`. A production deployment can
 * extend `RecogniserConfig.patterns` with additional intent definitions
 * without modifying this file.
 */

import type { Intent, IntentEntity } from './types.js';

/** Confidence floor enforced by the recogniser. Matches §1. */
export const MIN_INTENT_CONFIDENCE = 0.7;

/**
 * IntentPattern — a single keyword bundle that maps text → intent.
 *
 * `terms` is the set of lowercased keywords; the recogniser scores
 * matched / total. A pattern matches if at least one `required_any`
 * term hits.
 */
export interface IntentPattern {
  readonly kind: string;
  readonly required_any: ReadonlyArray<string>;
  readonly boosters?: ReadonlyArray<string>;
  readonly entity_extractors?: ReadonlyArray<EntityExtractor>;
}

/** Light-weight entity extractor — regex with a single capture group. */
export interface EntityExtractor {
  readonly kind: string;
  readonly pattern: RegExp;
}

/** Recogniser config — defaults provided below. */
export interface RecogniserConfig {
  readonly patterns: ReadonlyArray<IntentPattern>;
  readonly minConfidence: number;
}

/**
 * Default pattern library — the two reference intents that ship with
 * the package's example recipes.
 *
 * Discipline: every required_any term is lowercase ASCII; the
 * recogniser lowercases input before matching. No regex-injection
 * surface — keywords are matched as substrings only.
 */
export const DEFAULT_PATTERNS: ReadonlyArray<IntentPattern> = [
  {
    kind: 'BuyerKYBStart',
    required_any: ['buyer', 'kyb', 'tin number', 'new client'],
    boosters: ['mining', 'tons', 'gold', 'concentrate', 'jamhuri', 'licence', 'license'],
    entity_extractors: [
      {
        kind: 'commodity',
        pattern: /\b(gold|copper|tin|coltan|tantalum|cobalt|silver)\b/i,
      },
      {
        kind: 'quantity_tons',
        pattern: /(\d+(?:\.\d+)?)\s*(?:tons?|t)\b/i,
      },
    ],
  },
  {
    kind: 'SiteInspectionStart',
    required_any: ['inspection', 'site visit', 'parcel walkthrough', 'site check'],
    boosters: ['compliance', 'parcel', 'monitor', 'observation', 'walkthrough'],
    entity_extractors: [
      {
        kind: 'parcel_ref',
        pattern: /\b(?:parcel|plot|site)[-\s]?([a-z]?\d{2,8})\b/i,
      },
    ],
  },
];

export const DEFAULT_RECOGNISER_CONFIG: RecogniserConfig = {
  patterns: DEFAULT_PATTERNS,
  minConfidence: MIN_INTENT_CONFIDENCE,
};

/**
 * Score one pattern against the lowercased input.
 *
 * Score model — conservative on purpose:
 *
 *   1.0 if a required term hits AND ≥ 2 boosters hit.
 *   0.85 if a required term hits AND 1 booster hits.
 *   0.7 if a required term hits AND 0 boosters hit.
 *   0   otherwise.
 *
 * The 0.7 floor matches `MIN_INTENT_CONFIDENCE` so a bare required-term
 * hit just barely passes — exactly the spec's "stay silent rather than
 * nag" stance.
 */
function scorePattern(pattern: IntentPattern, lower: string): number {
  const required = pattern.required_any.some((term) =>
    lower.includes(term.toLowerCase()),
  );
  if (!required) {
    return 0;
  }
  const boosters = pattern.boosters ?? [];
  let hits = 0;
  for (const b of boosters) {
    if (lower.includes(b.toLowerCase())) {
      hits += 1;
    }
  }
  if (hits >= 2) {
    return 1;
  }
  if (hits === 1) {
    return 0.85;
  }
  return 0.7;
}

function extractEntities(
  pattern: IntentPattern,
  source: string,
): ReadonlyArray<IntentEntity> {
  const extractors = pattern.entity_extractors ?? [];
  const entities: IntentEntity[] = [];
  for (const extractor of extractors) {
    const re = new RegExp(extractor.pattern.source, extractor.pattern.flags);
    const match = re.exec(source);
    if (match) {
      const value = match[1] ?? match[0] ?? '';
      const start = match.index;
      const end = start + match[0].length;
      entities.push({
        kind: extractor.kind,
        value,
        start,
        end,
      });
    }
  }
  return entities;
}

/**
 * Recognise the operator's intent from a turn string.
 *
 * Returns `null` if no pattern scored at or above the floor — the
 * caller should stay silent. Returns the single best-scoring intent
 * otherwise.
 */
export function recogniseIntent(
  turn: string,
  config: RecogniserConfig = DEFAULT_RECOGNISER_CONFIG,
): Intent | null {
  if (typeof turn !== 'string' || turn.trim() === '') {
    return null;
  }
  const lower = turn.toLowerCase();
  let best: { pattern: IntentPattern; score: number } | null = null;
  for (const pattern of config.patterns) {
    const score = scorePattern(pattern, lower);
    if (score >= config.minConfidence && (!best || score > best.score)) {
      best = { pattern, score };
    }
  }
  if (!best) {
    return null;
  }
  return {
    kind: best.pattern.kind,
    confidence: best.score,
    entities: extractEntities(best.pattern, turn),
    source_excerpt: turn.slice(0, 280),
  };
}
