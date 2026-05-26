/**
 * Feedback repository (Wave 18V-DYNAMIC).
 *
 * Storage-agnostic CRUD on `junior_turn_feedback`. Production wires
 * this to Drizzle; tests use the in-memory implementation.
 */

import type { JuniorTurnFeedbackRecord } from '../types.js';

export interface FeedbackRepository {
  insert(record: JuniorTurnFeedbackRecord): Promise<void>;
  listByJunior(
    junior_id: string,
    tenant_id: string,
  ): Promise<ReadonlyArray<JuniorTurnFeedbackRecord>>;
}

/**
 * In-memory feedback repository. Records are stored in insertion
 * order; the lifecycle worker sorts by `recorded_at` when windowing.
 */
export function createInMemoryFeedbackRepository(): FeedbackRepository {
  const rows: JuniorTurnFeedbackRecord[] = [];

  return {
    async insert(record) {
      rows.push(record);
    },
    async listByJunior(junior_id, tenant_id) {
      return rows.filter(
        (row) => row.junior_id === junior_id && row.tenant_id === tenant_id,
      );
    },
  };
}
