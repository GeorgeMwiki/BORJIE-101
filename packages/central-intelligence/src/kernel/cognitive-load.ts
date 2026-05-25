/**
 * Cognitive load — does the user appear overloaded? If so, throttle
 * the answer's depth and break it into smaller chunks. The kernel
 * uses this to decide:
 *
 *   - max number of citations rendered inline (high load → 2; low → 8)
 *   - whether to emit an artifact alongside text (high load → no)
 *   - max sentence count of the reply
 *
 * Signals (per-turn): question length, multi-question density, recent
 * back-and-forth volume, mid-message hedging (hesitation markers),
 * explicit simplify requests, response latency (carried from the
 * previous turn).
 *
 * In addition to the per-turn signals, this module now maintains a
 * **stateful per-(tenant,user) accumulator** so a streak of overload
 * carries forward and an extended calm streak relaxes the band.
 *
 * Mirrors LITFIN's `src/core/brain/cognitive-load.ts:1-200`. Decay
 * rule: after `DECAY_AFTER_STABLE_TURNS` (= 4) stable turns, the
 * accumulator decays toward zero so one bad turn doesn't permanently
 * mark the user saturated.
 */

import type { GateVerdict } from './kernel-types.js';

export interface CognitiveLoadInput {
  readonly userMessage: string;
  readonly recentTurnCount: number; // turns by user in last 5 minutes
  /** Optional: previous-turn response latency in ms (capped at 30s). */
  readonly priorTurnLatencyMs?: number;
}

export interface CognitiveLoadOutput {
  readonly load: 'low' | 'medium' | 'high';
  readonly verdict: GateVerdict;
  readonly maxSentences: number;
  readonly maxCitations: number;
  readonly allowArtifact: boolean;
  /** Raw per-turn score [0,1] before accumulator blending. */
  readonly score: number;
}

const HESITATION_MARKERS = [
  /\b(uh|um|er|hmm|actually|wait|sorry)\b/i,
  /\.{3,}/,
];

const SIMPLIFY_REQUESTS: ReadonlyArray<RegExp> = [
  /\b(simpler|in plain (english|swahili)|in simple terms)\b/i,
  /\b(slow down|one step at a time|step by step)\b/i,
  /\bexplain (differently|again)\b/i,
  /\b(i (don'?t|do not) (get|understand))\b/i,
  /\b(can you (rephrase|re-explain|simplify))\b/i,
];

export function assessCognitiveLoad(input: CognitiveLoadInput): CognitiveLoadOutput {
  const m = input.userMessage;
  const wordCount = m.trim().split(/\s+/).filter(Boolean).length;
  const questionCount = (m.match(/\?/g) ?? []).length;
  const hesitationHits = HESITATION_MARKERS.filter((re) => re.test(m)).length;
  const simplifyHits = SIMPLIFY_REQUESTS.filter((re) => re.test(m)).length;
  const latencyMs = Math.min(input.priorTurnLatencyMs ?? 0, 30_000);

  let score = 0;
  if (wordCount > 80) score += 1;
  if (questionCount >= 3) score += 1;
  if (hesitationHits >= 2) score += 1;
  if (input.recentTurnCount >= 6) score += 1;
  if (simplifyHits >= 1) score += 1; // explicit simplify request weighs alone
  if (latencyMs >= 8_000) score += 1;

  const load: 'low' | 'medium' | 'high' =
    score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low';

  const verdict: GateVerdict =
    load === 'high'
      ? { status: 'soften', reason: 'cognitive overload — reply throttled' }
      : { status: 'pass' };

  return {
    load,
    verdict,
    maxSentences: load === 'high' ? 3 : load === 'medium' ? 6 : 12,
    maxCitations: load === 'high' ? 2 : load === 'medium' ? 5 : 8,
    allowArtifact: load !== 'high',
    score: Math.min(1, score / 6),
  };
}

export function renderLoadDirective(out: CognitiveLoadOutput): string {
  return `Reply in at most ${out.maxSentences} sentences, with at most ${out.maxCitations} inline citations.${
    out.allowArtifact ? '' : ' Do not produce an artifact this turn.'
  }`;
}

// ────────────────────────────────────────────────────────────────────
// Stateful accumulator — per-(tenant, user) load profile with LRU
// + 24h TTL eviction. Mirrors LITFIN's persistent load store.
// ────────────────────────────────────────────────────────────────────

export interface CognitiveLoadAccumulatorProfile {
  /** Running score in [0,1], decayed each read by DECAY_RATE. */
  readonly score: number;
  /** Total turns observed for this (tenant,user). */
  readonly turns: number;
  /** Count of consecutive "stable" turns (score change < 0.05). */
  readonly stableStreak: number;
  /** ISO timestamp of the most recent update. */
  readonly updatedAt: string;
}

export interface AccumulatorObservation {
  readonly perTurnScore: number; // [0,1] from assessCognitiveLoad.score
  readonly capturedAt: string;
}

const MAX_ENTRIES = 10_000;
const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DECAY_AFTER_STABLE_TURNS = 4;
const DECAY_PER_STABLE_TURN = 0.08;
const BLEND_NEW_WEIGHT = 0.4; // EMA-ish: new turn worth 0.4, history 0.6

export interface CognitiveLoadAccumulator {
  observe(tenantId: string, userId: string, obs: AccumulatorObservation): CognitiveLoadAccumulatorProfile;
  read(tenantId: string, userId: string, nowMs?: number): CognitiveLoadAccumulatorProfile | null;
  /** Force-eviction (test seam). */
  reset(): void;
  /** Current entry count (test seam). */
  size(): number;
}

interface InternalEntry {
  score: number;
  turns: number;
  stableStreak: number;
  updatedAtMs: number;
  /** insertion / access order for LRU */
  touchOrder: number;
}

export function createCognitiveLoadAccumulator(): CognitiveLoadAccumulator {
  const store = new Map<string, InternalEntry>();
  let touchCounter = 0;

  const key = (tenantId: string, userId: string): string =>
    `${tenantId}:${userId}`;

  const evictExpiredAndOverflow = (nowMs: number): void => {
    // Drop TTL-expired entries first.
    for (const [k, v] of store) {
      if (nowMs - v.updatedAtMs > TTL_MS) {
        store.delete(k);
      }
    }
    // Then LRU-evict if still over capacity.
    if (store.size <= MAX_ENTRIES) return;
    const sorted = [...store.entries()].sort(
      (a, b) => a[1].touchOrder - b[1].touchOrder,
    );
    const overflow = store.size - MAX_ENTRIES;
    for (let i = 0; i < overflow; i += 1) {
      const entry = sorted[i];
      if (entry) store.delete(entry[0]);
    }
  };

  return {
    observe(tenantId, userId, obs) {
      const nowMs = Date.parse(obs.capturedAt);
      const k = key(tenantId, userId);
      const prev = store.get(k);
      const next: InternalEntry = prev
        ? blend(prev, obs.perTurnScore, nowMs, ++touchCounter)
        : {
            score: obs.perTurnScore,
            turns: 1,
            stableStreak: 0,
            updatedAtMs: nowMs,
            touchOrder: ++touchCounter,
          };
      store.set(k, next);
      evictExpiredAndOverflow(nowMs);
      return toProfile(next);
    },
    read(tenantId, userId, nowMs) {
      const k = key(tenantId, userId);
      const entry = store.get(k);
      if (!entry) return null;
      const at = nowMs ?? Date.now();
      if (at - entry.updatedAtMs > TTL_MS) {
        store.delete(k);
        return null;
      }
      // Touch-only read updates LRU order.
      entry.touchOrder = ++touchCounter;
      return toProfile(entry);
    },
    reset() {
      store.clear();
      touchCounter = 0;
    },
    size() {
      return store.size;
    },
  };
}

function blend(
  prev: InternalEntry,
  perTurnScore: number,
  nowMs: number,
  touchOrder: number,
): InternalEntry {
  const blended = (1 - BLEND_NEW_WEIGHT) * prev.score + BLEND_NEW_WEIGHT * perTurnScore;
  const delta = Math.abs(perTurnScore - prev.score);
  const stableStreak = delta < 0.05 ? prev.stableStreak + 1 : 0;
  const decayed = stableStreak >= DECAY_AFTER_STABLE_TURNS
    ? Math.max(0, blended - DECAY_PER_STABLE_TURN)
    : blended;
  return {
    score: clamp01(decayed),
    turns: prev.turns + 1,
    stableStreak,
    updatedAtMs: nowMs,
    touchOrder,
  };
}

function toProfile(e: InternalEntry): CognitiveLoadAccumulatorProfile {
  return {
    score: e.score,
    turns: e.turns,
    stableStreak: e.stableStreak,
    updatedAt: new Date(e.updatedAtMs).toISOString(),
  };
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// ────────────────────────────────────────────────────────────────────
// Render directive with accumulator mix-in.
// ────────────────────────────────────────────────────────────────────

/**
 * Render a richer directive that mixes the per-turn output with the
 * accumulated profile. The accumulator nudges the directive
 * narratively: "Your last 4 turns showed escalating frustration;
 * soften tone, drop jargon, one idea per turn."
 */
export function renderLoadDirectiveWithProfile(
  out: CognitiveLoadOutput,
  profile: CognitiveLoadAccumulatorProfile | null,
): string {
  const base = renderLoadDirective(out);
  if (!profile) return base;
  const hint = describeProfile(profile);
  return hint ? `${base} ${hint}` : base;
}

function describeProfile(p: CognitiveLoadAccumulatorProfile): string {
  if (p.turns < 2) return '';
  if (p.score >= 0.6 && p.stableStreak < 2) {
    return `The last ${Math.min(p.turns, 4)} turns showed escalating load; drop jargon and lead with one concrete next step.`;
  }
  if (p.score >= 0.4) {
    return 'Sustained moderate load across recent turns; keep paragraphs short and avoid introducing new concepts.';
  }
  if (p.stableStreak >= 4 && p.score < 0.2) {
    return 'Recent turns are calm; you may resume normal vocabulary and longer reasoning.';
  }
  return '';
}
