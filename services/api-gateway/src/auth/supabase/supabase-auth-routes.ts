/**
 * Supabase Auth passthrough routes.
 *
 * Mounted under `/auth/supabase/*` when `AUTH_PROVIDER=supabase`.
 * These are server-side proxies that let clients hit the api-gateway
 * uniformly instead of having to know the Supabase project URL — and
 * they centralize cookie + CSRF concerns.
 *
 * Sensitive (server-only) endpoints:
 *   POST /sign-up      { email, password }
 *   POST /sign-in      { email, password }      → returns session
 *   POST /magic-link   { email }                → triggers email link
 *   POST /otp          { phone | email }        → triggers OTP
 *   POST /verify-otp   { phone | email, token } → returns session
 *   POST /refresh      { refresh_token }        → returns rotated session
 *   POST /sign-out     {}                       → invalidates refresh token
 *
 * The Hono `c.json(..., status)` pattern uses a literal-status overload
 * that Hono v4 widens across multiple branches — the `@ts-nocheck`
 * pragma at the top mirrors the existing `middleware/auth.middleware.ts`
 * style.
 */
// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union (hono-dev/hono#3891).

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { rotateSession } from './supabase-session.js';

const SignUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  metadata: z.record(z.unknown()).optional(),
});

const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

const MagicLinkSchema = z.object({
  email: z.string().email(),
  redirectTo: z.string().url().optional(),
});

const OtpSchema = z.union([
  z.object({ email: z.string().email() }),
  z.object({ phone: z.string().min(7).max(20) }),
]);

const VerifyOtpSchema = z.union([
  z.object({
    email: z.string().email(),
    token: z.string().min(4).max(20),
    type: z.enum(['email', 'magiclink', 'recovery', 'invite']).default('email'),
  }),
  z.object({
    phone: z.string().min(7).max(20),
    token: z.string().min(4).max(20),
    type: z.enum(['sms', 'phone_change']).default('sms'),
  }),
]);

const RefreshSchema = z.object({
  refresh_token: z.string().min(1),
});

interface SupabaseRoutesConfig {
  readonly url: string;
  readonly anonKey: string;
}

function readConfig(): SupabaseRoutesConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

async function callSupabase(
  config: SupabaseRoutesConfig,
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const url = `${config.url.replace(/\/+$/, '')}${path}`;
  return fetch(url, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

export function buildSupabaseAuthRoutes(): Hono {
  const app = new Hono();

  // Guard: refuse to expose these routes if config is missing.
  app.use('*', async (c, next) => {
    const cfg = readConfig();
    if (!cfg) {
      return c.json(
        {
          success: false,
          error: {
            code: 'AUTH_PROVIDER_MISCONFIGURED',
            message:
              'Supabase auth routes require NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
          },
        },
        500,
      );
    }
    c.set('supabaseAuthConfig', cfg);
    await next();
  });

  app.post('/sign-up', zValidator('json', SignUpSchema), async (c) => {
    const cfg = c.get('supabaseAuthConfig') as SupabaseRoutesConfig;
    const body = c.req.valid('json');
    const res = await callSupabase(cfg, '/auth/v1/signup', {
      email: body.email,
      password: body.password,
      data: body.metadata ?? {},
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return c.json({ success: res.ok, data: res.ok ? json : undefined, error: res.ok ? undefined : json }, res.status);
  });

  app.post('/sign-in', zValidator('json', SignInSchema), async (c) => {
    const cfg = c.get('supabaseAuthConfig') as SupabaseRoutesConfig;
    const body = c.req.valid('json');
    const res = await callSupabase(
      cfg,
      '/auth/v1/token?grant_type=password',
      { email: body.email, password: body.password },
    );
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return c.json({ success: res.ok, data: res.ok ? json : undefined, error: res.ok ? undefined : json }, res.status);
  });

  app.post('/magic-link', zValidator('json', MagicLinkSchema), async (c) => {
    const cfg = c.get('supabaseAuthConfig') as SupabaseRoutesConfig;
    const body = c.req.valid('json');
    const res = await callSupabase(cfg, '/auth/v1/magiclink', {
      email: body.email,
      options: body.redirectTo ? { redirectTo: body.redirectTo } : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return c.json({ success: res.ok, data: res.ok ? json : undefined, error: res.ok ? undefined : json }, res.status);
  });

  app.post('/otp', zValidator('json', OtpSchema), async (c) => {
    const cfg = c.get('supabaseAuthConfig') as SupabaseRoutesConfig;
    const body = c.req.valid('json');
    const res = await callSupabase(cfg, '/auth/v1/otp', body);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return c.json({ success: res.ok, data: res.ok ? json : undefined, error: res.ok ? undefined : json }, res.status);
  });

  app.post('/verify-otp', zValidator('json', VerifyOtpSchema), async (c) => {
    const cfg = c.get('supabaseAuthConfig') as SupabaseRoutesConfig;
    const body = c.req.valid('json');
    const res = await callSupabase(cfg, '/auth/v1/verify', body);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return c.json({ success: res.ok, data: res.ok ? json : undefined, error: res.ok ? undefined : json }, res.status);
  });

  app.post('/refresh', zValidator('json', RefreshSchema), async (c) => {
    const cfg = c.get('supabaseAuthConfig') as SupabaseRoutesConfig;
    const body = c.req.valid('json');
    try {
      const session = await rotateSession(body.refresh_token, cfg);
      return c.json({ success: true, data: session }, 200);
    } catch (err) {
      const status =
        typeof (err as { status?: number }).status === 'number'
          ? (err as { status: number }).status
          : 401;
      return c.json(
        {
          success: false,
          error: {
            code: 'REFRESH_FAILED',
            message: err instanceof Error ? err.message : 'refresh failed',
          },
        },
        status,
      );
    }
  });

  app.post('/sign-out', async (c) => {
    const cfg = c.get('supabaseAuthConfig') as SupabaseRoutesConfig;
    const accessToken =
      c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!accessToken) {
      return c.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'missing bearer' } },
        401,
      );
    }
    const res = await callSupabase(cfg, '/auth/v1/logout', {}, {
      Authorization: `Bearer ${accessToken}`,
    });
    return c.json({ success: res.ok }, res.status);
  });

  return app;
}
