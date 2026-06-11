/**
 * proposal-store.ts — the PROPOSAL persistence adapter for the self-build
 * loop, over the EXISTING module-spawning registry tables (migration 0323):
 *
 *   - `modules`       — one tenant-scoped row per proposed module, born at
 *                       lifecycle_state = 'PROPOSED'.
 *   - `module_specs`  — the compiled spec + dry-run DDL, stored with
 *                       status = 'proposed'. (0323 places NO enum CHECK on
 *                       `status`; only the apply-proof CHECK fires, and a
 *                       'proposed' spec carries no applied_migration_filename
 *                       so the CHECK is trivially satisfied. APPLY is a
 *                       separate, explicitly four-eye-gated step — this store
 *                       NEVER writes status='applied'.)
 *
 * Tenant isolation is belt-and-braces, mirroring the Lane-3 stores: every
 * read/write runs under `withServiceRoleContext` (the self-build driver runs
 * OUT OF BAND — a SUPER_ADMIN operator call, no per-tenant request GUC bound
 * for the service path) AND every query carries an explicit
 * `tenant_id = $tenant` predicate so a wrong-tenant id can never cross.
 *
 * Immutable inputs; Pino-shape logger only (no console). Honest-degrade: a
 * persistence fault throws a non-leaking error the orchestrator surfaces as a
 * degraded result; it never crashes the process.
 */

import { and, eq, desc } from 'drizzle-orm';
import {
  modules,
  moduleSpecs,
  withServiceRoleContext,
} from '@borjie/database';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import type { DatabaseClient } from '../module-spawning/shared.js';

/** The PROPOSED status the self-build loop stores a spec under. */
export const PROPOSAL_SPEC_STATUS = 'proposed' as const;
/** The PROPOSED lifecycle state the module row is born at. */
export const PROPOSAL_MODULE_STATE = 'PROPOSED' as const;
/** The APPROVED lifecycle state recorded when an operator approves a proposal. */
export const APPROVED_MODULE_STATE = 'APPROVED' as const;

export interface PersistProposalArgs {
  readonly moduleId: string;
  readonly specId: string;
  readonly tenantId: string;
  readonly slug: string;
  readonly title: string;
  readonly titleSw: string | null;
  readonly vectorNamespace: string;
  readonly scopedToolIds: readonly string[];
  readonly createdByUserId: string | null;
  readonly specJsonb: Readonly<Record<string, unknown>>;
  readonly generatedMigrationSql: string;
  readonly generatedZodValidators: Readonly<Record<string, unknown>>;
}

export interface ProposalSummary {
  readonly moduleId: string;
  readonly specId: string | null;
  readonly slug: string;
  readonly title: string;
  readonly titleSw: string | null;
  readonly lifecycleState: string;
  readonly specStatus: string | null;
  readonly createdAtMs: number;
}

export interface ProposalDetail extends ProposalSummary {
  readonly generatedMigrationSql: string | null;
  readonly specJsonb: Readonly<Record<string, unknown>> | null;
}

export interface SelfBuildProposalStore {
  /** Persist a NEW module proposal (module PROPOSED + spec 'proposed'). */
  persistProposal(args: PersistProposalArgs): Promise<{ readonly moduleId: string; readonly specId: string }>;
  /** List proposals for a tenant, newest first. */
  listProposals(args: { readonly tenantId: string }): Promise<ReadonlyArray<ProposalSummary>>;
  /** Fetch one proposal (module + latest spec) by module id. */
  getProposal(args: { readonly tenantId: string; readonly moduleId: string }): Promise<ProposalDetail | null>;
  /**
   * Record an operator's APPROVAL of a proposal: flip the module
   * lifecycle_state PROPOSED → APPROVED. This is an APPROVAL RECORD ONLY — it
   * does NOT apply the migration (apply stays a separate four-eye-gated step).
   * Returns false when no PROPOSED row matched (already approved / unknown).
   */
  recordApproval(args: { readonly tenantId: string; readonly moduleId: string }): Promise<boolean>;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toEpochMs(value: Date | string | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

/**
 * Build the self-build proposal store over Drizzle. Every method is
 * tenant-scoped by construction; failures throw non-leaking errors.
 */
export function createSelfBuildProposalStore(
  db: DatabaseClient,
  logger: PinoLikeLogger,
): SelfBuildProposalStore {
  return {
    async persistProposal(args) {
      try {
        return await withServiceRoleContext(db, async (tx) => {
          await tx.insert(modules).values({
            id: args.moduleId,
            tenantId: args.tenantId,
            slug: args.slug,
            title: args.title,
            titleSw: args.titleSw,
            templateId: null,
            specId: args.specId,
            vectorNamespace: args.vectorNamespace,
            scopedToolIds: [...args.scopedToolIds],
            // Born PROPOSED — never DRAFT, never ACTIVE. The operator review
            // gate sits between PROPOSED and any apply.
            lifecycleState: PROPOSAL_MODULE_STATE,
            createdByUserId: args.createdByUserId,
          });
          await tx.insert(moduleSpecs).values({
            id: args.specId,
            moduleId: args.moduleId,
            tenantId: args.tenantId,
            version: 1,
            specJsonb: { ...args.specJsonb },
            generatedMigrationSql: args.generatedMigrationSql,
            generatedZodValidators: { ...args.generatedZodValidators },
            // PROPOSED — explicitly NOT 'applied'. No applied_migration_filename
            // is written, so the apply-proof CHECK is trivially satisfied.
            status: PROPOSAL_SPEC_STATUS,
          });
          return { moduleId: args.moduleId, specId: args.specId };
        });
      } catch (err) {
        logger.error(
          { tenantId: args.tenantId, moduleId: args.moduleId, err: errMsg(err) },
          'self-build: persistProposal failed',
        );
        throw new Error('self-build: failed to persist module proposal');
      }
    },

    async listProposals(args) {
      return await withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select({
            moduleId: modules.id,
            specId: modules.specId,
            slug: modules.slug,
            title: modules.title,
            titleSw: modules.titleSw,
            lifecycleState: modules.lifecycleState,
            specStatus: moduleSpecs.status,
            createdAt: modules.createdAt,
          })
          .from(modules)
          .leftJoin(
            moduleSpecs,
            and(
              eq(moduleSpecs.id, modules.specId),
              eq(moduleSpecs.tenantId, modules.tenantId),
            ),
          )
          .where(eq(modules.tenantId, args.tenantId))
          .orderBy(desc(modules.createdAt));
        return rows.map((r) => ({
          moduleId: r.moduleId,
          specId: r.specId,
          slug: r.slug,
          title: r.title,
          titleSw: r.titleSw,
          lifecycleState: r.lifecycleState,
          specStatus: r.specStatus ?? null,
          createdAtMs: toEpochMs(r.createdAt),
        }));
      }).catch((err) => {
        logger.error(
          { tenantId: args.tenantId, err: errMsg(err) },
          'self-build: listProposals failed',
        );
        return [];
      });
    },

    async getProposal(args) {
      return await withServiceRoleContext(db, async (tx) => {
        const rows = await tx
          .select({
            moduleId: modules.id,
            specId: modules.specId,
            slug: modules.slug,
            title: modules.title,
            titleSw: modules.titleSw,
            lifecycleState: modules.lifecycleState,
            specStatus: moduleSpecs.status,
            specJsonb: moduleSpecs.specJsonb,
            generatedMigrationSql: moduleSpecs.generatedMigrationSql,
            createdAt: modules.createdAt,
          })
          .from(modules)
          .leftJoin(
            moduleSpecs,
            and(
              eq(moduleSpecs.id, modules.specId),
              eq(moduleSpecs.tenantId, modules.tenantId),
            ),
          )
          .where(
            and(
              eq(modules.id, args.moduleId),
              eq(modules.tenantId, args.tenantId),
            ),
          )
          .limit(1);
        const r = rows[0];
        if (!r) return null;
        return {
          moduleId: r.moduleId,
          specId: r.specId,
          slug: r.slug,
          title: r.title,
          titleSw: r.titleSw,
          lifecycleState: r.lifecycleState,
          specStatus: r.specStatus ?? null,
          specJsonb: r.specJsonb ? { ...r.specJsonb } : null,
          generatedMigrationSql: r.generatedMigrationSql ?? null,
          createdAtMs: toEpochMs(r.createdAt),
        };
      }).catch((err) => {
        logger.error(
          { tenantId: args.tenantId, moduleId: args.moduleId, err: errMsg(err) },
          'self-build: getProposal failed',
        );
        return null;
      });
    },

    async recordApproval(args) {
      try {
        return await withServiceRoleContext(db, async (tx) => {
          const updated = await tx
            .update(modules)
            .set({ lifecycleState: APPROVED_MODULE_STATE, updatedAt: new Date() })
            .where(
              and(
                eq(modules.id, args.moduleId),
                eq(modules.tenantId, args.tenantId),
                // Only a PROPOSED row may be approved — an idempotent re-approve
                // or an unknown id matches zero rows.
                eq(modules.lifecycleState, PROPOSAL_MODULE_STATE),
              ),
            )
            .returning({ id: modules.id });
          return updated.length > 0;
        });
      } catch (err) {
        logger.error(
          { tenantId: args.tenantId, moduleId: args.moduleId, err: errMsg(err) },
          'self-build: recordApproval failed',
        );
        throw new Error('self-build: failed to record proposal approval');
      }
    },
  };
}
