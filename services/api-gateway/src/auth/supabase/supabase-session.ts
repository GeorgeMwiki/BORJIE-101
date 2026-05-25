/**
 * Session refresh + token rotation helpers for Supabase Auth.
 *
 * Used by the api-gateway when proxying refresh-token requests to
 * Supabase Auth — clients should normally call Supabase directly, but
 * we keep these helpers so server-rendered surfaces (server-only
 * cookies) can rotate without exposing the anon key to the browser.
 */

import { z } from 'zod';

const SupabaseSessionResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().int().positive(),
  expires_at: z.number().int().positive().optional(),
  token_type: z.string(),
  user: z
    .object({
      id: z.string(),
      email: z.string().optional(),
    })
    .passthrough(),
});

export type SupabaseSessionResponse = z.infer<typeof SupabaseSessionResponseSchema>;

export interface SessionRotationConfig {
  /** Supabase project URL — `https://<ref>.supabase.co`. */
  readonly url: string;
  /** Public anon key (refresh endpoint requires it). */
  readonly anonKey: string;
}

export class SupabaseSessionError extends Error {
  readonly kind = 'SupabaseSessionError' as const;
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'SupabaseSessionError';
    this.status = status;
  }
}

/**
 * Exchange a refresh token for a new session. The api-gateway uses
 * this when serving SSR pages that store the session in an HTTP-only
 * cookie.
 */
export async function rotateSession(
  refreshToken: string,
  config: SessionRotationConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<SupabaseSessionResponse> {
  if (!refreshToken) {
    throw new SupabaseSessionError('missing_refresh_token', 400);
  }
  const url = `${config.url.replace(/\/+$/, '')}/auth/v1/token?grant_type=refresh_token`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    let body: string;
    try {
      body = await res.text();
    } catch {
      body = res.statusText;
    }
    throw new SupabaseSessionError(
      `supabase_refresh_failed: ${res.status} ${body}`,
      res.status,
    );
  }
  const json = (await res.json()) as unknown;
  const parsed = SupabaseSessionResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new SupabaseSessionError(
      `invalid_supabase_response: ${parsed.error.message}`,
      502,
    );
  }
  return parsed.data;
}

/**
 * Determine whether an access token is within `marginSeconds` of
 * expiring. Used by middleware to proactively rotate.
 */
export function shouldRotate(
  tokenExpiresAt: number,
  marginSeconds = 60,
  now: () => number = () => Math.floor(Date.now() / 1000),
): boolean {
  return tokenExpiresAt - now() <= marginSeconds;
}

/**
 * Build the Set-Cookie header value for an HTTP-only session cookie.
 * Safe defaults: HttpOnly, Secure (in prod), SameSite=Lax, 7-day TTL.
 */
export interface SessionCookieOptions {
  readonly name: string;
  readonly value: string;
  readonly maxAgeSeconds?: number;
  readonly secure?: boolean;
  readonly sameSite?: 'lax' | 'strict' | 'none';
  readonly path?: string;
  readonly domain?: string;
}

export function buildSessionCookie(opts: SessionCookieOptions): string {
  const parts = [
    `${opts.name}=${encodeURIComponent(opts.value)}`,
    `Path=${opts.path ?? '/'}`,
    `Max-Age=${opts.maxAgeSeconds ?? 7 * 24 * 3600}`,
    'HttpOnly',
    `SameSite=${(opts.sameSite ?? 'lax').replace(/^./, (c) => c.toUpperCase())}`,
  ];
  if (opts.secure ?? process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  return parts.join('; ');
}
