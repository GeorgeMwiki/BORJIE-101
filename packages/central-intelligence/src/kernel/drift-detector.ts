/**
 * Tool-loop drift detector — Jaccard intent overlap between the
 * original user message and the final assistant answer.
 *
 * Mirrors LITFIN's `src/core/brain/drift-detector.ts`. The kernel
 * calls `detectDrift()` at the END of a tool-loop turn; on drift the
 * verdict feeds the policy gate as `incidentClass: "policy_gate_fail"`
 * and the final reply is softened.
 *
 * Property-management framing: stopword sets are bilingual (English
 * + Swahili), and the distinctive-token set strips currency codes,
 * date tokens, and the property-domain regulatory abbreviations
 * (KRA, RERA, PDPA, TGN, BoT) so an answer that simply *cites* a
 * regulator is not credited with intent overlap.
 */

/**
 * English stopwords — articles, conjunctions, common verbs.
 */
const STOPWORDS_EN: ReadonlySet<string> = new Set([
  'a', 'an', 'the',
  'and', 'or', 'but', 'so', 'yet', 'for', 'nor',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'doing',
  'have', 'has', 'had', 'having',
  'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'we', 'they', 'it',
  'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'her', 'our', 'their', 'its',
  'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'as',
  'about', 'into', 'over', 'under', 'after', 'before',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'not', 'no', 'yes', 'if', 'then', 'than', 'too', 'very', 'just', 'also',
  'how', 'what', 'when', 'where', 'why', 'who', 'which',
  'please', 'thanks', 'thank',
]);

/**
 * Swahili stopwords — articles, conjunctions, common verbs.
 */
const STOPWORDS_SW: ReadonlySet<string> = new Set([
  'na', 'ya', 'wa', 'la', 'kwa', 'cha', 'za',
  'ni', 'si', 'ipo', 'iko', 'kuna', 'hakuna',
  'huyu', 'huyo', 'yule', 'hii', 'hiyo', 'ile', 'hizi', 'zile',
  'mimi', 'wewe', 'yeye', 'sisi', 'nyinyi', 'wao',
  'wangu', 'wako', 'wake', 'wetu', 'wenu', 'wao',
  'kama', 'lakini', 'au', 'ama', 'pia', 'tu', 'sasa', 'kisha',
  'tafadhali', 'asante',
  'unaweza', 'ninaweza', 'unataka', 'nataka',
  'gani', 'nani', 'wapi', 'lini', 'kwanini', 'nini', 'vipi',
]);

/**
 * Generic stripped tokens — currency codes, regulator abbreviations,
 * date words. These are NOT counted toward intent overlap because an
 * answer that merely cites them is not necessarily on-task.
 */
const GENERIC_DOMAIN_TOKENS: ReadonlySet<string> = new Set([
  'tzs', 'kes', 'ugx', 'usd', 'eur', 'gbp',
  'kra', 'rera', 'pdpa', 'tgn', 'bot', 'rmsa', 'cma',
  'today', 'tomorrow', 'yesterday',
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);

/**
 * Distinctive-token extractor. Splits on non-word characters,
 * lowercases, strips stopwords and generic domain tokens, and drops
 * single-character tokens.
 */
export function extractDistinctiveTokens(text: string): ReadonlySet<string> {
  const raw = text.toLowerCase().split(/[^a-zÀ-ſ0-9]+/u);
  const out = new Set<string>();
  for (const token of raw) {
    if (!token) continue;
    if (token.length <= 1) continue;
    if (STOPWORDS_EN.has(token)) continue;
    if (STOPWORDS_SW.has(token)) continue;
    if (GENERIC_DOMAIN_TOKENS.has(token)) continue;
    out.add(token);
  }
  return out;
}

/**
 * Jaccard similarity over two token sets. Returns 0 if both empty.
 */
export function jaccardOverlap(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersect = 0;
  for (const tok of a) {
    if (b.has(tok)) intersect += 1;
  }
  const union = a.size + b.size - intersect;
  if (union === 0) return 0;
  return intersect / union;
}

/**
 * Drift verdict.
 *
 * - `drifted`: true when overlap < threshold AND the user message had
 *   at least 2 distinctive tokens (so a single-word "hi" doesn't trip
 *   the detector).
 * - `score`: the Jaccard score in [0,1].
 * - `matchedKeywords`: tokens that appeared in both sides.
 * - `missingKeywords`: distinctive user tokens that did NOT appear
 *   in the reply (the most useful signal for an audit).
 * - `threshold`: the threshold that produced this verdict.
 */
export interface DriftVerdict {
  readonly drifted: boolean;
  readonly score: number;
  readonly matchedKeywords: ReadonlyArray<string>;
  readonly missingKeywords: ReadonlyArray<string>;
  readonly threshold: number;
}

export interface DriftDetectorInput {
  readonly userMessage: string;
  readonly finalReply: string;
  /**
   * Jaccard threshold below which we declare drift. Default 0.15,
   * matching LITFIN. Lower = more lenient.
   */
  readonly threshold?: number;
  /**
   * Minimum distinctive-token count in the user message to even run
   * the check. Default 2 — single-word greetings shouldn't drift.
   */
  readonly minUserTokens?: number;
}

export const DEFAULT_DRIFT_THRESHOLD = 0.15;

export function detectDrift(input: DriftDetectorInput): DriftVerdict {
  const threshold = input.threshold ?? DEFAULT_DRIFT_THRESHOLD;
  const minUserTokens = input.minUserTokens ?? 2;

  const userTokens = extractDistinctiveTokens(input.userMessage);
  const replyTokens = extractDistinctiveTokens(input.finalReply);

  // Short user messages bypass the detector — too noisy to be useful.
  if (userTokens.size < minUserTokens) {
    return {
      drifted: false,
      score: 1,
      matchedKeywords: [],
      missingKeywords: [],
      threshold,
    };
  }

  const matched: string[] = [];
  const missing: string[] = [];
  for (const tok of userTokens) {
    if (replyTokens.has(tok)) {
      matched.push(tok);
    } else {
      missing.push(tok);
    }
  }

  const score = jaccardOverlap(userTokens, replyTokens);
  return {
    drifted: score < threshold,
    score,
    matchedKeywords: matched,
    missingKeywords: missing,
    threshold,
  };
}
