/**
 * `FollowupCandidateRepository` — in-memory reference impl + SQL
 * port shape.
 *
 * The in-memory impl exists for tests and ephemeral workers. The
 * SQL port is defined as a thin interface that a production host
 * implements with `@borjie/database`'s drizzle bindings against the
 * `followup_candidates` table (migration 0034).
 */

import type {
  FollowupCandidate,
  FollowupCandidateRepository,
} from '../types.js';

export function createInMemoryCandidateRepository(): FollowupCandidateRepository {
  const rows = new Map<string, FollowupCandidate>();

  function startOfLocalDay(now: Date): number {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }

  return {
    async insert(candidate) {
      rows.set(candidate.id, candidate);
    },
    async listDue(tenant_id, now) {
      const matches: FollowupCandidate[] = [];
      const nowMs = now.getTime();
      for (const c of rows.values()) {
        if (c.tenant_id !== tenant_id) continue;
        if (c.status !== 'pending') continue;
        const dueMs = new Date(c.scheduled_for).getTime();
        if (dueMs <= nowMs) matches.push(c);
      }
      // Determinism — sort by priority desc then scheduled_for asc.
      return matches.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.scheduled_for.localeCompare(b.scheduled_for);
      });
    },
    async countSentToday(tenant_id, user_id, now) {
      const dayStart = startOfLocalDay(now);
      let count = 0;
      for (const c of rows.values()) {
        if (c.tenant_id !== tenant_id) continue;
        if (c.user_id !== user_id) continue;
        if (c.status !== 'sent') continue;
        if (c.sent_at === null) continue;
        if (new Date(c.sent_at).getTime() >= dayStart) count += 1;
      }
      return count;
    },
    async markSent(id, sent_at, audit_hash) {
      const existing = rows.get(id);
      if (!existing) return;
      rows.set(id, {
        ...existing,
        status: 'sent',
        sent_at: sent_at.toISOString(),
        audit_hash,
      });
    },
    async markDismissed(id, _dismissed_at) {
      const existing = rows.get(id);
      if (!existing) return;
      rows.set(id, { ...existing, status: 'dismissed' });
    },
    async markExpired(id, _expired_at) {
      const existing = rows.get(id);
      if (!existing) return;
      rows.set(id, { ...existing, status: 'expired' });
    },
  };
}

/**
 * SQL-port shape — the host adapter must implement
 * `FollowupCandidateRepository` against migration 0034's
 * `followup_candidates` table. RLS is enforced via the
 * `app.tenant_id` GUC, set by the host's connection wrapper.
 *
 * The port is identical to the interface in `types.ts`; we re-export
 * the type here for clarity at consumption sites.
 */
export type { FollowupCandidateRepository } from '../types.js';
