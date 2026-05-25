/**
 * `@borjie/supabase-client` — public surface.
 *
 * Typed wrappers around `@supabase/supabase-js` for the three calling
 * patterns we support across the platform:
 *
 *   - Admin: service-role key, bypasses RLS. Background jobs, system tasks.
 *   - User: anon key + access token, enforces RLS via `auth.uid()`.
 *   - RLS-aware: service role with per-request tenant context binding.
 *     The bridge that lets server-side code use the service role
 *     without losing RLS safety.
 */

export {
  createSupabaseAdminClient,
  type AdminClientOptions,
} from './admin-client.js';

export {
  createSupabaseUserClient,
  type UserClientInput,
  type UserClientOptions,
} from './user-client.js';

export {
  createSupabaseRlsAwareClient,
  type RlsAwareClient,
  type RlsAwareClientInput,
} from './rls-aware-client.js';

export {
  getOrCreateSupabaseSchema,
  EXPECTED_BUCKETS,
  type ExpectedBucket,
  type SchemaReport,
} from './schema-check.js';

export {
  RlsContextSchema,
  SupabaseClientError,
  SupabaseConfigError,
  SupabaseConfigSchema,
  SupabaseSchemaError,
  type RlsContext,
  type SupabaseClient,
  type SupabaseConfig,
  type SupabaseErrorKind,
  type SupabaseSession,
} from './types.js';
