/**
 * Prompt-safety gate — runs BEFORE any provider is invoked.
 *
 * A deterministic, dependency-free pre-flight that blocks prompts which
 * are clearly unsafe for an estate-operations product: sexual content,
 * real-person deepfakes, hate, illegal weapons/explosives synthesis, and
 * child-safety terms. This is a cheap first line; the host may ALSO run a
 * post-upload model moderation pass (NSFW / deepfake) on the produced
 * bytes — the two are complementary.
 *
 * The gate returns a structured verdict; the engine maps a block to
 * {@link MediaEngineError} `safety_blocked`. It never throws here so
 * callers can log the matched categories for audit.
 *
 * @module @borjie/media-engine/safety/prompt-safety-gate
 */

export type SafetyCategory =
  | 'sexual'
  | 'csae'
  | 'real_person_deepfake'
  | 'hate'
  | 'weapons_explosives'
  | 'self_harm';

export interface SafetyVerdict {
  readonly allowed: boolean;
  readonly matched: ReadonlyArray<SafetyCategory>;
}

/**
 * Word-boundary patterns per category. Kept intentionally narrow +
 * anchored to avoid over-blocking legitimate mining language (e.g.
 * "blast", "explosive ordnance survey", "shaft"). Bounded, linear-time
 * regexes only — no catastrophic backtracking.
 */
const CATEGORY_PATTERNS: ReadonlyArray<readonly [SafetyCategory, RegExp]> = [
  ['csae', /\b(child|minor|underage)\s+(porn|sexual|nude)\b/i],
  ['sexual', /\b(porn|pornographic|explicit\s+sex|nude\s+photo)\b/i],
  [
    'real_person_deepfake',
    /\bdeepfake\b|\bface[-\s]?swap\b|\bimpersonat(e|ing|ion)\s+(a\s+)?(real|named)\s+person\b/i,
  ],
  ['hate', /\b(genocide|ethnic\s+cleansing)\b/i],
  [
    'weapons_explosives',
    /\b(build|make|synthesi[sz]e|manufacture)\s+(a\s+)?(bomb|explosive\s+device|ied|nerve\s+agent)\b/i,
  ],
  ['self_harm', /\b(how\s+to\s+)?(commit\s+suicide|kill\s+myself)\b/i],
];

/**
 * Screen a prompt. Returns a verdict listing every matched category.
 * Deterministic and pure — same input always yields the same verdict.
 */
export function screenPrompt(prompt: string): SafetyVerdict {
  const text = prompt ?? '';
  const matched: SafetyCategory[] = [];
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(text)) matched.push(category);
  }
  return { allowed: matched.length === 0, matched };
}
