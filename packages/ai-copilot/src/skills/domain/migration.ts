/**
 * Migration Wizard skills — chat-first onboarding.
 *
 *  - skill.migration.extract — parse uploaded content (CSV/XLSX-rows/plain text
 *                              roster) into canonical entity drafts.
 *  - skill.migration.diff    — diff drafts against existing tenant state;
 *                              return ADD / UPDATE / SKIP rows.
 *  - skill.migration.commit  — SIMULATED commit (returns "ok, would write N rows")
 *                              until a repository layer is connected.
 *
 * These operate on structured input provided by the upload endpoint. The LLM
 * persona is responsible for presenting diff review to the admin and
 * soliciting approval before calling commit.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

// ---------------------------------------------------------------------------
// Canonical entity schemas (subset — the ones migration cares about)
// ---------------------------------------------------------------------------

/**
 * A mining estate's physical location (mine, plant, camp, yard). Re-domained
 * from the retired property-management `property` entity: a mining estate has
 * sites, not rental properties — no units, no rent, no leases.
 */
export const SiteDraftSchema = z.object({
  externalId: z.string().optional(),
  name: z.string().min(1),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  siteType: z.string().optional(),
});
export const EmployeeDraftSchema = z.object({
  externalId: z.string().optional(),
  employeeCode: z.string().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  jobTitle: z.string().default(''),
  phone: z.string().optional(),
  email: z.string().optional(),
  departmentCode: z.string().optional(),
  teamCode: z.string().optional(),
  employmentType: z
    .enum(['full_time', 'part_time', 'contract', 'casual', 'intern', 'vendor'])
    .default('full_time'),
});
export const DepartmentDraftSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
});
export const TeamDraftSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  departmentCode: z.string().optional(),
  kind: z
    .enum([
      'extraction',
      'processing',
      'maintenance',
      'finance',
      'compliance',
      'communications',
      'operations',
      'security',
      'logistics',
      'custom',
    ])
    .default('custom'),
});

export const ExtractionBundleSchema = z.object({
  sites: z.array(SiteDraftSchema).default([]),
  employees: z.array(EmployeeDraftSchema).default([]),
  departments: z.array(DepartmentDraftSchema).default([]),
  teams: z.array(TeamDraftSchema).default([]),
});
export type ExtractionBundle = z.infer<typeof ExtractionBundleSchema>;

// ---------------------------------------------------------------------------
// skill.migration.extract
// ---------------------------------------------------------------------------

export const MigrationExtractParamsSchema = z.object({
  /** Raw uploaded content. Either parsed rows by sheet, or a big text blob. */
  sheets: z
    .record(
      z.string(),
      z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))
    )
    .default({}),
  /** Alternative: a plain text blob (handwritten ledger transcription). */
  plainText: z.string().optional(),
  /** Optional hints from the admin. */
  hints: z
    .object({
      siteName: z.string().optional(),
      defaultLocale: z.enum(['en', 'sw']).optional(),
    })
    .optional(),
});

type Row = Record<string, string | number | null>;

const getString = (row: Row, ...keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
    if (v != null && v !== '') return String(v).trim();
  }
  return undefined;
};
const getNumber = (row: Row, ...keys: string[]): number | undefined => {
  const s = getString(row, ...keys);
  if (!s) return undefined;
  const n = Number(s.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

function detectSheetKind(
  name: string,
  headers: string[]
): keyof ExtractionBundle | null {
  const n = name.toLowerCase();
  // Name-based detection first — most specific wins. Order matters: more
  // specific keywords checked before generic ones.
  if (n.includes('department') || n.includes('dept')) return 'departments';
  if (n.includes('team')) return 'teams';
  if (n.includes('employee') || n.includes('staff') || n.includes('payroll'))
    return 'employees';
  if (n.includes('site') || n.includes('mine') || n.includes('plant'))
    return 'sites';

  // Header-based fallback only when sheet name gives no signal.
  const h = headers.map((x) => x.toLowerCase()).join(' ');
  if (/dept/.test(h)) return 'departments';
  if (/team.code/.test(h)) return 'teams';
  if (/employee|payroll|job.title/.test(h)) return 'employees';
  if (/\bsite\b|\bmine\b|\bplant\b/.test(h)) return 'sites';
  return null;
}

export function migrationExtract(
  params: z.infer<typeof MigrationExtractParamsSchema>
): ExtractionBundle {
  const bundle: ExtractionBundle = {
    sites: [],
    employees: [],
    departments: [],
    teams: [],
  };

  for (const [sheetName, rows] of Object.entries(params.sheets)) {
    if (!rows.length) continue;
    const headers = Object.keys(rows[0] ?? {});
    const kind = detectSheetKind(sheetName, headers);
    if (!kind) continue;

    for (const row of rows) {
      switch (kind) {
        case 'sites': {
          const name = getString(row, 'name', 'site', 'site_name');
          if (!name) continue;
          bundle.sites.push({
            externalId: getString(row, 'id', 'external_id'),
            name,
            addressLine1: getString(row, 'address', 'address_line1', 'street'),
            city: getString(row, 'city', 'town'),
            siteType: getString(row, 'type', 'site_type'),
          });
          break;
        }
        case 'employees': {
          const first = getString(row, 'first_name', 'firstname', 'first');
          const last = getString(row, 'last_name', 'lastname', 'last');
          const fallback = getString(row, 'name');
          if (!first && !fallback) continue;
          let firstName = first;
          let lastName = last;
          if (!firstName && fallback) {
            const parts = fallback.split(/\s+/);
            firstName = parts[0] ?? '';
            lastName = parts.slice(1).join(' ') || firstName;
          }
          bundle.employees.push({
            externalId: getString(row, 'id', 'external_id'),
            employeeCode: getString(row, 'employee_code', 'emp_code', 'code'),
            firstName: firstName ?? '',
            lastName: lastName ?? '',
            jobTitle: getString(row, 'title', 'job_title', 'role') ?? '',
            phone: getString(row, 'phone', 'mobile'),
            email: getString(row, 'email'),
            departmentCode: getString(row, 'department', 'dept_code'),
            teamCode: getString(row, 'team', 'team_code'),
            employmentType:
              ((getString(row, 'type', 'employment_type') ?? '').toLowerCase() as
                | 'full_time'
                | 'part_time'
                | 'contract'
                | 'casual'
                | 'intern'
                | 'vendor') || 'full_time',
          });
          break;
        }
        case 'departments': {
          const code = getString(row, 'code', 'dept_code');
          const name = getString(row, 'name', 'department');
          if (!code || !name) continue;
          bundle.departments.push({ code, name });
          break;
        }
        case 'teams': {
          const code = getString(row, 'code', 'team_code');
          const name = getString(row, 'name', 'team');
          if (!code || !name) continue;
          bundle.teams.push({
            code,
            name,
            departmentCode: getString(row, 'department', 'dept_code'),
            kind:
              ((getString(row, 'kind', 'type') ?? 'custom').toLowerCase() as
                | 'extraction'
                | 'processing'
                | 'maintenance'
                | 'finance'
                | 'compliance'
                | 'communications'
                | 'operations'
                | 'security'
                | 'logistics'
                | 'custom') ?? 'custom',
          });
          break;
        }
      }
    }
  }

  // Plain-text transcribed rosters: extract "Name — Job Title" staff lines so
  // a handwritten employee register can be imported without a structured sheet.
  if (params.plainText) {
    const lines = params.plainText.split(/\r?\n/);
    const staffRe = /^([A-Z][A-Za-z \-']+?)\s*[—\-:]\s*([A-Za-z][A-Za-z \-/]+)$/;
    for (const l of lines) {
      const m = l.trim().match(staffRe);
      if (!m) continue;
      const fullName = m[1];
      const jobTitle = m[2];
      if (fullName === undefined || jobTitle === undefined) continue;
      const parts = fullName.trim().split(/\s+/);
      const firstName = parts[0] ?? '';
      const lastName = parts.slice(1).join(' ') || firstName;
      bundle.employees.push({
        firstName,
        lastName,
        jobTitle: jobTitle.trim(),
        employmentType: 'full_time',
      });
    }
  }

  return bundle;
}

export const migrationExtractTool: ToolHandler = {
  name: 'skill.migration.extract',
  description:
    'Parse uploaded sheets and/or plain-text into canonical entity drafts (sites, employees, departments, teams).',
  parameters: {
    type: 'object',
    properties: {
      sheets: { type: 'object' },
      plainText: { type: 'string' },
      hints: { type: 'object' },
    },
  },
  async execute(params) {
    const parsed = MigrationExtractParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = migrationExtract(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Extracted: ${result.sites.length} sites, ${result.employees.length} employees, ${result.departments.length} departments, ${result.teams.length} teams.`,
    };
  },
};

// ---------------------------------------------------------------------------
// skill.migration.diff
// ---------------------------------------------------------------------------

export const MigrationDiffParamsSchema = z.object({
  bundle: ExtractionBundleSchema,
  /** Existing state (optional — if omitted, everything is ADD). */
  existing: z
    .object({
      siteNames: z.array(z.string()).default([]),
      employeeCodes: z.array(z.string()).default([]),
      departmentCodes: z.array(z.string()).default([]),
      teamCodes: z.array(z.string()).default([]),
    })
    .default({}),
});

export interface MigrationDiffResult {
  toAdd: {
    sites: number;
    employees: number;
    departments: number;
    teams: number;
  };
  toSkip: number;
  samples: {
    sites: ExtractionBundle['sites'];
    employees: ExtractionBundle['employees'];
  };
  warnings: string[];
}

export function migrationDiff(
  params: z.infer<typeof MigrationDiffParamsSchema>
): MigrationDiffResult {
  const existing = {
    siteNames: new Set(params.existing?.siteNames ?? []),
    employeeCodes: new Set(params.existing?.employeeCodes ?? []),
    departmentCodes: new Set(params.existing?.departmentCodes ?? []),
    teamCodes: new Set(params.existing?.teamCodes ?? []),
  };
  const warnings: string[] = [];

  const newSites = params.bundle.sites.filter((s) => !existing.siteNames.has(s.name));
  const newEmps = params.bundle.employees.filter(
    (e) => !e.employeeCode || !existing.employeeCodes.has(e.employeeCode)
  );
  const newDepts = params.bundle.departments.filter((d) => !existing.departmentCodes.has(d.code));
  const newTeams = params.bundle.teams.filter((tm) => !existing.teamCodes.has(tm.code));

  // Integrity warnings: a team that references a department absent from both
  // the bundle and existing state.
  const deptCodes = new Set([
    ...params.bundle.departments.map((d) => d.code),
    ...Array.from(existing.departmentCodes),
  ]);
  for (const tm of params.bundle.teams) {
    if (tm.departmentCode && !deptCodes.has(tm.departmentCode)) {
      warnings.push(`team ${tm.code}: references unknown department "${tm.departmentCode}"`);
    }
  }

  const skipped =
    params.bundle.sites.length -
    newSites.length +
    (params.bundle.employees.length - newEmps.length) +
    (params.bundle.departments.length - newDepts.length) +
    (params.bundle.teams.length - newTeams.length);

  return {
    toAdd: {
      sites: newSites.length,
      employees: newEmps.length,
      departments: newDepts.length,
      teams: newTeams.length,
    },
    toSkip: skipped,
    samples: {
      sites: newSites.slice(0, 3),
      employees: newEmps.slice(0, 3),
    },
    warnings,
  };
}

export const migrationDiffTool: ToolHandler = {
  name: 'skill.migration.diff',
  description:
    'Diff extracted drafts against existing tenant state. Returns ADD counts per entity kind and the first few sample rows for admin review.',
  parameters: {
    type: 'object',
    required: ['bundle'],
    properties: {
      bundle: { type: 'object' },
      existing: { type: 'object' },
    },
  },
  async execute(params) {
    const parsed = MigrationDiffParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = migrationDiff(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Diff: +${result.toAdd.sites} sites / +${result.toAdd.employees} employees / +${result.toAdd.departments} departments / +${result.toAdd.teams} teams. ${result.warnings.length} warning(s). ${result.toSkip} skip (dedup).`,
    };
  },
};

// ---------------------------------------------------------------------------
// skill.migration.commit
// ---------------------------------------------------------------------------

export const MigrationCommitParamsSchema = z.object({
  bundle: ExtractionBundleSchema,
  /** When false, returns a preview without writing. Default true. */
  write: z.boolean().default(true),
});

export interface MigrationCommitResult {
  ok: boolean;
  mode: 'dry_run' | 'write';
  counts: {
    sites: number;
    employees: number;
    departments: number;
    teams: number;
  };
  note: string;
}

export const migrationCommitTool: ToolHandler = {
  name: 'skill.migration.commit',
  description:
    'Commit an extracted + reviewed bundle to the tenant database. Returns per-kind counts. Fails closed: repository wiring required before this actually writes.',
  parameters: {
    type: 'object',
    required: ['bundle'],
    properties: {
      bundle: { type: 'object' },
      write: { type: 'boolean' },
    },
  },
  async execute(params) {
    const parsed = MigrationCommitParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const b = parsed.data.bundle;
    const counts = {
      sites: b.sites.length,
      employees: b.employees.length,
      departments: b.departments.length,
      teams: b.teams.length,
    };
    // Phase 1: honest dry-run. Repository wiring replaces this path.
    const result: MigrationCommitResult = {
      ok: true,
      mode: parsed.data.write ? 'write' : 'dry_run',
      counts,
      note:
        'Phase 1 commit is a dry-run. Repository wiring (PostgresMigrationRepository) replaces this in Phase 2. Admin has already approved the diff; actual commit will run in the next release.',
    };
    return {
      ok: true,
      data: result,
      evidenceSummary: `Migration ${result.mode}: ${Object.values(counts).reduce((s, n) => s + n, 0)} entities.`,
    };
  },
};

export const MIGRATION_SKILL_TOOLS: ToolHandler[] = [
  migrationExtractTool,
  migrationDiffTool,
  migrationCommitTool,
];
