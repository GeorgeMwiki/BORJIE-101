/**
 * Terminology override repository port (Wave 18X §4).
 *
 * The interface a sibling package implements against Drizzle (or any
 * other persistence layer) to read & write `terminology_overrides`.
 *
 * The repository is intentionally minimal — CRUD by tenant + optional
 * org_unit + optional key. Resolution logic lives in `resolver.ts`;
 * the repo only fetches rows and never enforces business rules.
 */

import type { TerminologyOverride } from '../types.js';

export interface ListOverridesQuery {
  readonly tenantId: string;
  readonly orgUnitId?: string | null;
  readonly key?: string;
}

export interface UpsertOverrideInput {
  readonly tenantId: string;
  readonly orgUnitId: string | null;
  readonly key: string;
  readonly singularEn: string;
  readonly pluralEn: string;
  readonly singularSw: string | null;
  readonly pluralSw: string | null;
  readonly overriddenBy: string;
}

export interface TerminologyOverrideRepository {
  list(query: ListOverridesQuery): Promise<ReadonlyArray<TerminologyOverride>>;
  upsert(input: UpsertOverrideInput): Promise<TerminologyOverride>;
  remove(id: string): Promise<void>;
}

/**
 * In-memory repository — useful for tests and for any sibling package
 * that wants to compose a resolver with a fixture set.
 */
export class InMemoryTerminologyOverrideRepository
  implements TerminologyOverrideRepository
{
  private readonly rows = new Map<string, TerminologyOverride>();

  public async list(query: ListOverridesQuery): Promise<ReadonlyArray<TerminologyOverride>> {
    const out: TerminologyOverride[] = [];
    for (const row of this.rows.values()) {
      if (row.tenant_id !== query.tenantId) continue;
      if (query.orgUnitId !== undefined && row.org_unit_id !== query.orgUnitId) continue;
      if (query.key !== undefined && row.key !== query.key) continue;
      out.push(row);
    }
    return out;
  }

  public async upsert(input: UpsertOverrideInput): Promise<TerminologyOverride> {
    const existing = this.findExisting(input.tenantId, input.orgUnitId, input.key);
    const id = existing?.id ?? `${input.tenantId}:${input.orgUnitId ?? 'root'}:${input.key}`;
    const next: TerminologyOverride = {
      id,
      tenant_id: input.tenantId,
      org_unit_id: input.orgUnitId,
      key: input.key,
      singular_en: input.singularEn,
      plural_en: input.pluralEn,
      singular_sw: input.singularSw,
      plural_sw: input.pluralSw,
      overridden_by: input.overriddenBy,
      overridden_at: new Date().toISOString(),
    };
    this.rows.set(id, next);
    return next;
  }

  public async remove(id: string): Promise<void> {
    this.rows.delete(id);
  }

  private findExisting(
    tenantId: string,
    orgUnitId: string | null,
    key: string,
  ): TerminologyOverride | undefined {
    for (const row of this.rows.values()) {
      if (
        row.tenant_id === tenantId &&
        row.org_unit_id === orgUnitId &&
        row.key === key
      ) {
        return row;
      }
    }
    return undefined;
  }
}
