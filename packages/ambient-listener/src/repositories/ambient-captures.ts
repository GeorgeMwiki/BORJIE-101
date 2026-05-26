/**
 * `AmbientCapturesRepository` — in-memory reference impl + SQL port
 * shape.
 *
 * Hash-chained — `latestForSession` returns the most recent row for
 * `(tenant, source_session_id)` so the pipeline can stamp the new
 * row's `prev_hash` correctly. The production SQL impl returns the
 * row whose `captured_at` is max for the same `(tenant_id,
 * source_session_id)`.
 */

import type {
  AmbientCapture,
  AmbientCapturesRepository,
} from '../types.js';

export function createInMemoryAmbientCapturesRepository(): AmbientCapturesRepository {
  const rows: AmbientCapture[] = [];

  return {
    async insert(capture) {
      rows.push(capture);
    },
    async latestForSession(tenant_id, source_session_id) {
      let latest: AmbientCapture | null = null;
      for (const c of rows) {
        if (c.tenant_id !== tenant_id) continue;
        if (c.source_session_id !== source_session_id) continue;
        if (!latest) {
          latest = c;
          continue;
        }
        if (
          new Date(c.captured_at).getTime() >
          new Date(latest.captured_at).getTime()
        ) {
          latest = c;
        }
      }
      return latest;
    },
    async listForUser(tenant_id, user_id) {
      const matches: AmbientCapture[] = [];
      for (const c of rows) {
        if (c.tenant_id === tenant_id && c.user_id === user_id) {
          matches.push(c);
        }
      }
      return matches.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
    },
  };
}

export type { AmbientCapturesRepository } from '../types.js';
