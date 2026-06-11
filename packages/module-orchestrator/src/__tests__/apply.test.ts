/**
 * apply.test.ts — K5 gate + migration-apply path.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { applyModuleSpec } from '../apply.js';
import { spawnModuleFromTemplate } from '../spawn.js';
import { makeFakeState, makeFakeDeps, type FakeState } from './fakes.js';
import { hrBundle } from '@borjie/module-templates';

function seedEstateTemplate(state: FakeState): void {
  // A generic known-good module-spec bundle (HR) seeds the orchestrator
  // fake — the test exercises the spawn/apply machinery, not any domain
  // semantics. (The pre-Borjie ESTATE bundle was excised.)
  state.templates.set('HR', {
    id: 'mtpl_hr',
    slug: 'HR',
    defaultSpec: hrBundle.spec as unknown as Readonly<Record<string, unknown>>,
    titleEn: hrBundle.titleEn,
    titleSw: hrBundle.titleSw,
  });
}

describe('applyModuleSpec', () => {
  let state: FakeState;
  beforeEach(() => {
    state = makeFakeState();
    seedEstateTemplate(state);
  });

  it('blocks LIVE transition until K5 four-eye approval exists', async () => {
    const deps = makeFakeDeps(state);
    const spawn = await spawnModuleFromTemplate(
      {
        tenantId: 'tnt_trc',
        templateSlug: 'HR',
        moduleSlug: 'estate_hq',
        title: 'Estate',
        titleSw: null,
        scopedToolIds: [],
        createdByUserId: 'usr_admin',
      },
      deps,
    );

    // Try to apply without K5 approval — must fail.
    const r = await applyModuleSpec(
      {
        tenantId: 'tnt_trc',
        moduleId: spawn.moduleId!,
        specId: spawn.specId!,
        requestingUserId: 'usr_admin',
      },
      deps,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/K5 four-eye/);

    // Module should still be PROPOSED.
    expect(state.modules.get(spawn.moduleId!)?.lifecycleState).toBe('PROPOSED');
  });

  it('applies the migration when K5 approval is present', async () => {
    const deps = makeFakeDeps(state);
    const spawn = await spawnModuleFromTemplate(
      {
        tenantId: 'tnt_trc',
        templateSlug: 'HR',
        moduleSlug: 'estate_hq',
        title: 'Estate',
        titleSw: null,
        scopedToolIds: [],
        createdByUserId: 'usr_admin',
      },
      deps,
    );

    // Seed the K5 approval row.
    state.approvals.set(`${spawn.moduleId}:${spawn.specId}`, {
      approvalId: 'apr_001',
    });

    const r = await applyModuleSpec(
      {
        tenantId: 'tnt_trc',
        moduleId: spawn.moduleId!,
        specId: spawn.specId!,
        requestingUserId: 'usr_admin',
      },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(r.appliedMigrationFilename).toContain('Ttnt_trc_');

    // Module is now LIVE.
    expect(state.modules.get(spawn.moduleId!)?.lifecycleState).toBe('LIVE');
    // Spec is marked applied.
    expect(state.specs.get(spawn.specId!)?.compileStatus).toBe('applied');
    // Migration runner saw the SQL.
    expect(state.appliedMigrations.length).toBe(1);
  });

  it('marks the spec failed and leaves module non-LIVE when migration throws', async () => {
    const deps = makeFakeDeps(state);
    const spawn = await spawnModuleFromTemplate(
      {
        tenantId: 'tnt_trc',
        templateSlug: 'HR',
        moduleSlug: 'estate_hq',
        title: 'Estate',
        titleSw: null,
        scopedToolIds: [],
        createdByUserId: 'usr_admin',
      },
      deps,
    );

    state.approvals.set(`${spawn.moduleId}:${spawn.specId}`, {
      approvalId: 'apr_001',
    });
    state.shouldFailMigration = true;

    const r = await applyModuleSpec(
      {
        tenantId: 'tnt_trc',
        moduleId: spawn.moduleId!,
        specId: spawn.specId!,
        requestingUserId: 'usr_admin',
      },
      deps,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/migration apply failed/);
    expect(state.specs.get(spawn.specId!)?.compileStatus).toBe('failed');
    // Module advanced to APPROVED (the lifecycle commit happens BEFORE
    // the migration runs in our implementation).
    expect(state.modules.get(spawn.moduleId!)?.lifecycleState).toBe('APPROVED');
  });

  it('rejects when module not found', async () => {
    const deps = makeFakeDeps(state);
    const r = await applyModuleSpec(
      {
        tenantId: 'tnt_trc',
        moduleId: 'mod_ghost',
        specId: 'mspec_ghost',
        requestingUserId: null,
      },
      deps,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/module not found/);
  });

  it('rejects when module is already LIVE', async () => {
    const deps = makeFakeDeps(state);
    const spawn = await spawnModuleFromTemplate(
      {
        tenantId: 'tnt_trc',
        templateSlug: 'HR',
        moduleSlug: 'estate_hq',
        title: 'Estate',
        titleSw: null,
        scopedToolIds: [],
        createdByUserId: 'usr_admin',
      },
      deps,
    );
    state.approvals.set(`${spawn.moduleId}:${spawn.specId}`, {
      approvalId: 'apr_001',
    });

    // First apply succeeds.
    await applyModuleSpec(
      {
        tenantId: 'tnt_trc',
        moduleId: spawn.moduleId!,
        specId: spawn.specId!,
        requestingUserId: 'usr_admin',
      },
      deps,
    );
    // Second apply (now LIVE) must be rejected.
    const r = await applyModuleSpec(
      {
        tenantId: 'tnt_trc',
        moduleId: spawn.moduleId!,
        specId: spawn.specId!,
        requestingUserId: 'usr_admin',
      },
      deps,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/cannot apply/);
  });

  it('rejects when spec missing', async () => {
    const deps = makeFakeDeps(state);
    const spawn = await spawnModuleFromTemplate(
      {
        tenantId: 'tnt_trc',
        templateSlug: 'HR',
        moduleSlug: 'estate_hq',
        title: 'Estate',
        titleSw: null,
        scopedToolIds: [],
        createdByUserId: 'usr_admin',
      },
      deps,
    );
    const r = await applyModuleSpec(
      {
        tenantId: 'tnt_trc',
        moduleId: spawn.moduleId!,
        specId: 'mspec_ghost',
        requestingUserId: null,
      },
      deps,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/spec not found/);
  });
});

describe('applyModuleSpec — re-validation of the STORED spec (never trust the row)', () => {
  let state: FakeState;
  beforeEach(() => {
    state = makeFakeState();
    seedEstateTemplate(state);
  });

  /** Replace the stored spec SQL with a tampered blob (immutably). */
  function tamperStoredSql(specId: string, tamperedSql: string): void {
    const row = state.specs.get(specId)!;
    state.specs.set(specId, { ...row, migrationSql: tamperedSql });
  }

  async function spawnApproved(deps = makeFakeDeps(state)) {
    const spawn = await spawnModuleFromTemplate(
      {
        tenantId: 'tnt_trc',
        templateSlug: 'HR',
        moduleSlug: 'hr_hq',
        title: 'HR',
        titleSw: null,
        scopedToolIds: [],
        createdByUserId: 'usr_admin',
      },
      deps,
    );
    state.approvals.set(`${spawn.moduleId}:${spawn.specId}`, {
      approvalId: 'apr_001',
    });
    return { spawn, deps };
  }

  it('rejects a stored spec with an injected DROP and marks the spec failed', async () => {
    const { spawn, deps } = await spawnApproved();
    const clean = state.specs.get(spawn.specId!)!.migrationSql;
    tamperStoredSql(spawn.specId!, `${clean}\n\nDROP TABLE tenants;`);

    const r = await applyModuleSpec(
      {
        tenantId: 'tnt_trc',
        moduleId: spawn.moduleId!,
        specId: spawn.specId!,
        requestingUserId: 'usr_admin',
      },
      deps,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/re-validation|DROP/i);
    // Spec is markFailed; migration runner NEVER saw the SQL.
    expect(state.specs.get(spawn.specId!)?.compileStatus).toBe('failed');
    expect(state.appliedMigrations.length).toBe(0);
    // Module did NOT advance to LIVE.
    expect(state.modules.get(spawn.moduleId!)?.lifecycleState).not.toBe('LIVE');
  });

  it('rejects a stored spec whose RLS block was stripped (non-namespaced table left bare)', async () => {
    const { spawn, deps } = await spawnApproved();
    // A bare CREATE TABLE with NO RLS block — HARD RULE 2 must reject it.
    const bare = [
      'CREATE TABLE IF NOT EXISTS tenant_mod_tnt_trc_evil (',
      '  id TEXT PRIMARY KEY,',
      '  tenant_id TEXT NOT NULL',
      ');',
    ].join('\n');
    tamperStoredSql(spawn.specId!, bare);

    const r = await applyModuleSpec(
      {
        tenantId: 'tnt_trc',
        moduleId: spawn.moduleId!,
        specId: spawn.specId!,
        requestingUserId: 'usr_admin',
      },
      deps,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/RLS|ROW LEVEL SECURITY|FORCE|re-validation/i);
    expect(state.specs.get(spawn.specId!)?.compileStatus).toBe('failed');
    expect(state.appliedMigrations.length).toBe(0);
  });

  it('rejects a stored spec swapped to a non-namespaced (foreign) table', async () => {
    const { spawn, deps } = await spawnApproved();
    const foreign = [
      'CREATE TABLE IF NOT EXISTS random_table (',
      '  id TEXT PRIMARY KEY,',
      '  tenant_id TEXT NOT NULL',
      ');',
    ].join('\n');
    tamperStoredSql(spawn.specId!, foreign);

    const r = await applyModuleSpec(
      {
        tenantId: 'tnt_trc',
        moduleId: spawn.moduleId!,
        specId: spawn.specId!,
        requestingUserId: 'usr_admin',
      },
      deps,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/namespace|re-validation/i);
    expect(state.specs.get(spawn.specId!)?.compileStatus).toBe('failed');
    expect(state.appliedMigrations.length).toBe(0);
  });
});
