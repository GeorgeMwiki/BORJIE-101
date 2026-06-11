/**
 * Salience scoring — the Generative-Agents retrieval recipe.
 *
 * score = normalize(recency × importance × relevance)
 *   - recency:    exponential decay (half-life in hours) over age.
 *   - importance: the source's 1-10 importance, normalized to [0,1].
 *   - relevance:  optional [0,1] cosine-relevance to the current focus;
 *                 defaults to 1 (no focus → recency×importance only).
 *
 * Pure + deterministic. No I/O. The brief uses this to rank every facet
 * so the brain reads the highest-salience undone item first.
 */

/** Recency decay half-life (hours). Matches the 0.995/step decay shape. */
export const DEFAULT_HALF_LIFE_HOURS = 72;

const MS_PER_HOUR = 60 * 60 * 1000;

export interface SalienceInput {
  /** ISO-8601 of the underlying event. Missing → treated as `now`. */
  readonly at?: string;
  /** Source importance 1-10. Clamped. */
  readonly importance: number;
  /** Optional relevance ∈ [0,1] to the current focus. Default 1. */
  readonly relevance?: number;
}

export interface SalienceContext {
  readonly now: () => Date;
  readonly halfLifeHours?: number;
}

/**
 * Compute a salience score ∈ [0,1] for one item.
 */
export function salience(input: SalienceInput, ctx: SalienceContext): number {
  const now = ctx.now().getTime();
  const halfLife = ctx.halfLifeHours ?? DEFAULT_HALF_LIFE_HOURS;

  const recency = recencyDecay(input.at, now, halfLife);
  const importance = clamp01((clampImportance(input.importance) - 1) / 9);
  const relevance = clamp01(input.relevance ?? 1);

  // Geometric blend so any near-zero factor drags the score down — a
  // stale-but-important item still surfaces, but a stale-AND-trivial one
  // sinks, exactly as the brain re-orientation ritual wants.
  return clamp01(recency * importance * relevance);
}

/**
 * Exponential recency decay. age=0 → 1; age=halfLife → 0.5. Future-dated
 * events (at > now) are treated as fully recent (decay = 1).
 */
function recencyDecay(
  at: string | undefined,
  nowMs: number,
  halfLifeHours: number,
): number {
  if (!at) return 1;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return 1;
  const ageHours = Math.max(0, (nowMs - t) / MS_PER_HOUR);
  if (ageHours === 0) return 1;
  return Math.pow(0.5, ageHours / Math.max(halfLifeHours, 1));
}

function clampImportance(n: number): number {
  if (n < 1) return 1;
  if (n > 10) return 10;
  return n;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
