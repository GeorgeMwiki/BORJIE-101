/**
 * Composition wiring for the public auth endpoints — `/api/v1/auth/sign-in`
 * and `/api/v1/auth/sign-out`.
 *
 * Binds:
 *   - `signInWithPassword` → Supabase REST `/auth/v1/token?grant_type=password`
 *     using the project anon key. We call the REST API directly (rather than
 *     spinning up `@supabase/supabase-js`) so a) no extra package weight in
 *     the hot path, b) we already have the same pattern in
 *     `auth/supabase/supabase-auth-routes.ts`, c) easier to stub in tests.
 *   - `signOut` → Supabase REST `/auth/v1/logout`.
 *   - `recordAuditEvent` → hash-chained `ai_audit_chain` append via the
 *     drizzle-backed repo + ai-copilot `AuditHashChain`.
 *   - `registerAttempt` → in-memory per-IP throttle (5 attempts / 10 min,
 *     15 min lockout).
 *   - `logger` → adapt the gateway Pino instance to our minimal contract.
 *
 * Degrades fail-soft when `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * are absent — the deps surface returns `provider_unavailable` so the route
 * answers 503 rather than 500.
 */

import type { Logger as PinoLogger } from 'pino';

import { createAuditHashChain, type AuditHashChain } from '@borjie/ai-copilot';

import { createDrizzleAiAuditChainRepo } from './ai-audit-chain-repo.js';
import {
  createInMemorySignInLimiter,
  type PublicAuthDeps,
  type SupabaseSignInOk,
  type SupabaseSignInResult,
} from '../routes/auth/public-auth.hono.js';

interface DrizzleLikeClient {
  execute(q: unknown): Promise<unknown>;
}

interface SupabaseUserPayload {
  readonly id?: string;
  readonly email?: string;
  readonly app_metadata?: {
    readonly tenant_id?: string;
    readonly mining_role?: string;
    readonly role?: string;
  };
  readonly user_metadata?: Record<string, unknown>;
}

interface SupabaseTokenResponse {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly expires_at?: number;
  readonly token_type?: string;
  readonly user?: SupabaseUserPayload;
  readonly error?: string;
  readonly error_description?: string;
  readonly msg?: string;
  readonly code?: string;
}

export interface PublicAuthWiringInput {
  readonly db: DrizzleLikeClient | null;
  readonly logger: PinoLogger;
  /** Override the fetch impl in tests. */
  readonly fetchImpl?: typeof fetch;
  /** Override the limiter in tests. */
  readonly limiter?: PublicAuthDeps['registerAttempt'];
}

function readSupabaseConfig(logger: PinoLogger): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? process.env.SUPABASE_URL?.trim();
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    logger.warn(
      {
        wiring: 'public-auth',
        supabaseUrl: Boolean(url),
        supabaseAnonKey: Boolean(anonKey),
      },
      'public-auth-wiring: Supabase env unset — /auth/sign-in will return PROVIDER_UNAVAILABLE',
    );
    return null;
  }
  return { url, anonKey };
}

function classifyTokenError(json: SupabaseTokenResponse | null, status: number): SupabaseSignInResult {
  const errMsg = (json?.error_description ?? json?.msg ?? json?.error ?? '').toLowerCase();
  const code = (json?.code ?? '').toLowerCase();
  if (status === 400 || status === 401) {
    if (
      errMsg.includes('invalid login') ||
      errMsg.includes('invalid_grant') ||
      errMsg.includes('invalid credentials') ||
      code === 'invalid_credentials'
    ) {
      return { ok: false, reason: 'invalid_credentials', message: errMsg };
    }
    if (errMsg.includes('not confirmed') || errMsg.includes('email not confirmed') || code === 'email_not_confirmed') {
      return { ok: false, reason: 'invalid_credentials', message: errMsg };
    }
    if (errMsg.includes('user is banned') || errMsg.includes('disabled')) {
      return { ok: false, reason: 'account_disabled', message: errMsg };
    }
  }
  if (status === 429) {
    return { ok: false, reason: 'rate_limited', message: errMsg };
  }
  return { ok: false, reason: 'provider_unavailable', message: errMsg };
}

export function createPublicAuthDeps(input: PublicAuthWiringInput): PublicAuthDeps {
  const cfg = readSupabaseConfig(input.logger);
  const doFetch = input.fetchImpl ?? fetch;

  const auditRepo = createDrizzleAiAuditChainRepo(input.db);
  const auditChain: AuditHashChain | null = auditRepo
    ? createAuditHashChain({ repo: auditRepo })
    : null;

  return {
    async signInWithPassword(req) {
      if (!cfg) {
        return { ok: false, reason: 'provider_unavailable', message: 'supabase env unset' };
      }
      try {
        const url = `${cfg.url.replace(/\/+$/, '')}/auth/v1/token?grant_type=password`;
        const res = await doFetch(url, {
          method: 'POST',
          headers: {
            apikey: cfg.anonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email: req.email, password: req.password }),
        });
        const json = (await res.json().catch(() => null)) as SupabaseTokenResponse | null;
        if (!res.ok || !json?.access_token || !json?.refresh_token || !json?.user?.id) {
          return classifyTokenError(json, res.status);
        }
        const nowSec = Math.floor(Date.now() / 1000);
        const expiresAt =
          typeof json.expires_at === 'number'
            ? json.expires_at
            : nowSec + (json.expires_in ?? 3600);
        const userMeta = json.user.app_metadata ?? {};
        // `exactOptionalPropertyTypes` rejects `field: undefined` for
        // declared-optional fields — only spread when defined.
        const role = userMeta.mining_role ?? userMeta.role;
        const tenantId = userMeta.tenant_id;
        const userPayload: SupabaseSignInOk['user'] = {
          id: json.user.id,
          ...(json.user.email !== undefined ? { email: json.user.email } : {}),
          ...(role !== undefined ? { role } : {}),
          ...(tenantId !== undefined ? { tenantId } : {}),
          appMetadata: userMeta as Record<string, unknown>,
        };
        const ok: SupabaseSignInOk = {
          ok: true,
          accessToken: json.access_token,
          refreshToken: json.refresh_token,
          expiresAt,
          user: userPayload,
        };
        return ok;
      } catch (err) {
        input.logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'public-auth-wiring: signInWithPassword threw',
        );
        return { ok: false, reason: 'provider_unavailable' };
      }
    },

    async signOut(req) {
      if (!cfg) return;
      try {
        const url = `${cfg.url.replace(/\/+$/, '')}/auth/v1/logout`;
        await doFetch(url, {
          method: 'POST',
          headers: {
            apikey: cfg.anonKey,
            Authorization: `Bearer ${req.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });
      } catch (err) {
        input.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'public-auth-wiring: signOut REST call threw — continuing',
        );
      }
    },

    async recordAuditEvent(evt) {
      if (!auditChain) return;
      try {
        await auditChain.append({
          tenantId: evt.tenantId ?? 'platform',
          turnId: `auth_${evt.event}_${Date.now()}`,
          action: evt.event,
          payload: {
            outcome: evt.outcome,
            email: evt.email,
            userId: evt.userId,
            reason: evt.reason,
            ip: evt.ip,
          },
        });
      } catch (err) {
        input.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'public-auth-wiring: audit append failed',
        );
      }
    },

    registerAttempt: input.limiter ?? createInMemorySignInLimiter(),

    logger: {
      info: (meta, msg) => input.logger.info(meta, msg),
      warn: (meta, msg) => input.logger.warn(meta, msg),
      error: (meta, msg) => input.logger.error(meta, msg),
    },
  };
}
