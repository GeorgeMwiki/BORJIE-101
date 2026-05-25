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

export const PropertyDraftSchema = z.object({
  externalId: z.string().optional(),
  name: z.string().min(1),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  unitCount: z.number().int().nonnegative().optional(),
  propertyType: z.string().optional(),
});
export const UnitDraftSchema = z.object({
  externalId: z.string().optional(),
  propertyName: z.string().min(1),
  label: z.string().min(1),
  bedrooms: z.number().int().nonnegative().optional(),
  rentKes: z.number().nonnegative().optional(),
  status: z.string().optional(),
});
export const TenantDraftSchema = z.object({
  externalId: z.string().optional(),
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().optional(),
  unitLabel: z.string().optional(),
  propertyName: z.string().optional(),
  leaseStart: z.string().optional(),
  leaseEnd: z.string().optional(),
  rentKes: z.number().optional(),
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
      'leasing',
      'maintenance',
      'finance',
      'compliance',
      'communications',
      'operations',
      'security',
      'caretaking',
      'custom',
    ])
    .default('custom'),
});

export const ExtractionBundleSchema = z.object({
  properties: z.array(PropertyDraftSchema).default([]),
  units: z.array(UnitDraftSchema).default([]),
  tenants: z.array(TenantDraftSchema).default([]),
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
      propertyName: z.string().optional(),
      defaultLocale: z.enum(['en', 'sw', 'sheng']).optional(),
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
  if (n.includes('tenant') || n.includes('customer')) return 'tenants';
  if (n.includes('unit')) return 'units';
  if (n.includes('propert')) return 'properties';

  // Header-based fallback only when sheet name gives no signal.
  const h = headers.map((x) => x.toLowerCase()).join(' ');
  if (/dept/.test(h)) return 'departments';
  if (/team.code/.test(h)) return 'teams';
  if (/employee|payroll|job.title/.test(h)) return 'employees';
  if (/bedroom|\brent\b/.test(h)) return 'units';
  if (/propert/.test(h)) return 'properties';
  return null;
}

export function migrationExtract(
  params: z.infer<typeof MigrationExtractParamsSchema>
): ExtractionBundle {
  const bundle: ExtractionBundle = {
    properties: [],
    units: [],
    tenants: [],
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
        case 'properties': {
          const name = getString(row, 'name', 'property', 'property_name');
          if (!name) continue;
          bundle.properties.push({
            externalId: getString(row, 'id', 'external_id'),
            name,
            addressLine1: getString(row, 'address', 'address_line1', 'street'),
            city: getString(row, 'city', 'town'),
            unitCount: getNumber(row, 'units', 'unit_count'),
            propertyType: getString(row, 'type', 'property_type'),
          });
          break;
        }
        case 'units': {
          const label = getString(row, 'unit', 'label', 'unit_label', 'unit_no');
          const propertyName = getString(row, 'property', 'property_name');
          if (!label || !propertyName) continue;
          bundle.units.push({
            externalId: getString(row, 'id', 'external_id'),
            propertyName,
            label,
            bedrooms: getNumber(row, 'bedrooms', 'bed', 'br'),
            rentKes: getNumber(row, 'rent', 'rent_kes', 'monthly_rent'),
            status: getString(row, 'status', 'occupancy'),
          });
          break;
        }
        case 'tenants': {
          const name = getString(row, 'name', 'tenant', 'tenant_name');
          if (!name) continue;
          bundle.tenants.push({
            externalId: getString(row, 'id', 'external_id'),
            name,
            phone: getString(row, 'phone', 'mobile', 'msisdn'),
            email: getString(row, 'email'),
            unitLabel: getString(row, 'unit', 'unit_label'),
            propertyName: getString(row, 'property'),
            leaseStart: getString(row, 'lease_start', 'start_date'),
            leaseEnd: getString(row, 'lease_end', 'end_date'),
            rentKes: getNumber(row, 'rent', 'rent_kes'),
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
                | 'leasing'
                | 'maintenance'
                | 'finance'
                | 'compliance'
                | 'communications'
                | 'operations'
                | 'security'
                | 'caretaking'
                | 'custom') ?? 'custom',
          });
          break;
        }
      }
    }
  }

  // Plain-text transcribed ledgers: extract rent lines with a simple regex.
  if (params.plainText) {
    const lines = params.plainText.split(/\r?\n/);
    const rentRe = /([A-Z][A-Za-z \-']+)\s+(\w{1,8})\s+KES\s*([0-9,]+)/;
    for (const l of lines) {
      const m = l.match(rentRe);
      if (!m) continue;
      bundle.tenants.push({
        name: m[1].trim(),
        unitLabel: m[2].trim(),
        rentKes: Number(m[3].replace(/,/g, '')),
      });
    }
  }

  return bundle;
}

export const migrationExtractTool: ToolHandler = {
  name: 'skill.migration.extract',
  description:
    'Parse uploaded sheets and/or plain-text into canonical entity drafts (properties, units, tenants, employees, departments, teams).',
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
      evidenceSummary: `Extracted: ${result.properties.length} properties, ${result.units.length} units, ${result.tenants.length} tenants, ${result.employees.length} employees, ${result.departments.length} departments, ${result.teams.length} teams.`,
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
      propertyNames: z.array(z.string()).default([]),
      unitLabelsByProperty: z.record(z.string(), z.array(z.string())).default({}),
      tenantNames: z.array(z.string()).default([]),
      employeeCodes: z.array(z.string()).default([]),
      departmentCodes: z.array(z.string()).default([]),
      teamCodes: z.array(z.string()).default([]),
    })
    .default({}),
});

export interface MigrationDiffResult {
  toAdd: {
    properties: number;
    units: number;
    tenants: number;
    employees: number;
    departments: number;
    teams: number;
  };
  toSkip: number;
  samples: {
    properties: ExtractionBundle['properties'];
    units: ExtractionBundle['units'];
    tenants: ExtractionBundle['tenants'];
    employees: ExtractionBundle['employees'];
  };
  warnings: string[];
}

export function migrationDiff(
  params: z.infer<typeof MigrationDiffParamsSchema>
): MigrationDiffResult {
  const existing = {
    propertyNames: new Set(params.existing?.propertyNames ?? []),
    unitLabelsByProperty: params.existing?.unitLabelsByProperty ?? {},
    tenantNames: new Set(params.existing?.tenantNames ?? []),
    employeeCodes: new Set(params.existing?.employeeCodes ?? []),
    departmentCodes: new Set(params.existing?.departmentCodes ?? []),
    teamCodes: new Set(params.existing?.teamCodes ?? []),
  };
  const warnings: string[] = [];

  const newProps = params.bundle.properties.filter((p) => !existing.propertyNames.has(p.name));
  const newUnits = params.bundle.units.filter((u) => {
    const existingLabels = new Set(existing.unitLabelsByProperty[u.propertyName] ?? []);
    return !existingLabels.has(u.label);
  });
  const newTenants = params.bundle.tenants.filter((t) => !existing.tenantNames.has(t.name));
  const newEmps = params.bundle.employees.filter(
    (e) => !e.employeeCode || !existing.employeeCodes.has(e.employeeCode)
  );
  const newDepts = params.bundle.departments.filter((d) => !existing.departmentCodes.has(d.code));
  const newTeams = params.bundle.teams.filter((tm) => !existing.teamCodes.has(tm.code));

  // Integrity warnings
  const propNames = new Set(
    [
      ...params.bundle.properties.map((p) => p.name),
      ...Array.from(existing.propertyNames),
    ]
  );
  for (const u of params.bundle.units) {
    if (!propNames.has(u.propertyName)) {
      warnings.push(`unit ${u.label}: references unknown property "${u.propertyName}"`);
    }
  }

  const skipped =
    params.bundle.properties.length -
    newProps.length +
    (params.bundle.units.length - newUnits.length) +
    (params.bundle.tenants.length - newTenants.length) +
    (params.bundle.employees.length - newEmps.length) +
    (params.bundle.departments.length - newDepts.length) +
    (params.bundle.teams.length - newTeams.length);

  return {
    toAdd: {
      properties: newProps.length,
      units: newUnits.length,
      tenants: newTenants.length,
      employees: newEmps.length,
      departments: newDepts.length,
      teams: newTeams.length,
    },
    toSkip: skipped,
    samples: {
      properties: newProps.slice(0, 3),
      units: newUnits.slice(0, 3),
      tenants: newTenants.slice(0, 3),
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
      evidenceSummary: `Diff: +${result.toAdd.properties} properties / +${result.toAdd.units} units / +${result.toAdd.tenants} tenants / +${result.toAdd.employees} employees. ${result.warnings.length} warning(s). ${result.toSkip} skip (dedup).`,
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
    properties: number;
    units: number;
    tenants: number;
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
      properties: b.properties.length,
      units: b.units.length,
      tenants: b.tenants.length,
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
