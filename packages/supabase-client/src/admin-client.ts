/**
 * Server-side admin client. Uses the service-role key which BYPASSES
 * Row-Level Security. NEVER expose this to the browser.
 *
 * Use the admin client for:
 *   - Background workers (cron jobs, queue consumers)
 *   - System-level migrations and seeders
 *   - Webhook handlers that need cross-tenant visibility
 *
 * For request-handlers serving authenticated users, prefer
 * `createSupabaseRlsAwareClient` so RLS still applies and a regression
 * in a query can't silently leak across tenants.
 */

import { createClient, type SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js';
import { SupabaseConfigError, SupabaseConfigSchema, type SupabaseConfig } from './types.js';

export interface AdminClientOptions {
  /** Override the default schema. Defaults to `public`. */
  readonly schema?: string;
  /**
   * Persist auth session? Should be `false` for server-side use because
   * the admin client has no concept of "current user".
   */
  readonly persistSession?: boolean;
}

/**
 * Build a Supabase admin client.
 *
 * Throws `SupabaseConfigError` if `serviceRoleKey` is missing — the
 * caller probably gave the anon key by accident, which would silently
 * enforce RLS and break system jobs.
 */
export function createSupabaseAdminClient(
  config: Pick<SupabaseConfig, 'url' | 'serviceRoleKey'>,
  options: AdminClientOptions = {},
): SupabaseClient {
  const parsed = SupabaseConfigSchema.pick({ url: true, serviceRoleKey: true }).safeParse(
    config,
  );
  if (!parsed.success) {
    throw new SupabaseConfigError(
      `Invalid Supabase admin config: ${parsed.error.message}`,
      parsed.error,
    );
  }
  if (!parsed.data.serviceRoleKey) {
    throw new SupabaseConfigError(
      'createSupabaseAdminClient requires `serviceRoleKey` — refusing to create an admin client with the anon key.',
    );
  }

  // Built without the `db` slot so the default `{schema: 'public'}` is
  // used unless the caller explicitly overrides via `options.schema`.
  // Casting to `any` is necessary because `createClient`'s overload
  // narrows the schema type to literal `'public'` when no Database
  // type-arg is supplied — adding a `db` field with a dynamic string
  // value triggers a `string is not assignable to never` error.
  const baseOptions = {
    auth: {
      persistSession: options.persistSession ?? false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        'X-Client-Info': 'borjie-admin/0.1.0',
      },
    },
  };
  // db.schema is typed against the consumer's Database typing; cast
  // through unknown so a runtime schema name is accepted without us
  // declaring a stub Database type just for the option.
  const clientOptions = options.schema
    ? ({ ...baseOptions, db: { schema: options.schema } } as unknown as SupabaseClientOptions<string>)
    : (baseOptions as unknown as SupabaseClientOptions<string>);
  return createClient(parsed.data.url, parsed.data.serviceRoleKey, clientOptions) as SupabaseClient;
}
