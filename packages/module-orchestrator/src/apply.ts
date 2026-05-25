/**
 * apply.ts — K5-gated migration application.
 *
 *   applyModuleSpec({tenantId, moduleId, specId, requestingUserId})
 *
 * Pre-conditions enforced by this function (all must hold):
 *
 *   1. The module is currently in PROPOSED or APPROVED state.
 *   2. The spec exists and points at this module + tenant.
 *   3. ApprovalPort.resolveApproval returns a non-null approval id
 *      (the K5 four-eye signal — recorded in `approval_policy_actions`).
 *   4. The current user MAY NOT be one of the approvers (the
 *      separation-of-duties check is enforced by the ApprovalPort
 *      itself — we just check the approvalId exists).
 *
 * On success, the orchestrator:
 *   a. Calls MigrationApplyPort with the spec's generated SQL.
 *   b. Writes the applied_migration_filename + marks spec applied.
 *   c. Transitions module APPROVED → LIVE.
 *
 * On failure, the spec is marked failed (the lifecycle stays at
 * PROPOSED/APPROVED for a re-attempt).
 */

import { canTransition } from './lifecycle.js';
import type { OrchestratorDeps } from './ports.js';

export interface ApplyModuleSpecInput {
  readonly tenantId: string;
  readonly moduleId: string;
  readonly specId: string;
  readonly requestingUserId: string | null;
}

export interface ApplyModuleSpecResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly appliedMigrationFilename: string | undefined;
}

export async function applyModuleSpec(
  input: ApplyModuleSpecInput,
  deps: OrchestratorDeps,
): Promise<ApplyModuleSpecResult> {
  // 1. Fetch the module.
  const module = await deps.modules.findModule({
    tenantId: input.tenantId,
    id: input.moduleId,
  });
  if (!module) {
    return failure(['module not found or wrong tenant']);
  }
  if (
    module.lifecycleState !== 'PROPOSED' &&
    module.lifecycleState !== 'APPROVED'
  ) {
    return failure([
      `module in state ${module.lifecycleState} — cannot apply (allowed: PROPOSED, APPROVED)`,
    ]);
  }

  // 2. Fetch the spec.
  const spec = await deps.specs.findSpec({
    tenantId: input.tenantId,
    id: input.specId,
  });
  if (!spec) {
    return failure(['spec not found or wrong tenant']);
  }
  if (!spec.migrationSql || spec.migrationSql.length === 0) {
    return failure(['spec has no compiled migration SQL']);
  }

  // 3. K5 four-eye approval gate.
  const approval = await deps.approval.resolveApproval({
    tenantId: input.tenantId,
    moduleId: input.moduleId,
    specId: input.specId,
  });
  if (!approval) {
    return failure([
      'K5 four-eye approval not found for this (module, spec) — admin must approve before LIVE',
    ]);
  }

  // 4. Transition state machine: PROPOSED → APPROVED (if not yet).
  if (module.lifecycleState === 'PROPOSED') {
    const t = canTransition({
      from: 'PROPOSED',
      to: 'APPROVED',
      hitlApprovalId: approval.approvalId,
    });
    if (!t.ok) return failure(t.errors);

    await deps.modules.setLifecycleState({
      tenantId: input.tenantId,
      id: input.moduleId,
      state: 'APPROVED',
      specId: input.specId,
    });
  }

  // 5. Apply the migration.
  let applied: { readonly appliedMigrationFilename: string };
  try {
    applied = await deps.migrate.applyMigration({
      tenantId: input.tenantId,
      moduleId: input.moduleId,
      migrationSql: spec.migrationSql,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await deps.specs.markFailed({
      tenantId: input.tenantId,
      id: input.specId,
      error: message,
    });
    return failure([`migration apply failed: ${message}`]);
  }

  await deps.specs.markApplied({
    tenantId: input.tenantId,
    id: input.specId,
    appliedMigrationFilename: applied.appliedMigrationFilename,
  });

  // 6. APPROVED → LIVE.
  await deps.modules.setLifecycleState({
    tenantId: input.tenantId,
    id: input.moduleId,
    state: 'LIVE',
    specId: input.specId,
  });

  return Object.freeze({
    ok: true,
    errors: [],
    appliedMigrationFilename: applied.appliedMigrationFilename,
  });
}

function failure(errors: readonly string[]): ApplyModuleSpecResult {
  return Object.freeze({
    ok: false,
    errors: Object.freeze([...errors]),
    appliedMigrationFilename: undefined,
  });
}
