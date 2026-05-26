/**
 * Org-unit tree builder (Wave 18X §2).
 *
 * Pure transformation from a flat array of `OrgUnit` rows (typically
 * just fetched from Postgres) into an in-memory adjacency map keyed by
 * unit id. Callers ingest the result into the rest of the resolvers
 * without re-querying the database.
 *
 * The builder enforces two invariants:
 *   - every row's `tenant_id` matches the supplied `tenantId`
 *   - `materialised_path` is consistent with `parent_unit_id`
 *
 * Inconsistencies surface as `TreeBuildError`. The caller decides
 * whether to crash, log, or attempt a self-heal.
 */

import type { OrgUnit } from '../types.js';

export interface OrgUnitTree {
  readonly tenantId: string;
  /** id → unit row. Includes every input unit. */
  readonly byId: ReadonlyMap<string, OrgUnit>;
  /** id → ordered array of direct children. */
  readonly childrenByParent: ReadonlyMap<string | null, ReadonlyArray<OrgUnit>>;
  /** Top-level units (those with `parent_unit_id = null`). */
  readonly roots: ReadonlyArray<OrgUnit>;
}

export class TreeBuildError extends Error {
  public override readonly name = 'TreeBuildError';
  public constructor(
    message: string,
    public readonly tenantId: string,
    public readonly unitId: string | null,
  ) {
    super(message);
  }
}

export interface BuildTreeInput {
  readonly tenantId: string;
  readonly units: ReadonlyArray<OrgUnit>;
}

export function buildOrgUnitTree({ tenantId, units }: BuildTreeInput): OrgUnitTree {
  const byId = new Map<string, OrgUnit>();
  const childrenByParent = new Map<string | null, OrgUnit[]>();

  for (const unit of units) {
    if (unit.tenant_id !== tenantId) {
      throw new TreeBuildError(
        `unit ${unit.id} tenant_id=${unit.tenant_id} mismatches expected ${tenantId}`,
        tenantId,
        unit.id,
      );
    }
    if (byId.has(unit.id)) {
      throw new TreeBuildError(
        `duplicate unit id ${unit.id} in input`,
        tenantId,
        unit.id,
      );
    }
    byId.set(unit.id, unit);
  }

  // Group by parent_unit_id (null = top-level).
  for (const unit of units) {
    const parentKey = unit.parent_unit_id;
    if (parentKey !== null && !byId.has(parentKey)) {
      throw new TreeBuildError(
        `unit ${unit.id} references unknown parent ${parentKey}`,
        tenantId,
        unit.id,
      );
    }
    const bucket = childrenByParent.get(parentKey);
    if (bucket === undefined) {
      childrenByParent.set(parentKey, [unit]);
    } else {
      bucket.push(unit);
    }
  }

  // Stable child ordering: by display_name asc, then id asc.
  for (const bucket of childrenByParent.values()) {
    bucket.sort((a, b) => {
      const byName = a.display_name.localeCompare(b.display_name);
      return byName !== 0 ? byName : a.id.localeCompare(b.id);
    });
  }

  const roots = childrenByParent.get(null) ?? [];

  // Freeze child arrays so callers can't mutate.
  const frozenChildrenByParent = new Map<string | null, ReadonlyArray<OrgUnit>>();
  for (const [parent, children] of childrenByParent.entries()) {
    frozenChildrenByParent.set(parent, Object.freeze([...children]));
  }

  return {
    tenantId,
    byId,
    childrenByParent: frozenChildrenByParent,
    roots: Object.freeze([...roots]),
  };
}
