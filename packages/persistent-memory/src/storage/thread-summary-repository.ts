/**
 * In-memory reference implementation of `ThreadSummaryRepository`
 * (Wave 18GG). Production wires a Postgres-backed adapter; this
 * module exists for tests and ephemeral worker contexts.
 */

import type { ThreadSummary, ThreadSummaryRepository } from '../types.js';

export function createInMemoryThreadSummaryRepository(): ThreadSummaryRepository {
  const summaries: ThreadSummary[] = [];

  return {
    async insert(s) {
      summaries.push(s);
    },
    async latest(tenant_id, thread_id) {
      const filtered = summaries.filter(
        (s) => s.tenant_id === tenant_id && s.thread_id === thread_id,
      );
      if (filtered.length === 0) return null;
      return filtered.reduce((latest, candidate) =>
        candidate.generated_at > latest.generated_at ? candidate : latest,
      );
    },
  };
}
