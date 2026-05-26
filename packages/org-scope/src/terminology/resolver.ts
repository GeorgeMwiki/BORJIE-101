/**
 * Terminology resolver (Wave 18X §4).
 *
 * Resolution order, deterministic:
 *
 *   1. exact (tenant_id, org_unit_id, key) override
 *   2. walk up the materialised path — each ancestor org_unit's override
 *   3. tenant-wide override (tenant_id, null, key)
 *   4. catalogue default
 *   5. the key itself (defensive)
 *
 * The function returns a `ResolvedTerminology` whose Map covers every
 * default key (so the UI never has to handle a missing entry). Each
 * entry's `source` tells the audit chain where the resolved value
 * came from for transparency.
 */

import type { OrgUnitTree } from '../hierarchy/org-unit-tree-builder.js';
import { isDescendantPath } from '../hierarchy/path-builder.js';
import type {
  ResolvedTerminology,
  ResolvedTerminologyEntry,
  TerminologyOverride,
} from '../types.js';
import {
  DEFAULT_TERMINOLOGY,
  DEFAULT_TERMINOLOGY_BY_KEY,
} from './defaults.js';

export interface ResolveTerminologyInput {
  readonly tenantId: string;
  readonly scopePath: string | null;
  readonly tree: OrgUnitTree;
  readonly overrides: ReadonlyArray<TerminologyOverride>;
}

export function resolveTerminologyForScope(
  input: ResolveTerminologyInput,
): ResolvedTerminology {
  const { tenantId, scopePath, tree, overrides } = input;

  // Index overrides by key for O(N) total walk per resolve call.
  const overridesByKey = new Map<string, TerminologyOverride[]>();
  for (const override of overrides) {
    if (override.tenant_id !== tenantId) {
      continue;
    }
    const bucket = overridesByKey.get(override.key);
    if (bucket === undefined) {
      overridesByKey.set(override.key, [override]);
    } else {
      bucket.push(override);
    }
  }

  const entries = new Map<string, ResolvedTerminologyEntry>();
  for (const fallback of DEFAULT_TERMINOLOGY) {
    const bucket = overridesByKey.get(fallback.key) ?? [];
    const winner = pickBestOverride(bucket, scopePath, tree);
    if (winner === null) {
      entries.set(fallback.key, {
        key: fallback.key,
        singular_en: fallback.singular_en,
        plural_en: fallback.plural_en,
        singular_sw: fallback.singular_sw,
        plural_sw: fallback.plural_sw,
        source: 'default',
      });
    } else {
      const fallbackSw = DEFAULT_TERMINOLOGY_BY_KEY.get(fallback.key);
      entries.set(fallback.key, {
        key: fallback.key,
        singular_en: winner.override.singular_en,
        plural_en: winner.override.plural_en,
        singular_sw:
          winner.override.singular_sw ?? fallbackSw?.singular_sw ?? fallback.singular_sw,
        plural_sw: winner.override.plural_sw ?? fallbackSw?.plural_sw ?? fallback.plural_sw,
        source: winner.source,
      });
    }
  }

  return {
    tenant_id: tenantId,
    scope_path: scopePath,
    entries,
  };
}

interface OverridePick {
  readonly override: TerminologyOverride;
  readonly source: 'tenant' | 'org_unit' | 'ancestor';
}

/**
 * Pick the highest-priority override out of a candidate bucket:
 *
 *   - exact path match           → org_unit
 *   - ancestor of `scopePath`    → ancestor (closest wins via path length)
 *   - tenant-wide (org_unit_id null) → tenant
 *
 * Returns `null` when no override applies.
 */
function pickBestOverride(
  bucket: ReadonlyArray<TerminologyOverride>,
  scopePath: string | null,
  tree: OrgUnitTree,
): OverridePick | null {
  if (bucket.length === 0) {
    return null;
  }

  let exact: TerminologyOverride | null = null;
  let bestAncestor: { override: TerminologyOverride; ancestorPath: string } | null = null;
  let tenantWide: TerminologyOverride | null = null;

  for (const override of bucket) {
    if (override.org_unit_id === null) {
      tenantWide = override;
      continue;
    }
    const unit = tree.byId.get(override.org_unit_id);
    if (unit === undefined) {
      continue;
    }
    if (scopePath !== null && unit.materialised_path === scopePath) {
      exact = override;
      continue;
    }
    if (scopePath !== null && isDescendantPath(scopePath, unit.materialised_path)) {
      if (
        bestAncestor === null ||
        unit.materialised_path.length > bestAncestor.ancestorPath.length
      ) {
        bestAncestor = { override, ancestorPath: unit.materialised_path };
      }
    }
  }

  if (exact !== null) {
    return { override: exact, source: 'org_unit' };
  }
  if (bestAncestor !== null) {
    return { override: bestAncestor.override, source: 'ancestor' };
  }
  if (tenantWide !== null) {
    return { override: tenantWide, source: 'tenant' };
  }
  return null;
}

/**
 * Convenience: render the singular form of a term given a resolved
 * terminology map. Returns the key as a defensive fallback.
 */
export function term(
  resolved: ResolvedTerminology,
  key: string,
  options?: { readonly plural?: boolean; readonly lang?: 'en' | 'sw' },
): string {
  const entry = resolved.entries.get(key);
  const plural = options?.plural === true;
  const lang = options?.lang ?? 'en';
  if (entry === undefined) {
    return key;
  }
  if (lang === 'sw') {
    return plural ? entry.plural_sw : entry.singular_sw;
  }
  return plural ? entry.plural_en : entry.singular_en;
}
