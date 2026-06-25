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
          counts: { sites: 2, employees: 3, departments: 1 },
          skipped: { employees: ['dup:emp_001'] },
        };
      },
    });

    const result = await tool.execute(
      {
        runId: 'run_1',
        tenantId: 't1',
        actorId: 'u1',
        bundle: {
          sites: [],
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
        sites: [], employees: [], departments: [], teams: [],
      }},
      {} as never
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not approved');
  });
});

describe('skill.migration.diff_v2 UPDATE bucket', () => {
  it('detects UPDATE when employee phone changes', () => {
    const result = migrationDiffAdvanced({
      bundle: {
        sites: [],
        employees: [
          {
            employeeCode: 'EMP-1',
            firstName: 'Alice',
            lastName: 'M',
            jobTitle: 'Geologist',
            phone: '+254700000111',
            employmentType: 'full_time',
          },
        ],
        departments: [],
        teams: [],
      },
      existing: {
        siteNames: [],
        employeeCodes: [],
        departmentCodes: [],
        teamCodes: [],
      },
      existingSnapshots: {
        employees: { 'EMP-1': { phone: '+254700000000', jobTitle: 'Geologist' } },
        sites: {},
      },
      includeSkipReasons: true,
    });
    expect(result.toUpdate.employees).toBe(1);
  });

  it('marks unchanged row with skipReason', () => {
    const result = migrationDiffAdvanced({
      bundle: {
        sites: [],
        employees: [
          {
            employeeCode: 'EMP-2',
            firstName: 'Bob',
            lastName: 'K',
            jobTitle: 'Driller',
            phone: '+111',
            employmentType: 'full_time',
          },
        ],
        departments: [],
        teams: [],
      },
      existing: {
        siteNames: [],
        employeeCodes: [],
        departmentCodes: [],
        teamCodes: [],
      },
      existingSnapshots: {
        employees: { 'EMP-2': { phone: '+111', jobTitle: 'Driller' } },
        sites: {},
      },
      includeSkipReasons: true,
    });
    expect(result.toUpdate.employees).toBe(0);
    expect(result.skipReasons.some((s) => s.kind === 'employees')).toBe(true);
  });

  it('has a registered ToolHandler name', () => {
    expect(migrationDiffAdvancedTool.name).toBe('skill.migration.diff_v2');
  });
});
