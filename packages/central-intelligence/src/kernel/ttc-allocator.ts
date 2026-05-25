/**
 * TTC allocator — multi-dimensional test-time-compute selector.
 *
 * Replaces the binary stakes-based `wantsThinking` boolean in the
 * kernel with a richer 4-tuple:
 *
 *   - cognitionMode:  'fast' | 'deliberate' | 'judge' | 'multi-sample'
 *   - samples:        1 | 3 | 5     (multi-sample count when applicable)
 *   - budgetUsd:      caller-visible spend ceiling for the turn
 *   - maxTokens:      sensor output cap
 *
 * The allocator is pure: input = `(stakes, surface, ambiguityScore,
 * costCeilingUsd, requireJudge)`; output = the 4-tuple. The kernel
 * threads the result into the sensor call + judge / regen decision.
 *
 * Modes (mirrors LITFIN's TTC-mode taxonomy adapted to PM):
 *   - 'fast'          — single sensor call, no thinking, smallest cap
 *   - 'deliberate'    — single sensor call WITH extended thinking
 *   - 'judge'         — deliberate + post-hoc judge pass
 *   - 'multi-sample'  — deliberate + judge + N samples self-consistency
 *
 * The kernel.ts wantsThinking site is replaced by:
 *   const ttc = allocateTtc({...});
 *   const wantsThinking = ttc.cognitionMode !== 'fast';
 */

export type CognitionMode =
  | 'fast'
  | 'deliberate'
  | 'judge'
  | 'multi-sample';

export interface TtcAllocation {
  readonly cognitionMode: CognitionMode;
  readonly samples: 1 | 3 | 5;
  readonly budgetUsd: number;
  readonly maxTokens: number;
}

export interface TtcAllocatorInput {
  readonly stakes: 'low' | 'medium' | 'high' | 'critical';
  readonly surface:
    | 'marketing'
    | 'tenant-app'
    | 'owner-portal'
    | 'estate-manager-app'
    | 'admin-portal'
    | 'platform-hq'
    | 'classroom';
  /**
   * Optional ambiguity / complexity score from the normaliser or
   * intent-classifier in [0, 1]. Higher → spend more compute.
   */
  readonly ambiguityScore?: number;
  /** Optional per-tenant or per-tier cost ceiling. */
  readonly costCeilingUsd?: number;
  /**
   * Optional explicit caller flag — when true forces `judge` mode
   * regardless of the heuristic verdict.
   */
  readonly requireJudge?: boolean;
}

const STAKES_BUDGET_USD: Record<TtcAllocatorInput['stakes'], number> = {
  low: 0.01,
  medium: 0.05,
  high: 0.2,
  critical: 0.6,
};

const STAKES_TOKEN_CAP: Record<TtcAllocatorInput['stakes'], number> = {
  low: 512,
  medium: 1_024,
  high: 4_096,
  critical: 8_192,
};

/**
 * Decide the base cognition mode from stakes + ambiguity.
 *
 *   stakes  ambiguity
 *   low     any         → fast
 *   medium  ≤ 0.3       → fast
 *   medium  > 0.3       → deliberate
 *   high    any         → judge
 *   critical any        → multi-sample
 */
function baseMode(
  stakes: TtcAllocatorInput['stakes'],
  ambiguity: number,
): CognitionMode {
  if (stakes === 'critical') return 'multi-sample';
  if (stakes === 'high') return 'judge';
  if (stakes === 'medium') return ambiguity > 0.3 ? 'deliberate' : 'fast';
  return 'fast';
}

const MODE_RANK: Record<CognitionMode, number> = {
  fast: 0,
  deliberate: 1,
  judge: 2,
  'multi-sample': 3,
};

function strongerMode(a: CognitionMode, b: CognitionMode): CognitionMode {
  return MODE_RANK[a] >= MODE_RANK[b] ? a : b;
}

export function allocateTtc(input: TtcAllocatorInput): TtcAllocation {
  const ambiguity = clamp01(input.ambiguityScore ?? 0);
  let mode = baseMode(input.stakes, ambiguity);

  // Caller-side override — applied AFTER the cost-ceiling downgrade
  // ladder so the caller's hard requirement is never silently
  // demoted by the stakes budget. The override never DOWNGRADES a
  // multi-sample mode (a caller asking for judge means "at least
  // judge"; see the contract test in ttc-allocator.test.ts).
  const requireJudge = input.requireJudge === true;

  // Cost-ceiling soft cap — when a low ceiling is supplied, downgrade
  // 'multi-sample' to 'judge' to stay within budget.
  const stakesBudget = STAKES_BUDGET_USD[input.stakes];
  const budget = Math.min(
    input.costCeilingUsd ?? Number.POSITIVE_INFINITY,
    stakesBudget,
  );
  if (mode === 'multi-sample' && budget < 0.3) mode = 'judge';
  if (mode === 'judge' && budget < 0.05) mode = 'deliberate';
  if (mode === 'deliberate' && budget < 0.01) mode = 'fast';

  if (requireJudge) {
    mode = strongerMode(mode, 'judge');
  }

  // Marketing / classroom surfaces never go above 'judge' regardless of
  // stakes — they're unauthenticated / educational and a multi-sample
  // pass is too expensive for the traffic profile.
  if (
    (input.surface === 'marketing' || input.surface === 'classroom') &&
    mode === 'multi-sample'
  ) {
    mode = 'judge';
  }

  // Samples: multi-sample → 3 by default, escalate to 5 for critical
  // stakes WITH high ambiguity (the only case where 5 pays off).
  let samples: 1 | 3 | 5 = 1;
  if (mode === 'multi-sample') {
    samples = input.stakes === 'critical' && ambiguity > 0.7 ? 5 : 3;
  }

  const maxTokens = STAKES_TOKEN_CAP[input.stakes];

  return { cognitionMode: mode, samples, budgetUsd: budget, maxTokens };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export const TTC_DEFAULTS = {
  budgetByStakes: STAKES_BUDGET_USD,
  tokenCapByStakes: STAKES_TOKEN_CAP,
} as const;
