/**
 * orchestrator.ts — the self-BUILDING loop (operator-gated, propose-only).
 *
 * THE GAP THIS CLOSES: `@borjie/internal-software-generator` (spec → generate
 * → wire → verify → lifecycle) and `@borjie/module-spec-engine` (compile /
 * validate / dry-run) are fully DARK — they have no non-test caller. The MD
 * can DETECT a capability gap (wave 2 W2e records it into the gap register /
 * md_commitments) but cannot yet ACT on it to BUILD a capability.
 *
 * WHAT THIS DOES (and only this): given a recorded gap, it
 *   1. DERIVES a grammar-valid `ModuleSpec` from the gap (gap-to-spec, pure);
 *   2. VALIDATES it through `module-spec-engine.validateSpec`;
 *   3. DRY-RUNS the compile through `module-spec-engine.previewMigration` +
 *      `compileSpec`, then injects + verifies the canonical FORCE-RLS block via
 *      `@borjie/module-orchestrator` (the orchestrator owns RLS, never the
 *      author);
 *   4. STORES the result as a PROPOSAL (module PROPOSED + spec 'proposed') in
 *      the migration-0323 registry.
 *
 * WHAT THIS NEVER DOES: it NEVER applies the migration to the running system.
 * No DDL touches Postgres here. APPLY is a separate, explicitly four-eye-gated
 * step. There is no autonomous code application anywhere on this path.
 *
 * Honest-degrade: if an engine dependency is missing / unloadable, or the
 * derived spec fails to validate/compile, the driver returns a structured
 * `{ ok: false, reason }` — it never throws past the route boundary and never
 * crashes boot. Pino-shape logger only (no console).
 */

import {
  validateSpec,
  compileSpec,
  previewMigration,
  type ModuleSpec,
} from '@borjie/module-spec-engine';
import {
  buildCanonicalRlsBlock,
  validateGeneratedDdl,
  verifyRlsForced,
} from '@borjie/module-orchestrator';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import {
  deriveModulePlanFromGap,
  type RecordedGap,
} from './gap-to-spec.js';
import type {
  SelfBuildProposalStore,
  ProposalSummary,
  ProposalDetail,
} from './proposal-store.js';

/** Stable-prefix id generator — crypto UUID, never Math.random. */
export interface SelfBuildIdGen {
  newId(prefix: 'mod' | 'mspec'): string;
}

export interface SelfBuildOrchestratorDeps {
  readonly store: SelfBuildProposalStore;
  readonly ids: SelfBuildIdGen;
  readonly logger: PinoLikeLogger;
}

export interface DriveGapInput {
  readonly gap: RecordedGap;
  /** The SUPER_ADMIN operator who drove the proposal (forensic replay). */
  readonly driverUserId: string | null;
  /** Tool ids the proposed module's juniors may reach. Defaults to []. */
  // `| undefined` so a zod `.optional()` parse result passes verbatim under
  // exactOptionalPropertyTypes.
  readonly scopedToolIds?: readonly string[] | undefined;
}

export type DriveGapResult =
  | {
      readonly ok: true;
      readonly moduleId: string;
      readonly specId: string;
      readonly moduleSlug: string;
      readonly specStatus: 'proposed';
      /** Dry-run shape — the operator reviews this BEFORE any apply. */
      readonly dryRun: {
        readonly tableCount: number;
        readonly workflowCount: number;
        readonly uiSectionCount: number;
        readonly moneyFieldCount: number;
      };
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly errors: readonly string[];
    };

function degrade(reason: string, errors: readonly string[] = []): DriveGapResult {
  return Object.freeze({ ok: false, reason, errors: Object.freeze([...errors]) });
}

/**
 * Inject + verify the canonical FORCE-RLS block onto the compiler's bare
 * table+index body and prove the result passes BOTH the DDL allowlist and the
 * per-table RLS-forced coverage check. The compiler emits NO RLS — the
 * orchestrator owns it, so a spec author can never control tenant isolation.
 * Returns the gated SQL or the failure reasons.
 */
function gateMigrationSql(
  bodySql: string,
  tableNames: readonly string[],
  tenantId: string,
): { readonly ok: true; readonly sql: string } | { readonly ok: false; readonly errors: readonly string[] } {
  try {
    if (tableNames.length === 0) {
      return { ok: false, errors: ['compile produced no tenant tables'] };
    }
    const rls = buildCanonicalRlsBlock(tenantId, tableNames);
    const finalSql = `${bodySql}\n\n${rls}`;
    const allowlist = validateGeneratedDdl({ tenantId, migrationSql: finalSql });
    if (!allowlist.ok) return { ok: false, errors: allowlist.errors };
    const rlsForced = verifyRlsForced(finalSql, tableNames, tenantId);
    if (!rlsForced.ok) return { ok: false, errors: rlsForced.errors };
    return { ok: true, sql: finalSql };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [`RLS gate failed: ${message}`] };
  }
}

/**
 * The self-build orchestrator: drive ONE recorded gap to a stored PROPOSAL via
 * a dry-run. Composes the EXISTING engines; applies NOTHING.
 */
export interface SelfBuildOrchestrator {
  driveGapToProposal(input: DriveGapInput): Promise<DriveGapResult>;
  listProposals(tenantId: string): Promise<ReadonlyArray<ProposalSummary>>;
  getProposal(tenantId: string, moduleId: string): Promise<ProposalDetail | null>;
  recordApproval(tenantId: string, moduleId: string): Promise<boolean>;
}

export function createSelfBuildOrchestrator(
  deps: SelfBuildOrchestratorDeps,
): SelfBuildOrchestrator {
  return {
    async driveGapToProposal(input) {
      const { gap } = input;
      if (!gap || !gap.tenantId || !gap.id || !gap.gapKind) {
        return degrade('invalid_gap', ['a recorded gap with id/tenantId/gapKind is required']);
      }

      // 1. DERIVE a grammar-valid spec from the gap (pure, generative).
      let plan: ReturnType<typeof deriveModulePlanFromGap>;
      try {
        plan = deriveModulePlanFromGap(gap);
      } catch (e) {
        deps.logger.error(
          { tenantId: gap.tenantId, gapId: gap.id, err: e instanceof Error ? e.message : String(e) },
          'self-build: gap-to-spec derivation failed',
        );
        return degrade('derivation_failed', [e instanceof Error ? e.message : String(e)]);
      }

      // 2. VALIDATE through the module-spec-engine grammar.
      const validated = validateSpec(plan.spec);
      if (!validated.ok || !validated.spec) {
        return degrade('spec_invalid', validated.errors);
      }
      const spec: ModuleSpec = validated.spec;

      // 3. DRY-RUN the compile (NEVER touches the DB) + gate RLS.
      const dry = previewMigration(spec, gap.tenantId);
      if (!dry.ok) {
        return degrade('compile_failed', dry.errors);
      }
      const compiled = compileSpec(spec, gap.tenantId);
      if (!compiled.ok) {
        return degrade('compile_failed', compiled.errors);
      }
      const gated = gateMigrationSql(compiled.migrationSql, compiled.tableNames, gap.tenantId);
      if (!gated.ok) {
        return degrade('rls_gate_failed', gated.errors);
      }

      // 4. STORE as a PROPOSAL (module PROPOSED + spec 'proposed'). NO apply.
      const moduleId = deps.ids.newId('mod');
      const specId = deps.ids.newId('mspec');
      const vectorNamespace = `tnt:${gap.tenantId}:mod:${moduleId}`;
      try {
        await deps.store.persistProposal({
          moduleId,
          specId,
          tenantId: gap.tenantId,
          slug: plan.moduleSlug,
          title: plan.title,
          titleSw: plan.titleSw,
          vectorNamespace,
          scopedToolIds: input.scopedToolIds ?? [],
          createdByUserId: input.driverUserId,
          specJsonb: spec as unknown as Readonly<Record<string, unknown>>,
          generatedMigrationSql: gated.sql,
          generatedZodValidators: compiled.zodValidators as Readonly<Record<string, unknown>>,
        });
      } catch (e) {
        return degrade('persist_failed', [e instanceof Error ? e.message : String(e)]);
      }

      deps.logger.info(
        { tenantId: gap.tenantId, gapId: gap.id, moduleId, specId, slug: plan.moduleSlug },
        'self-build: gap driven to PROPOSAL (dry-run, never applied)',
      );

      return Object.freeze({
        ok: true as const,
        moduleId,
        specId,
        moduleSlug: plan.moduleSlug,
        specStatus: 'proposed' as const,
        dryRun: Object.freeze({
          tableCount: dry.tableCount,
          workflowCount: dry.workflowCount,
          uiSectionCount: dry.uiSectionCount,
          moneyFieldCount: dry.moneyFieldCount,
        }),
      });
    },

    listProposals(tenantId) {
      return deps.store.listProposals({ tenantId });
    },

    getProposal(tenantId, moduleId) {
      return deps.store.getProposal({ tenantId, moduleId });
    },

    recordApproval(tenantId, moduleId) {
      return deps.store.recordApproval({ tenantId, moduleId });
    },
  };
}
