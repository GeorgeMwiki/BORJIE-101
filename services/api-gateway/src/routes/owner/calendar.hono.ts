/**
 * /api/v1/owner/calendar — owner calendar (Google / Microsoft 365) connect flow.
 *
 * Wave CALENDAR-SYNC. The owner links their calendar so Mr. Mwikila's reminders
 * (channel='calendar') and the autonomous worker's time-bound items (licence
 * renewals 90/60/30-day, royalty deadlines, shifts) appear as native calendar
 * events. Companion to:
 *   - packages/database/src/migrations/0171_owner_calendar_connections.sql
 *   - services/api-gateway/src/services/notification-dispatch/calendar-providers/
 *   - services/api-gateway/src/workers/calendar-sync.worker.ts
 *
 * Routes:
 *   GET    /owner/calendar/connect/:provider   (AUTH)   → 302 to consent screen
 *   GET    /owner/calendar/callback            (PUBLIC) → exchange + store sealed tokens
 *   GET    /owner/calendar/status              (AUTH)   → linked connections (token-free)
 *   DELETE /owner/calendar/disconnect          (AUTH)   → soft-revoke connection(s)
 *
 * Security:
 *   - Tokens are ENCRYPTED at rest (CalendarTokenCipher, AES-256-GCM). The
 *     callback NEVER persists a plaintext token.
 *   - The callback runs WITHOUT a JWT (the provider redirects the browser), so
 *     it trusts an HMAC-signed `state` carrying (tenant,user,provider,exp) and
 *     binds the RLS GUC from the verified tenant before any write.
 *   - OAuth client id/secret + token key come from env ONLY (no hardcoding).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'drizzle-orm';

// Import the provider enum from the TOP-LEVEL @borjie/database barrel, NOT the
// `/schemas` subpath: under the gateway's module-init order the subpath barrel
// can surface `CALENDAR_PROVIDERS` as `undefined` (circular-init in the large
// schemas index), which would make `z.enum(CALENDAR_PROVIDERS)` throw at load /
// reject valid input as a 500. The top-level barrel is init-stable.
import { CALENDAR_PROVIDERS, type CalendarProvider } from '@borjie/database';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { UserRole } from '../../types/user-role';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import {
  buildAuthorizeUrl,
  encodeOAuthState,
  decodeOAuthState,
  exchangeAuthorizationCode,
  type CalendarChannel,
} from '../../services/notification-dispatch/calendar-providers';

const moduleLogger = createLogger('owner-calendar');

const providerParamSchema = z.object({
  provider: z.enum(CALENDAR_PROVIDERS),
});

const callbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

const disconnectQuerySchema = z.object({
  provider: z.enum(CALENDAR_PROVIDERS).optional(),
});

export interface CalendarRouterDeps {
  /** Null when the channel is disabled (no token-encryption key configured). */
  readonly channel: CalendarChannel | null;
  /** Env access (test seam) — used only for state signing + redirect base. */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Build the owner-calendar router. The orchestrator passes the composed
 * `CalendarChannel`; tests pass a stub channel + injected env.
 */
export function createCalendarRouter(deps: CalendarRouterDeps): Hono {
  const env = deps.env ?? process.env;
  const app = new Hono();

  // ───────────────────────────────────────────────────────────────────
  // GET /connect/:provider — redirect the owner to the provider consent.
  // ───────────────────────────────────────────────────────────────────
  app.get('/connect/:provider', authMiddleware, requireRole(UserRole.OWNER), async (c: any) => {
    const channel = deps.channel;
    if (!channel) {
      return c.json(
        {
          success: false,
          error: {
            code: 'CALENDAR_NOT_CONFIGURED',
            message: 'Calendar integration is not configured on this server.',
          },
        },
        503,
      );
    }
    const parsed = providerParamSchema.safeParse({
      provider: c.req.param('provider'),
    });
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'UNSUPPORTED_PROVIDER',
            message: 'provider must be one of: google, microsoft',
          },
        },
        400,
      );
    }
    const provider = parsed.data.provider as CalendarProvider;
    const auth = c.get('auth') as { tenantId: string; userId: string };
    // A Supabase JWT missing `app_metadata.tenant_id` yields tenantId=''. Refuse
    // to mint an OAuth state (and later an orphan connection row) for it.
    if (!auth?.tenantId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'TENANT_CONTEXT_MISSING',
            message: 'This account has no tenant binding.',
          },
        },
        400,
      );
    }

    const pc =
      provider === 'google'
        ? channel.oauthConfig.google
        : channel.oauthConfig.microsoft;
    if (!pc || !channel.oauthConfig.redirectUri) {
      return c.json(
        {
          success: false,
          error: {
            code: 'PROVIDER_OAUTH_NOT_CONFIGURED',
            message: `OAuth client credentials for ${provider} are not configured.`,
          },
        },
        503,
      );
    }

    let url: string;
    try {
      const state = encodeOAuthState(
        { tenantId: auth.tenantId, userId: auth.userId, provider },
        env,
      );
      url = buildAuthorizeUrl({ provider, config: channel.oauthConfig, state });
    } catch (err) {
      moduleLogger.error('owner-calendar: failed to build authorize url', {
        provider,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          success: false,
          error: {
            code: 'AUTHORIZE_URL_FAILED',
            message: 'Could not start the calendar connect flow.',
          },
        },
        500,
      );
    }

    moduleLogger.info('owner-calendar: connect redirect', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      provider,
    });
    return c.redirect(url, 302);
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /callback — exchange the code, store SEALED tokens. No JWT here:
  // identity comes from the signed `state`; RLS GUC bound from it.
  // ───────────────────────────────────────────────────────────────────
  app.get('/callback', databaseMiddleware, async (c: any) => {
    const channel = deps.channel;
    if (!channel) {
      return c.json(
        {
          success: false,
          error: {
            code: 'CALENDAR_NOT_CONFIGURED',
            message: 'Calendar integration is not configured on this server.',
          },
        },
        503,
      );
    }
    const parsed = callbackQuerySchema.safeParse({
      code: c.req.query('code'),
      state: c.req.query('state'),
      error: c.req.query('error'),
      error_description: c.req.query('error_description'),
    });
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid callback query' },
        },
        400,
      );
    }
    if (parsed.data.error) {
      moduleLogger.warn('owner-calendar: provider returned an error', {
        error: parsed.data.error,
      });
      return c.json(
        {
          success: false,
          error: {
            code: 'OAUTH_CONSENT_DENIED',
            message: parsed.data.error_description ?? parsed.data.error,
          },
        },
        400,
      );
    }
    if (!parsed.data.code || !parsed.data.state) {
      return c.json(
        {
          success: false,
          error: { code: 'MISSING_CODE_OR_STATE', message: 'code and state are required' },
        },
        400,
      );
    }

    const state = decodeOAuthState(parsed.data.state, env);
    if (!state) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_STATE',
            message: 'OAuth state failed verification or expired.',
          },
        },
        400,
      );
    }
    // Belt-and-suspenders to the /connect guard: never bind an empty RLS tenant
    // GUC or write a connection row from a state that carries no tenant.
    if (!state.tenantId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_STATE_TENANT',
            message: 'OAuth state has no tenant binding.',
          },
        },
        400,
      );
    }

    const db = c.get('db');
    if (!db) {
      return c.json(
        {
          success: false,
          error: { code: 'CALENDAR_DB_UNAVAILABLE', message: 'Database not configured' },
        },
        503,
      );
    }

    // Bind the RLS GUC from the VERIFIED state tenant (no JWT on this route).
    try {
      await db.execute(
        sql`SELECT set_config('app.current_tenant_id', ${state.tenantId}, false)`,
      );
    } catch (err) {
      moduleLogger.error('owner-calendar: failed to bind tenant GUC', {
        tenantId: state.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          success: false,
          error: { code: 'RLS_CONTEXT_FAILED', message: 'Could not establish tenant context.' },
        },
        500,
      );
    }

    try {
      const tokens = await exchangeAuthorizationCode({
        provider: state.provider,
        config: channel.oauthConfig,
        code: parsed.data.code,
      });
      // refreshToken is guaranteed non-null by exchangeAuthorizationCode.
      const { id } = await channel.store.upsert({
        tenantId: state.tenantId,
        userId: state.userId,
        provider: state.provider,
        refreshToken: tokens.refreshToken as string,
        accessToken: tokens.accessToken,
        tokenExpiresAt: new Date(tokens.expiresAt),
        calendarId: 'primary',
        scope: tokens.scope,
      });

      moduleLogger.info('owner-calendar: connection stored (tokens sealed)', {
        tenantId: state.tenantId,
        userId: state.userId,
        provider: state.provider,
        connectionId: id,
      });

      return c.json({
        success: true,
        data: {
          connected: true,
          provider: state.provider,
          connectionId: id,
        },
      });
    } catch (err) {
      moduleLogger.error('owner-calendar: callback exchange/store failed', {
        tenantId: state.tenantId,
        provider: state.provider,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          success: false,
          error: {
            code: 'OAUTH_EXCHANGE_FAILED',
            message: 'Failed to complete the calendar connection.',
          },
        },
        502,
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // GET /status — list the caller's active connections (token-free).
  // ───────────────────────────────────────────────────────────────────
  app.get('/status', authMiddleware, requireRole(UserRole.OWNER), databaseMiddleware, async (c: any) => {
    if (!deps.channel) {
      return c.json({ success: true, data: { configured: false, connections: [] } });
    }
    const auth = c.get('auth') as { tenantId: string; userId: string };
    try {
      const connections = await deps.channel.store.listStatus(
        auth.tenantId,
        auth.userId,
      );
      return c.json({
        success: true,
        data: { configured: deps.channel.configured, connections },
      });
    } catch (err) {
      moduleLogger.error('owner-calendar: status query failed', {
        tenantId: auth.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          success: false,
          error: { code: 'CALENDAR_STATUS_FAILED', message: 'Could not load calendar status.' },
        },
        500,
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // DELETE /disconnect — soft-revoke the caller's connection(s).
  // ───────────────────────────────────────────────────────────────────
  app.delete('/disconnect', authMiddleware, requireRole(UserRole.OWNER), databaseMiddleware, async (c: any) => {
    if (!deps.channel) {
      return c.json(
        {
          success: false,
          error: {
            code: 'CALENDAR_NOT_CONFIGURED',
            message: 'Calendar integration is not configured on this server.',
          },
        },
        503,
      );
    }
    const parsed = disconnectQuerySchema.safeParse({
      provider: c.req.query('provider'),
    });
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid provider' },
        },
        400,
      );
    }
    const auth = c.get('auth') as { tenantId: string; userId: string };
    try {
      const revoked = await deps.channel.store.disconnect(
        auth.tenantId,
        auth.userId,
        parsed.data.provider as CalendarProvider | undefined,
      );
      moduleLogger.info('owner-calendar: disconnected', {
        tenantId: auth.tenantId,
        userId: auth.userId,
        provider: parsed.data.provider ?? 'all',
        revoked,
      });
      return c.json({ success: true, data: { revoked } });
    } catch (err) {
      moduleLogger.error('owner-calendar: disconnect failed', {
        tenantId: auth.tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        {
          success: false,
          error: { code: 'CALENDAR_DISCONNECT_FAILED', message: 'Could not disconnect the calendar.' },
        },
        500,
      );
    }
  });

  return app;
}
