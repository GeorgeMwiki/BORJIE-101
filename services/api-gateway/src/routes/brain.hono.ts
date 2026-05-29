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
  const out: { country: string; currency: string; defaultCity?: string } = { country, currency };
  if (defaultCity !== undefined) out.defaultCity = defaultCity;
  return out;
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
    const anthropic: { apiKey: string; baseUrl?: string; defaultModel?: string } = {
      apiKey: e.ANTHROPIC_API_KEY,
    };
    if (e.ANTHROPIC_BASE_URL !== undefined) anthropic.baseUrl = e.ANTHROPIC_BASE_URL;
    if (e.ANTHROPIC_MODEL_DEFAULT !== undefined) anthropic.defaultModel = e.ANTHROPIC_MODEL_DEFAULT;
    const brainConfig: Parameters<typeof createBrain>[0] = {
      anthropic,
      threadStoreBackend: backend,
      extraSkills: getBrainExtraSkills(),
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

// ─── G2 — brain /turn idempotency cache ─────────────────────────────
//
// Closes audit gap G2 from `Docs/AUDIT/ROBUSTNESS_AUDIT_2026-05-29.md`.
//
// Clients posting `/api/v1/brain/turn` with an `Idempotency-Key`
// header get the cached response on a duplicate (5-min TTL). Without
// the cache a network blip + auto-retry burns a second LLM turn,
// charges tokens twice, and creates a duplicate thread row.
//
// In-process LRU (cap 1000) because:
//   - the contention window is small (a turn that took 800ms; the
//     duplicate from the retry arrives within seconds);
//   - the cache key includes tenant + user so cross-replica collisions
//     are unlikely on the timescale of a single turn (a retry usually
//     hits the same replica via sticky session / connection re-use);
//   - bringing the shared Redis client to brain.hono.ts is out of
//     scope for this gap — the wiring belongs to a composition-level
//     follow-up.
//
// Key format: `${tenantId}:${userId}:${idempotencyKey}` — defence-in-
// depth against cross-tenant cache poisoning even if a malicious
// client supplies a key shaped like another tenant's.
//
// Validation: the key must be 1-256 chars of URL-safe alphanumerics
// (matches the webhook-idempotency regex). Invalid keys are silently
// ignored — the turn still executes.
interface BrainTurnCacheEntry {
  readonly status: number;
  readonly body: unknown;
  readonly cachedAt: number;
}

const BRAIN_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes
const BRAIN_IDEMPOTENCY_MAX_ENTRIES = 1000;
const BRAIN_IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_\-.]{1,256}$/;

const brainIdempotencyCache = new Map<string, BrainTurnCacheEntry>();

function brainIdempotencyKey(
  tenantId: string,
  userId: string,
  rawKey: string,
): string {
  return `${tenantId}:${userId}:${rawKey}`;
}

function extractBrainIdempotencyKey(c: any): string | null {
  const raw = c.req.header('idempotency-key');
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return BRAIN_IDEMPOTENCY_KEY_RE.test(raw) ? raw : null;
}

function getCachedBrainTurn(key: string): BrainTurnCacheEntry | null {
  const entry = brainIdempotencyCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > BRAIN_IDEMPOTENCY_TTL_MS) {
    brainIdempotencyCache.delete(key);
    return null;
  }
  // LRU touch — refresh insertion order so hot keys survive eviction.
  brainIdempotencyCache.delete(key);
  brainIdempotencyCache.set(key, entry);
  return entry;
}

function setCachedBrainTurn(
  key: string,
  entry: BrainTurnCacheEntry,
): void {
  if (brainIdempotencyCache.size >= BRAIN_IDEMPOTENCY_MAX_ENTRIES) {
    // Evict oldest (first inserted) — Map preserves insertion order.
    const oldestKey = brainIdempotencyCache.keys().next().value;
    if (oldestKey !== undefined) brainIdempotencyCache.delete(oldestKey);
  }
  brainIdempotencyCache.set(key, entry);
}

/** Test seam — flushes the cache between integration tests. */
export function __resetBrainIdempotencyCache(): void {
  brainIdempotencyCache.clear();
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

/**
 * Borjie-shaped ack-fast SSE event payload. Emitted immediately after
 * `turn.accepted` and BEFORE any orchestrator work begins so the mobile
 * chat surface can render a Swahili-first "thinking…" bubble inside
 * <100 ms of the user hitting Send.
 *
 * Closes G1 from `Docs/AUDIT/RESEARCH_GAPS_2026-05-29.md` — wires the
 * `Karibu, ninafikiri…` placeholder researched in
 * `Docs/RESEARCH/mobile-chat-latency-ux.md` §11.1 and
 * `Docs/RESEARCH/mobile-onload-intelligence.md` §4.2.
 *
 * Language is detected from the `Accept-Language` request header (sw
 * default per CLAUDE.md hard rule). The text is deterministic — no LLM
 * call — keeping the cost at a few µs of string format.
 */
const ACK_FAST_TEXTS = Object.freeze({
  sw: 'Karibu, ninafikiri…',
  en: 'Got it, thinking…',
} as const);

type AckFastLang = keyof typeof ACK_FAST_TEXTS;

function pickAckFastLang(acceptLanguage: string | null): AckFastLang {
  if (typeof acceptLanguage !== 'string' || acceptLanguage.length === 0) {
    return 'sw';
  }
  // The Accept-Language header is a comma-separated list of
  // language-quality pairs (`sw, en;q=0.8`). The first entry wins by
  // browser convention. We intentionally do not parse `q=` weights —
  // mobile clients send a single preferred language, not a ranked list.
  const first = acceptLanguage.split(',')[0]?.trim().toLowerCase() ?? '';
  if (first.startsWith('en')) return 'en';
  return 'sw';
}

export function buildAckFastFrame(acceptLanguage: string | null): {
  readonly text: string;
  readonly lang: AckFastLang;
} {
  const lang = pickAckFastLang(acceptLanguage);
  return Object.freeze({ text: ACK_FAST_TEXTS[lang], lang });
}

interface TurnGateContext {
  readonly tenant: { tenantId: string; tenantName: string; environment: 'production' | 'staging' | 'development' };
  readonly actor: { type: 'user'; id: string; email?: string; roles: string[] };
  readonly viewer: { userId: string; roles: string[]; teamIds: string[]; employeeId?: string; isAdmin: boolean; isManagement: boolean };
}

/**
 * Personal-team sentinel UUID used when a /turn request does not carry
 * an explicit `teamId` AND the authenticated viewer is not bound to any
 * team. The `threads.team_id` column is `uuid` in some deployed schemas
 * and `NOT NULL` after the 2026-04 owner-thread consolidation, so an
 * empty string fails the type cast at INSERT.
 *
 * Using a stable, well-known UUID keeps every "no team" thread bucketed
 * under one identifier so audit / per-team analytics can still partition
 * cleanly. We never persist this UUID to a real `teams` row — it's a
 * pseudo-team that means "personal / owner-direct".
 */
const PERSONAL_TEAM_SENTINEL = '00000000-0000-0000-0000-000000000000';

/**
 * Resolve the `teamId` used to bootstrap a new brain thread.
 *
 * Resolution order:
 *   1. Explicit `bodyTeamId` from the request payload (UUID string).
 *   2. First entry of the authenticated viewer's `teamIds` (set on JWT
 *      `app_metadata.team_ids`). This binds the thread to the user's
 *      primary team for visibility scoping.
 *   3. `PERSONAL_TEAM_SENTINEL` — never null/empty so the Postgres uuid
 *      column accepts the row even when the user has no team mapping.
 *
 * Logs the resolution path at info so live-verify runs can confirm the
 * fix is firing.
 */
function resolveTeamId(
  bodyTeamId: string | undefined,
  viewerTeamIds: readonly string[],
  ctx: { tenantId: string; userId: string },
): { teamId: string; source: 'body' | 'viewer' | 'sentinel' } {
  if (typeof bodyTeamId === 'string' && bodyTeamId.trim().length > 0) {
    const teamId = bodyTeamId.trim();
    logger.info(
      { tenantId: ctx.tenantId, userId: ctx.userId, teamId, source: 'body' },
      'brain /turn: teamId resolved from request body',
    );
    return { teamId, source: 'body' };
  }
  const fromViewer = viewerTeamIds.find(
    (t) => typeof t === 'string' && t.trim().length > 0,
  );
  if (fromViewer) {
    const teamId = fromViewer.trim();
    logger.info(
      { tenantId: ctx.tenantId, userId: ctx.userId, teamId, source: 'viewer' },
      'brain /turn: teamId resolved from viewer teamIds',
    );
    return { teamId, source: 'viewer' };
  }
  logger.info(
    {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      teamId: PERSONAL_TEAM_SENTINEL,
      source: 'sentinel',
    },
    'brain /turn: no team binding — using PERSONAL_TEAM_SENTINEL',
  );
  return { teamId: PERSONAL_TEAM_SENTINEL, source: 'sentinel' };
}

async function gateTurn(
  c: any,
  body: { userText?: unknown; threadId?: unknown; forcePersonaId?: unknown; teamId?: unknown },
): Promise<{ ok: true; ctx: TurnGateContext } | { ok: false; response: Response }> {
  if (!body?.userText || typeof body.userText !== 'string') {
    return { ok: false, response: c.json({ error: 'userText_required' }, 400) };
  }
  if (body.teamId !== undefined && typeof body.teamId !== 'string') {
    return { ok: false, response: c.json({ error: 'teamId_must_be_string' }, 400) };
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
  body: { userText: string; threadId?: string; forcePersonaId?: string; teamId?: string },
  ctx: TurnGateContext,
): Promise<Response> {
  const brain = registry().for(ctx.tenant.tenantId);
  try {
    if (!body.threadId) {
      const { teamId } = resolveTeamId(body.teamId, ctx.viewer.teamIds, {
        tenantId: ctx.tenant.tenantId,
        userId: ctx.viewer.userId,
      });
      const result = await brain.orchestrator.startThread({
        tenant: ctx.tenant,
        actor: ctx.actor,
        viewer: ctx.viewer,
        initialUserText: body.userText,
        teamId,
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
  body: { userText: string; threadId?: string; forcePersonaId?: string; teamId?: string },
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
    // Ack-fast — Swahili-first thinking placeholder. Emitted before any
    // orchestrator work so the mobile chat surface paints a bubble in
    // <100 ms. Detail: Docs/RESEARCH/mobile-chat-latency-ux.md §11.
    try {
      const ack = buildAckFastFrame(c.req.header('accept-language') ?? null);
      await stream.writeSSE({
        event: 'ack',
        data: JSON.stringify({ text: ack.text, lang: ack.lang }),
      });
    } catch (err) {
      // Non-fatal: the turn stream is still useful without the ack
      // pre-paint. Log + continue.
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'failed to send ack frame',
      );
    }
    let threadId = body.threadId;
    let bootstrap:
      | { type: 'started'; turn: StartedTurnPayload }
      | { type: 'existing'; threadId: string }
      | null = null;
    try {
      if (!threadId) {
        const { teamId } = resolveTeamId(body.teamId, ctx.viewer.teamIds, {
          tenantId: ctx.tenant.tenantId,
          userId: ctx.viewer.userId,
        });
        const startRes = await brain.orchestrator.startThread({
          tenant: ctx.tenant,
          actor: ctx.actor,
          viewer: ctx.viewer,
          initialUserText: body.userText,
          teamId,
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

  // G2 — Idempotency-Key cache lookup. Only applies to the JSON path
  // (SSE streams are not cacheable). When the client sends a valid key
  // and we have a fresh cached response for `(tenantId, userId, key)`
  // we replay it and skip the orchestrator entirely — no LLM tokens
  // burned on the retry. The cache hit sets `Idempotent-Replayed: true`
  // so live-verify can confirm the gate fired.
  const wantsSse = clientWantsSse(c.req.header('accept'));
  if (!wantsSse) {
    const rawKey = extractBrainIdempotencyKey(c);
    if (rawKey) {
      const cacheKey = brainIdempotencyKey(
        gate.ctx.tenant.tenantId,
        gate.ctx.viewer.userId,
        rawKey,
      );
      const cached = getCachedBrainTurn(cacheKey);
      if (cached) {
        c.header('Idempotent-Replayed', 'true');
        return c.json(cached.body, cached.status as 200);
      }
      const response = await handleTurnJson(c, body, gate.ctx);
      // Cache only successful 2xx — error responses must be retryable.
      if (response.status >= 200 && response.status < 300) {
        try {
          const cloned = response.clone();
          const text = await cloned.text();
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
          setCachedBrainTurn(cacheKey, {
            status: response.status,
            body: parsed,
            cachedAt: Date.now(),
          });
        } catch (err) {
          // Cache-write failures are non-fatal — the caller already
          // saw the success response.
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'brain /turn: failed to cache idempotency response',
          );
        }
      }
      return response;
    }
    return handleTurnJson(c, body, gate.ctx);
  }
  return handleTurnSse(c, body, gate.ctx);
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
  const diff = migrationDiff({ bundle } as Parameters<typeof migrationDiff>[0]);
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
