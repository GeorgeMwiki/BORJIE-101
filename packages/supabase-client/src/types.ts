/**
 * Shared types for the Supabase client wrappers.
 *
 * These are the public surface used by api-gateway, Brain routes, and
 * worker processes. The underlying `SupabaseClient` type from
 * `@supabase/supabase-js` is re-exported for downstream typing.
 */

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

export type { SupabaseClient };

/**
 * Project URL + key configuration. All three keys come from the Supabase
 * dashboard → Settings → API.
 *
 * - `serviceRoleKey` bypasses RLS — server-only.
 * - `anonKey` enforces RLS — safe for the browser.
 * - `url` is public.
 */
export const SupabaseConfigSchema = z.object({
  url: z.string().url(),
  serviceRoleKey: z.string().min(40).optional(),
  anonKey: z.string().min(40).optional(),
});

export type SupabaseConfig = z.infer<typeof SupabaseConfigSchema>;

/**
 * Per-request RLS context applied to every query made through the
 * `RlsAwareClient`. The `tenantId` is set via `set_config` on the
 * underlying Postgres session so RLS policies that read
 * `current_setting('app.current_tenant_id')` filter rows correctly.
 *
 * `userId` is propagated to `app.current_user_id` so audit triggers
 * can attribute the change to a principal.
 */
export const RlsContextSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1).optional(),
  role: z.string().optional(),
});

export type RlsContext = z.infer<typeof RlsContextSchema>;

/**
 * A Supabase Auth session — what the client gets after sign-in.
 */
export interface SupabaseSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number; // epoch seconds
  readonly userId: string;
  readonly email?: string | undefined;
  readonly tokenType: 'bearer';
}

/**
 * Errors thrown by this package. All errors share a discriminant
 * `kind` so callers can branch without reflection.
 */
export type SupabaseErrorKind =
  | 'SupabaseClientError'
  | 'SupabaseConfigError'
  | 'SupabaseSchemaError';

export class SupabaseClientError extends Error {
  readonly kind: SupabaseErrorKind;
  override readonly cause: unknown;
  constructor(
    message: string,
    cause?: unknown,
    kind: SupabaseErrorKind = 'SupabaseClientError',
  ) {
    super(message);
    this.name = kind;
    this.kind = kind;
    this.cause = cause;
  }
}

export class SupabaseConfigError extends SupabaseClientError {
  constructor(message: string, cause?: unknown) {
    super(message, cause, 'SupabaseConfigError');
  }
}

export class SupabaseSchemaError extends SupabaseClientError {
  constructor(message: string, cause?: unknown) {
    super(message, cause, 'SupabaseSchemaError');
  }
}
