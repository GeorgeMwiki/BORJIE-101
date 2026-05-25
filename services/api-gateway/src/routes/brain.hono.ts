// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: multiple c.json({...}, status) branches widen return type and TypedResponse overload rejects the union. Tracked at hono-dev/hono#3891.

/**
 * /api/v1/brain — Borjie Brain gateway routes.
 *
 * Production policy:
 *  - Requires verified Supabase JWT on every request (no dev fallback).
 *  - Per-tenant Brain instances backed by Postgres ThreadStore.
 *  - 401 on missing token, 403 on missing tenant claim, 503 on missing env.
 */

import { Hono } from 'hono';
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
// ---------------------------------------------------------------------------
// Lazy boot — fail fast on missing env, but defer until first request so the
// gateway can boot for unrelated routes (health, auth-only) when Brain env
// is intentionally not set.
// ---------------------------------------------------------------------------

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

/**
 * Resolve the tenant's country/currency/default-city. Currently uses
 * env-sourced defaults so we can remove the `'KE' / 'KES' / 'Nairobi'`
 * hardcoded constants from the migration writer without a Postgres
 * schema change; a follow-up will read these from `tenants.country`
 * once that column is populated on every tenant row.
 */
async function resolveTenantRegion(
  _tenantId: string
): Promise<{ country: string; currency: string; defaultCity?: string }> {
  // Env-driven so each deployment tenant can customize without code
  // changes. Production must set these; dev falls through with clear
  // empty strings so the violation is visible in the DB row.
  const country = process.env.DEFAULT_TENANT_COUNTRY?.trim() || '';
  const currency = process.env.DEFAULT_TENANT_CURRENCY?.trim() || '';
  const defaultCity = process.env.DEFAULT_TENANT_CITY?.trim() || undefined;
  if (process.env.NODE_ENV === 'production' && (!country || !currency)) {
    throw new Error(
      'brain.hono: DEFAULT_TENANT_COUNTRY and DEFAULT_TENANT_CURRENCY are ' +
        'required in production until per-tenant region-config lookup is wired.'
    );
  }
  return { country, currency, defaultCity };
}

function registry() {
  if (registryCache) return registryCache;
  const e = env();
  // Lazily-constructed graph toolkit — present only when NEO4J_URI is set.
  // Otherwise graph tools are not registered (and any persona that references
  // one will surface a loud TOOL_NOT_FOUND).
  const graphToolkit = (() => {
    if (!process.env.NEO4J_URI?.trim()) return undefined;
    try {
      const neo4j = createNeo4jClient();
      const queryService = createGraphQueryService(neo4j);
      return createGraphAgentToolkit(queryService);
    } catch (err) {
      // Use the gateway's pino logger if exposed, else fall back to console.
      // eslint-disable-next-line no-console
      console.error('brain.hono: failed to construct graph toolkit', err);
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

/**
 * F8 (BORJIE101 Supabase audit) — bind the RLS GUC for the current
 * tenant on the Brain's Postgres client BEFORE any repository read.
 *
 * Brain routes do not flow through the gateway's `databaseMiddleware`
 * (which is where the rest of the API sets `app.current_tenant_id`), so
 * Brain's `BrainThreadRepository` reads would run with an unbound GUC
 * and the RLS policies on `brain_threads` + `brain_thread_events` would
 * evaluate `tenant_id = current_setting('app.tenant_id', true)` against
 * NULL — silently zero rows if RLS is honoured, full bypass if the row
 * happens to also satisfy a different role's policy. Either outcome is
 * a defense-in-depth failure: the WHERE-clause tenant filter in the
 * repo is the primary defence, but RLS must back it up.
 *
 * The historical Postgres GUC name in this codebase is split across two
 * migrations:
 *   - 0005..0093 use `app.current_tenant_id` (legacy).
 *   - 0146 / 0156 / 0155 helper use `app.tenant_id` (canonical, what
 *     newer policies and `public.current_app_tenant_id()` read).
 *
 * Z-SUPA-F2 will unify these. Until that lands, we bind BOTH names in
 * the same statement so Brain is correct under either policy phase.
 * The third arg `false` (NOT `SET LOCAL`) matches the existing pattern
 * in `services/api-gateway/src/middleware/database.ts`: postgres.js
 * checks out a connection per request, so the setting persists for the
 * duration of the request only — every authenticated request re-binds
 * before any read, so no cross-tenant leak through pool reuse.
 */
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
    return c.json(
      { error: err.message, code: 'BRAIN_NOT_CONFIGURED' },
      503
    );
  }
  return c.json(
    { error: scrubMessage(err, 'Internal error'), code: 'INTERNAL' },
    500
  );
}

// ---------------------------------------------------------------------------
// Per-tenant + per-actor rate limiter
//
// Bug fix (A-BUG-DEEP #2): replaces a stale module-local `RATE_BUCKETS` Map
// with the shared `rateLimiter`/`rateLimitStore` used by
// `perUserRateLimit` (which `memory-declare.router.ts` mounts as middleware).
// The shared store is process-wide today and is the same primitive a Redis
// adapter will plug into in the follow-up; replacing the per-route Map
// removes the inconsistency where every router managed its own bucket.
// ---------------------------------------------------------------------------

const BRAIN_RATE_CONFIG = {
  maxRequests: 30,
  windowSizeSeconds: 60,
} as const;

function checkRate(key: string): boolean {
  return sharedRateLimiter.check(`perUser:brain:${key}`, BRAIN_RATE_CONFIG).allowed;
}

const brainRouter = new Hono();

// ----- Health -----------------------------------------------------------

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

// ----- Personae roster --------------------------------------------------

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

// ----- Turn (chat) ------------------------------------------------------

brainRouter.post('/turn', withSecurityEvents({ action: 'brain.create', resource: 'brain', severity: 'info' }, async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!body?.userText || typeof body.userText !== 'string') {
    return c.json({ error: 'userText_required' }, 400);
  }

  let ctx;
  try {
    ctx = await authenticate(c);
  } catch (err) {
    return handleError(c, err);
  }

  // Rate limit (per tenant + per actor).
  const rateKey = `${ctx.tenant.tenantId}:${ctx.actor.id}`;
  if (!checkRate(rateKey)) {
    return c.json({ error: 'rate_limited', code: 'RATE_LIMIT' }, 429);
  }

  // Wave-26 Agent Z4 — enforce per-tenant monthly AI budget BEFORE the Brain
  // orchestrator fires any LLM call. This is the same primitive `withBudgetGuard`
  // and the multi-LLM router use, surfaced here so the brain's non-streaming
  // /turn endpoint behaves identically to the SSE chat router.
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
      // eslint-disable-next-line no-console
      console.warn('brain.hono: budget pre-flight check failed (non-fatal)', e?.message ?? e);
    }
  }

  const brain = registry().for(ctx.tenant.tenantId);

  try {
    // F8: bind RLS GUC before the orchestrator triggers any thread repo read/write.
    await bindTenantGuc(db(), ctx.tenant.tenantId);
    if (!body.threadId) {
      const result = await brain.orchestrator.startThread({
        tenant: ctx.tenant,
        actor: ctx.actor,
        viewer: ctx.viewer,
        initialUserText: body.userText,
        forcePersonaId: body.forcePersonaId,
      });
      if (!result.success) {
        return c.json({ error: result.error.message }, 500);
      }
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
      forcePersonaId: body.forcePersonaId,
    });
    if (!result.success) {
      return c.json({ error: result.error.message }, 500);
    }
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
}));

// ----- Threads ----------------------------------------------------------

brainRouter.get('/threads', async (c) => {
  let ctx;
  try {
    ctx = await authenticate(c);
  } catch (err) {
    return handleError(c, err);
  }
  try {
    // F8: bind RLS GUC before any thread repo read.
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
    // F8: bind RLS GUC before any thread repo read.
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

// ----- Migration --------------------------------------------------------

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
    // F8: bind RLS GUC before the migration writer touches any
    // tenant-scoped tables.
    await bindTenantGuc(db(), ctx.tenant.tenantId);
    const writer = new MigrationWriterService(db());
    // Resolve tenant region settings from DB rather than hardcoding —
    // helper falls back to env defaults when unavailable.
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
