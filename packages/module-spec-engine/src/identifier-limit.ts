/**
 * identifier-limit.ts — the Postgres identifier-length wall.
 *
 * Postgres truncates any identifier longer than NAMEDATALEN-1 (63 bytes
 * in a default build) SILENTLY. Two distinct logical table names that
 * share their first 63 bytes would therefore collide into ONE physical
 * table — a cross-entity (or, with a crafted slug, a cross-tenant) data-
 * mixing hazard. The compiler refuses to emit any identifier over the
 * limit; the ddl-guard validator re-checks it at apply-time (defence in
 * depth — the compiler is not the only line).
 *
 * Byte length, not code-point length: our grammar is ASCII-only
 * (SLUG_REGEX is `[a-z0-9_]`), so byte length == char length here, but
 * we measure bytes explicitly so the bound is correct even if the
 * grammar ever widened.
 *
 * Pure. No I/O.
 */

/** Postgres NAMEDATALEN-1 — the max identifier length in bytes. */
export const PG_IDENTIFIER_MAX_BYTES = 63;

/** UTF-8 byte length of an identifier. */
export function identifierByteLength(name: string): number {
  return Buffer.byteLength(name, 'utf8');
}

/** True when an identifier exceeds the Postgres 63-byte limit. */
export function exceedsPgIdentifierLimit(name: string): boolean {
  return identifierByteLength(name) > PG_IDENTIFIER_MAX_BYTES;
}
