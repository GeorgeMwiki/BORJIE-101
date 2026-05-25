/**
 * Worked example #1 — Drizzle row → domain entity.
 *
 * `DrizzleACL` is a typed subclass-friendly base. Show a concrete
 * sample (Tenant) for ergonomics. The pattern is: snake_case columns
 * with null-flavored absences in the row → camelCase domain with
 * branded id + null-removed value objects.
 *
 * Real usage: each domain aggregate gets its own subclass at the
 * boundary between the repository and the domain service.
 */

import { BaseACL, type BaseACLOptions } from "./base-acl.js";

/** Branded id — enforces that you can't pass a raw string. */
export type TenantId = string & { readonly __brand: "TenantId" };

/** Drizzle row shape (snake_case, nullable). */
export interface DrizzleTenantRow {
  readonly id: string;
  readonly display_name: string;
  readonly country_code: string;
  readonly created_at: Date;
  readonly deleted_at: Date | null;
}

/** Domain shape (camelCase, branded, no null leaks). */
export interface DomainTenant {
  readonly id: TenantId;
  readonly displayName: string;
  readonly countryCode: string;
  readonly createdAt: Date;
  /** Soft-deleted tenants are absent from queries; if loaded, flagged. */
  readonly isDeleted: boolean;
}

export class TenantDrizzleACL extends BaseACL<DomainTenant, DrizzleTenantRow> {
  constructor(opts: BaseACLOptions = {}) {
    super(opts);
  }

  protected override mapToDomain(row: DrizzleTenantRow): DomainTenant {
    return {
      id: row.id as TenantId,
      displayName: row.display_name,
      countryCode: row.country_code,
      createdAt: row.created_at,
      isDeleted: row.deleted_at !== null,
    };
  }

  protected override mapFromDomain(domain: DomainTenant): DrizzleTenantRow {
    return {
      id: domain.id,
      display_name: domain.displayName,
      country_code: domain.countryCode,
      created_at: domain.createdAt,
      deleted_at: domain.isDeleted ? new Date() : null,
    };
  }
}
