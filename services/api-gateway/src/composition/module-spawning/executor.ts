/**
 * module-spawning/executor.ts — THE EXECUTOR (MigrationApplyPort).
 *
 * Applies a spawned module's generated, RLS-injected DDL against the
 * tenant DB. This is the single seam where runtime-generated SQL touches
 * Postgres, so it is the strongest part of the wall.
 *
 * applyMigration({tenantId, moduleId, specId, migrationSql}) — EXACT order:
 *
 *   1. assertTenantIdShape(tenantId)  — fail-closed on a malformed id.
 *   2. RE-VALIDATE validateGeneratedDdl({ tenantId, migrationSql }) — the
 *      STORED spec is NEVER trusted; nothing unvalidated reaches Postgres.
 *      `validateGeneratedDdl` internally re-runs HARD RULE 1 (allowlist:
 *      reject DROP/ALTER/non-namespaced tables/…) AND HARD RULE 2 (per-
 *      table canonical FORCE-RLS coverage).
 *   3. RE-CHECK four-eye via assertApplyApproved bound to sha256(SQL) AND
 *      to the REQUESTED specId (passed in by the orchestrator — NOT the one
 *      read back from the approval payload, which would be a tautology):
 *      proposer != approver, bound to THIS spec's SQL hash + spec id, not
 *      already executed. If not approved, throw BEFORE opening the txn.
 *   4. Build the on-disk filename from the injected clock:
 *      `<tenantId>/<compactIso>_<moduleId>.sql`.
 *   5. Execute in a SINGLE transaction:
 *        a. bind the canonical `app.current_tenant_id` GUC txn-locally FIRST
 *           (set_config(..., true) — cannot leak to the pooled connection);
 *        b. ATOMIC ONE-SHOT CONSUME — compare-and-set the approval:
 *           UPDATE sovereign_approvals SET executed = true
 *             WHERE action_id = $1 AND executed = false RETURNING action_id.
 *           If it does NOT return EXACTLY one row, the approval was already
 *           consumed (or lost the race) ⇒ THROW (replay refused). The CAS
 *           write satisfies the canonical tenant-isolation RLS policy because
 *           the row's tenant_id == the GUC we just bound;
 *        c. run the migration (sql.raw).
 *      Postgres DDL is transactional, so any throw — including the CAS
 *      "already executed" throw OR a DDL failure — rolls back ALL emitted
 *      statements, INCLUDING the consume. A DDL failure therefore
 *      un-consumes the approval (a corrected retry can still claim it); a
 *      crash after the DDL but before COMMIT also rolls the consume back.
 *      Only a successful COMMIT makes the one-shot consume durable.
 *   6. ONLY AFTER commit, write the SQL to the on-disk artifact. A
 *      post-commit disk failure is logged loudly (the DB change already
 *      landed) and the filename is still returned.
 *   7. Return { appliedMigrationFilename }.
 *
 * Immutable; comprehensive try/catch with non-leaking errors. Pino-shape
 * logger only — no `console.*`.
 */

import { sql } from 'drizzle-orm';
import {
  assertTenantIdShape,
  validateGeneratedDdl,
  assertApplyApproved,
  type MigrationApplyPort,
  type FourEyeApprovalView,
} from '@borjie/module-orchestrator';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { fetchApprovalView } from './approval.js';
import {
  compactIsoTimestamp,
  errMsg,
  rowsOf,
  specSqlHash,
  type DatabaseClient,
  type ModuleSpawnClock,
  type MigrationArtifactWriter,
} from './shared.js';

export interface ExecutorDeps {
  readonly db: DatabaseClient;
  readonly logger: PinoLikeLogger;
  readonly clock: ModuleSpawnClock;
  readonly artifactWriter: MigrationArtifactWriter;
}

export function createMigrationExecutor(deps: ExecutorDeps): MigrationApplyPort {
  return {
    async applyMigration(args) {
      const { tenantId, moduleId, specId, migrationSql } = args;

      // 1. Fail-closed on a malformed tenant id BEFORE any DB work.
      assertTenantIdShape(tenantId);

      // 2. RE-VALIDATE the stored SQL — never trust the persisted row.
      const validation = validateGeneratedDdl({ tenantId, migrationSql });
      if (!validation.ok) {
        throw new Error(
          `module-spawning: stored migration failed re-validation — ${validation.errors.join('; ')}`,
        );
      }

      // 3. RE-CHECK four-eye, bound to THIS exact spec SQL hash AND the
      //    REQUESTED specId. Returns the approval's action_id so the txn-local
      //    CAS consume can target it precisely. Throws (fail-closed) on reject.
      const approvalActionId = await assertFourEye(
        deps,
        tenantId,
        moduleId,
        specId,
        migrationSql,
      );

      // 4. Build the on-disk artifact path from the injected clock.
      const filename = buildArtifactPath(deps.clock, tenantId, moduleId);

      // 5. Apply in a single transaction: bind the canonical GUC FIRST, then
      //    atomically CONSUME the one-shot approval (CAS), then run the DDL.
      //    A throw anywhere rolls back ALL of it — including the consume — so
      //    a DDL failure un-consumes the approval (retryable) and only a
      //    successful COMMIT makes the one-shot durable.
      try {
        await deps.db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
          );
          await consumeApprovalOneShot(tx, approvalActionId);
          await tx.execute(sql.raw(migrationSql));
        });
      } catch (err) {
        deps.logger.error(
          { tenantId, moduleId, err: errMsg(err) },
          'module-spawning: migration apply transaction failed — rolled back (approval un-consumed)',
        );
        throw new Error('module-spawning: migration apply failed (rolled back)');
      }

      // 6. Post-commit: persist the audit artifact. A disk failure here
      //    does NOT undo the committed DB change — log loudly, return the
      //    filename anyway.
      try {
        await deps.artifactWriter.write(filename, migrationSql);
      } catch (err) {
        deps.logger.error(
          { tenantId, moduleId, filename, err: errMsg(err) },
          'module-spawning: DB committed but on-disk audit artifact write FAILED — ' +
            'the migration is applied; the artifact is missing and must be backfilled',
        );
      }

      // 7. Return the filename the spec row is stamped with.
      return { appliedMigrationFilename: filename };
    },
  };
}

/** A single row of the one-shot CAS `RETURNING action_id`. */
interface ConsumeCasRow {
  readonly action_id: string;
}

/**
 * ATOMIC one-shot consume — compare-and-set the approval from
 * `executed = false` to `executed = true`, returning the consumed
 * action_id. Runs INSIDE the apply transaction (the canonical
 * `app.current_tenant_id` GUC was bound first, so the canonical
 * `sovereign_approvals_tenant_isolation` RLS policy admits the write on the
 * approval row whose tenant_id == the bound tenant). If the CAS does NOT
 * affect EXACTLY one row, the approval was already executed (or lost the
 * race) — THROW so the whole txn rolls back and the replay is refused.
 */
async function consumeApprovalOneShot(
  tx: DatabaseClient,
  approvalActionId: string,
): Promise<void> {
  const result = await tx.execute(
    sql`
      UPDATE sovereign_approvals
      SET executed = true
      WHERE action_id = ${approvalActionId}
        AND executed = false
      RETURNING action_id
    `,
  );
  const rows = rowsOf<ConsumeCasRow>(result);
  if (rows.length !== 1) {
    throw new Error(
      'module-spawning: four-eye approval already executed (one-shot consumed — replay refused)',
    );
  }
}

/**
 * Fetch + re-derive the four-eye separation-of-duties invariant, bound to
 * the exact SQL hash AND the requested specId. Throws (fail-closed) when the
 * approval is missing, self-approved, stale, spec-mismatched, or already
 * executed. Returns the approval's action_id for the txn-local CAS consume.
 */
async function assertFourEye(
  deps: ExecutorDeps,
  tenantId: string,
  moduleId: string,
  specId: string,
  migrationSql: string,
): Promise<string> {
  const view: FourEyeApprovalView | null = await fetchApprovalView(
    deps.db,
    tenantId,
    moduleId,
    deps.logger,
  );
  const verdict = assertApplyApproved({
    tenantId,
    moduleId,
    // The REQUESTED specId (from the orchestrator) — NOT the one read back
    // from the approval payload. This is what makes the gate's
    // `payload.specId === input.specId` binding check genuinely fire: an
    // approval bound to a different spec is rejected, not tautologically
    // accepted.
    specId,
    specSqlHash: specSqlHash(migrationSql),
    approval: view,
  });
  if (!verdict.ok || !view) {
    deps.logger.warn(
      { tenantId, moduleId, errors: verdict.errors },
      'module-spawning: four-eye re-check REJECTED apply',
    );
    throw new Error(
      `module-spawning: four-eye approval check failed — ${verdict.errors.join('; ')}`,
    );
  }
  return view.action.id;
}

/** Build `<tenantId>/<compactIso>_<moduleId>.sql` (relative path). */
function buildArtifactPath(
  clock: ModuleSpawnClock,
  tenantId: string,
  moduleId: string,
): string {
  const ts = compactIsoTimestamp(clock.now());
  const safeModuleId = moduleId.replace(/[^A-Za-z0-9_-]/g, '_');
  return `${tenantId}/${ts}_${safeModuleId}.sql`;
}
