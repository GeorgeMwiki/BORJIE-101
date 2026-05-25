/**
 * Core memory blocks — Drizzle-backed service.
 *
 * Operations:
 *   - upsert(args)  : insert or refresh the active block for
 *                     (tenant, user, persona, kind); archives the
 *                     previous active row.
 *   - active(args)  : list the active (non-archived) blocks for
 *                     (tenant, user, persona). Returns an empty array
 *                     when nothing exists.
 *   - archive(args) : soft-delete a block by id.
 *
 * Hard DB failures degrade to no-op / []. The kernel reads this on
 * every turn through `coreMemoryProvider.active(...)`; failures must
 * not break the main turn.
 */

import { randomUUID } from 'crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { coreMemoryBlocks } from '../schemas/core-memory-blocks.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


export type CoreMemoryBlockKind =
  | 'persona'
  | 'human'
  | 'preferences'
  | 'project';

export interface CoreMemoryBlock {
  readonly id: string;
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly personaId: string;
  readonly blockKind: CoreMemoryBlockKind;
  readonly blockText: string;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export interface UpsertCoreMemoryBlockArgs {
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly personaId: string;
  readonly blockKind: CoreMemoryBlockKind;
  readonly blockText: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ListActiveCoreMemoryBlocksArgs {
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly personaId: string;
}

export interface CoreMemoryBlocksService {
  upsert(args: UpsertCoreMemoryBlockArgs): Promise<{ id: string }>;
  active(
    args: ListActiveCoreMemoryBlocksArgs,
  ): Promise<ReadonlyArray<CoreMemoryBlock>>;
  archive(id: string): Promise<void>;
}

const VALID_KINDS: ReadonlySet<CoreMemoryBlockKind> = new Set([
  'persona',
  'human',
  'preferences',
  'project',
]);

const MAX_BLOCK_TEXT = 2_000;

export function createCoreMemoryBlocksService(
  db: DatabaseClient,
): CoreMemoryBlocksService {
  return {
    async upsert(args) {
      const id = randomUUID();
      try {
        if (!VALID_KINDS.has(args.blockKind)) {
          throw new Error(`invalid block kind: ${args.blockKind}`);
        }
        const text = (args.blockText ?? '').slice(0, MAX_BLOCK_TEXT);
        if (!text) throw new Error('blockText required');

        // Soft-archive any active row with the same key.
        await db
          .update(coreMemoryBlocks)
          .set({ archivedAt: new Date() } as never)
          .where(
            and(
              args.tenantId
                ? eq(coreMemoryBlocks.tenantId, args.tenantId)
                : isNull(coreMemoryBlocks.tenantId),
              args.userId
                ? eq(coreMemoryBlocks.userId, args.userId)
                : isNull(coreMemoryBlocks.userId),
              eq(coreMemoryBlocks.personaId, args.personaId),
              eq(coreMemoryBlocks.blockKind, args.blockKind),
              isNull(coreMemoryBlocks.archivedAt),
            ),
          );

        await db.insert(coreMemoryBlocks).values({
          id,
          tenantId: args.tenantId,
          userId: args.userId,
          personaId: args.personaId,
          blockKind: args.blockKind,
          blockText: text,
          metadata: args.metadata ?? {},
        } as never);
        return { id };
      } catch (err) {
        logger.error('core-memory-blocks.upsert failed', { error: err });
        return { id };
      }
    },

    async active(args) {
      try {
        const rows = await db
          .select()
          .from(coreMemoryBlocks)
          .where(
            and(
              args.tenantId
                ? eq(coreMemoryBlocks.tenantId, args.tenantId)
                : isNull(coreMemoryBlocks.tenantId),
              args.userId
                ? eq(coreMemoryBlocks.userId, args.userId)
                : isNull(coreMemoryBlocks.userId),
              eq(coreMemoryBlocks.personaId, args.personaId),
              isNull(coreMemoryBlocks.archivedAt),
            ),
          )
          .orderBy(desc(coreMemoryBlocks.updatedAt));
        return (rows ?? []).map(rowToBlock);
      } catch (err) {
        logger.error('core-memory-blocks.active failed', { error: err });
        return [];
      }
    },

    async archive(id) {
      try {
        await db
          .update(coreMemoryBlocks)
          .set({ archivedAt: new Date() } as never)
          .where(eq(coreMemoryBlocks.id, id));
      } catch (err) {
        logger.error('core-memory-blocks.archive failed', { error: err });
      }
    },
  };
}

interface Row {
  id: string;
  tenantId: string | null;
  userId: string | null;
  personaId: string;
  blockKind: string;
  blockText: string;
  metadata: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
  archivedAt: Date | string | null;
}

function rowToBlock(r: Row): CoreMemoryBlock {
  return {
    id: r.id,
    tenantId: r.tenantId,
    userId: r.userId,
    personaId: r.personaId,
    blockKind: (VALID_KINDS.has(r.blockKind as CoreMemoryBlockKind)
      ? (r.blockKind as CoreMemoryBlockKind)
      : 'persona'),
    blockText: r.blockText,
    metadata:
      r.metadata && typeof r.metadata === 'object'
        ? (r.metadata as Record<string, unknown>)
        : {},
    createdAt:
      r.createdAt instanceof Date
        ? r.createdAt.toISOString()
        : String(r.createdAt),
    updatedAt:
      r.updatedAt instanceof Date
        ? r.updatedAt.toISOString()
        : String(r.updatedAt),
    archivedAt: r.archivedAt
      ? r.archivedAt instanceof Date
        ? r.archivedAt.toISOString()
        : String(r.archivedAt)
      : null,
  };
}

/** Render an active block list as a single prompt fragment. */
export function renderCoreMemoryBlocks(
  blocks: ReadonlyArray<CoreMemoryBlock>,
): string {
  if (!blocks || blocks.length === 0) return '';
  const lines: string[] = ['[CORE MEMORY — DO NOT OVERRIDE]'];
  for (const b of blocks) {
    lines.push(`### ${b.blockKind}`);
    lines.push(b.blockText);
    lines.push('');
  }
  lines.push('[END CORE MEMORY]');
  return lines.join('\n');
}

// Re-export the table for bespoke queries.
export { coreMemoryBlocks };
void sql;
