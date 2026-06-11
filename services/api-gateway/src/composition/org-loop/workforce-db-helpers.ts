/**
 * workforce-db-helpers.ts — the narrow db seam + shared row/RLS helpers the
 * workforce adapters share (extracted to keep each adapter file <800).
 *
 * The org-loop cron path is OUT OF BAND (no request middleware binds the
 * tenant GUC), so every write runs under `withServiceRoleContext` — the same
 * service-role bypass the md-commitment-repository uses. Every query is ALSO
 * explicitly tenant-scoped in SQL as defence in depth.
 */

import { withServiceRoleContext, createDatabaseClient } from '@borjie/database';

// `DatabaseClient` collides with a drizzle-orm/postgres-js namespace
// declaration when imported by name (TS2709). Derive the type locally from
// the factory return — the same pattern estate-mind-wiring.ts uses.
export type DatabaseClient = ReturnType<typeof createDatabaseClient>;

/** The minimal db surface this wiring binds (raw SQL execute seam). */
export interface DbExecLike {
  execute(query: unknown): Promise<unknown>;
}

export function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function rowsOf(
  result: unknown,
): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const rows = (result as { rows?: ReadonlyArray<Record<string, unknown>> })
    ?.rows;
  return Array.isArray(rows) ? rows : [];
}

export function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

export function asNullableString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Run a callback under the right RLS context. The org-loop cron path is
 * out-of-band (no request middleware binds the GUC), so it MUST use the
 * service-role bypass; the spine's primary driver is the cron.
 */
export function withCtx<T>(
  db: DatabaseClient,
  fn: (tx: DatabaseClient) => Promise<T>,
): Promise<T> {
  return withServiceRoleContext(db, fn);
}

/** crypto.randomUUID without a top-level node:crypto import collision. */
export function cryptoRandomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

/** SHA-256 hex over a string (WebCrypto). Used by the audit-chain stitch. */
export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
