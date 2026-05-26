/**
 * Stage 4.c — Migration filename allocator.
 *
 * Pure helper. Given the highest existing migration number, returns
 * the next zero-padded four-digit slot. The actual filesystem write
 * happens out-of-band (a sibling tool ships the file once approval
 * lands); this module only computes the canonical filename so the
 * proposal can preview it for the owner.
 */

const FILENAME_SUFFIX_RE = /^[0-9]{4}_[a-z0-9_]+\.sql$/;

export function nextMigrationFilename(
  highest_existing: number,
  slug: string,
): string {
  if (!Number.isInteger(highest_existing) || highest_existing < 0) {
    throw new Error('highest_existing must be a non-negative integer');
  }
  const next = highest_existing + 1;
  const padded = next.toString().padStart(4, '0');
  const safe_slug = slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (safe_slug.length === 0) {
    throw new Error('slug must be non-empty after sanitisation');
  }
  return `${padded}_${safe_slug}.sql`;
}

export function isValidMigrationFilename(name: string): boolean {
  return FILENAME_SUFFIX_RE.test(name);
}
