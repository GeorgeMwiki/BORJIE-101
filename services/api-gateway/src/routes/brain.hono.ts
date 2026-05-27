/**
 * /api/v1/brain — Borjie Brain gateway routes (SSE + JSON).
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import pino from 'pino';
import {
  createBrain,
  BrainRegistry,
  PostgresThreadStoreBackend,
  loadBrainEnv,
  verifySupabaseJwt,
  extractBearer,
  principalToBrainContexts,
  SupabaseAuthError,
  BrainConfigError,
  DEFAULT_PERSONAE,
  migrationExtract,
  migrationDiff,
  MigrationExtractParamsSchema,
  ExtractionBundleSchema,
  checkBrainHealth,
  streamTurn,
  type StreamTurnEvent,
} from '@borjie/ai-copilot';
import {
  createDatabaseClient,
  BrainThreadRepository,
  MigrationWriterService,
} from '@borjie/database';
import { sql } from 'drizzle-orm';
import {
  createNeo4jClient,
  createGraphQueryService,
  createGraphAgentToolkit,
} from '@borjie/graph-sync';
import { getBrainExtraSkills } from '../composition/brain-extensions';
import { scrubMessage } from '../utils/safe-error';
import { rateLimiter as sharedRateLimiter } from '../middleware/rate-limiter';
import { withSecurityEvents } from '@borjie/observability';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'brain-gateway',
});

let envCache: ReturnType<typeof loadBrainEnv> | null = null;
let dbCache: ReturnType<typeof createDatabaseClient> | null = null;
let registryCache: BrainRegistry | null = null;

function env() {
  if (envCache) return envCache;
  envCache = loadBrainEnv(process.env);
  return envCache;
}

function db() {
  if (dbCache) return dbCache;
  dbCache = createDatabaseClient(env().DATABASE_URL);
  return dbCache;
}

async function resolveTenantRegion(
  _tenantId: string
): Promise<{ country: string; currency: string; defaultCity?: string }> {
  const country = process.env.DEFAULT_TENANT_COUNTRY?.trim() || '';
  const currency = process.env.DEFAULT_TENANT_CURRENCY?.trim() || '';
  const defaultCity = process.env.DEFAULT_TENANT_CITY?.trim() || undefined;
  if (process.env.NODE_ENV === 'production' && (!country || !currency)) {
    throw new Error(
      'brain.hono: DEFAULT_TENANT_COUNTRY and DEFAULT_TENANT_CURRENCY are required in production.'
    );
  }
  return { country, currency, defaultCity };
}

function registry() {
  if (registryCache) return registryCache;
  const e = env();
  const graphToolkit = (() => {
    if (!process.env.NEO4J_URI?.trim()) return undefined;
    try {
      const neo4j = createNeo4jClient();
      const queryService = createGraphQueryService(neo4j);
      return createGraphAgentToolkit(queryService);
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'failed to construct graph toolkit');
      return undefined;
    }
  })();
  registryCache = new BrainRegistry((tenantId) => {
    const repo = new BrainThreadRepository(db());
    const backend = new PostgresThreadStoreBackend(repo, () => tenantId);
    return createBrain({
      anthropic: {
        apiKey: e.ANTHROPIC_API_KEY,
        baseUrl: e.ANTHROPIC_BASE_URL,
        defaultModel: e.ANTHROPIC_MODEL_DEFAULT,
      },
      threadStoreBackend: backend,
      graphToolkit,
      extraSkills: getBrainExtraSkills(),
    });
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
  return {
    principal,
    ...principalToBrainContexts(principal),
  };
}

async function bindTenantGuc(
  database: ReturnType<typeof createDatabaseClient>,
  tenantId: string
): Promise<void> {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new SupabaseAuthError('missing_tenant_for_guc_bind', 403);
  }
  await database.execute(
    sql`SELECT set_config('app.tenant_id', ${tenantId}, false), set_config('app.current_tenant_id', ${tenantId}, false)`
  );
}

function handleError(c, err) {
  if (err instanceof SupabaseAuthError) {
    return c.json({ error: err.message, code: 'AUTH' }, err.status);
  }
  if (err instanceof BrainConfigError) {
    return c.json({ error: err.message, code: 'BRAIN_NOT_CONFIGURED' }, 503);
  }
  return c.json({ error: scrubMessage(err, 'Internal error'), code: 'INTERNAL' }, 500);
}

const BRAIN_RATE_CONFIG = {
  maxRequests: 30,
  windowSizeSeconds: 60,
} as const;

function checkRate(key: string): boolean {
  return sharedRateLimiter.check(`perUser:brain:${key}`, BRAIN_RATE_CONFIG).allowed;
}

const brainRouter = new Hono();

brainRouter.get('/health', async (c) => {
  let ctx;
  try {
    ctx = await authenticate(c);
  } catch (err) {
    return handleError(c, err);
  }
  try {
    await bindTenantGuc(db(), ctx.tenant.tenantId);
    const brain = registry().for(ctx.tenant.tenantId);
    const health = await checkBrainHealth(brain);
    return c.json(health);
  } catch (err) {
    return handleError(c, err);
  }
});

brainRouter.get('/personae', async (c) => {
  try {
    await authenticate(c);
  } catch (err) {
    return handleError(c, err);
  }
  const personae = DEFAULT_PERSONAE.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    missionStatement: p.missionStatement,
    kind: p.kind,
  }));
  return c.json({ personae });
});

function clientWantsSse(accept: string | undefined): boolean {
  if (!accept || typeof accept !== 'string') return false;
  const parts = accept.split(',').map((p) => p.trim().toLowerCase());
  for (const p of parts) {
    if (!p.startsWith('text/event-stream')) continue;
    const qMatch = p.match(/;\s*q\s*=\s*([0-9.]+)/);
    if (qMatch && Number(qMatch[1]) === 0) return false;
    return true;
  }
  return false;
}

interface PublicSseFrame {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

function projectStreamEvent(evt: StreamTurnEvent, threadId: string): PublicSseFrame | null {
  switch (evt.type) {
    case 'turn_start':
      return null;
    case 'delta':
      return { event: 'message_chunk', data: { text: evt.content, done: false } };
    case 'tool_call':
      return { event: 'tool_call', data: { tool: evt.name, status: 'started', args: evt.args ?? null } };
    case 'tool_result':
      return { event: 'tool_call', data: { tool: evt.name, status: evt.ok ? 'ok' : 'error' } };
    case 'handoff':
      return {
        event: 'tool_call',
        data: { tool: `handoff:${evt.from}->${evt.to}`, status: 'ok', args: { objective: evt.objective } },
      };
    case 'proposed_action':
      return {
        event: 'message_chunk',
        data: {
          text: '',
          done: false,
          proposedAction: {
            risk: evt.risk,
            description: evt.description,
            reviewRequired: evt.reviewRequired,
            executionHeld: evt.executionHeld,
          },
        },
      };
    case 'error':
      return { event: 'error', data: { message: evt.message, code: evt.code, retryable: evt.retryable } };
    case 'turn_end':
      return {
        event: 'done',
        data: {
          threadId,
          tokensUsed: evt.totalTokens,
          totalMs: evt.timeMs,
          finalPersonaId: evt.finalPersonaId,
          advisorConsulted: evt.advisorConsulted,
          cacheReadTokens: null,
        },
      };
  }
}

interface TurnGateContext {
  readonly tenant: { tenantId: string; tenantName: string; environment: 'production' | 'staging' | 'development' };
  readonly actor: { type: 'user'; id: string; email?: string; roles: string[] };
  readonly viewer: { userId: string; roles: string[]; teamIds: string[]; employeeId?: string; isAdmin: boolean; isManagement: boolean };
}

async function gateTurn(
  c: any,
  body: { userText?: unknown; threadId?: unknown; forcePersonaId?: unknown },
): Promise<{ ok: true; ctx: TurnGateContext } | { ok: false; response: Response }> {
  if (!body?.userText || typeof body.userText !== 'string') {
    return { ok: false, response: c.json({ error: 'userText_required' }, 400) };
  }
  let ctx: TurnGateContext;
  try {
    ctx = (await authenticate(c)) as TurnGateContext;
  } catch (err) {
    return { ok: false, response: handleError(c, err) };
  }
  const rateKey = `${ctx.tenant.tenantId}:${ctx.actor.id}`;
  if (!checkRate(rateKey)) {
    return { ok: false, response: c.json({ error: 'rate_limited', code: 'RATE_LIMIT' }, 429) };
  }
  const services = c.get('services');
  const ledger = services?.aiCostLedger;
  if (ledger) {
    try {
      await ledger.assertWithinBudget(ctx.tenant.tenantId);
    } catch (err) {
      const e = err as { code?: string; name?: string; message?: string };
      if (e?.code === 'AI_BUDGET_EXCEEDED' || e?.name === 'AiBudgetExceededError') {
        return {
          ok: false,
          response: c.json({ error: e.message ?? 'monthly AI budget exceeded', code: 'BUDGET_EXCEEDED' }, 429),
        };
      }
      logger.warn(
        { tenantId: ctx.tenant.tenantId, err: e?.message ?? String(err) },
        'budget pre-flight check failed (non-fatal)',
      );
    }
  }
  try {
    await bindTenantGuc(db(), ctx.tenant.tenantId);
  } catch (err) {
    return { ok: false, response: handleError(c, err) };
  }
  return { ok: true, ctx };
}

async function handleTurnJson(
  c: any,
  body: { userText: string; threadId?: string; forcePersonaId?: string },
  ctx: TurnGateContext,
): Promise<Response> {
  const brain = registry().for(ctx.tenant.tenantId);
  try {
    if (!body.threadId) {
      const result = await brain.orchestrator.startThread({
        tenant: ctx.tenant,
        actor: ctx.actor,
        viewer: ctx.viewer,
        initialUserText: body.userText,
        ...(body.forcePersonaId !== undefined ? { forcePersonaId: body.forcePersonaId } : {}),
      });
      if (!result.success) return c.json({ error: result.error.message }, 500);
      const turn = result.data.turn;
      return c.json({
        threadId: result.data.thread.id,
        finalPersonaId: turn.finalPersonaId,
        responseText: turn.responseText,
        handoffs: turn.handoffs,
        toolCalls: turn.toolCalls,
        advisorConsulted: turn.advisorConsulted,
        proposedAction: turn.proposedAction,
        tokensUsed: turn.tokensUsed,
      });
    }
    const result = await brain.orchestrator.handleTurn({
      threadId: body.threadId,
      tenant: ctx.tenant,
      actor: ctx.actor,
      viewer: ctx.viewer,
      userText: body.userText,
      ...(body.forcePersonaId !== undefined ? { forcePersonaId: body.forcePersonaId } : {}),
    });
    if (!result.success) return c.json({ error: result.error.message }, 500);
    return c.json({
      threadId: result.data.threadId,
      finalPersonaId: result.data.finalPersonaId,
      responseText: result.data.responseText,
      handoffs: result.data.handoffs,
      toolCalls: result.data.toolCalls,
      advisorConsulted: result.data.advisorConsulted,
      proposedAction: result.data.proposedAction,
      tokensUsed: result.data.tokensUsed,
    });
  } catch (err) {
    return handleError(c, err);
  }
}

interface StartedTurnPayload {
  readonly threadId: string;
  readonly finalPersonaId: string;
  readonly responseText: string;
  readonly toolCalls: ReadonlyArray<{ tool: string; ok: boolean }>;
  readonly handoffs: ReadonlyArray<{ from: string; to: string; objective: string }>;
  readonly tokensUsed: number;
  readonly timeMs: number;
  readonly advisorConsulted: boolean;
  readonly proposedAction?: {
    verb: string;
    object: string;
    riskLevel: string;
    reviewRequired: boolean;
    executionHeld?: boolean;
  };
}

async function emitStartedTurnFrames(
  stream: { writeSSE: (data: { event: string; data: string }) => Promise<void> },
  turn: StartedTurnPayload,
): Promise<void> {
  for (const tc of turn.toolCalls) {
    await stream.writeSSE({
      event: 'tool_call',
      data: JSON.stringify({ tool: tc.tool, status: tc.ok ? 'ok' : 'error' }),
    });
  }
  for (const h of turn.handoffs) {
    await stream.writeSSE({
      event: 'tool_call',
      data: JSON.stringify({
        tool: `handoff:${h.from}->${h.to}`,
        status: 'ok',
        args: { objective: h.objective },
      }),
    });
  }
  const text = turn.responseText ?? '';
  const chunkSize = 80;
  for (let i = 0; i < text.length; i += chunkSize) {
    await stream.writeSSE({
      event: 'message_chunk',
      data: JSON.stringify({ text: text.slice(i, i + chunkSize), done: false }),
    });
  }
  if (turn.proposedAction) {
    await stream.writeSSE({
      event: 'message_chunk',
      data: JSON.stringify({
        text: '',
        done: false,
        proposedAction: {
          risk: turn.proposedAction.riskLevel,
          description: `${turn.proposedAction.verb} ${turn.proposedAction.object}`,
          reviewRequired: turn.proposedAction.reviewRequired,
          executionHeld: turn.proposedAction.executionHeld ?? turn.proposedAction.reviewRequired,
        },
      }),
    });
  }
  await stream.writeSSE({
    event: 'done',
    data: JSON.stringify({
      threadId: turn.threadId,
      tokensUsed: turn.tokensUsed,
      totalMs: turn.timeMs,
      finalPersonaId: turn.finalPersonaId,
      advisorConsulted: turn.advisorConsulted,
      cacheReadTokens: null,
    }),
  });
}

async function handleTurnSse(
  c: any,
  body: { userText: string; threadId?: string; forcePersonaId?: string },
  ctx: TurnGateContext,
): Promise<Response> {
  const brain = registry().for(ctx.tenant.tenantId);
  return streamSSE(c, async (stream) => {
    const acceptedAt = new Date().toISOString();
    try {
      await stream.writeSSE({
        event: 'turn.accepted',
        data: JSON.stringify({
          at: acceptedAt,
          tenantId: ctx.tenant.tenantId,
          threadId: body.threadId ?? null,
        }),
      });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'failed to send turn.accepted frame',
      );
      return;
    }
    let threadId = body.threadId;
    let bootstrap:
      | { type: 'started'; turn: StartedTurnPayload }
      | { type: 'existing'; threadId: string }
      | null = null;
    try {
      if (!threadId) {
        const startRes = await brain.orchestrator.startThread({
          tenant: ctx.tenant,
          actor: ctx.actor,
          viewer: ctx.viewer,
          initialUserText: body.userText,
          ...(body.forcePersonaId !== undefined ? { forcePersonaId: body.forcePersonaId } : {}),
        });
        if (!startRes.success) {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({
              message: startRes.error.message,
              code: startRes.error.code,
              retryable: startRes.error.retryable,
            }),
          });
          return;
        }
        threadId = startRes.data.thread.id;
        bootstrap = {
          type: 'started',
          turn: { ...startRes.data.turn, threadId },
        };
      } else {
        bootstrap = { type: 'existing', threadId };
      }
    } catch (err) {
      logger.error(
        {
          tenantId: ctx.tenant.tenantId,
          threadId: threadId ?? null,
          err: err instanceof Error ? err.message : String(err),
        },
        'brain /turn bootstrap failed',
      );
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          message: scrubMessage(err, 'orchestrator_failed'),
          code: 'INTERNAL',
          retryable: false,
        }),
      });
      return;
    }
    try {
      if (bootstrap.type === 'started') {
        await emitStartedTurnFrames(stream, bootstrap.turn);
        return;
      }
      const gen = streamTurn(brain.orchestrator, {
        threadId: bootstrap.threadId,
        tenant: ctx.tenant,
        actor: ctx.actor,
        viewer: ctx.viewer,
        userText: body.userText,
        ...(body.forcePersonaId !== undefined ? { forcePersonaId: body.forcePersonaId } : {}),
      });
      for await (const evt of gen) {
        const frame = projectStreamEvent(evt, bootstrap.threadId);
        if (!frame) continue;
        await stream.writeSSE({
          event: frame.event,
          data: JSON.stringify(frame.data),
        });
        if (frame.event === 'error') return;
      }
    } catch (err) {
      logger.error(
        {
          tenantId: ctx.tenant.tenantId,
          threadId: threadId ?? null,
          err: err instanceof Error ? err.message : String(err),
        },
        'brain /turn stream failed',
      );
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          message: scrubMessage(err, 'stream_failed'),
          code: 'INTERNAL',
          retryable: false,
        }),
      });
    }
  });
}

brainRouter.post('/turn', withSecurityEvents({ action: 'brain.create', resource: 'brain', severity: 'info' }, async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const gate = await gateTurn(c, body);
  if (!gate.ok) return gate.response;
  const wantsSse = clientWantsSse(c.req.header('accept'));
  if (wantsSse) return handleTurnSse(c, body, gate.ctx);
  return handleTurnJson(c, body, gate.ctx);
}));

brainRouter.get('/threads', async (c) => {
  let ctx;
  try {
    ctx = await authenticate(c);
  } catch (err) {
    return handleError(c, err);
  }
  try {
    await bindTenantGuc(db(), ctx.tenant.tenantId);
  } catch (err) {
    return handleError(c, err);
  }
  const brain = registry().for(ctx.tenant.tenantId);
  const limit = Number(c.req.query('limit') ?? 50);
  const list = await brain.threads.listThreads(ctx.tenant.tenantId, {
    userId: ctx.viewer.userId,
    limit,
  });
  return c.json({ threads: list });
});

brainRouter.get('/threads/:id', async (c) => {
  let ctx;
  try {
    ctx = await authenticate(c);
  } catch (err) {
    return handleError(c, err);
  }
  try {
    await bindTenantGuc(db(), ctx.tenant.tenantId);
  } catch (err) {
    return handleError(c, err);
  }
  const brain = registry().for(ctx.tenant.tenantId);
  const id = c.req.param('id');
  const thread = await brain.threads.getThread(id);
  if (!thread) return c.json({ error: 'thread_not_found' }, 404);
  if (thread.tenantId !== ctx.tenant.tenantId) {
    return c.json({ error: 'thread_not_found' }, 404);
  }
  const events = await brain.threads.readAs(id, ctx.viewer);
  return c.json({ thread, events });
});

brainRouter.post('/migrate/extract', withSecurityEvents({ action: 'brain.create', resource: 'brain', severity: 'info' }, async (c) => {
  try {
    await authenticate(c);
  } catch (err) {
    return handleError(c, err);
  }
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = MigrationExtractParamsSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const bundle = migrationExtract(parsed.data);
  const diff = migrationDiff({ bundle });
  return c.json({ bundle, diff });
}));

brainRouter.post('/migrate/commit', withSecurityEvents({ action: 'brain.create', resource: 'brain', severity: 'info' }, async (c) => {
  let ctx;
  try {
    ctx = await authenticate(c);
  } catch (err) {
    return handleError(c, err);
  }
  if (!ctx.actor.roles.includes('admin')) {
    return c.json({ error: 'admin_role_required', code: 'FORBIDDEN' }, 403);
  }
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const schema = (await import('zod')).z.object({
    bundle: ExtractionBundleSchema,
    bestEffort: (await import('zod')).z.boolean().optional().default(false),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  try {
    await bindTenantGuc(db(), ctx.tenant.tenantId);
    const writer = new MigrationWriterService(db());
    const region = await resolveTenantRegion(ctx.tenant.tenantId);
    const report = await writer.commit(
      parsed.data.bundle,
      {
        tenantId: ctx.tenant.tenantId,
        ownerUserId: ctx.actor.id,
        actorUserId: ctx.actor.id,
        tenantCountry: region.country,
        tenantCurrency: region.currency,
        defaultCity: region.defaultCity,
      },
      { bestEffort: parsed.data.bestEffort }
    );
    return c.json({ report });
  } catch (err) {
    return handleError(c, err);
  }
}));

export { brainRouter };
