/**
 * Breakout manager (Wave 11).
 *
 * Splits a large classroom session into smaller groups for peer learning.
 * Strategy is configurable:
 *
 *   - `by_mastery`    : cluster learners with similar pKnow (balance groups)
 *   - `mixed_ability` : each group has a leader (high pKnow) + novices
 *   - `random`        : simple random split
 *
 * Pure — returns a plan, no side-effects.
 */

import type { LearnerBKT } from './group-bkt.js';

export type BreakoutStrategy = 'by_mastery' | 'mixed_ability' | 'random';

export interface BreakoutPlan {
  readonly strategy: BreakoutStrategy;
  readonly groups: readonly BreakoutGroup[];
}

export interface BreakoutGroup {
  readonly id: string;
  readonly learners: readonly string[]; // userIds
  readonly leader?: string; // highest-mastery learner in the group
}

export interface BreakoutInput {
  readonly learners: readonly LearnerBKT[];
  readonly conceptId: string;
  readonly groupSize: number;
  readonly strategy: BreakoutStrategy;
  readonly seed?: number;
}

export function planBreakout(input: BreakoutInput): BreakoutPlan {
  const { learners, conceptId, groupSize, strategy } = input;
  if (groupSize < 2) {
    throw new Error('breakout groupSize must be >= 2');
  }
  if (learners.length === 0) {
    return { strategy, groups: [] };
  }
  const masteries = learners.map((l) => ({
    userId: l.userId,
    pKnow: l.concepts[conceptId]?.pKnow ?? 0,
  }));

  let groupsUserIds: string[][];
  if (strategy === 'by_mastery') {
    const sorted = [...masteries].sort((a, b) => b.pKnow - a.pKnow);
    groupsUserIds = chunk(
      sorted.map((m) => m.userId),
      groupSize
    );
  } else if (strategy === 'mixed_ability') {
    const sorted = [...masteries].sort((a, b) => b.pKnow - a.pKnow);
    const n = Math.max(1, Math.ceil(sorted.length / groupSize));
    groupsUserIds = Array.from({ length: n }, () => [] as string[]);
    sorted.forEach((m, i) => {
      groupsUserIds[i % n].push(m.userId);
    });
  } else {
    const shuffled = shuffle(
      masteries.map((m) => m.userId),
      input.seed
    );
    groupsUserIds = chunk(shuffled, groupSize);
  }

  const groups: BreakoutGroup[] = groupsUserIds.map((ids, i) => {
    const groupMasteries = ids
      .map((uid) => masteries.find((m) => m.userId === uid)!)
      .filter(Boolean);
    const leader = groupMasteries.sort((a, b) => b.pKnow - a.pKnow)[0];
    return {
      id: `bk_${i + 1}`,
      learners: ids,
      leader: leader && leader.pKnow >= 0.6 ? leader.userId : undefined,
    };
  });

  return { strategy, groups };
}

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Deterministic shuffle when a seed is provided; otherwise Math.random.
 * The seed version uses a tiny LCG so tests are reproducible.
 */
function shuffle<T>(arr: readonly T[], seed?: number): T[] {
  const out = [...arr];
  const rng = seed === undefined ? Math.random : lcg(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}
