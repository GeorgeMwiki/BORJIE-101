/**
 * Materialised-path builder (Wave 18X §2).
 *
 * The single authority that ever computes an org-unit's slashed
 * ancestry string. Used by the tree builder when inserting a new unit
 * and by the ancestor resolver when reasoning over an existing tree.
 *
 * The path is a lowercased ASCII-slug join of the tenant id + every
 * ancestor's slug, separated by '/'. It is intentionally a string —
 * Postgres has a `ltree` extension we may upgrade to in a later wave,
 * but a stable string keeps the migration ergonomics simple.
 */

const SLUG_REPLACE_RE = /[^a-z0-9]+/g;
const SLUG_TRIM_RE = /^-+|-+$/g;

/**
 * Lowercase + non-alphanumeric → `-` + trim. Empty input becomes `'_'`
 * so the path never contains a `//` pair.
 */
export function slugify(input: string): string {
  if (input.length === 0) {
    return '_';
  }
  const lowered = input.toLowerCase();
  const replaced = lowered.replace(SLUG_REPLACE_RE, '-');
  const trimmed = replaced.replace(SLUG_TRIM_RE, '');
  return trimmed.length === 0 ? '_' : trimmed;
}

/**
 * Build the materialised path for a new org-unit being inserted as a
 * child of `parentPath`. The tenant id slugged is the root segment.
 *
 * @param tenantId   the tenant root identifier
 * @param parentPath the parent unit's full path, or `null` when the
 *                   new unit is a top-level org unit (depth = 1)
 * @param displayName the new unit's tenant-facing name
 */
export function buildChildPath(
  tenantId: string,
  parentPath: string | null,
  displayName: string,
): string {
  const childSlug = slugify(displayName);
  if (parentPath === null) {
    return `${slugify(tenantId)}/${childSlug}`;
  }
  return `${parentPath}/${childSlug}`;
}

/**
 * The path used by user-scope-bindings whose `scope_kind = 'tenant_root'`.
 * Distinct from any real org unit's path.
 */
export function buildTenantRootPath(tenantId: string): string {
  return slugify(tenantId);
}

/**
 * Whether `descendantPath` lies within the subtree rooted at
 * `ancestorPath`. The check uses a slash-delimited prefix match so
 * `north-zone` does NOT match `north-zone-2`.
 */
export function isDescendantPath(
  descendantPath: string,
  ancestorPath: string,
): boolean {
  if (descendantPath === ancestorPath) {
    return true;
  }
  return descendantPath.startsWith(`${ancestorPath}/`);
}
