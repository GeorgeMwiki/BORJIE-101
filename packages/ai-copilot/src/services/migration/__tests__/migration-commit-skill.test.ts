/**
 * Amplified commit skill tests + diff-v2 UPDATE bucket tests.
 */

import { describe, it, expect } from 'vitest';
import {
  makeMigrationCommitTool,
  migrationDiffAdvanced,
  migrationDiffAdvancedTool,
} from '../../../skills/domain/migration-commit.js';

describe('skill.migration.commit (amplified)', () => {
  it('invokes deps.commit and returns counts', async () => {
    const calls: Array<{ tenantId: string; runId: string; actorId: string }> = [];
    const tool = makeMigrationCommitTool({
      commit: async (input) => {
        calls.push(input);
        return {
          ok: true,
          counts: { properties: 2, units: 3, tenants: 1 },
          skipped: { tenants: ['dup:alice'] },
        };
      },
    });

    const result = await tool.execute(
      {
        runId: 'run_1',
        tenantId: 't1',
        actorId: 'u1',
        bundle: {
          properties: [],
          units: [],
          tenants: [],
          employees: [],
          departments: [],
          teams: [],
        },
      },
      {} as never
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(result.evidenceSummary).toContain('run_1');
    expect(result.evidenceSummary).toContain('6 rows');
  });

  it('surfaces commit errors as tool failures', async () => {
    const tool = makeMigrationCommitTool({
      commit: async () => ({
        ok: false,
        error: { code: 'INVALID_STATUS', message: 'not approved' },
      }),
    });
    const result = await tool.execute(
      { runId: 'r', tenantId: 't', actorId: 'u', bundle: {
        properties: [], units: [], tenants: [], employees: [], departments: [], teams: [],
      }},
      {} as never
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not approved');
  });
});

describe('skill.migration.diff_v2 UPDATE bucket', () => {
  it('detects UPDATE when tenant phone changes', () => {
    const result = migrationDiffAdvanced({
      bundle: {
        properties: [],
        units: [],
        tenants: [
          { name: 'Alice', phone: '+254700000111', unitLabel: 'A1' },
        ],
        employees: [],
        departments: [],
        teams: [],
      },
      existing: {
        propertyNames: [],
        unitLabelsByProperty: {},
        tenantNames: ['Alice'],
        employeeCodes: [],
        departmentCodes: [],
        teamCodes: [],
      },
      existingSnapshots: {
        tenants: { Alice: { phone: '+254700000000', unitLabel: 'A1' } },
        units: {},
      },
      includeSkipReasons: true,
    });
    expect(result.toUpdate.tenants).toBe(1);
  });

  it('marks unchanged row with skipReason', () => {
    const result = migrationDiffAdvanced({
      bundle: {
        properties: [],
        units: [],
        tenants: [{ name: 'Bob', phone: '+111', unitLabel: 'B1' }],
        employees: [],
        departments: [],
        teams: [],
      },
      existing: {
        propertyNames: [],
        unitLabelsByProperty: {},
        tenantNames: ['Bob'],
        employeeCodes: [],
        departmentCodes: [],
        teamCodes: [],
      },
      existingSnapshots: {
        tenants: { Bob: { phone: '+111', unitLabel: 'B1' } },
        units: {},
      },
      includeSkipReasons: true,
    });
    expect(result.toUpdate.tenants).toBe(0);
    expect(result.skipReasons.some((s) => s.kind === 'tenants')).toBe(true);
  });

  it('has a registered ToolHandler name', () => {
    expect(migrationDiffAdvancedTool.name).toBe('skill.migration.diff_v2');
  });
});
