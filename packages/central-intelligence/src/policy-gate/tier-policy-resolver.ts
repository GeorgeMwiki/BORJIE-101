/**
 * Policy Gate — Reason-Based Tier-Policy Resolver
 *
 * Ported from LITFIN's Constitution v2 reason-based resolver and adapted
 * for Borjie's role hierarchy + the `md:*` action namespace.
 *
 * The historic resolver was rule-match: if the requested `action` was in
 * the role's allow-list, allow; otherwise deny. That model fails the
 * moment a new capability surfaces that nobody enumerated, even when
 * the underlying principle clearly covers it.
 *
 * This module adds the reasoning step: when the literal lookup misses,
 * we ask "is there a principle whose reason-statement clearly covers
 * this action?" If yes, the verdict is generalised from the matched
 * principle (with a `generalizedFromPrinciple` audit marker so the
 * trace is honest). If no, fail-safe deny.
 *
 * Pipeline:
 *   1. Literal action match → exact verdict.
 *   2. Otherwise, score every rule on the requested role by string
 *      similarity (rule.action + rule.examples vs. requested action).
 *   3. If the best similarity is high enough, generalise from that
 *      rule's verdict and return.
 *   4. If the best similarity is in the grey zone AND a Principle judge
 *      has been wired in (Haiku), ask whether the principle covers the
 *      action.
 *   5. Otherwise: safe-default deny.
 *
 * The LLM judge is intentionally injected (not imported) so this module
 * stays unit-testable without network calls.
 *
 * Borjie scoping:
 *   - Roles: TENANT_RESIDENT / OWNER_ADVISOR / ESTATE_MANAGER /
 *            ORG_ADMIN / PLATFORM_SOVEREIGN / SOVEREIGN_ADMIN.
 *   - Action namespace: `md:*` (managing-director chat-driven verbs).
 *
 * @module policy-gate/tier-policy-resolver
 */

// ════════════════════════════════════════════════════════════════════
// Role hierarchy (Borjie)
// ════════════════════════════════════════════════════════════════════

/**
 * The Borjie role hierarchy. Each role has a distinct trust scope
 * and a constrained surface of actions it may invoke.
 *
 *   - TENANT_RESIDENT     — single end-user resident (LITFIN borrower).
 *   - OWNER_ADVISOR       — property owner + agency-admin combined
 *                           (LITFIN bank-admin / org-admin).
 *   - ESTATE_MANAGER      — operations lead (LITFIN officer).
 *   - ORG_ADMIN           — deprecated alias for OWNER_ADVISOR; kept
 *                           for backward compat with older callers.
 *   - PLATFORM_SOVEREIGN  — industry-tier DP aggregate observer.
 *   - SOVEREIGN_ADMIN     — internal Borjie HQ "Nyumba Mind"
 *                           operator; first-person singular voice.
 */
export type MdRole =
  | 'TENANT_RESIDENT'
  | 'OWNER_ADVISOR'
  | 'ESTATE_MANAGER'
  | 'ORG_ADMIN'
  | 'PLATFORM_SOVEREIGN'
  | 'SOVEREIGN_ADMIN';

export const ALL_MD_ROLES: ReadonlyArray<MdRole> = Object.freeze([
  'TENANT_RESIDENT',
  'OWNER_ADVISOR',
  'ESTATE_MANAGER',
  'ORG_ADMIN',
  'PLATFORM_SOVEREIGN',
  'SOVEREIGN_ADMIN',
]);

// ════════════════════════════════════════════════════════════════════
// Rule + verdict types
// ════════════════════════════════════════════════════════════════════

/**
 * Verdict for a single principled rule. `four_eye` means the rule
 * authorises the action provided the four-eye approval workflow has
 * been completed.
 */
export type PolicyVerdict = 'allow' | 'deny' | 'four_eye';

/**
 * Constitutional AI v2 — a single principled rule. Adds `reason`,
 * `principle`, and `examples` to the literal action so the resolver
 * can generalise from the underlying intent rather than just matching
 * the surface verb.
 */
export interface PolicyRule {
  readonly id: string;
  readonly role: MdRole;
  /** The literal action this rule authorises (e.g. `md:create-lease`). */
  readonly action: string;
  readonly verdict: PolicyVerdict;
  /** Why this verdict exists — one or two plain-English sentences so
   *  the resolver and any auditor can reason about it. */
  readonly reason: string;
  /** Stable identifier for the underlying principle category
   *  (e.g. `resident-own-data-isolation`). */
  readonly principle: string;
  /** 2-3 concrete example actions covered by the same principle.
   *  Used as similarity anchors by the reason resolver. */
  readonly examples: ReadonlyArray<string>;
  /** Optional audit-trail tag attached to any decision citing this rule. */
  readonly auditTag?: string;
}

// ════════════════════════════════════════════════════════════════════
// Inputs / outputs
// ════════════════════════════════════════════════════════════════════

/**
 * Optional Haiku-tier judge. Returns `covers: true` to generalise the
 * matched rule's verdict to the unmatched action.
 *
 * Implementations should keep latency low — the resolver only consults
 * the judge when string similarity sits in the grey zone.
 */
export interface PrincipleJudge {
  judgeCovers(input: {
    readonly action: string;
    readonly principle: string;
    readonly principleReason: string;
    readonly examples: ReadonlyArray<string>;
    readonly role: MdRole;
    readonly contextSummary?: string;
  }): Promise<{
    readonly covers: boolean;
    readonly confidence: number;
    readonly explanation: string;
  }>;
}

export interface ResolveArgs {
  readonly role: MdRole;
  readonly action: string;
  readonly context?: Record<string, unknown>;
  /** Rules to score against. The caller passes the role's full rule
   *  set; the resolver never reaches into a global registry. */
  readonly rules: ReadonlyArray<PolicyRule>;
  /** Override the high-similarity auto-allow threshold. Default 0.7. */
  readonly autoMatchThreshold?: number;
  /** Override the grey-zone lower bound where we may consult the judge.
   *  Default 0.4. */
  readonly judgeGreyZoneFloor?: number;
  /** Optional judge. When omitted, the resolver decides on string
   *  similarity alone. */
  readonly judge?: PrincipleJudge;
}

export type ResolvedVerdict =
  | 'allow'
  | 'deny'
  | 'four_eye'
  | 'reason-generalized-allow'
  | 'reason-generalized-deny';

export interface ResolveResult {
  readonly verdict: ResolvedVerdict;
  /** The literal rule that matched (if any). */
  readonly matchedRule?: PolicyRule;
  /** The principle id we generalised from (if any). */
  readonly generalizedFromPrinciple?: string;
  /** The rule whose principle was the basis for generalisation. */
  readonly generalizedFromRule?: PolicyRule;
  /** Human-readable explanation suitable for the audit trail. */
  readonly reasoning: string;
  /** 0..1. 1.0 for literal hits; lower for principle generalisations. */
  readonly confidence: number;
  /** True when the result was synthesised from a principle rather than
   *  from a literal allow-list match. */
  readonly generalized: boolean;
}

// ════════════════════════════════════════════════════════════════════
// String similarity (no external deps)
// ════════════════════════════════════════════════════════════════════

const TOKEN_SPLIT = /[\s.:_/\-]+/g;

function tokenize(value: string): ReadonlyArray<string> {
  return value
    .toLowerCase()
    .split(TOKEN_SPLIT)
    .filter((token) => token.length > 0);
}

function bagOfTokens(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokenize(value)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

/**
 * Cosine similarity over a token bag-of-words. Lightweight,
 * deterministic, dependency-free; good enough for action verbs that
 * share namespace stems (e.g. `md:list-leases` vs. `md:list-tenants`).
 *
 * Exported for the assertions module's synchronous fast-path so we
 * keep similarity scoring in one place.
 */
export function cosineSimilarity(a: string, b: string): number {
  const aBag = bagOfTokens(a);
  const bBag = bagOfTokens(b);
  if (aBag.size === 0 || bBag.size === 0) return 0;
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (const [token, count] of aBag) {
    aMag += count * count;
    const bCount = bBag.get(token);
    if (bCount !== undefined) dot += count * bCount;
  }
  for (const count of bBag.values()) {
    bMag += count * count;
  }
  const denom = Math.sqrt(aMag) * Math.sqrt(bMag);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Score a rule against an action by taking the maximum cosine
 * similarity between the action and (rule.action ∪ rule.examples).
 * Examples carry as much weight as the literal action — that is the
 * whole point of Constitutional AI v2.
 */
export function scoreRule(action: string, rule: PolicyRule): number {
  let best = cosineSimilarity(action, rule.action);
  for (const example of rule.examples) {
    const score = cosineSimilarity(action, example);
    if (score > best) best = score;
  }
  return best;
}

// ════════════════════════════════════════════════════════════════════
// Resolver
// ════════════════════════════════════════════════════════════════════

const DEFAULT_AUTO_MATCH = 0.7;
const DEFAULT_JUDGE_FLOOR = 0.4;

function literalMatch(
  rules: ReadonlyArray<PolicyRule>,
  action: string,
): PolicyRule | undefined {
  return rules.find((rule) => rule.action === action);
}

interface ScoredRule {
  readonly rule: PolicyRule;
  readonly score: number;
}

function scoreAll(
  rules: ReadonlyArray<PolicyRule>,
  action: string,
): ReadonlyArray<ScoredRule> {
  return rules
    .map((rule) => ({ rule, score: scoreRule(action, rule) }))
    .sort((a, b) => b.score - a.score);
}

function generalizedVerdictFrom(verdict: PolicyVerdict): ResolvedVerdict {
  // Even when generalising an `allow`, we mark the verdict as
  // `reason-generalized-*` so the audit trail can distinguish principle-
  // generalised allows from literal allows. `four_eye` also generalises
  // to the safer four-eye gate, never bypassed.
  return verdict === 'deny'
    ? 'reason-generalized-deny'
    : 'reason-generalized-allow';
}

function summarizeContext(
  context: Record<string, unknown> | undefined,
): string {
  if (!context) return '';
  try {
    return JSON.stringify(context).slice(0, 500);
  } catch {
    return '';
  }
}

/**
 * Resolve a role + action against the principled rule set. See the
 * file-level docs for the full pipeline.
 *
 * Pure function: the only side effect is the optional judge call.
 */
export async function resolveActionVerdict(
  args: ResolveArgs,
): Promise<ResolveResult> {
  const rules = args.rules;

  // 1. Literal match — always the strongest signal.
  const literal = literalMatch(rules, args.action);
  if (literal) {
    return {
      verdict: literal.verdict,
      matchedRule: literal,
      reasoning: `literal allow-list match on rule '${literal.id}' (${literal.principle}): ${literal.reason}`,
      confidence: 1,
      generalized: false,
    };
  }

  // No principled rules at all on this role → fail-safe deny.
  if (rules.length === 0) {
    return {
      verdict: 'reason-generalized-deny',
      reasoning: `role '${args.role}' has no principled rules; refusing '${args.action}' by safe default.`,
      confidence: 1,
      generalized: true,
    };
  }

  // 2. Score every rule on this role.
  const scored = scoreAll(rules, args.action);
  const best = scored[0];
  const autoMatchThreshold = args.autoMatchThreshold ?? DEFAULT_AUTO_MATCH;
  const judgeFloor = args.judgeGreyZoneFloor ?? DEFAULT_JUDGE_FLOOR;

  // 3. High-similarity auto-generalisation.
  if (best && best.score >= autoMatchThreshold) {
    const verdict = generalizedVerdictFrom(best.rule.verdict);
    return {
      verdict,
      generalizedFromPrinciple: best.rule.principle,
      generalizedFromRule: best.rule,
      reasoning: `no literal match; reason-generalised from rule '${best.rule.id}' (principle '${best.rule.principle}', similarity=${best.score.toFixed(2)}): ${best.rule.reason}`,
      confidence: Math.min(0.95, best.score),
      generalized: true,
    };
  }

  // 4. Grey zone: optionally consult the LLM judge.
  if (
    args.judge &&
    best &&
    best.score >= judgeFloor &&
    best.score < autoMatchThreshold
  ) {
    let judgeResult: Awaited<ReturnType<PrincipleJudge['judgeCovers']>> | null =
      null;
    try {
      judgeResult = await args.judge.judgeCovers({
        action: args.action,
        principle: best.rule.principle,
        principleReason: best.rule.reason,
        examples: best.rule.examples,
        role: args.role,
        contextSummary: summarizeContext(args.context),
      });
    } catch (err) {
      const detail =
        err instanceof Error ? err.message : 'judge raised non-Error';
      return {
        verdict: 'reason-generalized-deny',
        generalizedFromPrinciple: best.rule.principle,
        generalizedFromRule: best.rule,
        reasoning: `judge errored (${detail}); refusing '${args.action}' by safe default.`,
        confidence: 0.4,
        generalized: true,
      };
    }
    if (judgeResult.covers) {
      const verdict = generalizedVerdictFrom(best.rule.verdict);
      return {
        verdict,
        generalizedFromPrinciple: best.rule.principle,
        generalizedFromRule: best.rule,
        reasoning: `judge confirmed principle '${best.rule.principle}' covers '${args.action}': ${judgeResult.explanation}`,
        confidence: Math.max(0.5, judgeResult.confidence),
        generalized: true,
      };
    }
    return {
      verdict: 'reason-generalized-deny',
      generalizedFromPrinciple: best.rule.principle,
      generalizedFromRule: best.rule,
      reasoning: `judge rejected principle coverage for '${args.action}': ${judgeResult.explanation}`,
      confidence: Math.max(0.5, judgeResult.confidence),
      generalized: true,
    };
  }

  // 5. Safe-default deny.
  const bestNote = best
    ? ` (best similarity=${best.score.toFixed(2)} on rule '${best.rule.id}')`
    : '';
  return {
    verdict: 'reason-generalized-deny',
    generalizedFromPrinciple: best?.rule.principle,
    generalizedFromRule: best?.rule,
    reasoning: `no rule or principle clearly covered '${args.action}'${bestNote}; refusing by safe default.`,
    confidence: 0.7,
    generalized: true,
  };
}

/**
 * Coerce the resolver's verdict into a boolean "is this allowed?"
 * suitable for callers that just need a yes/no. `four_eye` is treated
 * as conditionally allowed — the caller is expected to invoke the
 * four-eye approval workflow before any side effect.
 */
export function isAllowedVerdict(verdict: ResolvedVerdict): boolean {
  return (
    verdict === 'allow' ||
    verdict === 'four_eye' ||
    verdict === 'reason-generalized-allow'
  );
}
