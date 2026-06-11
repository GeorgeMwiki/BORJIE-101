/**
 * /api/v1/integrations/connectors — OAuth CONNECT sub-flow (the last mile).
 *
 * The runtime invokers (composition/connector-invokers-wiring.ts) decrypt
 * `connector_credentials` at call time — these routes are what WRITE those
 * rows. ONE generic engine over `CONNECTOR_OAUTH_DESCRIPTORS`
 * (composition/connector-oauth-descriptors.ts); Slack is the first
 * descriptor, a 2nd provider needs ZERO new route code.
 *
 *   POST /:connectorId/connect/start  (AUTH)   → provider authorize URL
 *   GET  /connect/callback            (PUBLIC) → verify state → exchange code
 *                                                → SEAL token → upsert row
 *   POST /:connectorId/disconnect     (AUTH)   → best-effort revoke + delete
 *
 * SECURITY (mirrors routes/owner/calendar.hono.ts exactly):
 *   - The callback runs WITHOUT a JWT (the provider redirects the browser).
 *     It trusts ONLY the HMAC-signed single-use `state` (tenant/user/
 *     connector + nonce + expiry) — the CSRF token of the OAuth dance.
 *     Replays are rejected by an in-process fast-path AND the cluster-wide
 *     DURABLE Postgres consume (oauth_state_nonces, migration 0343 —
 *     INSERT … ON CONFLICT DO NOTHING; fail-closed on a ledger fault) so a
 *     multi-replica deploy cannot be replayed across replicas.
 *   - redirect_uri comes from env only — never from the request.
 *   - Tokens are SEALED (AES-256-GCM connector-token-cipher) before any
 *     write; plaintext never persists, never logs, never echoes.
 *   - RLS GUC (`app.current_tenant_id`) is bound from the VERIFIED state
 *     inside the write transaction (SET LOCAL semantics) — the callback can
 *     only ever write the state's own tenant row.
 *   - HONEST DEGRADE: missing provider env / signing secret / cipher all
 *     yield structured `{ provisioned:false, reason }` envelopes — never a
 *     broken URL, never a partial write.
 */

import { createHash } from 'node:crypto';

import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'drizzle-orm';

import { authMiddleware } from '../../middleware/hono-auth.js';
import { databaseMiddleware } from '../../middleware/database.js';
import { createLogger } from '../../utils/logger';
import { getConnectorDescriptor } from '../../composition/connector-catalog.js';
import {
  createConnectorTokenCipher,
  type ConnectorTokenCipher,
} from '../../composition/connector-token-cipher.js';
import {
  buildConnectorAuthorizeUrl,
  CONNECTOR_OAUTH_STATE_TTL_MS,
  createOAuthStateReplayGuard,
  decodeConnectorOAuthState,
  encodeConnectorOAuthState,
  exchangeConnectorAuthorizationCode,
  getConnectorOAuthDescriptor,
  isStateSigningProvisioned,
  readConnectorOAuthProviderConfig,
  type OAuthStateReplayGuard,
} from '../../composition/connector-oauth-descriptors.js';
import {
  consumeOAuthStateNonceDurably,
  type DurableNonceConsumeOutcome,
  type OAuthNonceDb,
} from '../../composition/oauth-state-nonce-store.js';

const moduleLogger = createLogger('connectors-oauth');

// ─────────────────────────────────────────────────────────────────────
// Schemas + narrow ports
// ─────────────────────────────────────────────────────────────────────

const ConnectorIdParam = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'connectorId must be kebab-case');

const CallbackQuery = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(2048).optional(),
  error: z.string().max(256).optional(),
  error_description: z.string().max(1024).optional(),
});

interface AuthContext {
  readonly tenantId?: string;
  readonly userId?: string;
}

/** Narrow structural db seam — test-double-able (mirrors FabricDb). */
interface OAuthDb {
  execute(query: unknown): Promise<unknown>;
  transaction<T>(
    cb: (tx: { execute(q: unknown): Promise<unknown> }) => Promise<T>,
  ): Promise<T>;
}

export interface ConnectorsOAuthRouterOptions {
  /** Env source — composition-time default is process.env. */
  readonly env?: NodeJS.ProcessEnv;
  /** Outbound fetch (token exchange / revoke). Default globalThis.fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Cipher override for tests; default env-constructed (null = unsealed). */
  readonly cipher?: ConnectorTokenCipher | null;
  /** Replay-guard override for tests. */
  readonly replayGuard?: OAuthStateReplayGuard;
  /**
   * Durable (Postgres) nonce-consume override for tests. Default is the real
   * `consumeOAuthStateNonceDurably` over migration 0343's oauth_state_nonces
   * — the CLUSTER-WIDE replay authority (the in-process guard is only a
   * same-process fast-path on a multi-replica deploy).
   */
  readonly durableNonceConsume?: (
    db: OAuthNonceDb,
    args: {
      readonly nonce: string;
      readonly tenantId: string;
      readonly connectorId: string;
      readonly expMs: number;
    },
  ) => Promise<DurableNonceConsumeOutcome>;
  /** Clock override for tests. */
  readonly now?: () => number;
}

const unauthorized = {
  success: false as const,
  error: { code: 'NO_TENANT', message: 'tenant scope required' },
};

const badConnectorId = (message: string) => ({
  success: false as const,
  error: { code: 'BAD_CONNECTOR_ID', message },
});

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const wrapped = result as { rows?: ReadonlyArray<Record<string, unknown>> };
  return wrapped?.rows ?? [];
}

/**
 * Hash over NON-SECRET credential metadata for the append-only audit
 * column. NEVER includes token material.
 */
function credentialAuditHash(args: {
  readonly tenantId: string;
  readonly kind: string;
  readonly account: string;
  readonly scopes: ReadonlyArray<string>;
  readonly expiresAt: Date | null;
  readonly sealedAtMs: number;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        tenantId: args.tenantId,
        kind: args.kind,
        account: args.account,
        scopes: [...args.scopes],
        expiresAt: args.expiresAt?.toISOString() ?? null,
        sealedAtMs: args.sealedAtMs,
      }),
    )
    .digest('hex');
}

/** SQL fragment for a text[] literal from a string array. */
function textArraySql(values: ReadonlyArray<string>) {
  return sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}

/** Static success page — NO request data is ever interpolated. */
function successHtml(displayName: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>Connected</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0">` +
    `<div style="text-align:center;max-width:28rem;padding:1rem">` +
    `<h1 style="font-size:1.25rem">${displayName} connected</h1>` +
    '<p>The integration is now linked to your workspace. ' +
    'You can close this window and return to Borjie.</p>' +
    '</div></body></html>'
  );
}

// ─────────────────────────────────────────────────────────────────────
// Router factory
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the OAuth connect sub-router. Mounted INSIDE createConnectorsRouter
 * BEFORE its blanket auth middleware — this router applies auth itself on
 * start/disconnect, while the provider-initiated callback authenticates via
 * the signed state alone.
 */
export function createConnectorsOAuthRouter(
  opts: ConnectorsOAuthRouterOptions = {},
): Hono {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const cipher =
    opts.cipher !== undefined ? opts.cipher : createConnectorTokenCipher(env);
  const replayGuard = opts.replayGuard ?? createOAuthStateReplayGuard();
  const durableNonceConsume =
    opts.durableNonceConsume ?? consumeOAuthStateNonceDurably;
  const now = opts.now ?? Date.now;

  const app = new Hono();

  // Per-path middleware: the callback gets db only (no JWT exists there).
  app.use('/:connectorId/connect/start', authMiddleware);
  app.use('/:connectorId/disconnect', authMiddleware, databaseMiddleware);
  app.use('/connect/callback', databaseMiddleware);

  // ── POST /:connectorId/connect/start — mint the authorize URL ──────
  app.post('/:connectorId/connect/start', async (c) => {
    const auth = (c.get('auth') ?? {}) as AuthContext;
    if (!auth.tenantId) return c.json(unauthorized, 401);

    const idParsed = ConnectorIdParam.safeParse(c.req.param('connectorId'));
    if (!idParsed.success) {
      return c.json(
        badConnectorId(idParsed.error.issues[0]?.message ?? 'invalid id'),
        400,
      );
    }
    const connectorId = idParsed.data;

    const catalogEntry = getConnectorDescriptor(connectorId);
    if (!catalogEntry) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'UNKNOWN_CONNECTOR',
            message: `no connector "${connectorId}" in the catalog`,
          },
        },
        404,
      );
    }

    // HONEST envelopes (200 — the route worked; provisioning did not).
    const notProvisioned = (reason: string) =>
      c.json(
        {
          success: true as const,
          data: { provisioned: false, connectorId, reason },
        },
        200,
      );

    const descriptor = getConnectorOAuthDescriptor(connectorId);
    if (!descriptor) {
      return notProvisioned(
        `"${catalogEntry.displayName}" has no hosted OAuth connect flow yet — ` +
          'no provider descriptor is registered for it',
      );
    }
    const provider = readConnectorOAuthProviderConfig(descriptor, env);
    if (!provider.ok) {
      return notProvisioned(provider.reason);
    }
    if (!isStateSigningProvisioned(env)) {
      return notProvisioned(
        'state signing secret not configured — set ' +
          'CONNECTOR_OAUTH_STATE_SECRET (or CONNECTOR_TOKEN_KEY / ENCRYPTION_MASTER_KEY)',
      );
    }

    const nowMs = now();
    const state = encodeConnectorOAuthState(
      {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'unknown',
        connectorId,
      },
      env,
      nowMs,
    );
    const authorizeUrl = buildConnectorAuthorizeUrl({
      descriptor,
      config: provider.config,
      state,
    });

    moduleLogger.info('connectors-oauth: connect started', {
      tenantId: auth.tenantId,
      connectorId,
    });
    return c.json(
      {
        success: true as const,
        data: {
          provisioned: true,
          connectorId,
          authorizeUrl,
          // The signed state inside the URL expires then; surface it so the
          // UI can message "link valid for 10 minutes".
          stateExpiresAt: new Date(
            nowMs + CONNECTOR_OAUTH_STATE_TTL_MS,
          ).toISOString(),
        },
      },
      200,
    );
  });

  // ── GET /connect/callback — verify state, exchange, SEAL, upsert ───
  app.get('/connect/callback', async (c) => {
    const parsed = CallbackQuery.safeParse({
      code: c.req.query('code'),
      state: c.req.query('state'),
      error: c.req.query('error'),
      error_description: c.req.query('error_description'),
    });
    if (!parsed.success) {
      return c.json(
        {
          success: false as const,
          error: { code: 'VALIDATION_ERROR', message: 'invalid callback query' },
        },
        400,
      );
    }
    if (parsed.data.error) {
      // The human declined consent at the provider — honest, nothing written.
      return c.json(
        {
          success: false as const,
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
          success: false as const,
          error: {
            code: 'MISSING_CODE_OR_STATE',
            message: 'code and state are required',
          },
        },
        400,
      );
    }

    const state = decodeConnectorOAuthState(parsed.data.state, env, now());
    if (!state) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'INVALID_STATE',
            message: 'OAuth state failed verification or expired',
          },
        },
        400,
      );
    }
    // FAST-PATH replay check (same-process). NOT the authority on a
    // multi-replica deploy — the durable Postgres consume below decides.
    if (!replayGuard.consume(state.nonce, state.exp)) {
      moduleLogger.warn('connectors-oauth: replayed state rejected', {
        tenantId: state.tenantId,
        connectorId: state.connectorId,
      });
      return c.json(
        {
          success: false as const,
          error: {
            code: 'STATE_ALREADY_USED',
            message: 'this OAuth state was already consumed — restart the connect flow',
          },
        },
        400,
      );
    }

    const descriptor = getConnectorOAuthDescriptor(state.connectorId);
    const catalogEntry = getConnectorDescriptor(state.connectorId);
    if (!descriptor || !catalogEntry) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'UNKNOWN_CONNECTOR',
            message: 'the state references a connector with no OAuth descriptor',
          },
        },
        400,
      );
    }
    const provider = readConnectorOAuthProviderConfig(descriptor, env);
    if (!provider.ok) {
      return c.json(
        {
          success: false as const,
          error: { code: 'PROVIDER_OAUTH_NOT_CONFIGURED', message: provider.reason },
        },
        503,
      );
    }
    if (!cipher) {
      // Never persist a token we cannot seal — honest refusal, nothing written.
      return c.json(
        {
          success: false as const,
          error: {
            code: 'TOKEN_CIPHER_NOT_PROVISIONED',
            message:
              'credential cipher key not configured (CONNECTOR_TOKEN_KEY / ' +
              'ENCRYPTION_MASTER_KEY) — refusing to store an unsealed token',
          },
        },
        503,
      );
    }
    const db = (c.get('db') ?? null) as OAuthDb | null;
    if (!db) {
      return c.json(
        {
          success: false as const,
          error: { code: 'DB_UNAVAILABLE', message: 'database not configured' },
        },
        503,
      );
    }

    // DURABLE single-use consumption — THE replay authority (migration 0343).
    // The in-process fast-path above cannot see a consumption that happened
    // on another replica; this atomic INSERT … ON CONFLICT DO NOTHING decides
    // cluster-wide BEFORE the code exchange (a replayed state must never
    // trigger a provider round-trip). FAIL-CLOSED: an unreachable ledger
    // rejects — we cannot prove first-use, so we refuse rather than risk a
    // replay riding a DB outage.
    const durable = await durableNonceConsume(db as OAuthNonceDb, {
      nonce: state.nonce,
      tenantId: state.tenantId,
      connectorId: state.connectorId,
      expMs: state.exp,
    });
    if (durable === 'replayed') {
      moduleLogger.warn('connectors-oauth: replayed state rejected (durable)', {
        tenantId: state.tenantId,
        connectorId: state.connectorId,
      });
      return c.json(
        {
          success: false as const,
          error: {
            code: 'STATE_ALREADY_USED',
            message: 'this OAuth state was already consumed — restart the connect flow',
          },
        },
        400,
      );
    }
    if (durable === 'failed') {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'STATE_CONSUME_FAILED',
            message:
              'could not verify single-use of the OAuth state — try the connect flow again',
          },
        },
        503,
      );
    }

    // Exchange OUTSIDE any transaction — provider round-trip must not hold
    // a pooled connection.
    const exchanged = await exchangeConnectorAuthorizationCode({
      descriptor,
      config: provider.config,
      code: parsed.data.code,
      fetchImpl,
    });
    if (!exchanged.ok) {
      moduleLogger.error('connectors-oauth: code exchange failed', {
        tenantId: state.tenantId,
        connectorId: state.connectorId,
        reason: exchanged.reason, // token-free by construction
      });
      return c.json(
        {
          success: false as const,
          error: { code: 'OAUTH_EXCHANGE_FAILED', message: exchanged.reason },
        },
        502,
      );
    }
    const tokens = exchanged.tokens;

    // SEAL before any persistence — plaintext never reaches the db layer.
    let accessEnc: Uint8Array;
    let refreshEnc: Uint8Array | null;
    try {
      accessEnc = await cipher.seal(tokens.accessToken);
      refreshEnc =
        tokens.refreshToken !== null
          ? await cipher.seal(tokens.refreshToken)
          : null;
    } catch {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'TOKEN_SEAL_FAILED',
            message: 'could not seal the credential — nothing was stored',
          },
        },
        500,
      );
    }

    const auditHash = credentialAuditHash({
      tenantId: state.tenantId,
      kind: descriptor.credentialKind,
      account: tokens.account,
      scopes: tokens.scopes,
      expiresAt: tokens.expiresAt,
      sealedAtMs: now(),
    });

    try {
      // Bind the RLS GUC from the VERIFIED state inside the transaction
      // (SET LOCAL semantics — set_config(..., true)) so FORCE-RLS applies
      // to the write on the same pooled connection. The explicit tenant_id
      // value is the primary guard; the GUC makes RLS real defence-in-depth.
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.current_tenant_id', ${state.tenantId}, true)`,
        );
        await tx.execute(sql`
          INSERT INTO connector_credentials
            (tenant_id, connector_kind, connector_account,
             access_token_enc, refresh_token_enc, scopes, expires_at,
             audit_hash, updated_at)
          VALUES
            (${state.tenantId}, ${descriptor.credentialKind}, ${tokens.account},
             ${Buffer.from(accessEnc)},
             ${refreshEnc ? Buffer.from(refreshEnc) : null},
             ${textArraySql(tokens.scopes)}, ${tokens.expiresAt},
             ${auditHash}, now())
          ON CONFLICT (tenant_id, connector_kind, connector_account)
          DO UPDATE SET
            access_token_enc  = EXCLUDED.access_token_enc,
            refresh_token_enc = EXCLUDED.refresh_token_enc,
            scopes            = EXCLUDED.scopes,
            expires_at        = EXCLUDED.expires_at,
            audit_hash        = EXCLUDED.audit_hash,
            updated_at        = now()
        `);
      });
    } catch (err) {
      moduleLogger.error('connectors-oauth: credential upsert failed', {
        tenantId: state.tenantId,
        connectorId: state.connectorId,
        error: err instanceof Error ? err.message : 'unknown',
      });
      return c.json(
        {
          success: false as const,
          error: {
            code: 'CREDENTIAL_STORE_FAILED',
            message: 'could not persist the sealed credential',
          },
        },
        500,
      );
    }

    moduleLogger.info('connectors-oauth: credential sealed + stored', {
      tenantId: state.tenantId,
      connectorId: state.connectorId,
      account: tokens.account,
      scopes: tokens.scopes,
    });

    // Content-negotiate: JSON for programmatic callers, a minimal static
    // page for the human landing back from the consent screen.
    if (c.req.header('accept')?.includes('application/json')) {
      return c.json(
        {
          success: true as const,
          data: {
            connected: true,
            connectorId: state.connectorId,
            account: tokens.account,
            scopes: tokens.scopes,
          },
        },
        200,
      );
    }
    return c.html(successHtml(catalogEntry.displayName), 200);
  });

  // ── POST /:connectorId/disconnect — best-effort revoke + delete ────
  app.post('/:connectorId/disconnect', async (c) => {
    const auth = (c.get('auth') ?? {}) as AuthContext;
    if (!auth.tenantId) return c.json(unauthorized, 401);
    const tenantId = auth.tenantId;

    const idParsed = ConnectorIdParam.safeParse(c.req.param('connectorId'));
    if (!idParsed.success) {
      return c.json(
        badConnectorId(idParsed.error.issues[0]?.message ?? 'invalid id'),
        400,
      );
    }
    const connectorId = idParsed.data;
    const catalogEntry = getConnectorDescriptor(connectorId);
    if (!catalogEntry) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'UNKNOWN_CONNECTOR',
            message: `no connector "${connectorId}" in the catalog`,
          },
        },
        404,
      );
    }
    const db = (c.get('db') ?? null) as OAuthDb | null;
    if (!db) {
      return c.json(
        {
          success: false as const,
          error: { code: 'DB_UNAVAILABLE', message: 'database not configured' },
        },
        503,
      );
    }

    const kinds = catalogEntry.credentialKinds;
    const descriptor = getConnectorOAuthDescriptor(connectorId);

    // Best-effort provider-side revoke (never blocks the local delete).
    if (descriptor?.revokeUrl && cipher) {
      try {
        const result = await db.execute(sql`
          SELECT access_token_enc FROM connector_credentials
          WHERE tenant_id = ${tenantId}
            AND connector_kind = ANY(${textArraySql(kinds)})
        `);
        for (const row of rowsOf(result)) {
          const enc = row.access_token_enc;
          if (!enc) continue;
          try {
            const token = await cipher.open(
              enc instanceof Uint8Array ? enc : new Uint8Array(enc as Buffer),
            );
            await fetchImpl(descriptor.revokeUrl, {
              method: 'POST',
              headers: { authorization: `Bearer ${token}` },
            });
          } catch {
            // Best-effort only — tamper/transport failures never block delete.
          }
        }
      } catch {
        // Credential read failed — proceed straight to delete.
      }
    }

    let removed = 0;
    try {
      removed = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
        );
        const result = await tx.execute(sql`
          DELETE FROM connector_credentials
          WHERE tenant_id = ${tenantId}
            AND connector_kind = ANY(${textArraySql(kinds)})
          RETURNING id
        `);
        return rowsOf(result).length;
      });
    } catch (err) {
      moduleLogger.error('connectors-oauth: disconnect delete failed', {
        tenantId,
        connectorId,
        error: err instanceof Error ? err.message : 'unknown',
      });
      return c.json(
        {
          success: false as const,
          error: {
            code: 'DISCONNECT_FAILED',
            message: 'could not remove the stored credential',
          },
        },
        500,
      );
    }

    moduleLogger.info('connectors-oauth: disconnected', {
      tenantId,
      connectorId,
      removedAccounts: removed,
    });
    return c.json(
      {
        success: true as const,
        data: { disconnected: true, connectorId, removedAccounts: removed },
      },
      200,
    );
  });

  return app;
}

export default createConnectorsOAuthRouter;
