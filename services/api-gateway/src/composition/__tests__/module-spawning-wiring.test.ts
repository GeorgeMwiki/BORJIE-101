/**
 * module-spawning-wiring.test.ts — Lane 3 executor security tests.
 *
 * The crown-jewel seam: runtime-generated DDL touching Postgres. These
 * tests use a FAKE db that records every executed statement, a fake
 * clock, a fake `sovereign_approvals` row, and an injected artifact
 * writer (the real fs is NEVER touched).
 *
 * Asserts:
 *   (a) set_config is the FIRST executed statement of the apply txn and
 *       binds app.current_tenant_id to the given tenantId.
 *   (b) the validated DDL runs in the SAME transaction as the GUC bind.
 *   (c) a tampered migrationSql (DROP TABLE / ALTER / non-tenant_mod_
 *       table) is REJECTED by validateGeneratedDdl and the migration
 *       body is NEVER executed.
 *   (d) a throw during apply does NOT write the disk artifact and
 *       surfaces as a failure.
 *   (e) a missing four-eye record, or proposer == approver, is rejected.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { buildCanonicalRlsBlock } from '@borjie/module-orchestrator';
import {
  createMigrationExecutor,
  type ModuleSpawnClock,
  type MigrationArtifactWriter,
} from '../module-spawning-wiring.js';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';

const TENANT = 'acme_mining';
const MODULE_ID = 'mod_0001';
const SPEC_ID = 'mspec_0001';

const silentLogger: PinoLikeLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const fixedClock: ModuleSpawnClock = {
  now: () => new Date('2026-06-09T14:15:02.000Z'),
};

// ---------------------------------------------------------------------------
// SQL fixtures (mirrors the ddl-guard happy-path builder).
// ---------------------------------------------------------------------------

function ns(slug: string): string {
  return `tenant_mod_${TENANT}_${slug}`;
}

function buildAcceptedDdl(slug = 'assay'): string {
  const table = ns(slug);
  const create = [
    `CREATE TABLE IF NOT EXISTS ${table} (`,
    '  id                  TEXT PRIMARY KEY,',
    '  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,',
    '  module_id           TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,',
    '  display_name        TEXT NOT NULL,',
    "  lifecycle_state     TEXT NOT NULL DEFAULT 'active',",
    '  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
    '  metadata            JSONB',
    ');',
  ].join('\n');
  return [
    `-- Generated module migration for ${TENANT} / ${slug}`,
    create,
    buildCanonicalRlsBlock(TENANT, [table]),
  ].join('\n\n');
}

function specSqlHash(sql: string): string {
  return `sha256:${createHash('sha256').update(sql, 'utf-8').digest('hex')}`;
}

// ---------------------------------------------------------------------------
// Fake db — records executed statements; serves a fake sovereign_approvals
// row. `db.transaction(fn)` runs fn against a recording tx whose `execute`
// returns the approval rows for the sovereign_approvals SELECT.
// ---------------------------------------------------------------------------

interface ApprovalFixture {
  readonly status: string;
  readonly proposerUserId: string;
  readonly approverIds: readonly string[];
  readonly toolName: string;
  readonly tenantId: string | null;
  readonly specSqlHash: string;
  readonly moduleId: string;
  readonly specId: string;
  readonly executed: boolean;
}

function buildApprovalRow(fix: ApprovalFixture) {
  return {
    action_id: 'appr_1',
    tenant_id: fix.tenantId,
    proposer_user_id: fix.proposerUserId,
    tool_name: fix.toolName,
    payload: {
      specSqlHash: fix.specSqlHash,
      moduleId: fix.moduleId,
      specId: fix.specId,
    },
    status: fix.status,
    signatures: fix.approverIds.map((id) => ({
      approverUserId: id,
      verdict: 'approve' as const,
    })),
    // The REAL one-shot column (migration 0324). `toView` reads THIS, not
    // payload.executed (which nothing writes).
    executed: fix.executed,
  };
}

interface RecordedStmt {
  readonly text: string;
  readonly inTransaction: boolean;
}

/**
 * Fake db with one-shot CAS + rollback semantics.
 *
 * - A SELECT from sovereign_approvals returns the read-view approval rows.
 * - An `UPDATE sovereign_approvals SET executed = true ... RETURNING
 *   action_id` is the atomic compare-and-set consume: it claims the approval
 *   IF NOT already consumed (committed OR pending-in-this-txn) and returns
 *   exactly one row; otherwise it returns zero rows. Pending consumes are
 *   COMMITTED when the txn callback resolves and REVERTED when it throws —
 *   mirroring transactional `RETURNING` rollback. A reverted consume can be
 *   claimed again by a corrected retry.
 */
function makeFakeDb(opts: {
  readonly approvalRows: ReadonlyArray<ReturnType<typeof buildApprovalRow>>;
  readonly throwOnMigrationBody?: boolean;
}) {
  const recorded: RecordedStmt[] = [];
  let currentTxStatements: RecordedStmt[] | null = null;
  // Durably consumed action ids (post-commit).
  const consumed = new Set<string>();
  // Consumed-in-the-current-txn but not yet committed.
  let pendingConsumed: Set<string> | null = null;

  function classify(query: unknown): string {
    return JSON.stringify(query);
  }

  function isCasConsume(text: string): boolean {
    // The CAS one-shot consume is the UPDATE ... RETURNING — distinguished
    // from the read-view SELECT (which also names the `executed` column) by
    // the UPDATE verb.
    return (
      text.includes('sovereign_approvals') &&
      text.includes('UPDATE') &&
      text.includes('RETURNING')
    );
  }

  /** CAS: claim each not-yet-consumed approval row; return claimed ids. */
  function runCasConsume(): { rows: Array<{ action_id: string }> } {
    const claimed: Array<{ action_id: string }> = [];
    for (const row of opts.approvalRows) {
      const id = row.action_id;
      const alreadyConsumed =
        consumed.has(id) || (pendingConsumed?.has(id) ?? false);
      // The row's own `executed` flag also gates the CAS (executed = false).
      const rowExecuted = row.executed === true;
      if (!alreadyConsumed && !rowExecuted) {
        pendingConsumed?.add(id);
        claimed.push({ action_id: id });
      }
    }
    return { rows: claimed };
  }

  function makeExecute(inTx: boolean) {
    return async (query: unknown) => {
      const text = classify(query);
      const stmt: RecordedStmt = { text, inTransaction: inTx };
      recorded.push(stmt);
      if (inTx && currentTxStatements) currentTxStatements.push(stmt);
      // The CAS one-shot consume (UPDATE ... RETURNING) — must precede the
      // plain SELECT branch since both mention sovereign_approvals.
      if (isCasConsume(text)) {
        return runCasConsume();
      }
      if (text.includes('sovereign_approvals')) {
        return { rows: opts.approvalRows };
      }
      if (
        opts.throwOnMigrationBody &&
        text.includes('CREATE TABLE') &&
        !text.includes('set_config')
      ) {
        throw new Error('simulated postgres failure mid-apply');
      }
      return { rows: [] };
    };
  }

  const db = {
    async transaction(fn: (tx: unknown) => Promise<unknown>) {
      const txStatements: RecordedStmt[] = [];
      const prev = currentTxStatements;
      const prevPending = pendingConsumed;
      const txPending = new Set<string>();
      currentTxStatements = txStatements;
      pendingConsumed = txPending;
      const tx = { execute: makeExecute(true) };
      try {
        const out = await fn(tx);
        // COMMIT — promote this txn's pending consumes to durable.
        for (const id of txPending) consumed.add(id);
        return out;
      } catch (err) {
        // ROLLBACK — discard this txn's pending consumes (un-consume).
        throw err;
      } finally {
        currentTxStatements = prev;
        pendingConsumed = prevPending;
        lastTxStatements = txStatements;
      }
    },
    execute: makeExecute(false),
  };

  let lastTxStatements: RecordedStmt[] = [];

  return {
    db: db as never,
    recorded,
    consumed,
    applyTxStatements: () => lastTxStatements,
  };
}

function makeRecordingWriter(): {
  readonly writer: MigrationArtifactWriter;
  readonly writes: Array<{ path: string; sql: string }>;
} {
  const writes: Array<{ path: string; sql: string }> = [];
  return {
    writer: {
      async write(relativePath, migrationSql) {
        writes.push({ path: relativePath, sql: migrationSql });
      },
    },
    writes,
  };
}

// ---------------------------------------------------------------------------

describe('module-spawning executor (MigrationApplyPort)', () => {
  let goodSql: string;
  let goodHash: string;
  let approvedRow: ReturnType<typeof buildApprovalRow>;

  beforeEach(() => {
    goodSql = buildAcceptedDdl();
    goodHash = specSqlHash(goodSql);
    approvedRow = buildApprovalRow({
      status: 'approved',
      proposerUserId: 'user_proposer',
      approverIds: ['user_admin_a', 'user_admin_b'],
      toolName: 'module.apply',
      tenantId: TENANT,
      specSqlHash: goodHash,
      moduleId: MODULE_ID,
      specId: SPEC_ID,
      executed: false,
    });
  });

  it('(a) binds set_config(app.current_tenant_id) as the FIRST txn statement', async () => {
    const fake = makeFakeDb({ approvalRows: [approvedRow] });
    const { writer } = makeRecordingWriter();
    const executor = createMigrationExecutor({
      db: fake.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });

    await executor.applyMigration({
      tenantId: TENANT,
      moduleId: MODULE_ID,
      specId: SPEC_ID,
      migrationSql: goodSql,
    });

    const txStmts = fake.applyTxStatements();
    expect(txStmts.length).toBeGreaterThanOrEqual(2);
    expect(txStmts[0]!.text).toContain('set_config');
    expect(txStmts[0]!.text).toContain('app.current_tenant_id');
    expect(txStmts[0]!.text).toContain(TENANT);
  });

  it('(b) runs the validated DDL in the SAME transaction as the GUC bind', async () => {
    const fake = makeFakeDb({ approvalRows: [approvedRow] });
    const { writer } = makeRecordingWriter();
    const executor = createMigrationExecutor({
      db: fake.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });

    await executor.applyMigration({
      tenantId: TENANT,
      moduleId: MODULE_ID,
      specId: SPEC_ID,
      migrationSql: goodSql,
    });

    const txStmts = fake.applyTxStatements();
    const setConfigIdx = txStmts.findIndex((s) => s.text.includes('set_config'));
    const ddlIdx = txStmts.findIndex((s) => s.text.includes('CREATE TABLE'));
    expect(setConfigIdx).toBe(0);
    expect(ddlIdx).toBeGreaterThan(setConfigIdx);
    // The DDL ran inside a transaction.
    expect(txStmts[ddlIdx]!.inTransaction).toBe(true);
  });

  it('(c) REJECTS a tampered migration (injected DROP TABLE) and never executes its body', async () => {
    const tampered = goodSql.replace(
      '-- Generated module migration',
      'DROP TABLE tenants;\n-- Generated module migration',
    );
    const fake = makeFakeDb({ approvalRows: [approvedRow] });
    const { writer, writes } = makeRecordingWriter();
    const executor = createMigrationExecutor({
      db: fake.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });

    await expect(
      executor.applyMigration({
        tenantId: TENANT,
        moduleId: MODULE_ID,
        specId: SPEC_ID,
        migrationSql: tampered,
      }),
    ).rejects.toThrow(/re-validation/i);

    // The migration body never reached Postgres.
    const ranDrop = fake.recorded.some((s) => s.text.includes('DROP TABLE'));
    expect(ranDrop).toBe(false);
    expect(writes.length).toBe(0);
  });

  it('(c2) REJECTS an ALTER on a core table', async () => {
    const tampered = goodSql.replace(
      '-- Generated module migration',
      'ALTER TABLE tenants ADD COLUMN pwn TEXT;\n-- Generated module migration',
    );
    const fake = makeFakeDb({ approvalRows: [approvedRow] });
    const { writer } = makeRecordingWriter();
    const executor = createMigrationExecutor({
      db: fake.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });

    await expect(
      executor.applyMigration({
        tenantId: TENANT,
        moduleId: MODULE_ID,
        specId: SPEC_ID,
        migrationSql: tampered,
      }),
    ).rejects.toThrow(/re-validation/i);
    expect(fake.recorded.some((s) => s.text.includes('ALTER TABLE tenants'))).toBe(
      false,
    );
  });

  it('(c3) REJECTS a CREATE TABLE outside the tenant_mod_ namespace', async () => {
    const badSql = buildAcceptedDdl().replace(
      `tenant_mod_${TENANT}_assay`,
      'public_secrets',
    );
    const fake = makeFakeDb({ approvalRows: [approvedRow] });
    const { writer } = makeRecordingWriter();
    const executor = createMigrationExecutor({
      db: fake.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });

    await expect(
      executor.applyMigration({
        tenantId: TENANT,
        moduleId: MODULE_ID,
        specId: SPEC_ID,
        migrationSql: badSql,
      }),
    ).rejects.toThrow(/re-validation/i);
    expect(fake.recorded.some((s) => s.text.includes('public_secrets'))).toBe(false);
  });

  it('(d) a throw mid-apply does NOT write the disk artifact and surfaces as a failure', async () => {
    const fake = makeFakeDb({
      approvalRows: [approvedRow],
      throwOnMigrationBody: true,
    });
    const { writer, writes } = makeRecordingWriter();
    const executor = createMigrationExecutor({
      db: fake.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });

    await expect(
      executor.applyMigration({
        tenantId: TENANT,
        moduleId: MODULE_ID,
        specId: SPEC_ID,
        migrationSql: goodSql,
      }),
    ).rejects.toThrow(/rolled back/i);
    expect(writes.length).toBe(0);
  });

  it('(e) REJECTS when no four-eye approval record exists', async () => {
    const fake = makeFakeDb({ approvalRows: [] });
    const { writer, writes } = makeRecordingWriter();
    const executor = createMigrationExecutor({
      db: fake.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });

    await expect(
      executor.applyMigration({
        tenantId: TENANT,
        moduleId: MODULE_ID,
        specId: SPEC_ID,
        migrationSql: goodSql,
      }),
    ).rejects.toThrow(/four-eye/i);
    // The DDL body never executed (no approval).
    expect(fake.recorded.some((s) => s.text.includes('CREATE TABLE'))).toBe(false);
    expect(writes.length).toBe(0);
  });

  it('(e2) REJECTS self-approval (proposer == approver)', async () => {
    const selfApproved = buildApprovalRow({
      status: 'approved',
      proposerUserId: 'user_admin_a',
      approverIds: ['user_admin_a'],
      toolName: 'module.apply',
      tenantId: TENANT,
      specSqlHash: goodHash,
      moduleId: MODULE_ID,
      specId: SPEC_ID,
      executed: false,
    });
    const fake = makeFakeDb({ approvalRows: [selfApproved] });
    const { writer, writes } = makeRecordingWriter();
    const executor = createMigrationExecutor({
      db: fake.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });

    await expect(
      executor.applyMigration({
        tenantId: TENANT,
        moduleId: MODULE_ID,
        specId: SPEC_ID,
        migrationSql: goodSql,
      }),
    ).rejects.toThrow(/four-eye/i);
    expect(fake.recorded.some((s) => s.text.includes('CREATE TABLE'))).toBe(false);
    expect(writes.length).toBe(0);
  });

  it('(e3) REJECTS a stale approval bound to a different spec SQL hash', async () => {
    const staleHashRow = buildApprovalRow({
      status: 'approved',
      proposerUserId: 'user_proposer',
      approverIds: ['user_admin_a', 'user_admin_b'],
      toolName: 'module.apply',
      tenantId: TENANT,
      specSqlHash: 'sha256:STALE_DIFFERENT_HASH',
      moduleId: MODULE_ID,
      specId: SPEC_ID,
      executed: false,
    });
    const fake = makeFakeDb({ approvalRows: [staleHashRow] });
    const { writer } = makeRecordingWriter();
    const executor = createMigrationExecutor({
      db: fake.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });

    await expect(
      executor.applyMigration({
        tenantId: TENANT,
        moduleId: MODULE_ID,
        specId: SPEC_ID,
        migrationSql: goodSql,
      }),
    ).rejects.toThrow(/four-eye/i);
    expect(fake.recorded.some((s) => s.text.includes('CREATE TABLE'))).toBe(false);
  });

  it('(e4) REJECTS an already-executed (one-shot consumed) approval', async () => {
    const consumed = buildApprovalRow({
      status: 'approved',
      proposerUserId: 'user_proposer',
      approverIds: ['user_admin_a', 'user_admin_b'],
      toolName: 'module.apply',
      tenantId: TENANT,
      specSqlHash: goodHash,
      moduleId: MODULE_ID,
      specId: SPEC_ID,
      executed: true,
    });
    const fake = makeFakeDb({ approvalRows: [consumed] });
    const { writer } = makeRecordingWriter();
    const executor = createMigrationExecutor({
      db: fake.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });

    await expect(
      executor.applyMigration({
        tenantId: TENANT,
        moduleId: MODULE_ID,
        specId: SPEC_ID,
        migrationSql: goodSql,
      }),
    ).rejects.toThrow(/four-eye/i);
  });

  it('on success: writes the audit artifact + returns a clock-stamped filename', async () => {
    const fake = makeFakeDb({ approvalRows: [approvedRow] });
    const { writer, writes } = makeRecordingWriter();
    const executor = createMigrationExecutor({
      db: fake.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });

    const result = await executor.applyMigration({
      tenantId: TENANT,
      moduleId: MODULE_ID,
      specId: SPEC_ID,
      migrationSql: goodSql,
    });

    expect(result.appliedMigrationFilename).toBe(
      `${TENANT}/2026-06-09T141502Z_${MODULE_ID}.sql`,
    );
    expect(writes.length).toBe(1);
    expect(writes[0]!.path).toBe(result.appliedMigrationFilename);
    expect(writes[0]!.sql).toBe(goodSql);
  });

  it('a post-commit disk-write failure still returns the filename (DB already committed)', async () => {
    const fake = makeFakeDb({ approvalRows: [approvedRow] });
    const failingWriter: MigrationArtifactWriter = {
      async write() {
        throw new Error('disk full');
      },
    };
    const executor = createMigrationExecutor({
      db: fake.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: failingWriter,
    });

    const result = await executor.applyMigration({
      tenantId: TENANT,
      moduleId: MODULE_ID,
      specId: SPEC_ID,
      migrationSql: goodSql,
    });
    expect(result.appliedMigrationFilename).toContain(MODULE_ID);
    // The DDL still committed in the txn.
    expect(fake.recorded.some((s) => s.text.includes('CREATE TABLE'))).toBe(true);
  });

  it('fail-closed on a malformed (non-slug) tenant id before any DB work', async () => {
    const fake = makeFakeDb({ approvalRows: [approvedRow] });
    const { writer } = makeRecordingWriter();
    const executor = createMigrationExecutor({
      db: fake.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });

    await expect(
      executor.applyMigration({
        tenantId: 'BAD TENANT;DROP',
        moduleId: MODULE_ID,
        specId: SPEC_ID,
        migrationSql: goodSql,
      }),
    ).rejects.toThrow(/tenantId must be slug-shaped/i);
    expect(fake.recorded.length).toBe(0);
  });
});

// ===========================================================================
// FIX 4 — the FOUR-EYE replay + atomicity + specId-binding closure tests.
// ===========================================================================

describe('module-spawning executor — FIX 4 (replay / atomicity / specId)', () => {
  let goodSql: string;
  let goodHash: string;
  let approvedRow: ReturnType<typeof buildApprovalRow>;

  beforeEach(() => {
    goodSql = buildAcceptedDdl();
    goodHash = specSqlHash(goodSql);
    approvedRow = buildApprovalRow({
      status: 'approved',
      proposerUserId: 'user_proposer',
      approverIds: ['user_admin_a', 'user_admin_b'],
      toolName: 'module.apply',
      tenantId: TENANT,
      specSqlHash: goodHash,
      moduleId: MODULE_ID,
      specId: SPEC_ID,
      executed: false,
    });
  });

  it('(a/REPLAY) first apply succeeds + sets executed=true; a second apply of the SAME approval is REJECTED by the CAS (zero rows)', async () => {
    const fake = makeFakeDb({ approvalRows: [approvedRow] });
    const { writer } = makeRecordingWriter();
    const executor = createMigrationExecutor({
      db: fake.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });

    // First apply consumes the one-shot approval.
    const first = await executor.applyMigration({
      tenantId: TENANT,
      moduleId: MODULE_ID,
      specId: SPEC_ID,
      migrationSql: goodSql,
    });
    expect(first.appliedMigrationFilename).toContain(MODULE_ID);
    // The CAS durably consumed it.
    expect(fake.consumed.has('appr_1')).toBe(true);
    // The CAS UPDATE was emitted inside the apply txn, BEFORE the DDL.
    const txStmts = fake.applyTxStatements();
    const casIdx = txStmts.findIndex(
      (s) => s.text.includes('sovereign_approvals') && s.text.includes('executed'),
    );
    const ddlIdx = txStmts.findIndex((s) => s.text.includes('CREATE TABLE'));
    expect(casIdx).toBeGreaterThanOrEqual(0);
    expect(ddlIdx).toBeGreaterThan(casIdx);

    // Second apply of the SAME (now-consumed) approval — CAS returns zero
    // rows ⇒ replay refused.
    await expect(
      executor.applyMigration({
        tenantId: TENANT,
        moduleId: MODULE_ID,
        specId: SPEC_ID,
        migrationSql: goodSql,
      }),
    ).rejects.toThrow(/rolled back/i);
  });

  it('(b/ATOMICITY) if the DDL throws, executed is NOT left true (same-txn rollback) so a corrected retry can still consume', async () => {
    // First attempt: DDL body throws mid-apply.
    const failing = makeFakeDb({
      approvalRows: [approvedRow],
      throwOnMigrationBody: true,
    });
    const { writer, writes } = makeRecordingWriter();
    const executorFail = createMigrationExecutor({
      db: failing.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });

    await expect(
      executorFail.applyMigration({
        tenantId: TENANT,
        moduleId: MODULE_ID,
        specId: SPEC_ID,
        migrationSql: goodSql,
      }),
    ).rejects.toThrow(/rolled back/i);
    // The CAS consume was rolled back with the failed txn — NOT durable.
    expect(failing.consumed.has('appr_1')).toBe(false);
    expect(writes.length).toBe(0);

    // Corrected retry against a fresh (still-claimable) db succeeds: the
    // approval was never durably consumed, so the one-shot is still available.
    const ok = makeFakeDb({ approvalRows: [approvedRow] });
    const executorOk = createMigrationExecutor({
      db: ok.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });
    const retry = await executorOk.applyMigration({
      tenantId: TENANT,
      moduleId: MODULE_ID,
      specId: SPEC_ID,
      migrationSql: goodSql,
    });
    expect(retry.appliedMigrationFilename).toContain(MODULE_ID);
    expect(ok.consumed.has('appr_1')).toBe(true);
  });

  it('(c/specId) an approval whose payload.specId differs from the REQUESTED specId is REJECTED (the binding check now fires)', async () => {
    // The approval is bound to a DIFFERENT spec than the one being applied.
    const otherSpecRow = buildApprovalRow({
      status: 'approved',
      proposerUserId: 'user_proposer',
      approverIds: ['user_admin_a', 'user_admin_b'],
      toolName: 'module.apply',
      tenantId: TENANT,
      specSqlHash: goodHash,
      moduleId: MODULE_ID,
      specId: 'mspec_DIFFERENT',
      executed: false,
    });
    const fake = makeFakeDb({ approvalRows: [otherSpecRow] });
    const { writer } = makeRecordingWriter();
    const executor = createMigrationExecutor({
      db: fake.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });

    await expect(
      executor.applyMigration({
        tenantId: TENANT,
        moduleId: MODULE_ID,
        // Requested spec id != the approval's bound specId.
        specId: SPEC_ID,
        migrationSql: goodSql,
      }),
    ).rejects.toThrow(/four-eye/i);
    // Gate rejected BEFORE the txn — no CAS, no DDL, nothing consumed.
    expect(fake.consumed.has('appr_1')).toBe(false);
    expect(fake.recorded.some((s) => s.text.includes('CREATE TABLE'))).toBe(false);
  });

  it('(d/toView) the gate reads the REAL executed COLUMN — an approval with column executed=true (and NO payload.executed) is rejected', async () => {
    // No payload.executed key exists anymore; the one-shot truth is the
    // top-level `executed` column. A consumed approval must be refused.
    const consumedRow = buildApprovalRow({
      status: 'approved',
      proposerUserId: 'user_proposer',
      approverIds: ['user_admin_a', 'user_admin_b'],
      toolName: 'module.apply',
      tenantId: TENANT,
      specSqlHash: goodHash,
      moduleId: MODULE_ID,
      specId: SPEC_ID,
      executed: true,
    });
    // Guard: the fixture truly has no payload.executed key.
    expect(
      Object.prototype.hasOwnProperty.call(consumedRow.payload, 'executed'),
    ).toBe(false);

    const fake = makeFakeDb({ approvalRows: [consumedRow] });
    const { writer } = makeRecordingWriter();
    const executor = createMigrationExecutor({
      db: fake.db,
      logger: silentLogger,
      clock: fixedClock,
      artifactWriter: writer,
    });

    await expect(
      executor.applyMigration({
        tenantId: TENANT,
        moduleId: MODULE_ID,
        specId: SPEC_ID,
        migrationSql: goodSql,
      }),
    ).rejects.toThrow(/four-eye/i);
    expect(fake.recorded.some((s) => s.text.includes('CREATE TABLE'))).toBe(false);
  });
});
