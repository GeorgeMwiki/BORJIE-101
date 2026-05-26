/**
 * `reuse-counter.ts` — counts pattern reuse for the promotion threshold.
 *
 * Pure-functional counter. Keyed by `generated_recipe_hash`. Tracks total
 * count and distinct user-ids. Used by `promotion-decider.ts`.
 *
 * In-process only (the durable counts live in the
 * `ephemeral_dashboard_telemetry` table; this counter is a fast in-memory
 * read-aside for the composer's promotion check during a hot session).
 */

export interface ReuseCounter {
  readonly record: (recipeHash: string, userId: string) => void;
  readonly count: (recipeHash: string) => number;
  readonly distinctUserCount: (recipeHash: string) => number;
  readonly snapshot: (recipeHash: string) => ReuseSnapshot | null;
  readonly clear: () => void;
}

export interface ReuseSnapshot {
  readonly recipe_hash: string;
  readonly count: number;
  readonly distinct_user_count: number;
}

interface InnerState {
  readonly total: number;
  readonly users: Set<string>;
}

export function createReuseCounter(): ReuseCounter {
  const state = new Map<string, InnerState>();

  return {
    record(recipeHash, userId) {
      const prev = state.get(recipeHash);
      if (!prev) {
        state.set(recipeHash, {
          total: 1,
          users: new Set([userId]),
        });
        return;
      }
      const nextUsers = new Set(prev.users);
      nextUsers.add(userId);
      state.set(recipeHash, {
        total: prev.total + 1,
        users: nextUsers,
      });
    },
    count(recipeHash) {
      return state.get(recipeHash)?.total ?? 0;
    },
    distinctUserCount(recipeHash) {
      return state.get(recipeHash)?.users.size ?? 0;
    },
    snapshot(recipeHash) {
      const s = state.get(recipeHash);
      if (!s) return null;
      return {
        recipe_hash: recipeHash,
        count: s.total,
        distinct_user_count: s.users.size,
      };
    },
    clear() {
      state.clear();
    },
  };
}
