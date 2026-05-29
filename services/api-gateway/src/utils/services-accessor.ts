/**
 * Typed accessor over the per-request `services` bag.
 *
 * The composition middleware (`service-context.middleware.ts`) stores
 * a `ServiceRegistry` on every Hono context under the `services` key
 * but types it as `{ readonly [slot: string]: unknown }` so the
 * registry can hold an arbitrary number of slots without polluting
 * the global Hono `ContextVariableMap`.
 *
 * Most callers only need one or two slots (a `db` handle, a
 * feature-flag service, a domain repo). Re-asserting the precise
 * shape at every callsite is noisy; this helper lets routers fetch a
 * typed slot in one line while still emitting `undefined` for
 * environments where the registry is not live (DATABASE_URL unset in
 * tests, etc.).
 *
 *   const db = getService<DrizzleDb>(c, 'db');
 *   if (!db) return dbUnavailable(c);
 *   await db.select().from(...)
 *
 * Returns `undefined` (never throws) so route handlers can fall
 * through to their normal "service not wired" 503 path.
 */
import type { Context } from 'hono';

export function getService<T>(c: Context, slot: string): T | undefined {
  const bag = c.get('services') as Record<string, unknown> | undefined;
  if (!bag) return undefined;
  const value = bag[slot];
  return value as T | undefined;
}

/**
 * Convenience: fetch the Drizzle `db` handle from the registry.
 * Returns `any` because the api-gateway intentionally avoids the
 * cross-package Drizzle type to prevent a hard import cycle; callers
 * re-narrow locally where useful. This is the single sanctioned
 * `any`-typed accessor — any new ports should use {@link getService}
 * with a real generic.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- documented cross-package Drizzle type
export function getDbFromServices(c: Context): any {
  return getService(c, 'db');
}
