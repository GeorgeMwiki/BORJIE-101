/**
 * Drizzle-backed `WorkflowRunEventRepository`.
 *
 * Persists the append-only transition log to `workflow_run_events`
 * (migration 0307). Inserts carry `event.tenantId` so they run inside a
 * tenant-context transaction; `listForRun` has no tenant argument (a run
 * id is globally unique, the caller verifies tenant downstream) so it
 * reads under the service-role bypass and orders by `occurred_at`.
 */

import { asc, eq } from 'drizzle-orm';
import {
  workflowRunEvents,
  withTenantContext,
  withServiceRoleContext,
  type DatabaseClient,
} from '@borjie/database';
import type {
  WorkflowRunEvent,
  WorkflowRunEventRepository,
} from '../types.js';
import { rowToEvent } from './row-mappers.js';

export function createDrizzleRunEventRepository(
  db: DatabaseClient | null,
): WorkflowRunEventRepository {
  if (!db) {
    throw new Error(
      'createDrizzleRunEventRepository requires a DatabaseClient (got null)',
    );
  }
  return {
    async insert(event: WorkflowRunEvent) {
      await withTenantContext(db, event.tenantId, async (tx) => {
        await tx.insert(workflowRunEvents).values({
          id: event.id,
          runId: event.runId,
          tenantId: event.tenantId,
          kind: event.kind,
          actorUserId: event.actorUserId,
          payload: { ...event.payload },
          occurredAt: event.occurredAt,
        });
      });
    },

    async listForRun(runId) {
      const rows = await withServiceRoleContext(db, async (tx) => {
        return tx
          .select()
          .from(workflowRunEvents)
          .where(eq(workflowRunEvents.runId, runId))
          .orderBy(asc(workflowRunEvents.occurredAt));
      });
      return Object.freeze(
        (rows as Record<string, unknown>[]).map(rowToEvent),
      );
    },
  };
}
