/**
 * Reinforcement repository — Drizzle/Postgres implementation (cognitive-
 * persistence follow-up).
 *
 * Durable counterpart to `createInMemoryReinforcementRepository`. Persists
 * one row per `memory.reinforce` call to the
 * `cognitive_memory_reinforcements` table (migration 0029) so the cross-
 * specialisation reinforcement audit trail survives a process restart — the
 * in-memory variant loses every row on reboot.
 *
 * Design
 * ------
 *   - Same `ReinforcementRepository` port as the in-memory reference impl.
 *     The composition root swaps one for the other without any other change.
 *   - Immutability: rows map to NEW plain objects; no caller-supplied object
 *     is mutated, and `insert` issues a single SQL INSERT.
 *   - Validation: every public write input is zod-validated before touching
 *     the DB so malformed wire data never reaches Postgres.
 *   - No `console.*`. A narrow structural logger is injected; failures
 *     surface as typed `CognitiveMemoryError`s for the caller to log via its
 *     own Pino instance.
 *
 * Dependency direction: `@borjie/cognitive-memory` → `@borjie/database`
 * (one-way; `@borjie/database` never imports this package, so no cycle).
 */

import { asc, eq } from 'drizzle-orm';
import {
  cognitiveMemoryReinforcements,
  type DatabaseClient,
  type CognitiveMemoryReinforcementRow,
} from '@borjie/database';
import { z } from 'zod';

import {
  CognitiveMemoryError,
  type ReinforcementRepository,
} from '../types.js';

// ---------------------------------------------------------------------------
// Narrow logger contract — keeps this module free of any logging library.
// The host injects a Pino-backed adapter; failures are otherwise raised as
// typed CognitiveMemoryError so the caller logs them with redaction.
// ---------------------------------------------------------------------------

export interface DrizzleReinforcementRepositoryLogger {
  readonly warn: (message: string, meta?: Record<string, unknown>) => void;
}

const NOOP_LOGGER: DrizzleReinforcementRepositoryLogger = Object.freeze({
  warn: (): void => {
    // intentional no-op default logger
  },
});

// ---------------------------------------------------------------------------
// Zod validation — guard the boundary before any SQL is issued. Mirrors the
// `ReinforcementRepository.insert` payload shape in types.ts.
// ---------------------------------------------------------------------------

const reinforcementRecordSchema = z.object({
  id: z.string().min(1),
  cell_id: z.string().min(1),
  tenant_id: z.string().min(1),
  specialisation: z.string().min(1),
  turn_id: z.string().min(1),
  reinforced_at: z.string().min(1),
  audit_hash: z.string().min(1),
});

const cellIdSchema = z.string().min(1);

// ---------------------------------------------------------------------------
// Row -> listForCell projection. Postgres returns timestamps as Date; we
// normalise `reinforced_at` to an ISO string to match the in-memory repo.
// ---------------------------------------------------------------------------

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowToListItem(row: CognitiveMemoryReinforcementRow): {
  readonly id: string;
  readonly specialisation: string;
  readonly turn_id: string;
  readonly reinforced_at: string;
} {
  return {
    id: row.id,
    specialisation: row.specialisation,
    turn_id: row.turnId,
    reinforced_at: toIso(row.reinforcedAt),
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct a Drizzle-backed {@link ReinforcementRepository}. Implements the
 * identical port as {@link createInMemoryReinforcementRepository}: `insert`
 * (one row per reinforce call) and `listForCell` (chronological trail for a
 * cell). Validation failures and DB faults surface as
 * {@link CognitiveMemoryError} so the caller logs them via its own redacting
 * logger.
 *
 * @param db     A Drizzle client (postgres-js backed). RLS pins the tenant
 *               via the `app.tenant_id` GUC at the request layer; this repo
 *               additionally forwards `tenant_id` for defence in depth.
 * @param logger Optional structural logger for non-fatal diagnostics.
 */
export function createDrizzleReinforcementRepository(
  db: DatabaseClient,
  logger: DrizzleReinforcementRepositoryLogger = NOOP_LOGGER,
): ReinforcementRepository {
  return {
    async insert(record): Promise<void> {
      const parsed = reinforcementRecordSchema.safeParse(record);
      if (!parsed.success) {
        throw new CognitiveMemoryError(
          'reinforcement_repo.invalid_insert',
          'drizzle reinforcement repo: invalid reinforcement record',
          { issues: parsed.error.issues },
        );
      }
      try {
        await db.insert(cognitiveMemoryReinforcements).values({
          id: parsed.data.id,
          cellId: parsed.data.cell_id,
          tenantId: parsed.data.tenant_id,
          specialisation: parsed.data.specialisation,
          turnId: parsed.data.turn_id,
          reinforcedAt: new Date(parsed.data.reinforced_at),
          auditHash: parsed.data.audit_hash,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/duplicate key|unique constraint/i.test(message)) {
          throw new CognitiveMemoryError(
            'reinforcement_repo.duplicate_id',
            `reinforcement ${parsed.data.id} already exists`,
          );
        }
        throw new CognitiveMemoryError(
          'reinforcement_repo.insert_failed',
          `drizzle reinforcement repo: insert failed for ${parsed.data.id}`,
          { error: message },
        );
      }
    },

    async listForCell(cellId): Promise<
      ReadonlyArray<{
        readonly id: string;
        readonly specialisation: string;
        readonly turn_id: string;
        readonly reinforced_at: string;
      }>
    > {
      const idParse = cellIdSchema.safeParse(cellId);
      if (!idParse.success) {
        return [];
      }
      try {
        const rows = (await db
          .select()
          .from(cognitiveMemoryReinforcements)
          .where(eq(cognitiveMemoryReinforcements.cellId, cellId))
          .orderBy(
            asc(cognitiveMemoryReinforcements.reinforcedAt),
          )) as ReadonlyArray<CognitiveMemoryReinforcementRow>;
        return rows.map(rowToListItem);
      } catch (err) {
        logger.warn('drizzle reinforcement repo: listForCell failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        throw new CognitiveMemoryError(
          'reinforcement_repo.list_failed',
          `drizzle reinforcement repo: listForCell failed for ${cellId}`,
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    },
  };
}
