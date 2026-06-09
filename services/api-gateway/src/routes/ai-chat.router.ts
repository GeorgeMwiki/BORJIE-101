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
// INPUT CONTAINMENT (CLOSE-G) — the blessed ingress prompt-injection /
// jailbreak guard, applied to the user's OWN message BEFORE it reaches
// `streamTurn` (the orchestrator). Mirrors brain.hono /turn: CRITICAL →
// single-language SSE refusal (the model never sees it); lower severities →
// run on the detector-redacted text. Fail-OPEN-but-logged inside the guard.
import {
  applyIngressGuard,
  pickIngressGuardLang,
} from '../composition/ingress-guard-apply.js';
// IP-EGRESS (CLOSE-G) — the SSE projected to `useChatStream` MUST NOT leak the
// brain's internal mechanics. Before this projection the raw `StreamTurnEvent`
// was JSON-stringified verbatim, exposing tool/agent names, handoff
// from/to/objective, persona ids, and un-egress-filtered model prose. We now
// PROJECT every event: coarsen tool_call / tool_result name to a generic label,
// DROP handoff + persona ids, and run model-authored text leaves through
// `getEgressFilter().guardFinal` (FAIL-CLOSED). See `egress-filter-wiring.ts`.
import { getEgressFilter } from '../composition/egress-filter-wiring.js';
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
      (brainConfig as unknown as { graphToolkit?: typeof graphToolkit }).graphToolkit = graphToolkit;
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
// Shared SSE serializer + IP-egress projection
// ---------------------------------------------------------------------------

/**
 * IP-EGRESS (CLOSE-G) — the single coarse, provider-agnostic label the
 * client-facing tool events carry. The raw internal tool/agent verb is an IP
 * leak (it exposes the brain's tool surface), so we coarsen it. Mirrors
 * brain-voice.hono.ts `COARSE_TOOL_CALL_LABEL`.
 */
const COARSE_TOOL_CALL_LABEL = 'action' as const;

/** Generic egress fail-closed placeholder for model-authored text. */
const EGRESS_FAIL_CLOSED = '[redacted]';

/**
 * Guard a model-authored text leaf through the FAIL-CLOSED egress filter. A
 * thrown filter (or construction fault) yields the generic placeholder, never
 * the raw text. Empty / non-string spans pass through unchanged.
 */
function guardChatText(text: string, tenantId: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  try {
    return getEgressFilter().guardFinal(text, tenantId).text;
  } catch (err) {
    logger.error(
      { wiring: 'egress-filter', tenantId, err: err instanceof Error ? err.message : String(err) },
      'ai-chat: egress guard threw — failing closed',
    );
    return EGRESS_FAIL_CLOSED;
  }
}

/** A projected, client-safe SSE frame. */
interface ProjectedChatFrame {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

/**
 * Project ONE raw `StreamTurnEvent` to its client-safe SSE frame. Returns null
 * for events the client must never see (handoff — agent-to-agent mechanics).
 *
 *   - turn_start  → DROP persona id; keep threadId + createdAt only.
 *   - delta       → model prose through the FAIL-CLOSED egress filter.
 *   - tool_call   → COARSE label, no name, no args (args can carry prompts/IP).
 *   - tool_result → COARSE label + ok flag, no name.
 *   - handoff     → DROPPED entirely (from / to / objective are pure mechanics).
 *   - proposed_action → keep risk + flags; egress-guard the description prose.
 *   - error       → keep code + retryable; egress-guard the message text.
 *   - turn_end    → DROP finalPersonaId + totalCost; keep tokens/time/thread.
 */
function projectChatStreamEvent(
  evt: StreamTurnEvent,
  tenantId: string,
): ProjectedChatFrame | null {
  switch (evt.type) {
    case 'turn_start':
      return {
        event: 'turn_start',
        data: { type: 'turn_start', threadId: evt.threadId, createdAt: evt.createdAt },
      };
    case 'delta':
      return {
        event: 'delta',
        data: { type: 'delta', content: guardChatText(evt.content, tenantId) },
      };
    case 'tool_call':
      return {
        event: 'tool_call',
        data: { type: 'tool_call', name: COARSE_TOOL_CALL_LABEL },
      };
    case 'tool_result':
      return {
        event: 'tool_result',
        data: { type: 'tool_result', name: COARSE_TOOL_CALL_LABEL, ok: evt.ok },
      };
    case 'handoff':
      // Agent-to-agent mechanics (from / to / objective) — NEVER to the client.
      return null;
    case 'proposed_action':
      return {
        event: 'proposed_action',
        data: {
          type: 'proposed_action',
          risk: evt.risk,
          description: guardChatText(evt.description, tenantId),
          reviewRequired: evt.reviewRequired,
          executionHeld: evt.executionHeld,
        },
      };
    case 'error':
      return {
        event: 'error',
        data: {
          type: 'error',
          code: evt.code,
          message: guardChatText(evt.message, tenantId),
          retryable: evt.retryable,
        },
      };
    case 'turn_end':
      return {
        event: 'turn_end',
        data: {
          type: 'turn_end',
          threadId: evt.threadId,
          totalTokens: evt.totalTokens,
          timeMs: evt.timeMs,
          advisorConsulted: evt.advisorConsulted,
        },
      };
  }
}

/**
 * Pipe an `AsyncGenerator<StreamTurnEvent>` into a Hono `streamSSE` response,
 * PROJECTING every event through `projectChatStreamEvent` so no internal
 * mechanic (tool/agent names, handoff, persona ids) or un-egress-filtered model
 * prose reaches the client. `tenantId` scopes the egress filter.
 */
export async function pipeStreamTurnToSSE(
  stream,
  iter: AsyncGenerator<StreamTurnEvent>,
  tenantId: string,
): Promise<void> {
  try {
    for await (const evt of iter) {
      const frame = projectChatStreamEvent(evt, tenantId);
      if (!frame) continue; // dropped (handoff)
      await stream.writeSSE({ event: frame.event, data: JSON.stringify(frame.data) });
    }
  } catch (err) {
    // Wave-26 Agent Z4 — surface `AiBudgetExceededError` from `withBudgetGuard`
    // (and from `MultiLLMRouter.complete` via `ledger.assertWithinBudget`) as a
    // structured SSE error so the chat UI can render a friendly
    // "monthly AI budget reached" banner. Everything else maps to INTERNAL.
    // IP-EGRESS (CLOSE-G): the raw `err.message` can leak provider / model /
    // internal-id detail, so we log it server-side (pino) and emit a GENERIC
    // client message — never the raw cause.
    const isBudgetExceeded =
      err instanceof Error &&
      ((err as { code?: string }).code === 'AI_BUDGET_EXCEEDED' ||
        err.name === 'AiBudgetExceededError');
    logger.error(
      { wiring: 'ai-chat', tenantId, err: err instanceof Error ? err.message : String(err) },
      'ai-chat: stream pipe threw',
    );
    await stream.writeSSE({
      event: 'error',
      data: JSON.stringify({
        type: 'error',
        code: isBudgetExceeded ? 'BUDGET_EXCEEDED' : 'INTERNAL',
        message: isBudgetExceeded
          ? 'Monthly AI budget reached. Please try again later.'
          : 'The assistant is temporarily unavailable. Please try again.',
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
  // `threadId` is guaranteed defined: the `if (!threadId)` block above
  // either assigns from the freshly created thread or the parsed value
  // was non-empty to begin with.
  const resolvedThreadId: string = threadId as string;

  // INPUT CONTAINMENT (CLOSE-G) — run the blessed ingress guard on the
  // user's OWN message BEFORE `streamTurn` reaches the orchestrator.
  // CRITICAL prompt-injection / jailbreak → single-language SSE refusal
  // frame (the model never sees it). Lower severities → run the turn on the
  // detector-redacted text (offending spans stripped). Fail-OPEN-but-logged.
  const ingress = await applyIngressGuard({
    userText: parsed.data.message,
    tenantId: ctx.tenant.tenantId,
    userId: ctx.actor.id ?? null,
    lang: pickIngressGuardLang(c.req.header('accept-language') ?? null),
  });
  if (ingress.refused) {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          type: 'error',
          code: 'INPUT_GUARD_REFUSED',
          message: ingress.refusalMessage,
          retryable: false,
        }),
      });
    });
  }
  const guardedMessage = ingress.text;

  return streamSSE(c, async (stream) => {
    const abort = new AbortController();
    stream.onAbort(() => abort.abort());

    const iter = streamTurn(brain.orchestrator, {
      threadId: resolvedThreadId,
      tenant: ctx.tenant,
      actor: ctx.actor,
      viewer: ctx.viewer,
      userText: guardedMessage,
      forcePersonaId: parsed.data.forcePersonaId ?? parsed.data.personaId,
      signal: abort.signal,
    });

    await pipeStreamTurnToSSE(stream, iter, ctx.tenant.tenantId);
  });
}));

export default router;
