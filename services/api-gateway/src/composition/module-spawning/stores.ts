/**
 * module-spawning/stores.ts — Drizzle CRUD adapters for the three
 * module-spawning registry tables (Lane 3, Pass 2).
 *
 *   - ModulesStorePort        → `modules`         (tenant-scoped)
 *   - ModuleSpecsStorePort     → `module_specs`    (tenant-scoped)
 *   - ModuleTemplatesStorePort → `module_templates`(global catalogue)
 *
 * Tenant isolation is enforced two ways, belt-and-braces:
 *   1. Every tenant-scoped read/write runs under `withServiceRoleContext`
 *      so the FORCE-RLS policy on each table has a bound GUC (the
 *      out-of-band orchestrator has no request GUC), AND every query
 *      additionally carries an explicit `tenant_id = $tenant` predicate
 *      so a wrong-tenant id can never read/write another tenant's row.
 *   2. `findModule` returns null when the row's tenant differs (the
 *      `eq(tenantId)` predicate guarantees this — a wrong tenant yields
 *      zero rows).
 *
 * `module_templates` is GLOBAL (no tenant column): reads run under the
 * service-role context (catalogue is read-all); the orchestrator never
 * writes templates from this path (writes are a service-role seed job).
 *
 * Immutable: every persisted object is freshly built; inputs are never
 * mutated. No `console.*` — Pino-shape logger only.
 */

import { and, eq, asc } from 'drizzle-orm';
import {
  modules,
  moduleSpecs,
  moduleTemplates,
  withServiceRoleContext,
} from '@borjie/database';
import type {
  ModulesStorePort,
  ModuleSpecsStorePort,
  ModuleTemplatesStorePort,
  ModuleRowSummary,
} from '@borjie/module-orchestrator';
import type { ModuleLifecycleState } from '@borjie/module-orchestrator';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { errMsg, type DatabaseClient } from './shared.js';

// ---------------------------------------------------------------------------
// modules store
// ---------------------------------------------------------------------------

export function createModulesStore(
  db: DatabaseClient,
  logger: PinoLikeLogger,
): ModulesStorePort {
  return {
    async createModule(args) {
      try {
        return await withServiceRoleContext(db, async (tx) => {
          await tx.insert(modules).values({
            id: args.id,
            tenantId: args.tenantId,
            slug: args.slug,
            title: args.title,
            titleSw: args.titleSw,
            templateId: args.templateId,
            vectorNamespace: args.vectorNamespace,
            scopedToolIds: [...args.scopedToolIds],
            createdByUserId: args.createdByUserId,
          });
          return { id: args.id };
        });
      } catch (err) {
        logger.error(
          { tenantId: args.tenantId, err: errMsg(err) },
          'module-spawning: createModule failed',
        );
        throw new Error('module-spawning: failed to persist module row');
      }
    },

    async findModule(args) {
      return await withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select()
          .from(modules)
          .where(and(eq(modules.id, args.id), eq(modules.tenantId, args.tenantId)))
          .limit(1);
        const row = rows[0];
        return row ? toSummary(row) : null;
      });
    },

    async listModules(args) {
      return await withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select()
          .from(modules)
          .where(eq(modules.tenantId, args.tenantId))
          .orderBy(asc(modules.createdAt));
        return rows.map(toSummary);
      });
    },

    async setLifecycleState(args) {
      try {
        await withServiceRoleContext(db, async (tx) => {
          await tx
            .update(modules)
            .set({ lifecycleState: args.state, specId: args.specId, updatedAt: new Date() })
            .where(
              and(eq(modules.id, args.id), eq(modules.tenantId, args.tenantId)),
            );
        });
      } catch (err) {
        logger.error(
          { tenantId: args.tenantId, err: errMsg(err) },
          'module-spawning: setLifecycleState failed',
        );
        throw new Error('module-spawning: failed to transition module state');
      }
    },
  };
}

function toSummary(row: typeof modules.$inferSelect): ModuleRowSummary {
  return {
    id: row.id,
    tenantId: row.tenantId,
    slug: row.slug,
    title: row.title,
    titleSw: row.titleSw,
    templateId: row.templateId,
    specId: row.specId,
    lifecycleState: row.lifecycleState as ModuleLifecycleState,
    vectorNamespace: row.vectorNamespace,
  };
}

// ---------------------------------------------------------------------------
// module_specs store
// ---------------------------------------------------------------------------

export function createModuleSpecsStore(
  db: DatabaseClient,
  logger: PinoLikeLogger,
): ModuleSpecsStorePort {
  return {
    async createSpec(args) {
      try {
        return await withServiceRoleContext(db, async (tx) => {
          await tx.insert(moduleSpecs).values({
            id: args.id,
            moduleId: args.moduleId,
            tenantId: args.tenantId,
            version: args.version,
            specJsonb: { ...args.specJsonb },
            generatedMigrationSql: args.generatedMigrationSql,
            generatedZodValidators: { ...args.generatedZodValidators },
            status: 'draft',
          });
          return { id: args.id };
        });
      } catch (err) {
        logger.error(
          { tenantId: args.tenantId, err: errMsg(err) },
          'module-spawning: createSpec failed',
        );
        throw new Error('module-spawning: failed to persist spec row');
      }
    },

    async findSpec(args) {
      return await withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select({
            id: moduleSpecs.id,
            migrationSql: moduleSpecs.generatedMigrationSql,
          })
          .from(moduleSpecs)
          .where(
            and(
              eq(moduleSpecs.id, args.id),
              eq(moduleSpecs.tenantId, args.tenantId),
            ),
          )
          .limit(1);
        const row = rows[0];
        return row ? { id: row.id, migrationSql: row.migrationSql } : null;
      });
    },

    async markApplied(args) {
      try {
        await withServiceRoleContext(db, async (tx) => {
          // The DB CHECK (module_specs_applied_proof_chk) rejects
          // status='applied' with a NULL filename — so we stamp BOTH
          // together, never one without the other.
          await tx
            .update(moduleSpecs)
            .set({
              status: 'applied',
              appliedMigrationFilename: args.appliedMigrationFilename,
              appliedAt: new Date(),
            })
            .where(
              and(
                eq(moduleSpecs.id, args.id),
                eq(moduleSpecs.tenantId, args.tenantId),
              ),
            );
        });
      } catch (err) {
        logger.error(
          { tenantId: args.tenantId, err: errMsg(err) },
          'module-spawning: markApplied failed',
        );
        throw new Error('module-spawning: failed to mark spec applied');
      }
    },

    async markFailed(args) {
      try {
        await withServiceRoleContext(db, async (tx) => {
          await tx
            .update(moduleSpecs)
            .set({ status: 'failed', error: args.error })
            .where(
              and(
                eq(moduleSpecs.id, args.id),
                eq(moduleSpecs.tenantId, args.tenantId),
              ),
            );
        });
      } catch (err) {
        logger.error(
          { tenantId: args.tenantId, err: errMsg(err) },
          'module-spawning: markFailed failed',
        );
        throw new Error('module-spawning: failed to mark spec failed');
      }
    },
  };
}

// ---------------------------------------------------------------------------
// module_templates store (global catalogue — service-role reads)
// ---------------------------------------------------------------------------

export function createModuleTemplatesStore(
  db: DatabaseClient,
  logger: PinoLikeLogger,
): ModuleTemplatesStorePort {
  return {
    async findTemplate(slug) {
      return await withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select({
            id: moduleTemplates.id,
            slug: moduleTemplates.slug,
            defaultSpec: moduleTemplates.defaultSpec,
          })
          .from(moduleTemplates)
          .where(eq(moduleTemplates.slug, slug))
          .limit(1);
        const row = rows[0];
        if (!row) return null;
        return {
          id: row.id,
          slug: row.slug,
          defaultSpec: { ...(row.defaultSpec ?? {}) },
        };
      }).catch((err) => {
        logger.error(
          { slug, err: errMsg(err) },
          'module-spawning: findTemplate failed',
        );
        return null;
      });
    },

    async listTemplates() {
      return await withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select({
            id: moduleTemplates.id,
            slug: moduleTemplates.slug,
            titleEn: moduleTemplates.titleEn,
            titleSw: moduleTemplates.titleSw,
          })
          .from(moduleTemplates)
          .orderBy(asc(moduleTemplates.slug));
        return rows.map((r) => ({
          id: r.id,
          slug: r.slug,
          titleEn: r.titleEn,
          titleSw: r.titleSw,
        }));
      }).catch((err) => {
        logger.error({ err: errMsg(err) }, 'module-spawning: listTemplates failed');
        return [];
      });
    },
  };
}
