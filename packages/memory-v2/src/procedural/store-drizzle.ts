/**
 * Drizzle/Postgres procedural store (MEM-01) — Voyager-style promotion.
 *
 * Durable counterpart to `createInMemoryProceduralStore`. Persists skills to
 * `memory_v2_procedural_skills` (migration 0312) so observed skills + their
 * promotion state survive a process restart. Same `ProceduralStore` port.
 *
 * Merge semantics mirror the in-memory store exactly: each `recordSkill` on an
 * existing (tenant, name) increments `observedCount`, blends the success rate,
 * and promotes once the count crosses `PROMOTION_THRESHOLD`. The read-then-
 * upsert keeps the blended-rate contract identical to the reference impl; the
 * row id is the synthetic `${tenantId}:${name}` so the upsert dedupes.
 */

import { and, desc, eq } from 'drizzle-orm';
import {
  memoryV2ProceduralSkills,
  type DatabaseClient,
  type MemoryV2ProceduralSkillRow,
} from '@borjie/database';
import { z } from 'zod';

import type {
  ProceduralSkill,
  ProceduralStore,
  TenantId,
} from '../types.js';
import {
  errMessage,
  toIso,
  toNumber,
  NOOP_STORE_LOGGER,
  type DrizzleStoreLogger,
} from '../drizzle-logger.js';

const PROMOTION_THRESHOLD = 3;

const skillSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().min(1),
});

function rowToSkill(row: MemoryV2ProceduralSkillRow): ProceduralSkill {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    triggerPattern: row.triggerPattern,
    actionSequence: Object.freeze(
      Array.isArray(row.actionSequence)
        ? (row.actionSequence as ReadonlyArray<Record<string, unknown>>)
        : [],
    ),
    observedCount: row.observedCount,
    successRate: toNumber(row.successRate),
    promoted: row.promoted === 'true',
    lastSeenAt: toIso(row.lastSeenAt),
    createdAt: toIso(row.createdAt),
  });
}

function blendSuccessRate(
  prevRate: number,
  prevCount: number,
  newSample: number,
): number {
  const weighted = (prevRate * prevCount + newSample) / (prevCount + 1);
  return Math.max(0, Math.min(1, weighted));
}

export function createDrizzleProceduralStore(
  db: DatabaseClient,
  logger: DrizzleStoreLogger = NOOP_STORE_LOGGER,
): ProceduralStore {
  return {
    async recordSkill(skill: ProceduralSkill): Promise<ProceduralSkill> {
      const parsed = skillSchema.safeParse(skill);
      if (!parsed.success) {
        throw new Error(
          `memory-v2 drizzle procedural: invalid skill (${JSON.stringify(parsed.error.issues)})`,
        );
      }
      // Synthetic id so the upsert dedupes per (tenant, name) regardless of the
      // caller-supplied id, matching the in-memory `${tenantId}:${name}` key.
      const id = `${skill.tenantId}:${skill.name}`;
      try {
        const existingRows = (await db
          .select()
          .from(memoryV2ProceduralSkills)
          .where(eq(memoryV2ProceduralSkills.id, id))
          .limit(1)) as ReadonlyArray<MemoryV2ProceduralSkillRow>;
        const existing = existingRows[0];

        if (existing) {
          const prev = rowToSkill(existing);
          const observedCount = prev.observedCount + 1;
          const successRate = blendSuccessRate(
            prev.successRate,
            prev.observedCount,
            skill.successRate,
          );
          const merged: ProceduralSkill = {
            ...prev,
            observedCount,
            successRate,
            promoted: observedCount >= PROMOTION_THRESHOLD,
            lastSeenAt: skill.lastSeenAt,
            actionSequence: skill.actionSequence,
            triggerPattern: skill.triggerPattern,
            description: skill.description,
          };
          await db
            .update(memoryV2ProceduralSkills)
            .set({
              description: merged.description,
              triggerPattern: merged.triggerPattern,
              actionSequence: [...merged.actionSequence],
              observedCount: merged.observedCount,
              successRate: merged.successRate.toFixed(3),
              promoted: merged.promoted ? 'true' : 'false',
              lastSeenAt: new Date(merged.lastSeenAt),
            })
            .where(eq(memoryV2ProceduralSkills.id, id));
          return Object.freeze(merged);
        }

        const observedCount = Math.max(1, skill.observedCount);
        const inserted: ProceduralSkill = {
          ...skill,
          id,
          observedCount,
          promoted: observedCount >= PROMOTION_THRESHOLD,
        };
        await db
          .insert(memoryV2ProceduralSkills)
          .values({
            id,
            tenantId: skill.tenantId,
            name: skill.name,
            description: skill.description,
            triggerPattern: skill.triggerPattern,
            actionSequence: [...skill.actionSequence],
            observedCount,
            successRate: skill.successRate.toFixed(3),
            promoted: inserted.promoted ? 'true' : 'false',
            lastSeenAt: new Date(skill.lastSeenAt),
            createdAt: new Date(skill.createdAt),
          })
          .onConflictDoNothing({ target: memoryV2ProceduralSkills.id });
        return Object.freeze(inserted);
      } catch (err) {
        throw new Error(
          `memory-v2 drizzle procedural: recordSkill failed for ${id}: ${errMessage(err)}`,
        );
      }
    },

    async getPromotedSkills(
      tenantId: TenantId,
      limit = 25,
    ): Promise<ReadonlyArray<ProceduralSkill>> {
      try {
        const rows = (await db
          .select()
          .from(memoryV2ProceduralSkills)
          .where(
            and(
              eq(memoryV2ProceduralSkills.tenantId, tenantId),
              eq(memoryV2ProceduralSkills.promoted, 'true'),
            ),
          )
          .orderBy(desc(memoryV2ProceduralSkills.lastSeenAt))
          .limit(limit)) as ReadonlyArray<MemoryV2ProceduralSkillRow>;
        return rows.map(rowToSkill);
      } catch (err) {
        logger.warn('memory-v2 drizzle procedural: getPromotedSkills failed', {
          error: errMessage(err),
        });
        return [];
      }
    },

    async findByName(
      tenantId: TenantId,
      name: string,
    ): Promise<ProceduralSkill | null> {
      try {
        const rows = (await db
          .select()
          .from(memoryV2ProceduralSkills)
          .where(eq(memoryV2ProceduralSkills.id, `${tenantId}:${name}`))
          .limit(1)) as ReadonlyArray<MemoryV2ProceduralSkillRow>;
        const row = rows[0];
        return row === undefined ? null : rowToSkill(row);
      } catch (err) {
        logger.warn('memory-v2 drizzle procedural: findByName failed', {
          error: errMessage(err),
        });
        return null;
      }
    },
  };
}

export const PROCEDURAL_PROMOTION_THRESHOLD = PROMOTION_THRESHOLD;
