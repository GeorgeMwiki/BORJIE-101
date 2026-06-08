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
  checkBrainHealth,
  streamTurn,
  type StreamTurnEvent,
} from '@borjie/ai-copilot';
import {
  createDatabaseClient,
  withTenantContext,
  BrainThreadRepository,
} from '@borjie/database';
import {
  createNeo4jClient,
  createGraphQueryService,
  createGraphAgentToolkit,
} from '@borjie/graph-sync';
import { getBrainExtraSkills } from '../composition/brain-extensions';
import {
  auditChatResponse,
  decideStrictResponse,
  type StrictWithholdLang,
} from '../composition/chat-response-gate';
import {
  recallSupportMemory,
  type RecallLang,
} from '../services/support-cases/index.js';
// R8 / LP-01 / LP-30 — per-turn cognitive enrichment. Reads the wired
// cognitive bundle off the Hono context (set by `createCognitiveContextMiddleware`
// in index.ts) and prepends a recalled-memory + (flag-gated, default-OFF)
// deep-reasoning context block to the user's text. Fail-safe: never throws
// into the turn (see `withCognitiveEnrichment`).
import {
  enrichBrainTurnWithCognitive,
  observeBrainTurnMemory,
  type WiredCognitive,
} from '../composition/cognitive-wiring.js';
// LP-15 / LP-30 — privacy router consulted BEFORE the orchestrator (the
// LLM provider boundary) on the MAIN brain turn. Classifies the payload by
// data-sensitivity tier: DENIED (restricted data + no local model) refuses
// the turn; CONFIDENTIAL strips PII before the provider sees it. Default
// ENABLED but inert for ordinary (INTERNAL/PUBLIC) text; fail-conservative
// on any error (never forwards raw text on a routing fault).
import {
  buildPrivacyRouter,
  consultPrivacyRouter,
  type WiredPrivacyRouter,
} from '../composition/privacy-router-wiring.js';
import { scrubMessage } from '../utils/safe-error';
import { rateLimiter as sharedRateLimiter } from '../middleware/rate-limiter';
import { withSecurityEvents } from '@borjie/observability';
// Stage 2 — orchestrator main-loop as the DEFAULT-ON live generator for
// the main brain chat surface. When ON, `kernel.think()` runs the rails +
// answer generation in ONE call, so the route routes generation through
// the helper below and does NOT also run `kernelPreflight` (no double
// LLM). When OFF (`KERNEL_USE_ORCHESTRATOR=false` hard-kill /
// `BORJIE_ORCHESTRATOR_MAINLOOP=0|false|off` soft-disable), the persona
// path + `kernelPreflight` run UNCHANGED (byte-identical fallback).
import {
  resolveBrainOrchestratorRoutingEnabled,
  generateBrainTurnViaOrchestrator,
  type OrchestratorTurnPayload,
  type OrchestratorTurnContext,
} from '../composition/brain-orchestrator-turn.js';
// Latency wins — streaming first-token (smaller SSE chunks for a sooner
// first paint) + async-offload (defer non-critical post-response work off
// the critical path).
import {
  chunkTextToSse,
  resolveStreamChunkChars,
  deferPostResponseWork,
} from './brain-stream-helpers.js';

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
    // No session-scoped GUC bind: the thread-store repo binds tenant context
    // per operation now, and `checkBrainHealth` probes a synthetic tenant.
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
  // Tenant context is bound PER OPERATION downstream — the thread-store repo
  // wraps each read/write in a short per-tenant transaction, and support
  // recall is wrapped in `withTenantContext` (see `withRecalledMemory`). A
  // session-scoped bind here would be clobbered across the turn's LLM calls
  // on the shared brain pool.
  return { ok: true, ctx };
}

// ─── Persistent-memory RECALL — the "never loses memory" hook ─────────
//
// Mr. Mwikila is the user's first line of technical support. At the start of
// every turn we load the user's OPEN/active `support_cases` (tenant + user
// scoped; the GUC is already bound by gateTurn) and PREPEND a compact,
// single-language memory preamble to the user's text, so the MD always
// remembers their in-flight issues across sessions AND devices — a new login
// on a new phone still recalls the case state.
//
// This is a CHEAP QUERY, never an LLM call, and runs best-effort: a recall
// failure never blocks the turn (the user still gets their answer, just
// without the preamble that turn).
//
// EN/SW absolute (CLAUDE.md): the default user language is `en`; an explicit
// `sw` in Accept-Language switches the preamble entirely to Swahili with zero
// mixing.

/** Resolve the recall locale. Default `en` (CLAUDE.md); explicit `sw` toggles. */
function pickRecallLang(acceptLanguage: string | null): RecallLang {
  if (typeof acceptLanguage !== 'string' || acceptLanguage.length === 0) {
    return 'en';
  }
  const first = acceptLanguage.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('sw') ? 'sw' : 'en';
}

/**
 * Load the user's active support cases and return the body with the memory
 * preamble prepended to `userText`. Best-effort — returns the body unchanged on
 * any failure. Pure on the input body (immutability): builds a new object.
 */
async function withRecalledMemory<
  T extends { readonly userText: string },
>(c: any, ctx: TurnGateContext, body: T): Promise<T> {
  try {
    const lang = pickRecallLang(c.req.header('accept-language') ?? null);
    // Bind tenant context for the recall read in a short transaction (the
    // brain pool is not request-pinned). The query is belt-and-braces
    // (tenant_id + user_id) and never makes an external call, so it is safe
    // inside the transaction.
    const { preamble, cases } = await withTenantContext(
      db(),
      ctx.tenant.tenantId,
      (tx) =>
        recallSupportMemory(
          {
            db: tx,
            tenantId: ctx.tenant.tenantId,
            userId: ctx.viewer.userId,
            logger,
          },
          lang,
        ),
    );
    if (!preamble) return body;
    logger.info(
      {
        wiring: 'support-recall',
        tenantId: ctx.tenant.tenantId,
        userId: ctx.viewer.userId,
        activeCases: cases.length,
        lang,
      },
      'brain /turn: injected persistent support-case memory',
    );
    return { ...body, userText: `${preamble}\n\n${body.userText}` };
  } catch (err) {
    // Never let recall break the turn.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'brain /turn: support-memory recall failed (continuing)',
    );
    return body;
  }
}

// ─── R8 / LP-01 / LP-30 — per-turn cognitive enrichment ───────────────
//
// The composition root (index.ts) constructs the `WiredCognitive` bundle
// once and exposes it on every request via `c.get('cognitive')`. Before
// this wiring NOTHING on the live `/turn` path read that bundle — the
// cognitive-memory recall and the (flag-gated) deep-reasoning composer
// were "built but dark". This hook closes that gap: it calls
// `enrichBrainTurnWithCognitive` and, when a non-empty context block comes
// back, PREPENDS it to the user's text as additive grounding (same
// immutable, best-effort contract as `withRecalledMemory`).
//
// Fail-safe posture (CLAUDE.md hot-path rule): the bundle may be absent
// (middleware not mounted in a unit test) or fully degraded; the
// enrichment is itself fail-safe (returns an empty result on any internal
// error); and this wrapper try/catches so a fault NEVER blocks the turn.
//
// The deep composer inside the enrichment is gated by
// `BORJIE_COGNITIVE_COMPOSER_ENABLED` (default OFF) and only spins on a
// non-fast TTC route, so by default this hook is a cheap in-memory recall
// — no extra LLM cost until the composer is canaried on.

/** Conservative composer surface derived from the turn viewer. */
function composerSurfaceForViewer(
  viewer: TurnGateContext['viewer'],
): 'owner-portal' | 'admin-portal' | 'tenant-app' {
  if (viewer.isAdmin) return 'admin-portal';
  if (viewer.isManagement) return 'owner-portal';
  return 'tenant-app';
}

/**
 * Read the wired cognitive bundle from the Hono context, enrich the turn,
 * and prepend any context block to `userText`. Pure on the input body
 * (immutability): builds a new object. Best-effort — returns the body
 * unchanged on a missing bundle or any failure.
 */
async function withCognitiveEnrichment<
  T extends { readonly userText: string; readonly threadId?: string },
>(c: any, ctx: TurnGateContext, body: T): Promise<T> {
  try {
    const wired = c.get('cognitive') as WiredCognitive | undefined;
    if (!wired || !wired.isLive) return body;
    const enrichArgs: Parameters<typeof enrichBrainTurnWithCognitive>[0] = {
      wired,
      tenantId: ctx.tenant.tenantId,
      userId: ctx.viewer.userId,
      userText: body.userText,
      personaId: 'mr-mwikila',
      // Deep composer routing — conservative stakes; the composer slot is
      // flag-gated (default OFF) and a low-stakes route stays on the fast
      // path, so this is inert until the composer is enabled + a turn is
      // routed deep. The surface mirrors the viewer's portal.
      composer: { stakes: 'low', surface: composerSurfaceForViewer(ctx.viewer) },
      ...(body.threadId !== undefined ? { threadId: body.threadId } : {}),
      logger: {
        debug: (message, meta) => logger.debug(meta ?? {}, message),
        info: (message, meta) => logger.info(meta ?? {}, message),
        warn: (message, meta) => logger.warn(meta ?? {}, message),
        error: (message, meta) => logger.error(meta ?? {}, message),
      },
    };
    const enrichment = await enrichBrainTurnWithCognitive(enrichArgs);
    if (enrichment.enrichedSystemPrompt.length === 0) return body;
    logger.info(
      {
        wiring: 'cognitive-enrichment',
        tenantId: ctx.tenant.tenantId,
        userId: ctx.viewer.userId,
        citations: enrichment.citations.length,
        composerStrategy: enrichment.composer?.route.strategy ?? 'none',
      },
      'brain /turn: injected cognitive enrichment (recall + deep-reasoning)',
    );
    return {
      ...body,
      userText: `${enrichment.enrichedSystemPrompt}\n\n${body.userText}`,
    };
  } catch (err) {
    // Never let enrichment break the turn.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'brain /turn: cognitive enrichment failed (continuing)',
    );
    return body;
  }
}

// ─── MEM-02 — per-turn cognitive WRITER (observe) ─────────────────────
//
// The enrichment hook above only READS memory. This hook closes the WRITE
// side: after a JSON turn produces an answer, it observes the exchange as one
// memory cell so the store ACCRUES turn over turn (with the Drizzle cell repo
// selected at the composition root, the cell is durable across a restart).
//
// Runs on the JSON path only (SSE deltas aren't a single cacheable body) and
// is fully fail-safe: it clones the response (never consumes the original),
// only fires on a 2xx, and `observeBrainTurnMemory` swallows every error so a
// memory-write fault can NEVER affect the response the user already received.

/**
 * Run a JSON turn handler, then best-effort observe the exchange into
 * cognitive memory. Returns the handler's ORIGINAL response untouched.
 *
 * ASYNC-OFFLOAD (latency win): the memory-observe WRITE (which may embed +
 * persist) is moved OFF the critical path via `deferPostResponseWork` — the
 * response is returned to the client immediately and the observe runs on a
 * microtask after the turn returns. The work STILL RUNS (fire-and-forget,
 * not dropped) and every error is swallowed so a deferred fault can never
 * affect the reply the user already received. Only the cheap clone+parse of
 * the response text happens inline (needed before the body stream is sent).
 */
async function withTurnMemoryObserve(
  c: any,
  ctx: TurnGateContext,
  userText: string,
  response: Response,
): Promise<Response> {
  try {
    if (response.status < 200 || response.status >= 300) return response;
    const wired = c.get('cognitive') as WiredCognitive | undefined;
    if (!wired || !wired.isLive) return response;

    // Clone so the original body stream is never consumed. The parse is
    // cheap; the WRITE below is what we defer.
    const cloned = response.clone();
    let responseText = '';
    try {
      const parsed = (await cloned.json()) as { responseText?: unknown };
      responseText =
        typeof parsed.responseText === 'string' ? parsed.responseText : '';
    } catch {
      return response; // non-JSON / unparseable body — skip silently.
    }
    if (responseText.length === 0) return response;

    // Defer the observe write off the critical path. The user gets their
    // answer now; the memory cell is written immediately after on a
    // microtask. Errors are swallowed (best-effort side-channel).
    deferPostResponseWork(
      async () => {
        const cellId = await observeBrainTurnMemory({
          wired,
          tenantId: ctx.tenant.tenantId,
          userText,
          responseText,
          specialisation: 'mr-mwikila',
          logger: {
            debug: (message, meta) => logger.debug(meta ?? {}, message),
            info: (message, meta) => logger.info(meta ?? {}, message),
            warn: (message, meta) => logger.warn(meta ?? {}, message),
            error: (message, meta) => logger.error(meta ?? {}, message),
          },
        });
        if (cellId !== null) {
          logger.info(
            {
              wiring: 'cognitive-observe',
              tenantId: ctx.tenant.tenantId,
              userId: ctx.viewer.userId,
              cellId,
              deferred: true,
            },
            'brain /turn: observed turn into cognitive memory (deferred)',
          );
        }
      },
      (err) =>
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'brain /turn: deferred cognitive observe failed (continuing)',
        ),
    );
  } catch (err) {
    // Never let the writer break the turn — the user already has the answer.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'brain /turn: cognitive observe failed (continuing)',
    );
  }
  return response;
}

// ─── LP-15 / LP-30 — privacy-router consult on the MAIN brain turn ────
//
// The orchestrator (`brain.orchestrator.handleTurn` / `startThread`) is the
// LLM provider boundary for the main chat path. Before this wiring the
// privacy router was only consulted on the `/ask` advisor path (via
// `multi-llm-brain-adapter`); the main `/turn` dispatched to the provider
// WITHOUT a sensitivity-tier check. This hook closes that gap by consulting
// the router on the final user text just before dispatch:
//   - DENIED (restricted data + no local model) → refuse the turn.
//   - CONFIDENTIAL → substitute the PII-stripped text so no raw PII reaches
//     the cloud provider (and is not persisted on the thread).
//   - INTERNAL / PUBLIC → passthrough (the common case; zero cost).
//
// Built once per process (the router holds only a stripper + a health
// probe). Default ENABLED, but ordinary text classifies INTERNAL → no
// strip / no deny, so this is inert until genuinely sensitive content
// appears. `consultPrivacyRouter` is fail-conservative on any error: a
// routing fault PII-strips rather than forwarding raw text, and a strip
// fault denies — it NEVER fails open to a raw-text egress.

let brainPrivacyRouterCache: WiredPrivacyRouter | null = null;

function brainPrivacyRouter(): WiredPrivacyRouter {
  if (brainPrivacyRouterCache) return brainPrivacyRouterCache;
  brainPrivacyRouterCache = buildPrivacyRouter({
    env: process.env,
    logger: {
      info: (meta, msg) => logger.info(meta, msg),
      warn: (meta, msg) => logger.warn(meta, msg),
    },
  });
  return brainPrivacyRouterCache;
}

/** Test seam — drop the cached router so a test can rebuild with a new env. */
export function __resetBrainPrivacyRouter(): void {
  brainPrivacyRouterCache = null;
}

export interface BrainTurnPrivacyDecision {
  /** True when the router refused the turn (restricted data, no local model). */
  readonly refused: boolean;
  /** Single-language refusal copy for the client, when refused. */
  readonly message?: string;
  /** The (possibly PII-stripped) body to dispatch when not refused. */
  readonly body?: { readonly userText: string };
}

/** Single-language privacy-refusal copy. EN default; SW when locale toggles. */
const PRIVACY_REFUSAL_TEXTS = Object.freeze({
  en: 'I can’t process that request — it contains restricted data that must stay on-premises, and the local model is unavailable right now.',
  sw: 'Siwezi kushughulikia ombi hilo — lina taarifa zilizozuiliwa ambazo lazima zibaki ndani ya mfumo, na modeli ya ndani haipatikani kwa sasa.',
} as const);

/**
 * Consult the privacy router for the main brain turn. Returns a refusal
 * directive when the router DENIED the turn; otherwise returns the
 * (possibly PII-stripped) body to dispatch. Never throws — the underlying
 * `consultPrivacyRouter` is fail-conservative, and this wrapper try/catches
 * so a fault falls through to the unchanged body (the kernel pre-flight +
 * evidence gate remain in force).
 */
async function consultBrainTurnPrivacy<
  T extends { readonly userText: string },
>(c: any, body: T): Promise<BrainTurnPrivacyDecision> {
  try {
    const wired = brainPrivacyRouter();
    const decision = await consultPrivacyRouter(
      wired,
      { text: body.userText },
      {
        info: (meta, msg) => logger.info(meta, msg),
        warn: (meta, msg) => logger.warn(meta, msg),
      },
    );
    if (!decision.allowed) {
      const lang: StrictWithholdLang = pickRecallLang(
        c.req.header('accept-language') ?? null,
      );
      logger.warn(
        {
          wiring: 'privacy-router',
          classification: decision.result.classification,
          reason: decision.result.reason,
        },
        'brain /turn: privacy router DENIED dispatch (restricted data, no local model)',
      );
      return { refused: true, message: PRIVACY_REFUSAL_TEXTS[lang] };
    }
    // Substitute the processed (possibly stripped) text. When nothing was
    // stripped this is identical to the input, so the object is rebuilt
    // immutably either way.
    return { refused: false, body: { ...body, userText: decision.processedText } };
  } catch (err) {
    // Defence-in-depth: consultPrivacyRouter is already fail-conservative,
    // but a construction fault must not break the turn. Fall through with
    // the unchanged body — kernel pre-flight + evidence gate still apply.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'brain /turn: privacy-router consult failed (continuing with unprocessed text)',
    );
    return { refused: false };
  }
}

// ─── GAP 2 — 14-step kernel PRE-FLIGHT on /brain/turn ────────────────
//
// Before this wiring the main chat path (/brain/turn) called only
// `brain.orchestrator.handleTurn` — the persona-driven ai-copilot
// stack — and NEVER `kernel.think`. The disciplined 14-step pipeline
// (inviolable → policy-gate → uncertainty/escalation → confidence →
// provenance) ran ONLY on the Jarvis routers. The main chat surface was
// therefore ungated by the kernel's hard refusal rails.
//
// SAFE SUBSET (per the wiring brief): route /brain/turn through the SAME
// `kernel.think` entry the Jarvis routers use (`getSovereignBrain(...)
// .kernel.think(...)`) as a PRE-FLIGHT discipline gate. When the kernel
// REFUSES (inviolable / policy / drift block) we short-circuit and
// return the refusal — the persona path never gets to answer an unsafe
// or out-of-bounds request. When the kernel ALLOWS, we fall through to
// the existing persona path UNCHANGED (persona binding preserved).
//
// STAYED STAGED (flagged): the FULL threading — delegating the whole
// turn to the kernel's Claude-Code-style orchestrator main-loop
// (`composeSovereign({ orchestrator })`) so the persona answer itself
// is GENERATED inside the 14-step pipeline — still depends on the LLM
// router + dispatcher adapters that ship in a separate PR (see
// `packages/central-intelligence/src/kernel/compose.ts` Phase E.5.1 and
// `brain-kernel-wiring.ts` `orchestratorBindings`). Threading that here
// would risk the working persona path, so we ship the pre-flight gate
// (which is the load-bearing safety half) and leave answer-generation
// on the persona path.
//
// Fail-OPEN on infra (NOT on a refusal): if the kernel is unwired (no
// ANTHROPIC_API_KEY) or `think` throws for an infra reason, the
// pre-flight degrades to "allow" so the main chat keeps working — the
// persona path + the auditor evidence gate (GAP 1) remain in force.
// A genuine kernel REFUSAL always blocks; only infra faults pass.

/**
 * Conservative kernel-scope role derived from the turn viewer. Drives
 * WHICH grounding slice the pre-flight kernel sees; the inviolable /
 * policy rails fire regardless of role.
 */
type KernelScopeRole = 'tenant' | 'manager' | 'org-admin';

function kernelRoleForViewer(viewer: TurnGateContext['viewer']): KernelScopeRole {
  if (viewer.isAdmin) return 'org-admin';
  if (viewer.isManagement) return 'manager';
  return 'tenant';
}

/** Single-language refusal copy. EN default; SW when the locale toggles. */
const KERNEL_REFUSAL_TEXTS = Object.freeze({
  en: 'I can’t help with that request — it crosses a safety or policy boundary I’m not allowed to bypass.',
  sw: 'Siwezi kukusaidia na ombi hilo — linavuka mpaka wa usalama au sera ambao siruhusiwi kuukiuka.',
} as const);

export interface KernelPreflightResult {
  /** True when the kernel issued a hard refusal — the turn must stop. */
  readonly refused: boolean;
  /** Which gate refused (for structured logging), when refused. */
  readonly gate?: 'inviolable' | 'policy' | 'drift';
  /** Single-language, locale-correct refusal message for the client. */
  readonly message?: string;
  /** True when the pre-flight could not run (infra) and we failed open. */
  readonly degraded?: boolean;
}

/**
 * Run the 14-step kernel as a PRE-FLIGHT over the user's text. Returns a
 * refusal directive when the kernel blocks (inviolable / policy / drift);
 * otherwise signals "allow" so the caller proceeds to the persona path.
 *
 * Never throws. Tenant-scoped: the calling tenant rides on
 * `req.scope` so memory recall / provenance writes stay isolated.
 */
async function kernelPreflight(
  c: any,
  ctx: TurnGateContext,
  userText: string,
): Promise<KernelPreflightResult> {
  const lang: StrictWithholdLang = pickRecallLang(
    c.req.header('accept-language') ?? null,
  );
  try {
    const role = kernelRoleForViewer(ctx.viewer);
    // Dynamic import: the sovereign composition root transitively pulls
    // in the service-registry + ledger infrastructure. Loading it lazily
    // (only when a turn actually pre-flights) keeps it OUT of this
    // module's eval graph so route-level test suites that partially mock
    // `@borjie/database` don't fault on an unrelated module-eval read.
    const { getSovereignBrain } = await import('../composition/sovereign.js');
    const sov = await getSovereignBrain({
      tenantId: ctx.tenant.tenantId,
      userId: ctx.viewer.userId,
      role,
    });
    const decision = await sov.kernel.think({
      threadId: `brain-turn-preflight:${ctx.tenant.tenantId}:${ctx.viewer.userId}`,
      userMessage: userText,
      scope: {
        kind: 'tenant',
        tenantId: ctx.tenant.tenantId,
        actorUserId: ctx.viewer.userId,
        roles: ctx.viewer.roles,
        personaId: 'mr-mwikila-head',
      },
      // Conservative defaults: the pre-flight exists to fire the hard
      // rails, not to escalate trust. 'tenant' tier + 'low' stakes keep
      // the off-hours / sovereign-tier policy checks from over-firing on
      // ordinary chat while still running inviolable + policy + drift.
      tier: 'tenant',
      stakes: 'low',
      surface: 'owner-portal',
    });
    if (decision.kind === 'refusal') {
      logger.warn(
        {
          wiring: 'kernel-preflight',
          tenantId: ctx.tenant.tenantId,
          userId: ctx.viewer.userId,
          gate: decision.gateThatRefused,
          lang,
        },
        'brain /turn: kernel PRE-FLIGHT refused the turn (14-step rail fired)',
      );
      return {
        refused: true,
        gate: decision.gateThatRefused,
        message: KERNEL_REFUSAL_TEXTS[lang],
      };
    }
    logger.info(
      {
        wiring: 'kernel-preflight',
        tenantId: ctx.tenant.tenantId,
        userId: ctx.viewer.userId,
        decision: decision.kind,
      },
      'brain /turn: kernel PRE-FLIGHT passed (14-step pipeline cleared)',
    );
    return { refused: false };
  } catch (err) {
    // Infra fault (kernel unwired / sensor down). Fail OPEN — the main
    // chat must keep working; the persona path + GAP-1 evidence gate
    // still apply. A genuine refusal NEVER reaches this catch.
    logger.warn(
      {
        wiring: 'kernel-preflight',
        tenantId: ctx.tenant.tenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      'brain /turn: kernel PRE-FLIGHT unavailable; failing open to persona path',
    );
    return { refused: false, degraded: true };
  }
}

// ─── Evidence-required ENFORCEMENT (HARD / JSON mode) ────────────────
//
// CLAUDE.md hard rule: "The Auditor Agent REJECTS responses with empty
// evidence chains." The auditor already computes the verdict; this is
// the enforcement half — in JSON mode we WITHHOLD an ungrounded answer
// and ship a safe single-language placeholder + 422 instead of the
// evidence-free text. Gated behind `BRAIN_STRICT_EVIDENCE` (default ON
// for JSON). SSE remains a non-blocking warn frame (a stream can't
// un-send) handled by `emitAuditorFrame`.

/**
 * Resolve the HARD-mode strict-evidence flag. Default ON for the JSON
 * path. Operators can disable with `BRAIN_STRICT_EVIDENCE=off|0|false`
 * to restore the legacy observe-only behaviour (e.g. during a corpus
 * back-fill where many answers are legitimately evidence-thin).
 */
function strictEvidenceEnabled(): boolean {
  const raw = process.env.BRAIN_STRICT_EVIDENCE?.trim().toLowerCase();
  if (raw === undefined || raw === '') return true; // default ON
  return !(raw === 'off' || raw === '0' || raw === 'false' || raw === 'no');
}

/**
 * Run the auditor over a JSON-mode response and apply HARD-mode
 * enforcement. Returns the (possibly substituted) responseText, the
 * HTTP status (422 when withheld), and the public audit envelope.
 *
 * Pure-ish: performs the auditor call + a Pino log on withhold; never
 * throws (the auditor itself is best-effort). The caller assembles the
 * final JSON body from `responseText` + `audit`.
 */
async function auditAndEnforceJson(args: {
  readonly c: any;
  readonly ctx: TurnGateContext;
  readonly threadId: string;
  readonly personaId: string;
  readonly responseText: string;
  readonly tokensUsed: number;
}): Promise<{
  readonly responseText: string;
  readonly status: 200 | 422;
  readonly audit: {
    verdict: string;
    evidenceCount: number;
    auditLogId: string;
    evidenceWarning: 'no_evidence_cited' | null;
    enforced: boolean;
  };
}> {
  const verdict = await auditChatResponse({
    tenantId: args.ctx.tenant.tenantId,
    threadId: args.threadId,
    userId: args.ctx.viewer.userId,
    personaId: args.personaId,
    responseText: args.responseText,
    tokensUsed: args.tokensUsed,
  });
  const lang: StrictWithholdLang = pickRecallLang(
    args.c.req.header('accept-language') ?? null,
  );
  const strict = strictEvidenceEnabled();
  const decision = decideStrictResponse({
    verdict: verdict.verdict,
    originalText: args.responseText,
    lang,
    strict,
  });
  if (decision.withheld) {
    logger.warn(
      {
        wiring: 'evidence-enforcement',
        tenantId: args.ctx.tenant.tenantId,
        userId: args.ctx.viewer.userId,
        threadId: args.threadId,
        verdict: verdict.verdict,
        evidenceCount: verdict.evidenceCount,
        auditLogId: verdict.auditLogId,
        lang,
      },
      'brain /turn: ungrounded response WITHHELD in HARD mode (evidence-required)',
    );
  }
  return {
    responseText: decision.responseText,
    status: decision.status,
    audit: {
      verdict: verdict.verdict,
      evidenceCount: verdict.evidenceCount,
      auditLogId: verdict.auditLogId,
      evidenceWarning: verdict.evidenceWarning,
      enforced: decision.withheld,
    },
  };
}

// ─── Stage 2 — orchestrator-routed turn (DEFAULT-ON live generator) ──
//
// When `resolveBrainOrchestratorRoutingEnabled()` is ON, generation flows
// through `sov.kernel.think()` (the orchestrator main-loop), which runs the
// inviolable/policy/drift rails AND the answer in ONE call — so the route
// does NOT also run `kernelPreflight` (that would double the LLM spend).
// The flag-OFF persona path (`handleTurnJson` / `handleTurnSse` +
// `kernelPreflight`) stays byte-identical.

/** Map the viewer's portal to the kernel surface tier. */
function orchestratorSurfaceForViewer(
  viewer: TurnGateContext['viewer'],
): 'owner-portal' | 'admin-portal' | 'tenant-app' {
  if (viewer.isAdmin) return 'admin-portal';
  if (viewer.isManagement) return 'owner-portal';
  return 'tenant-app';
}

/** Build the orchestrator turn context from the gate context. */
function orchestratorTurnContext(ctx: TurnGateContext, teamId?: string): OrchestratorTurnContext {
  return {
    tenantId: ctx.tenant.tenantId,
    userId: ctx.viewer.userId,
    roles: ctx.viewer.roles,
    ...(teamId !== undefined ? { teamId } : {}),
  };
}

/**
 * Acquire the live SovereignBrain for this turn's tenant/viewer scope.
 * Dynamic import keeps the sovereign composition root out of this module's
 * eval graph (same rationale as `kernelPreflight`).
 */
async function getSovForTurn(ctx: TurnGateContext) {
  const role = kernelRoleForViewer(ctx.viewer);
  const { getSovereignBrain } = await import('../composition/sovereign.js');
  return getSovereignBrain({
    tenantId: ctx.tenant.tenantId,
    userId: ctx.viewer.userId,
    role,
  });
}

async function handleTurnJsonViaOrchestrator(
  c: any,
  body: { userText: string; threadId?: string; forcePersonaId?: string; teamId?: string },
  ctx: TurnGateContext,
): Promise<Response> {
  const brain = registry().for(ctx.tenant.tenantId);
  try {
    const sov = await getSovForTurn(ctx);
    const payload: OrchestratorTurnPayload = await generateBrainTurnViaOrchestrator({
      brain,
      sov,
      ctx: orchestratorTurnContext(ctx, body.teamId),
      userText: body.userText,
      ...(body.threadId !== undefined ? { threadId: body.threadId } : {}),
      ...(body.forcePersonaId !== undefined ? { forcePersonaId: body.forcePersonaId } : {}),
      surface: orchestratorSurfaceForViewer(ctx.viewer),
      language: pickRecallLang(c.req.header('accept-language') ?? null),
      logger: {
        info: (meta, msg) => logger.info(meta, msg),
        warn: (meta, msg) => logger.warn(meta, msg),
      },
    });
    // The kernel already fired the inviolable/policy/drift rails inside
    // think(); a refusal surfaces as the SAME 403 KERNEL_REFUSED shape the
    // persona-path preflight emits.
    if (payload.refused) {
      return c.json(
        {
          error: 'kernel_refused',
          code: 'KERNEL_REFUSED',
          gate: payload.refusalGate,
          responseText: payload.responseText,
        },
        403,
      );
    }
    // Evidence-required HARD enforcement runs on the kernel's output text,
    // exactly as on the persona path (Auditor rejects empty chains).
    const enforced = await auditAndEnforceJson({
      c,
      ctx,
      threadId: payload.threadId,
      personaId: payload.finalPersonaId,
      responseText: payload.responseText,
      tokensUsed: payload.tokensUsed,
    });
    return c.json(
      {
        threadId: payload.threadId,
        finalPersonaId: payload.finalPersonaId,
        responseText: enforced.responseText,
        handoffs: payload.handoffs,
        toolCalls: payload.toolCalls,
        advisorConsulted: payload.advisorConsulted,
        proposedAction: payload.proposedAction,
        tokensUsed: payload.tokensUsed,
        audit: enforced.audit,
      },
      enforced.status,
    );
  } catch (err) {
    return handleError(c, err);
  }
}

async function handleTurnSseViaOrchestrator(
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
    // Ack-fast pre-paint — identical to the persona path so the mobile
    // chat surface paints a bubble in <100 ms.
    try {
      const ack = buildAckFastFrame(c.req.header('accept-language') ?? null);
      await stream.writeSSE({
        event: 'ack',
        data: JSON.stringify({ text: ack.text, lang: ack.lang }),
      });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'failed to send ack frame',
      );
    }
    let payload: OrchestratorTurnPayload;
    try {
      const sov = await getSovForTurn(ctx);
      payload = await generateBrainTurnViaOrchestrator({
        brain,
        sov,
        ctx: orchestratorTurnContext(ctx, body.teamId),
        userText: body.userText,
        ...(body.threadId !== undefined ? { threadId: body.threadId } : {}),
        ...(body.forcePersonaId !== undefined ? { forcePersonaId: body.forcePersonaId } : {}),
        surface: orchestratorSurfaceForViewer(ctx.viewer),
        language: pickRecallLang(c.req.header('accept-language') ?? null),
        logger: {
          info: (meta, msg) => logger.info(meta, msg),
          warn: (meta, msg) => logger.warn(meta, msg),
        },
      });
    } catch (err) {
      logger.error(
        {
          tenantId: ctx.tenant.tenantId,
          threadId: body.threadId ?? null,
          err: err instanceof Error ? err.message : String(err),
        },
        'brain /turn orchestrator stream failed',
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
    // A kernel refusal surfaces as the SAME error+done frame pair the
    // persona-path preflight emits.
    if (payload.refused) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          message: payload.responseText,
          code: 'KERNEL_REFUSED',
          gate: payload.refusalGate,
          retryable: false,
        }),
      });
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ threadId: payload.threadId, refused: true }),
      });
      return;
    }
    // Stream the answer text in the SAME `message_chunk` envelope the
    // persona path emits, then a `done` frame, then the warn-only auditor
    // frame (SSE cannot un-send tokens). STREAMING FIRST-TOKEN: chunk at the
    // (smaller, env-tunable) stream chunk size so the first visible paint
    // lands sooner than the legacy 80-char chunks.
    try {
      const text = payload.responseText ?? '';
      for (const piece of chunkTextToSse(text, resolveStreamChunkChars())) {
        await stream.writeSSE({
          event: 'message_chunk',
          data: JSON.stringify({ text: piece, done: false }),
        });
      }
      if (payload.proposedAction) {
        await stream.writeSSE({
          event: 'message_chunk',
          data: JSON.stringify({
            text: '',
            done: false,
            proposedAction: {
              risk: payload.proposedAction.riskLevel,
              description: `${payload.proposedAction.verb} ${payload.proposedAction.object}`,
              reviewRequired: payload.proposedAction.reviewRequired,
              executionHeld:
                payload.proposedAction.executionHeld ?? payload.proposedAction.reviewRequired,
            },
          }),
        });
      }
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          threadId: payload.threadId,
          tokensUsed: payload.tokensUsed,
          totalMs: payload.timeMs,
          finalPersonaId: payload.finalPersonaId,
          advisorConsulted: payload.advisorConsulted,
          cacheReadTokens: null,
        }),
      });
      await emitAuditorFrame(
        stream,
        { tenantId: ctx.tenant.tenantId, userId: ctx.viewer.userId },
        {
          threadId: payload.threadId,
          personaId: payload.finalPersonaId,
          responseText: payload.responseText,
          tokensUsed: payload.tokensUsed,
        },
      );
    } catch (err) {
      logger.error(
        {
          tenantId: ctx.tenant.tenantId,
          threadId: payload.threadId,
          err: err instanceof Error ? err.message : String(err),
        },
        'brain /turn orchestrator frame emit failed',
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
      const newThreadId = result.data.thread.id;
      const enforced = await auditAndEnforceJson({
        c,
        ctx,
        threadId: newThreadId,
        personaId: turn.finalPersonaId,
        responseText: turn.responseText,
        tokensUsed: turn.tokensUsed,
      });
      return c.json(
        {
          threadId: newThreadId,
          finalPersonaId: turn.finalPersonaId,
          responseText: enforced.responseText,
          handoffs: turn.handoffs,
          toolCalls: turn.toolCalls,
          advisorConsulted: turn.advisorConsulted,
          proposedAction: turn.proposedAction,
          tokensUsed: turn.tokensUsed,
          audit: enforced.audit,
        },
        enforced.status,
      );
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
    const enforced = await auditAndEnforceJson({
      c,
      ctx,
      threadId: result.data.threadId,
      personaId: result.data.finalPersonaId,
      responseText: result.data.responseText,
      tokensUsed: result.data.tokensUsed,
    });
    return c.json(
      {
        threadId: result.data.threadId,
        finalPersonaId: result.data.finalPersonaId,
        responseText: enforced.responseText,
        handoffs: result.data.handoffs,
        toolCalls: result.data.toolCalls,
        advisorConsulted: result.data.advisorConsulted,
        proposedAction: result.data.proposedAction,
        tokensUsed: result.data.tokensUsed,
        audit: enforced.audit,
      },
      enforced.status,
    );
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

interface AuditorContextForStream {
  readonly tenantId: string;
  readonly userId: string;
}

async function emitAuditorFrame(
  stream: { writeSSE: (data: { event: string; data: string }) => Promise<void> },
  auditCtx: AuditorContextForStream,
  args: {
    readonly threadId: string;
    readonly personaId: string;
    readonly responseText: string;
    readonly tokensUsed: number;
  },
): Promise<void> {
  try {
    const verdict = await auditChatResponse({
      tenantId: auditCtx.tenantId,
      threadId: args.threadId,
      userId: auditCtx.userId,
      personaId: args.personaId,
      responseText: args.responseText,
      tokensUsed: args.tokensUsed,
    });
    await stream.writeSSE({
      event: 'auditor',
      data: JSON.stringify({
        verdict: verdict.verdict,
        evidenceCount: verdict.evidenceCount,
        auditLogId: verdict.auditLogId,
        evidenceWarning: verdict.evidenceWarning,
        // SSE is WARN-ONLY: tokens were already streamed to the client,
        // so we cannot un-send an ungrounded answer here. The auditor
        // verdict is surfaced for client-side display (e.g. an
        // "unverified" badge). HARD enforcement (withhold + 422) lives
        // on the JSON path only. See `auditAndEnforceJson`.
        enforced: false,
        mode: 'warn-only',
      }),
    });
  } catch (err) {
    // Auditor + SSE write are best-effort; never abort the turn.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'failed to emit auditor frame',
    );
  }
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
  // STREAMING FIRST-TOKEN: chunk at the (smaller, env-tunable) stream chunk
  // size so the first visible paint lands sooner than legacy 80-char chunks.
  const text = turn.responseText ?? '';
  for (const piece of chunkTextToSse(text, resolveStreamChunkChars())) {
    await stream.writeSSE({
      event: 'message_chunk',
      data: JSON.stringify({ text: piece, done: false }),
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
        await emitAuditorFrame(
          stream,
          { tenantId: ctx.tenant.tenantId, userId: ctx.viewer.userId },
          {
            threadId: bootstrap.turn.threadId,
            personaId: bootstrap.turn.finalPersonaId,
            responseText: bootstrap.turn.responseText,
            tokensUsed: bootstrap.turn.tokensUsed,
          },
        );
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
      // SOFT MODE — accumulate deltas so the post-stream auditor frame
      // has the full responseText. The auditor is fired AFTER `done`
      // so it can never block the user-visible stream.
      let accumulatedText = '';
      let lastPersonaId: string | null = null;
      let lastTokens = 0;
      for await (const evt of gen) {
        const frame = projectStreamEvent(evt, bootstrap.threadId);
        if (!frame) continue;
        if (frame.event === 'message_chunk') {
          const data = frame.data as { text?: unknown };
          if (typeof data.text === 'string') accumulatedText += data.text;
        } else if (frame.event === 'done') {
          const data = frame.data as { finalPersonaId?: unknown; tokensUsed?: unknown };
          if (typeof data.finalPersonaId === 'string') lastPersonaId = data.finalPersonaId;
          if (typeof data.tokensUsed === 'number') lastTokens = data.tokensUsed;
        }
        await stream.writeSSE({
          event: frame.event,
          data: JSON.stringify(frame.data),
        });
        if (frame.event === 'error') return;
      }
      await emitAuditorFrame(
        stream,
        { tenantId: ctx.tenant.tenantId, userId: ctx.viewer.userId },
        {
          threadId: bootstrap.threadId,
          personaId: lastPersonaId ?? 'unknown',
          responseText: accumulatedText,
          tokensUsed: lastTokens,
        },
      );
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

  // Stage 2 — orchestrator main-loop routing decision (DEFAULT-ON). When
  // ON, `kernel.think()` runs the inviolable/policy/drift rails AND the
  // answer generation in ONE call, so we MUST NOT also run the separate
  // `kernelPreflight` below (that would double the LLM spend). When OFF
  // (`KERNEL_USE_ORCHESTRATOR=false` hard-kill / `BORJIE_ORCHESTRATOR_
  // MAINLOOP=0|false|off` soft-disable) the persona path + the preflight
  // gate run UNCHANGED — byte-identical to the prior production behaviour.
  const orchestratorOn = resolveBrainOrchestratorRoutingEnabled();

  // GAP 2 — 14-step kernel PRE-FLIGHT (persona-path safety half ONLY).
  // Route the turn through the same `kernel.think` entry the Jarvis routers
  // use BEFORE the persona path so the inviolable / policy / drift rails
  // fire on the MAIN chat too. A hard refusal short-circuits the turn
  // (JSON 403 / SSE refusal frame); an infra fault fails open to the
  // persona path. We pre-flight the ORIGINAL user text (before the memory
  // preamble is prepended) so the rails see exactly what the user asked.
  // SKIPPED when the orchestrator is ON: the kernel runs these same rails
  // inside `think()` during generation, so a second pre-flight think()
  // would be a redundant LLM call.
  if (!orchestratorOn) {
    const preflight = await kernelPreflight(c, gate.ctx, body.userText);
    if (preflight.refused) {
      if (wantsSse) {
        return streamSSE(c, async (stream) => {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({
              message: preflight.message,
              code: 'KERNEL_REFUSED',
              gate: preflight.gate,
              retryable: false,
            }),
          });
          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify({ threadId: body.threadId ?? null, refused: true }),
          });
        });
      }
      return c.json(
        {
          error: 'kernel_refused',
          code: 'KERNEL_REFUSED',
          gate: preflight.gate,
          responseText: preflight.message,
        },
        403,
      );
    }
  }

  // Persistent-memory RECALL — load the user's OPEN/active support cases
  // (tenant+user scoped; GUC bound by gateTurn) and prepend a compact,
  // single-language memory preamble to the user's text so Mr. Mwikila never
  // loses support context across sessions/devices. Cheap query, never an LLM
  // call; best-effort (never blocks the turn).
  body = await withRecalledMemory(c, gate.ctx, body);

  // R8 / LP-01 / LP-30 — per-turn cognitive enrichment. Reads the wired
  // cognitive bundle from `c.get('cognitive')` (set by the cognitive
  // context middleware in index.ts) and prepends a recalled-memory +
  // (flag-gated, default-OFF) deep-reasoning context block. This is the
  // call-site that turns the previously-dark composer ON for a live turn.
  // Best-effort + fail-safe (never throws into the turn); inert until the
  // composer flag is enabled and a turn routes to a non-fast strategy.
  body = await withCognitiveEnrichment(c, gate.ctx, body);

  // LP-15 / LP-30 — privacy-router consult BEFORE the orchestrator (the LLM
  // provider boundary). DENIED (restricted data + no local model) refuses
  // the turn; CONFIDENTIAL substitutes the PII-stripped text so no raw PII
  // reaches the cloud provider. Default ENABLED but inert for ordinary
  // INTERNAL/PUBLIC text. Fail-conservative on any error (never forwards
  // raw text on a routing fault).
  const privacy = await consultBrainTurnPrivacy(c, body);
  if (privacy.refused) {
    if (wantsSse) {
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            message: privacy.message,
            code: 'PRIVACY_DENIED',
            retryable: false,
          }),
        });
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ threadId: body.threadId ?? null, refused: true }),
        });
      });
    }
    return c.json(
      {
        error: 'privacy_denied',
        code: 'PRIVACY_DENIED',
        responseText: privacy.message,
      },
      403,
    );
  }
  if (privacy.body) {
    body = { ...body, userText: privacy.body.userText };
  }

  // G2 — Idempotency-Key cache lookup. Only applies to the JSON path
  // (SSE streams are not cacheable). When the client sends a valid key
  // and we have a fresh cached response for `(tenantId, userId, key)`
  // we replay it and skip the orchestrator entirely — no LLM tokens
  // burned on the retry. The cache hit sets `Idempotent-Replayed: true`
  // so live-verify can confirm the gate fired.
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
      // Stage 2 — route generation through the orchestrator main-loop when
      // ON; the proven persona path (`handleTurnJson`) runs UNCHANGED when
      // OFF. Idempotency caching wraps whichever handler runs.
      const response = orchestratorOn
        ? await handleTurnJsonViaOrchestrator(c, body, gate.ctx)
        : await handleTurnJson(c, body, gate.ctx);
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
      // MEM-02 — observe the exchange into cognitive memory (fail-safe).
      return withTurnMemoryObserve(c, gate.ctx, body.userText, response);
    }
    const jsonResponse = orchestratorOn
      ? await handleTurnJsonViaOrchestrator(c, body, gate.ctx)
      : await handleTurnJson(c, body, gate.ctx);
    // MEM-02 — observe the exchange into cognitive memory (fail-safe).
    return withTurnMemoryObserve(c, gate.ctx, body.userText, jsonResponse);
  }
  return orchestratorOn
    ? handleTurnSseViaOrchestrator(c, body, gate.ctx)
    : handleTurnSse(c, body, gate.ctx);
}));

brainRouter.get('/threads', async (c) => {
  let ctx;
  try {
    ctx = await authenticate(c);
  } catch (err) {
    return handleError(c, err);
  }
  // Thread-store reads self-bind tenant context per operation (the repo
  // wraps each query in a short per-tenant transaction).
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
  // Thread-store reads self-bind tenant context per operation (the repo
  // wraps each query in a short per-tenant transaction).
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

// NOTE: the legacy `/brain/migrate/extract` + `/brain/migrate/commit` routes
// were REMOVED in the RLS-pinning / dead-code sweep. They were a
// property-domain relic from the BossNyumba hard-fork: they extracted/diffed/
// committed `{ properties, units, tenants, employees, departments, teams }`
// bundles via `MigrationWriterService`, whose backing tables were dropped in
// migration 0003_mining_domain.sql (the service is now a no-op stub — gh-issue
// #29). `/migrate/commit` in particular called a non-existent `writer.commit`
// (the stub only exposes a no-op `write`), so it threw `writer.commit is not a
// function` at runtime; it only type-checked because the handler params were
// `any`. The supported migration surface is the live wizard at
// `/api/v1/migration` (`migration.router.ts`), which uses a real per-run
// commit service — NOT this dead brain endpoint.

export { brainRouter };
