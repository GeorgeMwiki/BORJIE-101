/**
 * `PerfNudgeRepository` — in-memory reference impl + SQL port shape.
 *
 * In-memory impl backs tests + ephemeral workers. The SQL port targets
 * migration 0058's `perf_nudges` table. RLS is enforced via the
 * canonical `app.tenant_id` GUC.
 */

import type {
  PerfNudge,
  PerfNudgeRepository,
} from '../types.js';

export function createInMemoryPerfNudgeRepository(): PerfNudgeRepository {
  const rows = new Map<string, PerfNudge>();
  return {
    async insert(nudge) {
      rows.set(nudge.id, nudge);
    },
    async listForScorecard(scorecard_id) {
      const out: PerfNudge[] = [];
      for (const n of rows.values()) {
        if (n.scorecard_id === scorecard_id) out.push(n);
      }
      // Deterministic order — by tier then id.
      const tierOrder: Record<string, number> = {
        subject: 0,
        supervisor: 1,
        owner: 2,
      };
      out.sort((a, b) => {
        const at = tierOrder[a.recipient_tier] ?? 99;
        const bt = tierOrder[b.recipient_tier] ?? 99;
        if (at !== bt) return at - bt;
        return a.id.localeCompare(b.id);
      });
      return out;
    },
    async markSent(id, sent_at) {
      const existing = rows.get(id);
      if (!existing) return;
      rows.set(id, {
        ...existing,
        sent_at: sent_at.toISOString(),
      });
    },
  };
}

export type { PerfNudgeRepository } from '../types.js';
