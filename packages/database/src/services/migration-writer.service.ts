/**
 * MigrationWriterService — TODO(borjie-hard-fork) stub.
 *
 * The original implementation transactionally committed property-
 * domain bundles (properties, units, customers, employees, teams,
 * departments) into the live database. Every consuming schema was
 * removed in migration 0003_mining_domain.sql, so this file is now a
 * type-preserving shim that reports zero writes for every batch.
 *
 * Rebuild for the mining-domain bundles (shipments, assays,
 * production-sales, mining-licences, workforce rosters, etc.) once
 * those importers are written. Until then the kernel composition
 * roots that wire the writer can keep their wiring without crashing.
 */

import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';

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
  externalId?: string;
  code: string;
  name: string;
  parentCode?: string;
}

export interface TeamDraft {
  externalId?: string;
  code: string;
  name: string;
  departmentCode?: string;
}

export interface ExtractedBundle {
  readonly properties?: ReadonlyArray<PropertyDraft>;
  readonly units?: ReadonlyArray<UnitDraft>;
  readonly tenants?: ReadonlyArray<TenantDraft>;
  readonly employees?: ReadonlyArray<EmployeeDraft>;
  readonly departments?: ReadonlyArray<DepartmentDraft>;
  readonly teams?: ReadonlyArray<TeamDraft>;
}

export type WriterRowOutcome =
  | { kind: 'inserted'; id: string }
  | { kind: 'skipped'; reason: 'duplicate' | 'invalid' }
  | { kind: 'error'; message: string };

export interface WriterReport {
  readonly properties: ReadonlyArray<WriterRowOutcome>;
  readonly units: ReadonlyArray<WriterRowOutcome>;
  readonly tenants: ReadonlyArray<WriterRowOutcome>;
  readonly employees: ReadonlyArray<WriterRowOutcome>;
  readonly departments: ReadonlyArray<WriterRowOutcome>;
  readonly teams: ReadonlyArray<WriterRowOutcome>;
  readonly aborted: boolean;
}

export interface WriterOptions {
  readonly bestEffort?: boolean;
  readonly tenantId: string;
  readonly createdBy: string;
}

export class MigrationWriterService {
  constructor(private readonly db: DatabaseClient) {}

  async write(
    _bundle: ExtractedBundle,
    options: WriterOptions,
  ): Promise<WriterReport> {
    logger.warn(
      'migration-writer: stub invoked; property-domain tables removed in mining hard-fork',
      { tenantId: options.tenantId, createdBy: options.createdBy },
    );
    return {
      properties: [],
      units: [],
      tenants: [],
      employees: [],
      departments: [],
      teams: [],
      aborted: true,
    };
  }
}
