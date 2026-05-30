/**
 * In-memory FollowUpPersister implementation.
 *
 * For request-scoped runs (the v1 MD chat route) and tests, this is a
 * zero-dependency persister that holds follow-ups in a frozen array
 * and applies updates immutably. Production callers swap in
 * `makeFollowUpPersister(supabase)` from `./persister`.
 *
 * Identical surface to the Supabase variant — `upsert`, `upsertMany`,
 * `listPending`, `setStatus` — so the composition root can wire either
 * one against the same `FollowUpPersister` port.
 *
 * @module features/central-command/md/follow-up/in-memory-persister
 */

import type { FollowUp, FollowUpStatus } from "./types";
import type { FollowUpPersister } from "./persister";

export interface InMemoryFollowUpPersister extends FollowUpPersister {
  /** Test/debug helper — returns the current in-memory snapshot. */
  snapshot(): ReadonlyArray<FollowUp>;
}

export function makeInMemoryFollowUpPersister(): InMemoryFollowUpPersister {
  let rows: ReadonlyArray<FollowUp> = [];

  return Object.freeze({
    async upsert(fu: FollowUp): Promise<void> {
      rows = Object.freeze([...rows.filter((r) => r.id !== fu.id), fu]);
    },
    async upsertMany(fus: ReadonlyArray<FollowUp>): Promise<void> {
      const ids = new Set(fus.map((f) => f.id));
      rows = Object.freeze([...rows.filter((r) => !ids.has(r.id)), ...fus]);
    },
    async listPending(
      tenantId: string,
      _limit?: number,
    ): Promise<ReadonlyArray<FollowUp>> {
      return rows.filter(
        (r) =>
          r.tenantId === tenantId &&
          (r.status === "pending" || r.status === "escalated"),
      );
    },
    async setStatus(id: string, status: FollowUpStatus): Promise<void> {
      rows = Object.freeze(
        rows.map((r) => (r.id === id ? { ...r, status } : r)),
      );
    },
    snapshot(): ReadonlyArray<FollowUp> {
      return rows;
    },
  });
}
