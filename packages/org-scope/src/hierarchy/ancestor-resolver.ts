/**
 * Ancestor resolver (Wave 18X §2 + §4).
 *
 * Given a unit id, return the ordered chain of ancestors (closest
 * first) by walking `parent_unit_id` through the pre-built tree.
 *
 * Used by:
 *   - terminology resolver (walk up looking for the nearest override)
 *   - visibility filter (does user binding's unit_id sit on this ancestry chain?)
 *   - authority checker (inherit Tier 2 from an ancestor when
 *     `authority_inheritance = true`)
 */

import type { OrgUnit } from '../types.js';
import type { OrgUnitTree } from './org-unit-tree-builder.js';

/**
 * Resolve the chain of ancestors for `unitId`, ordered closest-first.
 * The returned array does NOT include the unit itself.
 *
 * Returns `null` when the unit id is unknown to the tree.
 */
export function resolveAncestors(
  tree: OrgUnitTree,
  unitId: string,
): ReadonlyArray<OrgUnit> | null {
  const start = tree.byId.get(unitId);
  if (start === undefined) {
    return null;
  }

  const chain: OrgUnit[] = [];
  let cursor: string | null = start.parent_unit_id;
  // Bound the loop to the tree size to defensively prevent cycles in
  // malformed data — the builder should have rejected cycles, but a
  // belt-and-braces guard is cheap.
  let guard = tree.byId.size + 1;
  while (cursor !== null && guard > 0) {
    const ancestor = tree.byId.get(cursor);
    if (ancestor === undefined) {
      break;
    }
    chain.push(ancestor);
    cursor = ancestor.parent_unit_id;
    guard -= 1;
  }
  return Object.freeze(chain);
}

/**
 * Whether `candidateAncestorId` is a (possibly distant) ancestor of
 * `unitId`. Self-ancestry returns `false` — use `isSelfOrAncestor` for
 * the inclusive variant.
 */
export function isAncestor(
  tree: OrgUnitTree,
  candidateAncestorId: string,
  unitId: string,
): boolean {
  const ancestors = resolveAncestors(tree, unitId);
  if (ancestors === null) {
    return false;
  }
  return ancestors.some((a) => a.id === candidateAncestorId);
}

export function isSelfOrAncestor(
  tree: OrgUnitTree,
  candidateAncestorId: string,
  unitId: string,
): boolean {
  if (candidateAncestorId === unitId) {
    return tree.byId.has(unitId);
  }
  return isAncestor(tree, candidateAncestorId, unitId);
}
