/**
 * Descendant resolver (Wave 18X §2 + §6).
 *
 * Given a unit id, return every unit in the subtree rooted at it.
 * Used by:
 *   - VisibilityFilter expansion when `include_descendants = true`
 *   - The sub-org admin's "see your sub-units" tree view in admin-web
 *   - Bulk operations across a sub-tree (terminology overrides,
 *     mutation broadcasts)
 *
 * Walk is breadth-first so the immediate children come first in the
 * output — useful for rendering as an expandable tree.
 */

import type { OrgUnit } from '../types.js';
import type { OrgUnitTree } from './org-unit-tree-builder.js';

export function resolveDescendants(
  tree: OrgUnitTree,
  unitId: string,
): ReadonlyArray<OrgUnit> | null {
  const root = tree.byId.get(unitId);
  if (root === undefined) {
    return null;
  }

  const out: OrgUnit[] = [];
  const queue: string[] = [unitId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    const children = tree.childrenByParent.get(current);
    if (children === undefined) {
      continue;
    }
    for (const child of children) {
      out.push(child);
      queue.push(child.id);
    }
  }
  return Object.freeze(out);
}

/**
 * Collect the unit + its descendants. Convenient when applying a
 * VisibilityFilter that should include the focus unit itself.
 */
export function resolveSelfAndDescendants(
  tree: OrgUnitTree,
  unitId: string,
): ReadonlyArray<OrgUnit> | null {
  const root = tree.byId.get(unitId);
  if (root === undefined) {
    return null;
  }
  const descendants = resolveDescendants(tree, unitId) ?? [];
  const out: ReadonlyArray<OrgUnit> = [root, ...descendants];
  return Object.freeze(out);
}
