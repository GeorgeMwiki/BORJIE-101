/**
 * RLS-aware admin client.
 *
 * Wraps the service-role Supabase client so every query is automatically
 * preceded by `set_config('app.current_tenant_id', <tenantId>, false)`
 * on the same Postgres session. This is the bridge between server-side
 * code that needs the convenience of the service role (no auth flow,
 * no token plumbing) AND the safety guarantees of RLS.
 *
 * Without this, a query that forgets to filter by `tenant_id` would
 * return rows from every tenant — exactly the kind of cross-tenant
 * leak that earned P21's GUC-bind hardening.
 *
 * Usage:
 * ```ts
 * const client = createSupabaseRlsAwareClient({
 *   url,
 *   serviceRoleKey,
 *   tenantId: 'tenant-uuid',
 *   userId: 'user-uuid',
 * });
 * await client.rls(async (sb) => {
 *   const { data } = await sb.from('leases').select('*');
 *   return data;
 * });
 * ```
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from './admin-client.js';
import {
  RlsContextSchema,
  SupabaseConfigError,
  type RlsContext,
  type SupabaseConfig,
} from './types.js';

export interface RlsAwareClientInput
  extends Pick<SupabaseConfig, 'url' | 'serviceRoleKey'>,
    RlsContext {}

export interface RlsAwareClient {
  /**
   * Run a callback with the RLS GUCs set on the underlying connection.
   * The GUCs are set per-RPC using Postgres' `set_config` function;
   * because Supabase routes through PgBouncer in transaction-mode,
   * the GUCs are scoped to the duration of each function call.
   */
  readonly rls: <T>(fn: (sb: SupabaseClient) => Promise<T>) => Promise<T>;
  /** Raw client, for migrations / admin tasks that should bypass RLS. */
  readonly raw: SupabaseClient;
  /** Tenant id that this client is bound to. */
  readonly tenantId: string;
}

/**
 * Build an RLS-aware client. Throws on invalid config.
 */
export function createSupabaseRlsAwareClient(
  input: RlsAwareClientInput,
): RlsAwareClient {
  const ctxParse = RlsContextSchema.safeParse({
    tenantId: input.tenantId,
    userId: input.userId,
    role: input.role,
  });
  if (!ctxParse.success) {
    throw new SupabaseConfigError(
      `Invalid RLS context: ${ctxParse.error.message}`,
      ctxParse.error,
    );
  }
  const ctx = ctxParse.data;

  const raw = createSupabaseAdminClient({
    url: input.url,
    serviceRoleKey: input.serviceRoleKey,
  });

  /**
   * `set_config(setting_name, new_value, is_local)` is the safe way to
   * propagate per-request settings to Postgres. With `is_local=false`
   * the value persists for the connection lifetime; combined with
   * PgBouncer txn-mode that means "for this RPC".
   *
   * We call it via `rpc('set_config', ...)` to avoid an explicit DDL
   * roundtrip. The function exists in Postgres core (`pg_catalog.set_config`).
   */
  const applyContext = async (sb: SupabaseClient): Promise<void> => {
    // `rpc()` on `pg_catalog.set_config` requires the function to be exposed
    // via a wrapper in the `public` schema. The migration in
    // `supabase/db-policies.sql` creates `public.set_tenant_context`.
    const { error } = await sb.rpc('set_tenant_context', {
      p_tenant_id: ctx.tenantId,
      p_user_id: ctx.userId ?? null,
    });
    if (error) {
      throw new SupabaseConfigError(
        `Failed to set RLS tenant context: ${error.message}`,
        error,
      );
    }
  };

  return {
    raw,
    tenantId: ctx.tenantId,
    rls: async <T>(fn: (sb: SupabaseClient) => Promise<T>): Promise<T> => {
      await applyContext(raw);
      return fn(raw);
    },
  };
}
