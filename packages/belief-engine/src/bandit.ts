/**
 * LinUCB contextual bandit.
 *
 * Learns per-arm suggestion quality from a context feature vector and adapts
 * which arm to pull. For Borjie: an owner/manager who rejects most nudges
 * gets a higher abstain threshold (less chatter); one who accepts gets more
 * help. The same machinery ranks copilot suggestions, routing arms, etc.
 *
 * Reference: LinUCB (Li et al. 2010, "A Contextual-Bandit Approach to
 * Personalised News Article Recommendation").
 *
 *   score(a, x) = θ̂·x + α · √(xᵀ A⁻¹ x),  θ̂ = A⁻¹ b
 *   update:      A ← A + x·xᵀ,  b ← b + reward·x
 *
 * PURE module. Per-arm state (A matrix, b vector) is persisted by the caller.
 * Ported from LITFIN litfin-ai/learning/suggestion-bandit.ts.
 */

export type FeatureVector = ReadonlyArray<number>;

export interface ArmState {
  /** d×d positive-definite matrix (A_a). */
  readonly A: ReadonlyArray<ReadonlyArray<number>>;
  /** d-length vector (b_a). */
  readonly b: ReadonlyArray<number>;
  readonly d: number;
}

export interface LinUcbConfig {
  /** Exploration parameter — higher = more exploration. */
  readonly alpha: number;
  readonly d: number;
}

/** Initial arm: A = I, b = 0. */
export function createArmState(d: number): ArmState {
  const A: number[][] = Array.from({ length: d }, (_, i) =>
    Array.from({ length: d }, (_, j) => (i === j ? 1 : 0)),
  );
  const b: number[] = Array.from({ length: d }, () => 0);
  return { A, b, d };
}

/**
 * Solve A·x = b via Gaussian elimination with partial pivoting. Total — a
 * singular system returns the zero vector rather than throwing.
 */
function solveLinear(
  A: ReadonlyArray<ReadonlyArray<number>>,
  b: ReadonlyArray<number>,
): number[] {
  const n = A.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i += 1) {
    let pivot = M[i][i];
    if (Math.abs(pivot) < 1e-12) {
      for (let r = i + 1; r < n; r += 1) {
        if (Math.abs(M[r][i]) > 1e-12) {
          [M[i], M[r]] = [M[r], M[i]];
          pivot = M[i][i];
          break;
        }
      }
      if (Math.abs(pivot) < 1e-12) return Array.from({ length: n }, () => 0);
    }
    for (let r = i + 1; r < n; r += 1) {
      const factor = M[r][i] / pivot;
      for (let c = i; c <= n; c += 1) M[r][c] -= factor * M[i][c];
    }
  }
  const x: number[] = Array.from({ length: n }, () => 0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j += 1) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

function dot(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

/** UCB score for an arm given the context features. */
export function ucbScore(
  arm: ArmState,
  features: FeatureVector,
  alpha: number,
): number {
  if (features.length !== arm.d) {
    throw new Error(
      `ucbScore: features length ${features.length} != arm d ${arm.d}`,
    );
  }
  const theta = solveLinear(arm.A, arm.b);
  const exploit = dot(theta, features);
  const AinvX = solveLinear(arm.A, features);
  const variance = Math.max(0, dot(features, AinvX));
  return exploit + alpha * Math.sqrt(variance);
}

/** Update an arm after observing a reward. PURE — returns a new ArmState. */
export function updateArmState(
  arm: ArmState,
  features: FeatureVector,
  reward: number,
): ArmState {
  if (features.length !== arm.d) {
    throw new Error(
      `updateArmState: features length ${features.length} != arm d ${arm.d}`,
    );
  }
  if (!Number.isFinite(reward)) {
    throw new Error('updateArmState: reward must be a finite number');
  }
  const A: number[][] = arm.A.map((row, i) =>
    row.map((v, j) => v + features[i] * features[j]),
  );
  const b: number[] = arm.b.map((v, i) => v + reward * features[i]);
  return { A, b, d: arm.d };
}

/** Pick the best arm by UCB. Ties broken by first occurrence. */
export function selectArmByUcb(
  arms: ReadonlyMap<string, ArmState>,
  features: FeatureVector,
  config: LinUcbConfig,
): { readonly armId: string; readonly score: number } | null {
  if (arms.size === 0) return null;
  let best: { armId: string; score: number } | null = null;
  for (const [armId, state] of arms) {
    const s = ucbScore(state, features, config.alpha);
    if (!best || s > best.score) best = { armId, score: s };
  }
  return best;
}
