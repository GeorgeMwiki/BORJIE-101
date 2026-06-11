/**
 * Drizzle/Postgres reflective store (MEM-01).
 *
 * Durable counterpart to `createInMemoryReflectiveStore`. Persists notes to
 * `memory_v2_reflective_notes` (migration 0312) so Reflexion-style notes
 * survive a process restart. Same `ReflectiveStore` port. The `reflect()`
 * note builder stays in the in-memory module (it is pure); only the storage
 * port changes here.
 */

import { desc, eq } from 'drizzle-orm';
import {
  memoryV2ReflectiveNotes,
  type DatabaseClient,
  type MemoryV2ReflectiveNoteRow,
} from '@borjie/database';
import { z } from 'zod';

import type { ReflectiveNote, ReflectiveStore, TenantId } from '../types.js';
import {
  errMessage,
  toIso,
  toNumber,
  NOOP_STORE_LOGGER,
  type DrizzleStoreLogger,
} from '../drizzle-logger.js';

const noteSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  insight: z.string(),
});

function rowToNote(row: MemoryV2ReflectiveNoteRow): ReflectiveNote {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    insight: row.insight,
    adjustments: Object.freeze([...row.adjustments]),
    periodStart: toIso(row.periodStart),
    periodEnd: toIso(row.periodEnd),
    selfScore: toNumber(row.selfScore),
    createdAt: toIso(row.createdAt),
  });
}

export function createDrizzleReflectiveStore(
  db: DatabaseClient,
  logger: DrizzleStoreLogger = NOOP_STORE_LOGGER,
): ReflectiveStore {
  return {
    async upsertNote(note: ReflectiveNote): Promise<ReflectiveNote> {
      const parsed = noteSchema.safeParse(note);
      if (!parsed.success) {
        throw new Error(
          `memory-v2 drizzle reflective: invalid note (${JSON.stringify(parsed.error.issues)})`,
        );
      }
      const values = {
        id: note.id,
        tenantId: note.tenantId,
        userId: note.userId,
        insight: note.insight,
        adjustments: [...note.adjustments],
        periodStart: new Date(note.periodStart),
        periodEnd: new Date(note.periodEnd),
        selfScore: note.selfScore.toFixed(3),
        createdAt: new Date(note.createdAt),
      };
      try {
        await db
          .insert(memoryV2ReflectiveNotes)
          .values(values)
          .onConflictDoUpdate({
            target: memoryV2ReflectiveNotes.id,
            set: {
              userId: values.userId,
              insight: values.insight,
              adjustments: values.adjustments,
              periodStart: values.periodStart,
              periodEnd: values.periodEnd,
              selfScore: values.selfScore,
            },
          });
        return Object.freeze({ ...note });
      } catch (err) {
        throw new Error(
          `memory-v2 drizzle reflective: upsertNote failed for ${note.id}: ${errMessage(err)}`,
        );
      }
    },

    async getLatestForTenant(
      tenantId: TenantId,
    ): Promise<ReflectiveNote | null> {
      try {
        const rows = (await db
          .select()
          .from(memoryV2ReflectiveNotes)
          .where(eq(memoryV2ReflectiveNotes.tenantId, tenantId))
          .orderBy(desc(memoryV2ReflectiveNotes.periodEnd))
          .limit(1)) as ReadonlyArray<MemoryV2ReflectiveNoteRow>;
        const row = rows[0];
        return row === undefined ? null : rowToNote(row);
      } catch (err) {
        logger.warn(
          'memory-v2 drizzle reflective: getLatestForTenant failed',
          { error: errMessage(err) },
        );
        return null;
      }
    },
  };
}
