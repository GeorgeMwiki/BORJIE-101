/**
 * User-scoped Supabase client. Uses the anon key plus the user's
 * access token so RLS policies see `auth.uid()` and the JWT claims.
 *
 * Use for request handlers acting on behalf of a signed-in user.
 * Safe to instantiate per request — the underlying transport is
 * stateless and the constructor is cheap.
 */

import { createClient, type SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js';
import { SupabaseConfigError, SupabaseConfigSchema, type SupabaseConfig } from './types.js';

export interface UserClientOptions {
  /** Override the default schema. Defaults to `public`. */
  readonly schema?: string;
}

export interface UserClientInput extends Pick<SupabaseConfig, 'url' | 'anonKey'> {
  /**
   * The user's access_token (from the Supabase Auth session). Attached
   * as `Authorization: Bearer <token>` on every request so RLS policies
   * see the correct `auth.uid()`.
   */
  readonly accessToken: string;
}

/**
 * Build a user-scoped Supabase client. Throws `SupabaseConfigError`
 * when required fields are missing.
 */
export function createSupabaseUserClient(
  input: UserClientInput,
  options: UserClientOptions = {},
): SupabaseClient {
  const parsed = SupabaseConfigSchema.pick({ url: true, anonKey: true }).safeParse(input);
  if (!parsed.success) {
    throw new SupabaseConfigError(
      `Invalid Supabase user config: ${parsed.error.message}`,
      parsed.error,
    );
  }
  if (!parsed.data.anonKey) {
    throw new SupabaseConfigError(
      'createSupabaseUserClient requires `anonKey` — RLS-enforcing client needs the public key.',
    );
  }
  if (!input.accessToken || input.accessToken.length < 16) {
    throw new SupabaseConfigError(
      'createSupabaseUserClient requires a non-empty `accessToken`.',
    );
  }

  const baseOptions = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'X-Client-Info': 'borjie-user/0.1.0',
      },
    },
  };
  // db.schema is typed `string & keyof Database['schema']` — Supabase
  // wants the consumer-typed Database parameter to make `string` legal.
  // We pass the schema name through an unknown-cast so the runtime
  // option flows without us declaring a fake Database type.
  const clientOptions = options.schema
    ? ({ ...baseOptions, db: { schema: options.schema } } as unknown as SupabaseClientOptions<string>)
    : (baseOptions as unknown as SupabaseClientOptions<string>);
  return createClient(parsed.data.url, parsed.data.anonKey, clientOptions) as SupabaseClient;
}
