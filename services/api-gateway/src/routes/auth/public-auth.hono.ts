// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union widens c.json(..., status) branches and rejects the union; tracked at hono-dev/hono#3891.
/**
 * Public auth endpoints — `/api/v1/auth/sign-in` and `/api/v1/auth/sign-out`.
 *
 * These run OUTSIDE the JWT-verify middleware (mounted on the api-v1
 * tree before `/auth` because the legacy `/auth` Hono sub-app exposes
 * `/login` and `/me` — both of which gate the rest). The router accepts
 * `{ email, password }`, exchanges them with Supabase via the password
 * grant, encrypts the resulting session into the `borjie-session`
 * HttpOnly cookie, and returns a structured response the marketing /
 * owner-web forms can navigate from directly.
 *
 * Why a fresh router rather than extending `auth.ts`:
 *   - `auth.ts` is the legacy bcrypt + internal-JWT path. Mixing the
 *     Supabase OAuth-style password grant into that file blurs which
 *     auth provider owns each endpoint.
 *   - The marketing site needs `credentials: 'include'` and the
 *     simpler `{email, password}` shape; the legacy `/login` returns
 *     `{ data.token }` and never sets a cookie.
 *   - Rate limiting + audit lives in one place per concern.
 *
 * Rate limit: 5 attempts per IP per 10 min, 15 min lockout after 5
 * failures. In-memory because the gateway runs behind a single replica
 * in dev; production swaps the Redis-backed limiter via
 * `createRateLimitMiddleware`.
 *
 * Audit: every success/failure writes a `auth.sign_in` event to the
 * hash-chained `ai_audit_chain` via the injected writer. Failures use
 * `outcome: failure`, successes `outcome: success`. Tenant id comes
 * from the JWT's `app_metadata.tenant_id` claim.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import {
  SESSION_COOKIE_NAME,
  buildSessionCookieClearHeader,
  buildSessionCookieHeader,
  encodeSessionCookie,
  readSessionCookie,
} from '../../auth/public/session-cookie.js';

// ─── Wire contract ───────────────────────────────────────────────────

const SignInRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
});

export type SignInRequest = z.infer<typeof SignInRequestSchema>;

export interface SupabaseSignInUser {
  readonly id: string;
  readonly email?: string;
  readonly role?: string;
  readonly tenantId?: string;
  readonly appMetadata?: Record<string, unknown>;
}

export interface SupabaseSignInOk {
  readonly ok: true;
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch seconds at which the access token expires. */
  readonly expiresAt: number;
  readonly user: SupabaseSignInUser;
}

export interface SupabaseSignInFailure {
  readonly ok: false;
  readonly reason:
    | 'invalid_credentials'
    | 'rate_limited'
    | 'provider_unavailable'
    | 'account_disabled';
  /** Optional upstream-message for log lines (never sent to client). */
  readonly message?: string;
}

export type SupabaseSignInResult = SupabaseSignInOk | SupabaseSignInFailure;

export interface PublicAuthDeps {
  /** Calls Supabase password-grant; returns structured result. */
  signInWithPassword(input: { email: string; password: string }): Promise<SupabaseSignInResult>;
  /** Best-effort: revoke the supplied access token at Supabase. */
  signOut(input: { accessToken: string }): Promise<void>;
  /** Records the sign-in attempt to the audit chain. Fire-and-forget. */
  recordAuditEvent(input: {
    readonly event: 'auth.sign_in' | 'auth.sign_out';
    readonly outcome: 'success' | 'failure';
    readonly tenantId: string | null;
    readonly userId: string | null;
    readonly email: string;
    readonly reason?: string;
    readonly ip: string;
  }): Promise<void>;
  /**
   * Per-IP attempt tracker. The router calls this in TWO phases:
   *   - peek (`success` omitted)  — does NOT mutate state; just answers
   *     "is this IP currently locked out?". Use this BEFORE touching
   *     Supabase so the credential timing channel is closed.
   *   - record (`success` provided) — mutates state. The router calls
   *     this AFTER it knows the outcome.
   */
  registerAttempt(input: { ip: string; success?: boolean }): {
    allowed: boolean;
    retryAfterSec?: number;
  };
  /** Structured logger — Pino-shaped. */
  logger: {
    info(meta: Record<string, unknown>, msg: string): void;
    warn(meta: Record<string, unknown>, msg: string): void;
    error(meta: Record<string, unknown>, msg: string): void;
  };
}

// ─── Router factory ──────────────────────────────────────────────────

export function createPublicAuthRouter(deps: PublicAuthDeps): Hono {
  const app = new Hono();

  app.post('/sign-in', async (c) => {
    const ip = readClientIp(c.req.header('x-forwarded-for'), c.req.header('x-real-ip'));

    // Lockout gate FIRST — peek-only (no state mutation) so we close
    // the credential-timing channel without spending a failure budget
    // just for asking "am I allowed to try?".
    const limit = deps.registerAttempt({ ip });
    if (!limit.allowed) {
      return c.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many sign-in attempts. Try again in a few minutes.',
            retryAfter: limit.retryAfterSec ?? 900,
          },
        },
        429,
      );
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        { success: false, error: { code: 'INVALID_BODY', message: 'Request body must be valid JSON' } },
        400,
      );
    }
    const parsed = SignInRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_BODY',
            message: first?.message ?? 'Invalid email or password format',
            field: first?.path?.join('.') ?? undefined,
          },
        },
        400,
      );
    }

    const email = parsed.data.email.trim().toLowerCase();
    const password = parsed.data.password;

    let result: SupabaseSignInResult;
    try {
      result = await deps.signInWithPassword({ email, password });
    } catch (err) {
      deps.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'public-auth: sign-in threw — degrading to provider_unavailable',
      );
      result = { ok: false, reason: 'provider_unavailable' };
    }

    if (!result.ok) {
      // Record the failed attempt + audit event. Do NOT count provider
      // outages against the IP throttle — that would punish legitimate
      // users for a Supabase blip.
      if (result.reason !== 'provider_unavailable') {
        deps.registerAttempt({ ip, success: false });
      }
      void deps.recordAuditEvent({
        event: 'auth.sign_in',
        outcome: 'failure',
        tenantId: null,
        userId: null,
        email,
        reason: result.reason,
        ip,
      }).catch(() => undefined);

      if (result.reason === 'invalid_credentials') {
        return c.json(
          { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } },
          401,
        );
      }
      if (result.reason === 'account_disabled') {
        return c.json(
          { success: false, error: { code: 'ACCOUNT_DISABLED', message: 'Account has been disabled. Contact support.' } },
          403,
        );
      }
      if (result.reason === 'rate_limited') {
        return c.json(
          { success: false, error: { code: 'RATE_LIMITED', message: 'Upstream is rate-limited. Try again shortly.' } },
          429,
        );
      }
      return c.json(
        { success: false, error: { code: 'PROVIDER_UNAVAILABLE', message: 'Authentication provider is temporarily unavailable.' } },
        503,
      );
    }

    // Success — reset the failure counter, encrypt the session into a
    // cookie, and return the same payload the marketing form will use
    // for navigation.
    deps.registerAttempt({ ip, success: true });

    let cookieValue: string;
    try {
      cookieValue = encodeSessionCookie({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
        userId: result.user.id,
        email: result.user.email,
        tenantId: result.user.tenantId,
      });
    } catch (err) {
      deps.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'public-auth: session-cookie encryption failed — refusing to set cookie',
      );
      // Fall through so the client still gets the session in the body
      // — they can wire Authorization manually until the operator
      // sets COOKIE_SECRET.
      cookieValue = '';
    }

    if (cookieValue) {
      c.header('Set-Cookie', buildSessionCookieHeader(cookieValue, {
        maxAgeSeconds: Math.max(60, result.expiresAt - Math.floor(Date.now() / 1000)),
      }));
    }

    void deps.recordAuditEvent({
      event: 'auth.sign_in',
      outcome: 'success',
      tenantId: result.user.tenantId ?? null,
      userId: result.user.id,
      email,
      ip,
    }).catch(() => undefined);

    return c.json(
      {
        success: true,
        user: {
          id: result.user.id,
          email: result.user.email ?? email,
          role: result.user.role ?? null,
          tenantId: result.user.tenantId ?? null,
        },
        session: {
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
          expires_at: result.expiresAt,
        },
      },
      200,
    );
  });

  app.post('/sign-out', async (c) => {
    const cookieValue = readSessionCookie(c.req.header('Cookie'));
    if (cookieValue) {
      try {
        // Decode lazily — failures are fine; we still clear the cookie.
        const { decodeSessionCookie } = await import('../../auth/public/session-cookie.js');
        const decoded = decodeSessionCookie(cookieValue);
        if (decoded?.accessToken) {
          await deps.signOut({ accessToken: decoded.accessToken }).catch((err) => {
            deps.logger.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'public-auth: supabase sign-out call failed — continuing to clear cookie',
            );
          });
          void deps.recordAuditEvent({
            event: 'auth.sign_out',
            outcome: 'success',
            tenantId: decoded.tenantId ?? null,
            userId: decoded.userId,
            email: decoded.email ?? '',
            ip: readClientIp(c.req.header('x-forwarded-for'), c.req.header('x-real-ip')),
          }).catch(() => undefined);
        }
      } catch (err) {
        deps.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'public-auth: sign-out cleanup failed (non-fatal)',
        );
      }
    }
    c.header('Set-Cookie', buildSessionCookieClearHeader());
    return c.json({ success: true }, 200);
  });

  return app;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function readClientIp(xff: string | undefined, real: string | undefined): string {
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  if (real) return real.trim();
  return 'unknown';
}

// ─── In-memory rate limiter for sign-in (default impl) ──────────────

interface AttemptRecord {
  count: number;
  windowStart: number;
  lockedUntil: number;
}

const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/**
 * Default in-memory attempt counter. Production should swap this with
 * a Redis-backed variant for HPA correctness — the contract is small
 * enough that one `INCR + EXPIRE` does the job.
 *
 * Semantics:
 *   - `{ ip }` (no `success` field) — peek only. Returns the current
 *     allowed/locked state without mutating the counter.
 *   - `{ ip, success: true }` — clears the counter for the IP.
 *   - `{ ip, success: false }` — increments and trips the lock at
 *     MAX_ATTEMPTS+1.
 */
export function createInMemorySignInLimiter(): PublicAuthDeps['registerAttempt'] {
  const store = new Map<string, AttemptRecord>();
  return (input: { ip: string; success?: boolean }) => {
    const now = Date.now();
    let rec = store.get(input.ip);
    if (!rec || now - rec.windowStart > WINDOW_MS) {
      rec = { count: 0, windowStart: now, lockedUntil: 0 };
      store.set(input.ip, rec);
    }
    if (rec.lockedUntil > now) {
      return { allowed: false, retryAfterSec: Math.ceil((rec.lockedUntil - now) / 1000) };
    }
    if (input.success === undefined) {
      // Peek-only — do not mutate the counter; just answer the gate.
      return { allowed: true };
    }
    if (input.success) {
      // Reset on success so a successful sign-in clears the slate.
      store.delete(input.ip);
      return { allowed: true };
    }
    rec.count += 1;
    if (rec.count >= MAX_ATTEMPTS) {
      // The 5th failure trips the lock. The current request's 401 will
      // still be returned (we don't yank it after the fact), but every
      // subsequent peek lands in the locked branch above.
      rec.lockedUntil = now + LOCK_MS;
    }
    return { allowed: true };
  };
}

export { SESSION_COOKIE_NAME };
