/**
 * Central Intelligence streaming router.
 *
 *   POST /api/v1/intelligence/thread
 *     Start a new thread. Returns { threadId, title }.
 *
 *   POST /api/v1/intelligence/thread/:threadId/message
 *     Stream an agent turn over Server-Sent Events. One event per
 *     `AgentEvent.kind` (plan | thought | tool_call | tool_result |
 *     text | citation | artifact | error | done). Final event is
 *     `event: done`.
 *
 *   GET  /api/v1/intelligence/threads?limit=20
 *     List the caller's threads, scoped to their tenant or to the
 *     platform (platform scope requires SUPER_ADMIN / ADMIN / SUPPORT).
 *
 *   GET  /api/v1/intelligence/thread/:threadId
 *     Return { thread, turns } for the caller's own thread. 404 if the
 *     thread is not visible in the caller's scope.
 *
 * Auth: every endpoint runs `authMiddleware`. ScopeContext is built
 *   SERVER-SIDE from the authed user's session — NEVER from the
 *   request body — so a tenant cannot mint a platform-scoped agent
 *   turn against anybody else's data.
 *
 * Scope gating:
 *   - Tenant tokens always build a tenant ScopeContext.
 *   - Platform scope requires SUPER_ADMIN / ADMIN / SUPPORT roles AND
 *     `scope: 'platform'` in the request body. Otherwise we refuse
 *     with 403 PLATFORM_SCOPE_FORBIDDEN.
 *
 * Degradation: when the LLM adapter is not wired (agent slot null),
 * every endpoint that needs agency returns 503
 * INTELLIGENCE_SERVICE_UNAVAILABLE. No mock agents, ever. The memory
 * endpoints (list threads, read thread) still work against the
 * in-memory ConversationMemory so clients can exercise thread
 * lifecycle locally.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type {
  AgentEvent,
  CentralIntelligenceAgent,
  ConversationAuditReader,
  ConversationMemory,
  ScopeContext,
} from '@borjie/central-intelligence';
import { authMiddleware } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ScopeEnum = z.enum(['tenant', 'platform']);

const CreateThreadBodySchema = z
  .object({
    firstMessage: z.string().min(1).max(10_000),
    scope: ScopeEnum.optional(),
  })
  .strict();

const SendMessageBodySchema = z
  .object({
    message: z.string().min(1).max(10_000),
    scope: ScopeEnum.optional(),
    extendedThinking: z.boolean().optional(),
  })
  .strict();

const ListThreadsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    scope: ScopeEnum.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Router + middleware
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface IntelligenceSlot {
  readonly agent: CentralIntelligenceAgent | null;
  readonly memory: ConversationMemory | null;
  readonly auditReader: ConversationAuditReader | null;
}

function getIntelligence(c: any): IntelligenceSlot {
  const services = c.get('services') ?? {};
  return (
    services.centralIntelligence ?? {
      agent: null,
      memory: null,
      auditReader: null,
    }
  );
}

const PLATFORM_ROLES: ReadonlyArray<string> = Object.freeze([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.SUPPORT,
]);

function canUsePlatformScope(role: string | undefined): boolean {
  if (!role) return false;
  return PLATFORM_ROLES.includes(role);
}

/**
 * Build the ScopeContext server-side from the authed user's session.
 *
 * NEVER trust a `scope` value from the request body unless the
 * authenticated user is permitted to elevate. The tenant path uses
 * the session's tenantId — a tenant-token caller can never mint a
 * tenant context for another tenant.
 */
function buildScopeContext(
  auth: { tenantId?: string; userId?: string; role?: string },
  requestedScope: 'tenant' | 'platform' | undefined,
): ScopeContext | { error: 'TENANT_CONTEXT_MISSING' | 'PLATFORM_SCOPE_FORBIDDEN' } {
  const role = auth?.role;
  const userId = String(auth?.userId ?? '');

  // Platform scope — only when explicitly requested AND the caller has
  // a platform-admin role. Tenant-scoped tokens can never escalate.
  if (requestedScope === 'platform') {
    if (!canUsePlatformScope(role)) {
      return { error: 'PLATFORM_SCOPE_FORBIDDEN' };
    }
    return Object.freeze({
      kind: 'platform',
      actorUserId: userId,
      roles: Object.freeze([String(role ?? '')]),
      personaId: 'industry-observer',
    }) as ScopeContext;
  }

  // Default: tenant scope. Tenant-id comes from the session, never
  // from the body. A missing tenantId on the session is a 400.
  const tenantId = String(auth?.tenantId ?? '');
  if (!tenantId) {
    return { error: 'TENANT_CONTEXT_MISSING' };
  }
  return Object.freeze({
    kind: 'tenant',
    tenantId,
    actorUserId: userId,
    roles: Object.freeze([String(role ?? '')]),
    personaId: 'mr-mwikila-head',
  }) as ScopeContext;
}

function unavailableAgent(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'INTELLIGENCE_SERVICE_UNAVAILABLE',
        message:
          'Central Intelligence agent is not wired on this gateway. Set CI_LLM_URL and wire the LLM adapter to enable.',
      },
    },
    503,
  );
}

function unavailableMemory(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'INTELLIGENCE_SERVICE_UNAVAILABLE',
        message: 'Central Intelligence memory is not wired on this gateway.',
      },
    },
    503,
  );
}

function forbiddenPlatform(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'PLATFORM_SCOPE_FORBIDDEN',
        message:
          'Platform scope requires a platform-admin role (SUPER_ADMIN, ADMIN, SUPPORT).',
      },
    },
    403,
  );
}

function tenantMissing(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'TENANT_CONTEXT_MISSING',
        message: 'Authenticated request is missing a tenant context',
      },
    },
    400,
  );
}

// ---------------------------------------------------------------------------
// POST /thread — create a thread and seed it with the first user message
// ---------------------------------------------------------------------------

app.post(
  '/thread',
  zValidator('json', CreateThreadBodySchema),
  withSecurityEvents({ action: 'intelligence.create', resource: 'intelligence', severity: 'info' }, async (c: any) => {
    const auth = c.get('auth');
    const body = c.req.valid('json');
    const { memory } = getIntelligence(c);
    if (!memory) return unavailableMemory(c);

    const scoped = buildScopeContext(auth, body.scope);
    if ('error' in scoped) {
      if (scoped.error === 'PLATFORM_SCOPE_FORBIDDEN') return forbiddenPlatform(c);
      return tenantMissing(c);
    }

    try {
      const thread = await memory.createThread(scoped, body.firstMessage);
      return c.json(
        {
          success: true,
          data: {
            threadId: thread.threadId,
            title: thread.title,
          },
        },
        201,
      );
    } catch (err) {
      return routeCatch(c, err, {
        code: 'INTELLIGENCE_THREAD_CREATE_FAILED',
        status: 500,
        fallback: 'Failed to create intelligence thread',
      });
    }
  }),
);

// ---------------------------------------------------------------------------
// POST /thread/:threadId/message — SSE stream of AgentEvents
// ---------------------------------------------------------------------------

app.post(
  '/thread/:threadId/message',
  zValidator('json', SendMessageBodySchema),
  withSecurityEvents({ action: 'intelligence.create', resource: 'intelligence', severity: 'info' }, async (c: any) => {
    const auth = c.get('auth');
    const threadId = c.req.param('threadId');
    const body = c.req.valid('json');
    const { agent, memory } = getIntelligence(c);
    if (!agent || !memory) return unavailableAgent(c);

    const scoped = buildScopeContext(auth, body.scope);
    if ('error' in scoped) {
      if (scoped.error === 'PLATFORM_SCOPE_FORBIDDEN') return forbiddenPlatform(c);
      return tenantMissing(c);
    }

    // Verify the thread exists in the caller's scope BEFORE opening the
    // SSE stream. A cross-scope probe must look the same as a 404 — no
    // indication that the threadId exists somewhere else on the system.
    const loaded = await memory.getThread(threadId, scoped).catch(() => null);
    if (!loaded) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INTELLIGENCE_THREAD_NOT_FOUND',
            message: 'Thread not found',
          },
        },
        404,
      );
    }

    return streamSSE(c, async (stream) => {
      try {
        const iter = agent.run({
          threadId,
          userMessage: body.message,
          ctx: scoped,
          extendedThinking: body.extendedThinking === true,
        });

        for await (const event of iter as AsyncIterable<AgentEvent>) {
          await stream.writeSSE({
            event: event.kind,
            data: JSON.stringify(event),
          });
          if (event.kind === 'done' || event.kind === 'error') break;
        }
      } catch (err) {
        // Surface as a typed SSE error so the client can render a
        // banner without needing a second HTTP probe.
        const message = err instanceof Error ? err.message : String(err);
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            kind: 'error',
            message,
            retryable: false,
            at: new Date().toISOString(),
          }),
        });
      }
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /threads — list the caller's threads
// ---------------------------------------------------------------------------

app.get(
  '/threads',
  zValidator('query', ListThreadsQuerySchema),
  async (c: any) => {
    const auth = c.get('auth');
    const query = c.req.valid('query');
    const { memory } = getIntelligence(c);
    if (!memory) return unavailableMemory(c);

    const scoped = buildScopeContext(auth, query.scope);
    if ('error' in scoped) {
      if (scoped.error === 'PLATFORM_SCOPE_FORBIDDEN') return forbiddenPlatform(c);
      return tenantMissing(c);
    }

    try {
      const threads = await memory.listThreads(scoped, query.limit);
      return c.json({
        success: true,
        data: threads,
        meta: {
          total: threads.length,
          limit: query.limit,
          scope: scoped.kind,
        },
      });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'INTELLIGENCE_THREAD_LIST_FAILED',
        status: 500,
        fallback: 'Failed to list intelligence threads',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /thread/:threadId — return { thread, turns } in the caller's scope
// ---------------------------------------------------------------------------

app.get('/thread/:threadId', async (c: any) => {
  const auth = c.get('auth');
  const threadId = c.req.param('threadId');
  const { memory } = getIntelligence(c);
  if (!memory) return unavailableMemory(c);

  // Read scope hint from the query string; same rules as the other
  // endpoints — platform scope requires a platform-admin role.
  const scopeHint = c.req.query('scope');
  const parsedScope =
    scopeHint === 'platform' || scopeHint === 'tenant' ? scopeHint : undefined;

  const scoped = buildScopeContext(auth, parsedScope);
  if ('error' in scoped) {
    if (scoped.error === 'PLATFORM_SCOPE_FORBIDDEN') return forbiddenPlatform(c);
    return tenantMissing(c);
  }

  try {
    const loaded = await memory.getThread(threadId, scoped);
    if (!loaded) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INTELLIGENCE_THREAD_NOT_FOUND',
            message: 'Thread not found',
          },
        },
        404,
      );
    }
    return c.json({ success: true, data: loaded });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'INTELLIGENCE_THREAD_FETCH_FAILED',
      status: 500,
      fallback: 'Failed to fetch intelligence thread',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /thread/:threadId/audit
// ---------------------------------------------------------------------------
//
// Returns the cryptographically-chained audit records for a single
// thread. Exposes the full per-turn trail:
//   user_message → plan → thoughts → tool_calls → tool_results →
//   citations → artifacts → done
//
// Scope-gated exactly like the other endpoints: tenant callers see
// their own tenant's chain; platform callers see the platform chain.
// Cross-scope probes return an empty array (the reader filters by
// scope-derived tenant id), never revealing existence signals.
//
// 503 INTELLIGENCE_AUDIT_UNAVAILABLE when the reader is null (should
// never happen in either degraded or live mode, but the check keeps
// future slot removals from silently breaking the surface).

const AuditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(1000).default(500),
    scope: ScopeEnum.optional(),
  })
  .strict();

app.get(
  '/thread/:threadId/audit',
  zValidator('query', AuditQuerySchema),
  async (c: any) => {
    const auth = c.get('auth');
    const threadId = c.req.param('threadId');
    const { auditReader } = getIntelligence(c);
    if (!auditReader) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INTELLIGENCE_AUDIT_UNAVAILABLE',
            message: 'Audit reader not wired on this gateway',
          },
        },
        503,
      );
    }

    const query = c.req.valid('query');
    const scoped = buildScopeContext(auth, query.scope);
    if ('error' in scoped) {
      if (scoped.error === 'PLATFORM_SCOPE_FORBIDDEN') return forbiddenPlatform(c);
      return tenantMissing(c);
    }

    try {
      const records = await auditReader.listForThread({
        threadId,
        ctx: scoped,
        limit: query.limit,
      });
      return c.json({ success: true, data: { records, threadId, total: records.length } });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'INTELLIGENCE_AUDIT_FETCH_FAILED',
        status: 500,
        fallback: 'Failed to fetch intelligence audit trail',
      });
    }
  },
);

export default app;
