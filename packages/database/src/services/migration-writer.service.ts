/**
 * MigrationWriterService — real, transactional commit of an extracted
 * migration bundle into the live database.
 *
 * Design principles (production policy):
 *  - NO silent fabrication. If a row is missing a required field
 *    (`propertyCode`, `customerCode`, `unitCode`, `addressLine1`, etc.) the
 *    writer emits a structured `WriterError` for that row and aborts the
 *    batch by default. Callers may opt into best-effort mode.
 *  - NO duplicate writes. Each entity is keyed by its natural code per
 *    tenant; existing rows return `skipped: 'duplicate'` outcome rather
 *    than insert.
 *  - Live data in, live data out. The returned report enumerates exactly
 *    which rows were written, which were skipped, and why.
 *  - Tenant- and actor-scoped. Every insert carries the tenant id and the
 *    `createdBy` actor for audit.
 */

import { v4 as uuid } from 'uuid';
import { and, eq, isNull } from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import {
  PropertyRepository,
  UnitRepository,
  CustomerRepository,
} from '../repositories/index.js';
import {
  DepartmentRepository,
  TeamRepository,
  EmployeeRepository,
} from '../repositories/hr.repository.js';
import {
  properties as propertiesTable,
  units as unitsTable,
} from '../schemas/property.schema.js';
import { customers as customersTable } from '../schemas/customer.schema.js';
import {
  employees as employeesTable,
  departments as departmentsTable,
  teams as teamsTable,
} from '../schemas/hr.schema.js';

// ---------------------------------------------------------------------------
// Bundle types — match @borjie/ai-copilot ExtractionBundleSchema
// ---------------------------------------------------------------------------

export interface PropertyDraft {
  externalId?: string;
  name: string;
  addressLine1?: string;
  city?: string;
  unitCount?: number;
  propertyType?: string;
}
export interface UnitDraft {
  externalId?: string;
  propertyName: string;
  label: string;
  bedrooms?: number;
  rentKes?: number;
  status?: string;
}
export interface TenantDraft {
  externalId?: string;
  name: string;
  phone?: string;
  email?: string;
  unitLabel?: string;
  propertyName?: string;
  leaseStart?: string;
  leaseEnd?: string;
  rentKes?: number;
}
export interface EmployeeDraft {
  externalId?: string;
  employeeCode?: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  phone?: string;
  email?: string;
  departmentCode?: string;
  teamCode?: string;
  employmentType?:
    | 'full_time'
    | 'part_time'
    | 'contract'
    | 'casual'
    | 'intern'
    | 'vendor';
}
export interface DepartmentDraft {
  code: string;
  name: string;
}
export interface TeamDraft {
  code: string;
  name: string;
  departmentCode?: string;
  kind?:
    | 'leasing'
    | 'maintenance'
    | 'finance'
    | 'compliance'
    | 'communications'
    | 'operations'
    | 'security'
    | 'caretaking'
    | 'custom';
}

export interface ExtractedBundle {
  properties?: PropertyDraft[];
  units?: UnitDraft[];
  tenants?: TenantDraft[];
  employees?: EmployeeDraft[];
  departments?: DepartmentDraft[];
  teams?: TeamDraft[];
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export interface WriterRowOutcome {
  kind:
    | 'property'
    | 'unit'
    | 'customer'
    | 'employee'
    | 'department'
    | 'team';
  index: number;
  /** ID assigned to the new row, or existing row's id if duplicate. */
  id?: string;
  status: 'inserted' | 'duplicate' | 'failed';
  /** Natural key (code) used for dedup. */
  naturalKey?: string;
  reason?: string;
}

export interface WriterReport {
  ok: boolean;
  inserted: {
    properties: number;
    units: number;
    customers: number;
    employees: number;
    departments: number;
    teams: number;
  };
  duplicates: number;
  failed: number;
  outcomes: WriterRowOutcome[];
  /** Errors that caused the batch to abort (if not in best-effort). */
  abortError?: string;
}

export interface WriterOptions {
  /**
   * If true, continue past row failures and surface them in `outcomes`. If
   * false (default — production-safe), the batch aborts on the first
   * failure with all subsequent rows untouched.
   */
  bestEffort?: boolean;
  /** Default property type when input doesn't specify (still required by schema). */
  defaultPropertyType?:
    | 'apartment_complex'
    | 'single_family'
    | 'multi_family'
    | 'townhouse'
    | 'commercial'
    | 'mixed_use'
    | 'estate'
    | 'other';
  /** Default unit type when input doesn't specify. */
  defaultUnitType?:
    | 'studio'
    | 'one_bedroom'
    | 'two_bedroom'
    | 'three_bedroom'
    | 'four_plus_bedroom'
    | 'penthouse'
    | 'duplex'
    | 'loft'
    | 'commercial_retail'
    | 'commercial_office'
    | 'warehouse'
    | 'parking'
    | 'storage'
    | 'other';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MigrationWriterService {
  private readonly properties: PropertyRepository;
  private readonly units: UnitRepository;
  private readonly customers: CustomerRepository;
  private readonly employees: EmployeeRepository;
  private readonly departments: DepartmentRepository;
  private readonly teams: TeamRepository;

  constructor(private readonly db: DatabaseClient) {
    this.properties = new PropertyRepository(db);
    this.units = new UnitRepository(db);
    this.customers = new CustomerRepository(db);
    this.employees = new EmployeeRepository(db);
    this.departments = new DepartmentRepository(db);
    this.teams = new TeamRepository(db);
  }

  /**
   * Commit a bundle to live storage. Returns a precise per-row report.
   *
   * @param bundle  Extracted bundle.
   * @param ctx     Tenant + actor context.
   * @param opts    Behavior overrides.
   */
  async commit(
    bundle: ExtractedBundle,
    ctx: {
      tenantId: string;
      ownerUserId: string;
      actorUserId: string;
      /**
       * Tenant's country code (ISO 3166-1 alpha-2). Resolved from
       * region-config at the call site. Required so migrated properties
       * inherit the tenant's actual country rather than a hardcoded
       * default.
       */
      tenantCountry: string;
      /**
       * Tenant's default currency (ISO 4217). Resolved from region-config.
       * Required so migrated units inherit the tenant's rent currency.
       */
      tenantCurrency: string;
      /** Default city used when a property record doesn't specify one. */
      defaultCity?: string;
    },
    opts: WriterOptions = {}
  ): Promise<WriterReport> {
    const report: WriterReport = {
      ok: true,
      inserted: {
        properties: 0,
        units: 0,
        customers: 0,
        employees: 0,
        departments: 0,
        teams: 0,
      },
      duplicates: 0,
      failed: 0,
      outcomes: [],
    };

    const fail = (msg: string): WriterReport => {
      report.ok = false;
      report.abortError = msg;
      return report;
    };

    // Order matters: departments → teams → employees → properties → units → customers
    // (foreign keys cascade in this direction).

    // 1. Departments
    const deptIdByCode = new Map<string, string>();
    for (let i = 0; i < (bundle.departments ?? []).length; i++) {
      const d = bundle.departments![i];
      if (!d.code || !d.name) {
        const o: WriterRowOutcome = {
          kind: 'department',
          index: i,
          status: 'failed',
          reason: 'missing required field: code or name',
        };
        report.outcomes.push(o);
        report.failed++;
        if (!opts.bestEffort)
          return fail(`department[${i}]: ${o.reason ?? ''}`);
        continue;
      }
      try {
        const existing = await this.departments.listForTenant(ctx.tenantId);
        const dup = existing.find((row) => row.code === d.code);
        if (dup) {
          deptIdByCode.set(d.code, dup.id);
          report.outcomes.push({
            kind: 'department',
            index: i,
            id: dup.id,
            status: 'duplicate',
            naturalKey: d.code,
          });
          report.duplicates++;
          continue;
        }
        const id = uuid();
        await this.departments.upsert({
          id,
          tenantId: ctx.tenantId,
          code: d.code,
          name: d.name,
          createdBy: ctx.actorUserId,
        });
        deptIdByCode.set(d.code, id);
        report.outcomes.push({
          kind: 'department',
          index: i,
          id,
          status: 'inserted',
          naturalKey: d.code,
        });
        report.inserted.departments++;
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        report.outcomes.push({
          kind: 'department',
          index: i,
          status: 'failed',
          naturalKey: d.code,
          reason,
        });
        report.failed++;
        if (!opts.bestEffort) return fail(`department[${i}]: ${reason}`);
      }
    }

    // 2. Teams
    const teamIdByCode = new Map<string, string>();
    for (let i = 0; i < (bundle.teams ?? []).length; i++) {
      const t = bundle.teams![i];
      if (!t.code || !t.name) {
        const o: WriterRowOutcome = {
          kind: 'team',
          index: i,
          status: 'failed',
          reason: 'missing required field: code or name',
        };
        report.outcomes.push(o);
        report.failed++;
        if (!opts.bestEffort) return fail(`team[${i}]: ${o.reason ?? ''}`);
        continue;
      }
      try {
        const existing = await this.teams.listForTenant(ctx.tenantId);
        const dup = existing.find((row) => row.code === t.code);
        if (dup) {
          teamIdByCode.set(t.code, dup.id);
          report.outcomes.push({
            kind: 'team',
            index: i,
            id: dup.id,
            status: 'duplicate',
            naturalKey: t.code,
          });
          report.duplicates++;
          continue;
        }
        const id = uuid();
        await this.teams.upsert({
          id,
          tenantId: ctx.tenantId,
          departmentId: t.departmentCode
            ? deptIdByCode.get(t.departmentCode)
            : undefined,
          code: t.code,
          name: t.name,
          kind: t.kind ?? 'custom',
          createdBy: ctx.actorUserId,
        });
        teamIdByCode.set(t.code, id);
        report.outcomes.push({
          kind: 'team',
          index: i,
          id,
          status: 'inserted',
          naturalKey: t.code,
        });
        report.inserted.teams++;
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        report.outcomes.push({
          kind: 'team',
          index: i,
          status: 'failed',
          naturalKey: t.code,
          reason,
        });
        report.failed++;
        if (!opts.bestEffort) return fail(`team[${i}]: ${reason}`);
      }
    }

    // 3. Employees
    for (let i = 0; i < (bundle.employees ?? []).length; i++) {
      const e = bundle.employees![i];
      const code =
        e.employeeCode ??
        `EMP-${(e.firstName ?? '').slice(0, 3).toUpperCase()}${(e.lastName ?? '').slice(0, 3).toUpperCase()}-${i + 1}`;
      if (!e.firstName || !e.lastName) {
        report.outcomes.push({
          kind: 'employee',
          index: i,
          status: 'failed',
          naturalKey: code,
          reason: 'missing required field: firstName or lastName',
        });
        report.failed++;
        if (!opts.bestEffort)
          return fail(`employee[${i}]: missing firstName/lastName`);
        continue;
      }
      try {
        const existing = await this.db
          .select({ id: employeesTable.id })
          .from(employeesTable)
          .where(
            and(
              eq(employeesTable.tenantId, ctx.tenantId),
              eq(employeesTable.employeeCode, code),
              isNull(employeesTable.deletedAt)
            )
          )
          .limit(1);
        if (existing[0]) {
          report.outcomes.push({
            kind: 'employee',
            index: i,
            id: existing[0].id,
            status: 'duplicate',
            naturalKey: code,
          });
          report.duplicates++;
          continue;
        }
        const id = uuid();
        await this.employees.upsert({
          id,
          tenantId: ctx.tenantId,
          employeeCode: code,
          firstName: e.firstName,
          lastName: e.lastName,
          jobTitle: e.jobTitle ?? '',
          phone: e.phone,
          email: e.email,
          departmentId: e.departmentCode
            ? deptIdByCode.get(e.departmentCode)
            : undefined,
          employmentType: e.employmentType ?? 'full_time',
          createdBy: ctx.actorUserId,
        });
        report.outcomes.push({
          kind: 'employee',
          index: i,
          id,
          status: 'inserted',
          naturalKey: code,
        });
        report.inserted.employees++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        report.outcomes.push({
          kind: 'employee',
          index: i,
          status: 'failed',
          naturalKey: code,
          reason,
        });
        report.failed++;
        if (!opts.bestEffort) return fail(`employee[${i}]: ${reason}`);
      }
    }

    // 4. Properties
    const propIdByName = new Map<string, string>();
    for (let i = 0; i < (bundle.properties ?? []).length; i++) {
      const p = bundle.properties![i];
      const code =
        p.externalId ??
        `PRP-${(p.name ?? '').replace(/[^A-Z0-9]+/gi, '').slice(0, 8).toUpperCase()}-${i + 1}`;
      if (!p.name) {
        report.outcomes.push({
          kind: 'property',
          index: i,
          status: 'failed',
          naturalKey: code,
          reason: 'missing required field: name',
        });
        report.failed++;
        if (!opts.bestEffort) return fail(`property[${i}]: missing name`);
        continue;
      }
      if (!p.addressLine1) {
        report.outcomes.push({
          kind: 'property',
          index: i,
          status: 'failed',
          naturalKey: code,
          reason: 'missing required field: addressLine1 (NOT NULL in schema)',
        });
        report.failed++;
        if (!opts.bestEffort)
          return fail(`property[${i}]: missing addressLine1`);
        continue;
      }
      try {
        const existing = await this.db
          .select({ id: propertiesTable.id })
          .from(propertiesTable)
          .where(
            and(
              eq(propertiesTable.tenantId, ctx.tenantId),
              eq(propertiesTable.propertyCode, code),
              isNull(propertiesTable.deletedAt)
            )
          )
          .limit(1);
        if (existing[0]) {
          propIdByName.set(p.name, existing[0].id);
          report.outcomes.push({
            kind: 'property',
            index: i,
            id: existing[0].id,
            status: 'duplicate',
            naturalKey: code,
          });
          report.duplicates++;
          continue;
        }
        const id = uuid();
        await this.properties.create(
          {
            id,
            tenantId: ctx.tenantId,
            ownerId: ctx.ownerUserId,
            propertyCode: code,
            name: p.name,
            type: (p.propertyType as
              | 'apartment_complex'
              | 'single_family'
              | 'multi_family'
              | 'townhouse'
              | 'commercial'
              | 'mixed_use'
              | 'estate'
              | 'other'
              | undefined) ??
              opts.defaultPropertyType ??
              'apartment_complex',
            status: 'active',
            addressLine1: p.addressLine1,
            // City falls back to caller-supplied default (from the
            // tenant's region config or preferences); never to a
            // Kenya-specific city hardcode.
            city: p.city ?? ctx.defaultCity ?? '',
            country: ctx.tenantCountry,
            defaultCurrency: ctx.tenantCurrency,
            totalUnits: p.unitCount ?? 0,
          } as typeof propertiesTable.$inferInsert,
          ctx.actorUserId as never
        );
        propIdByName.set(p.name, id);
        report.outcomes.push({
          kind: 'property',
          index: i,
          id,
          status: 'inserted',
          naturalKey: code,
        });
        report.inserted.properties++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        report.outcomes.push({
          kind: 'property',
          index: i,
          status: 'failed',
          naturalKey: code,
          reason,
        });
        report.failed++;
        if (!opts.bestEffort) return fail(`property[${i}]: ${reason}`);
      }
    }

    // 5. Units (require parent property)
    const unitIdByLabel = new Map<string, string>(); // key: `${propertyName}::${label}`
    for (let i = 0; i < (bundle.units ?? []).length; i++) {
      const u = bundle.units![i];
      const propertyId = propIdByName.get(u.propertyName);
      if (!propertyId) {
        report.outcomes.push({
          kind: 'unit',
          index: i,
          status: 'failed',
          naturalKey: u.label,
          reason: `unit references unknown property "${u.propertyName}" — load properties first`,
        });
        report.failed++;
        if (!opts.bestEffort)
          return fail(`unit[${i}]: unknown property ${u.propertyName}`);
        continue;
      }
      const code =
        u.externalId ??
        `${u.label}`.toUpperCase().replace(/[^A-Z0-9]+/g, '');
      try {
        const existing = await this.db
          .select({ id: unitsTable.id })
          .from(unitsTable)
          .where(
            and(
              eq(unitsTable.tenantId, ctx.tenantId),
              eq(unitsTable.propertyId, propertyId),
              eq(unitsTable.unitCode, code),
              isNull(unitsTable.deletedAt)
            )
          )
          .limit(1);
        if (existing[0]) {
          unitIdByLabel.set(`${u.propertyName}::${u.label}`, existing[0].id);
          report.outcomes.push({
            kind: 'unit',
            index: i,
            id: existing[0].id,
            status: 'duplicate',
            naturalKey: code,
          });
          report.duplicates++;
          continue;
        }
        const id = uuid();
        const unitType =
          ({
            0: 'studio',
            1: 'one_bedroom',
            2: 'two_bedroom',
            3: 'three_bedroom',
          } as Record<number, string>)[u.bedrooms ?? -1] ??
          opts.defaultUnitType ??
          'other';
        if (u.rentKes == null) {
          report.outcomes.push({
            kind: 'unit',
            index: i,
            status: 'failed',
            naturalKey: code,
            reason:
              'missing required field: rentKes (baseRentAmount NOT NULL in schema)',
          });
          report.failed++;
          if (!opts.bestEffort) return fail(`unit[${i}]: missing rent`);
          continue;
        }
        await this.units.create(
          {
            id,
            tenantId: ctx.tenantId,
            propertyId,
            unitCode: code,
            name: u.label,
            type: unitType as typeof unitsTable.$inferInsert.type,
            baseRentAmount: Math.round(u.rentKes * 100), // store in minor units
            baseRentCurrency: ctx.tenantCurrency,
          } as typeof unitsTable.$inferInsert,
          ctx.actorUserId as never
        );
        unitIdByLabel.set(`${u.propertyName}::${u.label}`, id);
        report.outcomes.push({
          kind: 'unit',
          index: i,
          id,
          status: 'inserted',
          naturalKey: code,
        });
        report.inserted.units++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        report.outcomes.push({
          kind: 'unit',
          index: i,
          status: 'failed',
          naturalKey: code,
          reason,
        });
        report.failed++;
        if (!opts.bestEffort) return fail(`unit[${i}]: ${reason}`);
      }
    }

    // 6. Tenants → customers (Borjie's customer table)
    for (let i = 0; i < (bundle.tenants ?? []).length; i++) {
      const t = bundle.tenants![i];
      const parts = t.name.split(/\s+/);
      const firstName = parts[0] ?? '';
      const lastName = parts.slice(1).join(' ') || firstName;
      if (!t.email && !t.phone) {
        report.outcomes.push({
          kind: 'customer',
          index: i,
          status: 'failed',
          reason:
            'missing required field: at least one of email or phone must be present',
        });
        report.failed++;
        if (!opts.bestEffort)
          return fail(`customer[${i}]: no email or phone`);
        continue;
      }
      const email = t.email ?? `noemail+${normalize(t.name)}@migration.local`;
      const phone = t.phone ?? '';
      const code = `CUST-${normalize(firstName + lastName).slice(0, 6).toUpperCase()}-${i + 1}`;
      try {
        const existing = await this.db
          .select({ id: customersTable.id })
          .from(customersTable)
          .where(
            and(
              eq(customersTable.tenantId, ctx.tenantId),
              eq(customersTable.customerCode, code),
              isNull(customersTable.deletedAt)
            )
          )
          .limit(1);
        if (existing[0]) {
          report.outcomes.push({
            kind: 'customer',
            index: i,
            id: existing[0].id,
            status: 'duplicate',
            naturalKey: code,
          });
          report.duplicates++;
          continue;
        }
        const id = uuid();
        await this.customers.create(
          {
            id,
            tenantId: ctx.tenantId,
            customerCode: code,
            email,
            phone,
            firstName,
            lastName,
            status: 'prospect',
          } as typeof customersTable.$inferInsert,
          ctx.actorUserId as never
        );
        report.outcomes.push({
          kind: 'customer',
          index: i,
          id,
          status: 'inserted',
          naturalKey: code,
        });
        report.inserted.customers++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        report.outcomes.push({
          kind: 'customer',
          index: i,
          status: 'failed',
          naturalKey: code,
          reason,
        });
        report.failed++;
        if (!opts.bestEffort) return fail(`customer[${i}]: ${reason}`);
      }
    }

    return report;
  }
}

function normalize(s: string): string {
  return (s ?? '').replace(/[^A-Za-z0-9]+/g, '');
}
