/**
 * BORJIE AI memory decay — Wave-11.
 *
 * Exponential decay on the `decayScore` field of each memory row. Recent
 * memories (or memories that have been recently recalled) keep a score near
 * 1.0; dormant memories trend toward 0.
 *
 * Pure computation; actual persistence happens via the injected repository.
 * Schedule via the heartbeat (see heartbeat-engine.ts).
 */

import type {
  SemanticMemoryRepository,
  SemanticMemoryRow,
} from './semantic-memory.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DecayPolicy {
  /** Decay factor per day. Larger => faster decay. */
  readonly ratePerDay: number;
  /** Bonus added per recent access, capped at 1.0. */
  readonly accessBoost: number;
  /** Threshold below which memories are considered archived. */
  readonly archiveBelow: number;
}

export const DEFAULT_DECAY: DecayPolicy = Object.freeze({
  ratePerDay: 0.02,
  accessBoost: 0.05,
  archiveBelow: 0.1,
});

export interface DecayResult {
  readonly scanned: number;
  readonly updated: number;
  readonly archived: number;
}

// ---------------------------------------------------------------------------
// Pure math
// ---------------------------------------------------------------------------

export function computeDecayedScore(
  row: Pick<SemanticMemoryRow, 'decayScore' | 'lastAccessedAt' | 'accessCount'>,
  now: Date,
  policy: DecayPolicy = DEFAULT_DECAY,
): number {
  const daysSinceAccess = Math.max(
    0,
    (now.getTime() - new Date(row.lastAccessedAt).getTime()) /
      (24 * 60 * 60 * 1000),
  );
  const decayed = row.decayScore * Math.exp(-policy.ratePerDay * daysSinceAccess);
  const bonus = Math.min(1, Math.log1p(row.accessCount) * policy.accessBoost);
  const next = Math.max(0, Math.min(1, decayed + bonus));
  return Number.isFinite(next) ? next : 0;
}

// ---------------------------------------------------------------------------
// Scheduled sweep
// ---------------------------------------------------------------------------

export interface DecaySweepDeps {
  readonly repo: SemanticMemoryRepository;
  readonly now?: () => Date;
  readonly policy?: Partial<DecayPolicy>;
}

/**
 * Apply decay across every memory belonging to a tenant. Rows that dip below
 * the archive threshold are deleted (they remain recoverable from cold
 * storage if the operator ships one).
 */
export async function sweepTenantDecay(
  tenantId: string,
  deps: DecaySweepDeps,
): Promise<DecayResult> {
  if (!tenantId) throw new Error('memory-decay: tenantId required');
  const now = deps.now ?? (() => new Date());
  const policy: DecayPolicy = { ...DEFAULT_DECAY, ...(deps.policy ?? {}) };
  const current = now();
  const rows = await deps.repo.listForTenant(tenantId, { limit: 10_000 });

  let updated = 0;
  let archived = 0;

  for (const row of rows) {
    const next = computeDecayedScore(row, current, policy);
    if (next < policy.archiveBelow) {
      await deps.repo.deleteById(tenantId, row.id);
      archived += 1;
      continue;
    }
    if (Math.abs(next - row.decayScore) >= 0.001) {
      await deps.repo.updateDecay(row.id, next);
      updated += 1;
    }
  }

  return { scanned: rows.length, updated, archived };
}
