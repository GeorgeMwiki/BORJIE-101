/**
 * /api/v1/ai/chat — streaming chat router.
 *
 * This is the transport the chat UIs (`useChatStream`) consume. It wraps
 * Brain's `streamTurn` orchestrator generator in an SSE response frame so
 * the browser can render typing deltas, tool calls, tool results, and
 * proposed actions incrementally.
 *
 * Endpoints:
 *   POST /api/v1/ai/chat          — authenticated, persona-aware streaming
 *
 * The public/marketing variant lives in `public-marketing.router.ts` and
 * re-uses `buildSseStream` to stream Mr. Mwikila's responses unauthenticated.
 *
 * SSE contract (matches packages/ai-copilot StreamTurnEvent):
 *   event: turn_start\ndata: {...}\n\n
 *   event: delta\ndata: {"content":"..."}\n\n
 *   event: tool_call\ndata: {...}\n\n
 *   event: tool_result\ndata: {...}\n\n
 *   event: proposed_action\ndata: {...}\n\n
 *   event: turn_end\ndata: {...}\n\n
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import pino from 'pino';
import {
  BrainRegistry,
  createBrain,
  PostgresThreadStoreBackend,
  loadBrainEnv,
  verifySupabaseJwt,
  extractBearer,
  principalToBrainContexts,
  SupabaseAuthError,
  BrainConfigError,
  streamTurn,
  type StreamTurnEvent,
} from '@borjie/ai-copilot';
import {
  createDatabaseClient,
  BrainThreadRepository,
} from '@borjie/database';
import {
  createNeo4jClient,
  createGraphQueryService,
  createGraphAgentToolkit,
} from '@borjie/graph-sync';
import { getBrainExtraSkills } from '../composition/brain-extensions';
import { rateLimiter as sharedRateLimiter } from '../middleware/rate-limiter';
import { v4 as uuid } from 'uuid';

import { withSecurityEvents } from '@borjie/observability';

const logger = pino({ name: 'ai-chat' });

// ---------------------------------------------------------------------------
// Lazy boot — the brain registry is constructed on first request so the
// gateway continues to boot for unrelated routes when ANTHROPIC_API_KEY is
// absent (dev + test paths).
// ---------------------------------------------------------------------------

let envCache: ReturnType<typeof loadBrainEnv> | null = null;
let dbCache: ReturnType<typeof createDatabaseClient> | null = null;
let registryCache: BrainRegistry | null = null;

function env() {
  if (!envCache) envCache = loadBrainEnv(process.env);
  return envCache;
}

function db() {
  if (!dbCache) dbCache = createDatabaseClient(env().DATABASE_URL);
  return dbCache;
}

function registry() {
  if (registryCache) return registryCache;
  const e = env();
  const graphToolkit = (() => {
    if (!process.env.NEO4J_URI?.trim()) return undefined;
    try {
      const neo4j = createNeo4jClient();
      return createGraphAgentToolkit(createGraphQueryService(neo4j));
    } catch (err) {
      logger.error({ err }, 'ai-chat.router: failed to construct graph toolkit');
      return undefined;
    }
  })();
  registryCache = new BrainRegistry((tenantId) => {
    const repo = new BrainThreadRepository(db());
    const backend = new PostgresThreadStoreBackend(repo, () => tenantId);
    const anthropic: { apiKey: string; baseUrl?: string; defaultModel?: string } = {
      apiKey: e.ANTHROPIC_API_KEY,
    };
    if (e.ANTHROPIC_BASE_URL !== undefined) anthropic.baseUrl = e.ANTHROPIC_BASE_URL;
    if (e.ANTHROPIC_MODEL_DEFAULT !== undefined) anthropic.defaultModel = e.ANTHROPIC_MODEL_DEFAULT;
    const brainConfig: Parameters<typeof createBrain>[0] = {
      anthropic,
      threadStoreBackend: backend,      extraSkills: getBrainExtraSkills(),
    };
    if (graphToolkit !== undefined) {
      (brainConfig as { graphToolkit?: typeof graphToolkit }).graphToolkit = graphToolkit;
    }
    return createBrain(brainConfig);
  });
  return registryCache;
}

async function authenticate(c) {
  const token = extractBearer(c.req.header('authorization'));
  if (!token) throw new SupabaseAuthError('missing_authorization_header', 401);
  const principal = await verifySupabaseJwt(token, {
    jwtSecret: env().SUPABASE_JWT_SECRET,
    defaultEnvironment: 'production',
  });
  return { principal, ...principalToBrainContexts(principal) };
}

// ---------------------------------------------------------------------------
// Request body schema
// ---------------------------------------------------------------------------

const ChatBodySchema = z.object({
  personaId: z.string().min(1).max(80),
  subPersonaId: z.string().max(80).optional(),
  forcePersonaId: z.string().max(80).optional(),
  threadId: z.string().uuid().optional(),
  message: z.string().min(1).max(10_000),
});

// ---------------------------------------------------------------------------
// Rate limiter — backed by the shared `rateLimiter` (same store as
// `perUserRateLimit` in `memory-declare.router.ts`). Bug fix
// A-BUG-DEEP #2: removes a per-router in-memory Map that drifted from the
// canonical limiter and could be swapped to Redis in one place later.
// ---------------------------------------------------------------------------

const CHAT_RATE_CONFIG = {
  maxRequests: 30,
  windowSizeSeconds: 60,
} as const;

function checkRate(key: string): boolean {
  return sharedRateLimiter.check(`perUser:chat:${key}`, CHAT_RATE_CONFIG).allowed;
}

// ---------------------------------------------------------------------------
// Shared SSE serializer
// ---------------------------------------------------------------------------

/**
 * Pipe an `AsyncGenerator<StreamTurnEvent>` into a Hono `streamSSE` response.
 *
 * Exported so `public-marketing.router` can re-use exactly the same event
 * framing for the unauthenticated Mr. Mwikila chat.
 */
export async function pipeStreamTurnToSSE(
  stream,
  iter: AsyncGenerator<StreamTurnEvent>
): Promise<void> {
  try {
    for await (const evt of iter) {
      await stream.writeSSE({
        event: evt.type,
        data: JSON.stringify(evt),
      });
    }
  } catch (err) {
    // Wave-26 Agent Z4 — surface `AiBudgetExceededError` from `withBudgetGuard`
    // (and from `MultiLLMRouter.complete` via `ledger.assertWithinBudget`) as a
    // structured SSE error so the chat UI can render a friendly
    // "monthly AI budget reached" banner. Everything else maps to INTERNAL.
    const isBudgetExceeded =
      err instanceof Error &&
      ((err as { code?: string }).code === 'AI_BUDGET_EXCEEDED' ||
        err.name === 'AiBudgetExceededError');
    await stream.writeSSE({
      event: 'error',
      data: JSON.stringify({
        type: 'error',
        code: isBudgetExceeded ? 'BUDGET_EXCEEDED' : 'INTERNAL',
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      }),
    });
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = new Hono();

router.post('/chat', withSecurityEvents({ action: 'ai-chat.create', resource: 'ai-chat', severity: 'info' }, async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = ChatBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }

  let ctx;
  try {
    ctx = await authenticate(c);
  } catch (err) {
    if (err instanceof SupabaseAuthError) {
      return c.json({ error: err.message, code: 'AUTH' }, err.status);
    }
    if (err instanceof BrainConfigError) {
      return c.json({ error: err.message, code: 'BRAIN_NOT_CONFIGURED' }, 503);
    }
    return c.json({ error: 'auth_failed' }, 500);
  }

  const rateKey = `${ctx.tenant.tenantId}:${ctx.actor.id}`;
  if (!checkRate(rateKey)) {
    return c.json({ error: 'rate_limited', code: 'RATE_LIMIT' }, 429);
  }

  // Wave-26 Agent Z4 — per-tenant monthly AI budget enforcement. We invoke
  // `CostLedger.assertWithinBudget` (the same primitive that `withBudgetGuard`
  // and `MultiLLMRouter.complete` call) BEFORE the SSE stream opens so an
  // over-budget tenant gets a clean 429 with `code: BUDGET_EXCEEDED` instead
  // of a half-open stream that errors mid-flight. When the ledger is absent
  // (degraded mode) we skip silently so the rest of the chat surface stays up.
  const services = c.get('services');
  const ledger = services?.aiCostLedger;
  if (ledger) {
    try {
      await ledger.assertWithinBudget(ctx.tenant.tenantId);
    } catch (err) {
      const e = err as { code?: string; name?: string; message?: string };
      if (e?.code === 'AI_BUDGET_EXCEEDED' || e?.name === 'AiBudgetExceededError') {
        return c.json(
          {
            error: e.message ?? 'monthly AI budget exceeded',
            code: 'BUDGET_EXCEEDED',
          },
          429,
        );
      }
      // Ledger-lookup failures must not block the chat — log once and proceed.
      logger.warn({ err: e }, 'ai-chat.router: budget pre-flight check failed (non-fatal)');
    }
  }

  let brain;
  try {
    brain = registry().for(ctx.tenant.tenantId);
  } catch (err) {
    if (err instanceof BrainConfigError) {
      return c.json({ error: err.message, code: 'BRAIN_NOT_CONFIGURED' }, 503);
    }
    throw err;
  }

  // Ensure a thread exists. The authenticated /api/v1/brain/turn endpoint
  // starts a thread on demand, so we mirror that behaviour here.
  let threadId: string | undefined = parsed.data.threadId;  if (!threadId) {
    const createInput: Parameters<typeof brain.threads.createThread>[0] = {
      id: uuid(),
      tenantId: ctx.tenant.tenantId,
      initiatingUserId: ctx.actor.id,
      title: parsed.data.message.slice(0, 80),
      status: 'open',
    };
    const persona = parsed.data.forcePersonaId ?? parsed.data.personaId;
    if (persona !== undefined) {
      (createInput as { primaryPersonaId?: string }).primaryPersonaId = persona;
    }
    const thread = await brain.threads.createThread(createInput);
    threadId = thread.id;
  }
  const resolvedThreadId: string = threadId;

  return streamSSE(c, async (stream) => {
    const abort = new AbortController();
    stream.onAbort(() => abort.abort());

    const iter = streamTurn(brain.orchestrator, {
      threadId: resolvedThreadId,
      tenant: ctx.tenant,
      actor: ctx.actor,
      viewer: ctx.viewer,
      userText: parsed.data.message,
      forcePersonaId: parsed.data.forcePersonaId ?? parsed.data.personaId,
      signal: abort.signal,
    });

    await pipeStreamTurnToSSE(stream, iter);
  });
}));

export default router;
