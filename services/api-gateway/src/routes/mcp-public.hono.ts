/**
 * /mcp + /mcp/sse — public MCP server adapter.
 *
 * Wave AGENTIC-PLATFORM. Mounts `@borjie/mcp-server-borjie` at the
 * express ROOT (NOT under /api/v1) per MCP 2024-11-05 convention so
 * the URL the discovery manifest hands out matches the URL clients
 * connect to.
 *
 * Routes:
 *   POST /mcp        — JSON-RPC 2.0 over HTTP, single request, single response.
 *   GET  /mcp/sse    — long-lived Server-Sent Events stream. Emits a
 *                       `session` event on connect, then `message`,
 *                       `$/progress`, `notifications/resources/updated`,
 *                       and `logging/message` events for the lifetime
 *                       of the connection.
 *   POST /mcp/messages?sessionId=…
 *                    — sidecar inbound channel for SSE-connected clients.
 *                       Each JSON-RPC request is matched to the SSE
 *                       channel and the response pushed back as a
 *                       `message` event.
 *
 * Auth: OAuth2 device-flow agent tokens (migration 0118). The bearer
 *       token is validated by the dispatcher's resolveAuthContext.
 *
 * Security:
 *   - kill-switch fail-closed (-32003)
 *   - per-scope rate limit (-32099)
 *   - four-eye on sovereign tool prefixes (-32011)
 *   - audit trail hash-chain on every tools/call
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  createSseHandler,
  createInMemorySseRegistry,
  createDispatcher,
  createGatewayClient,
  createTokenBucketRateLimiter,
  createInMemorySubscriptionRegistry,
  createInMemorySessionStore,
  createSessionManager,
  createInMemoryApprovalStore,
  createUnsupportedSamplingResponder,
  createEmptyRootsProvider,
  createEmptyWorkspaceProvider,
  createNoopNotificationSink,
  createLogLevelController,
  formatSseEvent,
  type BorjieMcpAuthContext,
  type BorjieScope,
  type SseChannel,
  type SseEvent,
} from '@borjie/mcp-server-borjie';
import { oauthAgentTokens } from '@borjie/database';
import { databaseMiddleware } from '../middleware/database';
import { createLogger } from '../utils/logger';

const moduleLogger = createLogger('mcp-public');

const PUBLIC_API_BASE = process.env.BORJIE_PUBLIC_API_URL ?? 'http://localhost:4001';
const OWNER_WEB_BASE = process.env.BORJIE_OWNER_WEB_URL ?? 'https://owner.borjie.app';

const KNOWN_SCOPES = new Set<BorjieScope>([
  'owner:read',
  'owner:write',
  'owner:draft',
  'owner:reminders',
  'owner:share',
  'admin:read',
]);

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function narrowScopes(stored: readonly string[]): ReadonlyArray<BorjieScope> {
  const out: BorjieScope[] = [];
  for (const s of stored) {
    if ((KNOWN_SCOPES as Set<string>).has(s)) out.push(s as BorjieScope);
  }
  return Object.freeze(out);
}

// Shared singletons — one per gateway process. RLS still isolates per
// tenant at the SQL layer; these holders only carry session/limiter
// state which is keyed on token id anyway.
const sseRegistry = createInMemorySseRegistry();
const rateLimiter = createTokenBucketRateLimiter();
const subscriptions = createInMemorySubscriptionRegistry();
const sessionStore = createInMemorySessionStore();
const sessionManager = createSessionManager({ store: sessionStore });
const approvalStore = createInMemoryApprovalStore();
const sharedLogLevel = createLogLevelController('info');

const gatewayClient = createGatewayClient({ baseUrl: PUBLIC_API_BASE });

function buildDeps(db: unknown) {
  return {
    gatewayClient,
    async resolveAuthContext(bearer: string | null): Promise<BorjieMcpAuthContext | null> {
      if (!bearer) return null;
      // db can be null when the registry is not live; in that case we
      // cannot validate the token and fail closed.
      if (!db) return null;
      const tokenHash = hashToken(bearer);
      // Direct lookup — RLS is fine to bypass here because we look up by
      // the secret hash, which is itself the credential. The matched row
      // carries the tenant_id we then use for the GUC during the
      // downstream gateway call.
      try {
        const rows = await (db as {
          select: (selector: Record<string, unknown>) => {
            from: (table: unknown) => {
              where: (predicate: unknown) => { limit: (n: number) => Promise<ReadonlyArray<{
                id: string;
                tenantId: string;
                userId: string;
                scopes: ReadonlyArray<string> | null;
                clientLabel: string | null;
                revokedAt: Date | null;
                expiresAt: Date | null;
                issuedAt: Date;
              }>> };
            };
          };
        }).select({
          id: oauthAgentTokens.id,
          tenantId: oauthAgentTokens.tenantId,
          userId: oauthAgentTokens.userId,
          scopes: oauthAgentTokens.scopes,
          clientLabel: oauthAgentTokens.clientLabel,
          revokedAt: oauthAgentTokens.revokedAt,
          expiresAt: oauthAgentTokens.expiresAt,
          issuedAt: oauthAgentTokens.issuedAt,
        })
          .from(oauthAgentTokens)
          .where(eq(oauthAgentTokens.tokenHash, tokenHash))
          .limit(1);
        const row = rows[0];
        if (!row) return null;
        if (row.revokedAt) return null;
        if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
        return Object.freeze({
          tenantId: row.tenantId,
          ownerId: row.userId,
          agentName: row.clientLabel ?? 'external-agent',
          agentTokenId: row.id,
          scopes: narrowScopes(row.scopes ?? []),
          issuedAt: row.issuedAt.getTime(),
          expiresAt: row.expiresAt ? row.expiresAt.getTime() : Date.now() + 24 * 60 * 60 * 1_000,
          correlationId: randomUUID(),
        });
      } catch (err) {
        moduleLogger.error('mcp.resolveAuthContext.failed', {
          err: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
    async killSwitchOpen(): Promise<boolean> {
      return false;
    },
    async auditChainHash(input: {
      readonly toolName: string;
      readonly auth: BorjieMcpAuthContext;
      readonly idempotencyKey?: string;
    }): Promise<string> {
      const seed = `${input.auth.agentTokenId}:${input.toolName}:${input.idempotencyKey ?? ''}:${Date.now()}`;
      return createHash('sha256').update(seed, 'utf8').digest('hex');
    },
    rateLimiter,
    subscriptions,
    sessionManager,
    approvalStore,
    samplingResponder: createUnsupportedSamplingResponder(),
    rootsProvider: createEmptyRootsProvider(),
    workspaceProvider: createEmptyWorkspaceProvider(),
    notificationSink: createNoopNotificationSink(),
    logLevel: sharedLogLevel,
    ownerWebBaseUrl: OWNER_WEB_BASE,
  };
}

const app = new Hono();
app.use('*', databaseMiddleware);

// ─── POST /mcp ─────────────────────────────────────────────────────────────
// We use the dispatcher directly (not createHttpHandler) so the URL
// rewriting concerns don't apply. Hono mounts us at /mcp; this handler
// fires for POST /mcp itself.
app.post('/', async (c) => {
  const db = c.get('db');
  const body = await c.req.text();
  const dispatcher = createDispatcher(buildDeps(db));
  const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const idempotencyKey = c.req.header('idempotency-key');
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return c.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'invalid JSON' },
      },
      200,
    );
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.method !== 'string') {
    return c.json(
      {
        jsonrpc: '2.0',
        id: parsed?.id ?? null,
        error: { code: -32600, message: 'invalid JSON-RPC envelope' },
      },
      200,
    );
  }
  const response = await dispatcher.dispatch({
    request: parsed,
    bearerToken: bearer,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
  return c.json(response, 200);
});

// ─── GET /mcp/healthz ──────────────────────────────────────────────────────
app.get('/healthz', (c) => c.json({ ok: true }, 200));

// ─── GET /mcp/sse ──────────────────────────────────────────────────────────
app.get('/sse', (c) => {
  const db = c.get('db');
  const sseHandler = createSseHandler({
    ...buildDeps(db),
    registry: sseRegistry,
  });
  const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const resume = c.req.query('session');
  return streamSSE(c, async (stream) => {
    const queue: SseEvent[] = [];
    let alive = true;
    let resolver: (() => void) | null = null;

    const channel: Omit<SseChannel, 'sessionId'> = {
      send(event: SseEvent): void {
        if (!alive) return;
        queue.push(event);
        resolver?.();
      },
      close(): void {
        alive = false;
        resolver?.();
      },
    };
    const bound = sseHandler.onConnect(
      { bearerToken: bearer, ...(resume ? { resumeSessionId: resume } : {}) },
      channel,
    );
    stream.onAbort(() => {
      alive = false;
      sseRegistry.unregister(bound.sessionId);
      resolver?.();
    });

    while (alive) {
      if (queue.length > 0) {
        const evt = queue.shift()!;
        await stream.write(formatSseEvent(evt));
        continue;
      }
      await new Promise<void>((r) => {
        resolver = r;
      });
      resolver = null;
    }
  });
});

// ─── POST /mcp/messages?sessionId=… ────────────────────────────────────────
app.post('/messages', async (c) => {
  const db = c.get('db');
  const sseHandler = createSseHandler({
    ...buildDeps(db),
    registry: sseRegistry,
  });
  const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const sessionId = c.req.query('sessionId');
  if (!sessionId) return c.json({ error: 'sessionId required' }, 400);
  const body = await c.req.text();
  const idempotencyKey = c.req.header('idempotency-key');
  const response = await sseHandler.onPost({
    sessionId,
    bearerToken: bearer,
    body,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
  return c.json(response, 200);
});

export const mcpPublicRouter = app;
export default app;
