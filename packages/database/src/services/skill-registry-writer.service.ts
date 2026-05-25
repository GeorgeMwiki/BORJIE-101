/**
 * skill-registry-writer.service — Drizzle-backed adapter.
 *
 * Satisfies the `SkillRegistryWriter` port declared in
 * `packages/ai-copilot/src/skill-promotion/types.ts`. Wraps the
 * existing `skill_registry` table (`packages/database/src/schemas/
 * skill-registry.schema.ts`) — no new schema or migration needed for
 * the registry itself.
 *
 * The minimal `SkillRegistryWriter` port the promoter (Voyager-style
 * auto-promotion pipeline) requires:
 *
 *   - upsertSkill(record): bool   // true = newly inserted
 *   - findByCodeHash(tenantId, codeHash): record | null
 *
 * Idempotency contract from the port:
 *   INSERT ... ON CONFLICT (tenant_id, code_hash)
 *     DO UPDATE SET success_count = success_count + EXCLUDED.success_count,
 *                   failure_count = failure_count + EXCLUDED.failure_count;
 *
 * A re-promote on the same (tenant_id, code_hash) bumps the counters
 * rather than inserting a duplicate row.
 *
 * Tenant scoping:
 *   - `findByCodeHash` and the dedupe key are both tenant-scoped.
 *     `tenantId === null` is the global / cross-tenant pool, matching
 *     `skill_registry.tenant_id IS NULL` rows.
 *
 * Error handling:
 *   - `upsertSkill` returns `false` on failure (callers treat that as
 *     "did not promote"; the promotion pipeline retries on the next
 *     consolidation tick).
 *   - `findByCodeHash` returns `null` on failure (lookup-miss is the
 *     same code path as not-found; the promoter handles both as
 *     "needs upsert").
 *
 * SOC 2 / GDPR Art. 30 rationale:
 *   - Skills carry NO personal data (tool name + canonical input shape).
 *   - tenant_id mandatory for per-tenant skills; NULL = explicit
 *     global pool (cross-tenant default skills).
 *   - `code_hash` is a sha256 over canonicalised tool sequence — no
 *     user content reaches the writer surface.
 */

import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { skillRegistry } from '../schemas/skill-registry.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


// ─────────────────────────────────────────────────────────────────────
// Port shape (mirrors packages/ai-copilot/src/skill-promotion/types.ts).
// Inlined here so the database package does not compile-time-depend on
// the ai-copilot package.
// ─────────────────────────────────────────────────────────────────────

export interface PromotionRecord {
  readonly tenantId: string | null;
  readonly name: string;
  readonly nlDescription: string;
  readonly codeHash: string;
  readonly toolCallTemplate: Readonly<Record<string, unknown>>;
  readonly initialSuccessCount: number;
  readonly initialFailureCount: number;
}

export interface SkillRegistryWriter {
  upsertSkill(record: PromotionRecord): Promise<boolean>;
  findByCodeHash(
    tenantId: string | null,
    codeHash: string,
  ): Promise<PromotionRecord | null>;
}

export function createSkillRegistryWriterService(
  db: DatabaseClient,
): SkillRegistryWriter {
  return {
    async upsertSkill(record) {
      try {
        const name = (record.name ?? '').slice(0, 200).trim();
        const desc = (record.nlDescription ?? '').slice(0, 2_000).trim();
        const codeHash = (record.codeHash ?? '').slice(0, 128).trim();
        if (!name || !desc || !codeHash) {
          throw new Error(
            'skill-registry-writer: name / nlDescription / codeHash are required',
          );
        }

        const id = randomUUID();
        const initialSuccess = Math.max(0, Math.floor(record.initialSuccessCount ?? 0));
        const initialFailure = Math.max(0, Math.floor(record.initialFailureCount ?? 0));

        const inserted = (await db
          .insert(skillRegistry)
          .values({
            id,
            tenantId: record.tenantId,
            name,
            nlDescription: desc,
            toolCallTemplate: record.toolCallTemplate as never,
            successCount: initialSuccess,
            failureCount: initialFailure,
            codeHash,
            status: 'active',
          } as never)
          .onConflictDoUpdate({
            target: [skillRegistry.tenantId, skillRegistry.codeHash],
            set: {
              // Voyager-style counter bump on re-promote. Carries the
              // template + description forward so the latest distilled
              // version wins (the canonical input shape can drift as the
              // tool's argument set evolves).
              name,
              nlDescription: desc,
              toolCallTemplate: record.toolCallTemplate as never,
              successCount: sql`${skillRegistry.successCount} + ${initialSuccess}`,
              failureCount: sql`${skillRegistry.failureCount} + ${initialFailure}`,
            } as never,
          })
          .returning({ id: skillRegistry.id })) as ReadonlyArray<{
          id: string;
        }>;

        const returnedId = inserted?.[0]?.id;
        return returnedId === id;
      } catch (error) {
        logger.error('skill-registry-writer.upsertSkill failed', { error: error });
        return false;
      }
    },

    async findByCodeHash(tenantId, codeHash) {
      try {
        if (!codeHash) return null;
        const conds: SQL<unknown>[] = [eq(skillRegistry.codeHash, codeHash)];
        if (tenantId === null) {
          conds.push(isNull(skillRegistry.tenantId));
        } else {
          conds.push(eq(skillRegistry.tenantId, tenantId));
        }
        const rows = (await db
          .select(SELECT_COLS)
          .from(skillRegistry)
          .where(and(...conds))
          .limit(1)) as ReadonlyArray<SkillRowShape>;
        const row = rows?.[0];
        if (!row) return null;
        return Object.freeze({
          tenantId: row.tenantId,
          name: row.name,
          nlDescription: row.nlDescription,
          codeHash: row.codeHash,
          toolCallTemplate:
            row.toolCallTemplate && typeof row.toolCallTemplate === 'object'
              ? (row.toolCallTemplate as Readonly<Record<string, unknown>>)
              : ({} as Readonly<Record<string, unknown>>),
          initialSuccessCount: Number(row.successCount ?? 0),
          initialFailureCount: Number(row.failureCount ?? 0),
        });
      } catch (error) {
        logger.error('skill-registry-writer.findByCodeHash failed', { error: error });
        return null;
      }
    },
  };
}

const SELECT_COLS = {
  tenantId: skillRegistry.tenantId,
  name: skillRegistry.name,
  nlDescription: skillRegistry.nlDescription,
  codeHash: skillRegistry.codeHash,
  toolCallTemplate: skillRegistry.toolCallTemplate,
  successCount: skillRegistry.successCount,
  failureCount: skillRegistry.failureCount,
} as const;

interface SkillRowShape {
  tenantId: string | null;
  name: string;
  nlDescription: string;
  codeHash: string;
  toolCallTemplate: unknown;
  successCount: number;
  failureCount: number;
}

export { skillRegistry };
