/**
 * Authenticated Borjie HOME Teaching Chat — /api/v1/brain/teach
 *
 * SURPASSES LitFin's /api/chat/exploration register on five vectors:
 *
 *   1. Multi-block teaching. LitFin allows ONE ui_block per response.
 *      Borjie allows ONE primary block PLUS up to TWO inline_metric
 *      micro-blocks for live data, rendered as chips inside the body.
 *   2. 5-step lesson ladder (orient → licence → royalty → workforce →
 *      marketplace). The model emits a step_progress block at the start
 *      of a fresh thread, and the actions chip array is framed
 *      "next / deeper / wider" so the owner sees which lesson is next
 *      vs deeper vs wider (LitFin only does deeper/wider).
 *   3. Strategic intent layer (ASSESS / TEACH / EXECUTE / SUMMARIZE)
 *      mirrors the marketing chat's invisible-thinking discipline.
 *   4. Tenant-grounded examples — auth context injects
 *      <owner_context>{tenantId,fullName,country,language}</owner_context>
 *      before the system prompt so the model can reference the owner's
 *      real data instead of LitFin's generic Tanzania anchors.
 *   5. Mandatory citation chain — every capability claim ends in a
 *      bracketed citation marker which the server validates against the
 *      whitelist (same one as marketing). Unknown ids are stripped.
 *
 * Provider ladder (every entry tried regardless of error class — never
 * a curated fallback string):
 *   1. Anthropic claude-sonnet-4-6  — env override BORJIE_HOME_ANTHROPIC_MODEL
 *   2. OpenAI gpt-5                 — env override BORJIE_HOME_OPENAI_MODEL
 *   3. DeepSeek deepseek-chat       — env override BORJIE_HOME_DEEPSEEK_MODEL
 *
 * Wire shape (SSE):
 *   event: turn.accepted     { mode:'teach', step:1, language, sessionId, at }
 *   event: message_chunk     { text, evidence_ids[], confidence, done }
 *   event: ui_block          { block: {type, ...}, at }
 *   event: inline_metric     { metric: {label,value,tone}, at }
 *   event: suggested_actions { actions:string[], at }
 *   event: done              { at, provider, depth, latencyMs, attempts }
 *   event: error             { kind, message, retryable }
 *
 * NO mock data. If all 3 providers fail the SSE stream emits a real
 * error event and the renderer surfaces it to the owner.
 *
 * DOES NOT touch the existing /api/v1/brain/turn route — purely
 * additive. /turn keeps its tool-calling persona-runtime; /teach is a
 * lightweight direct LLM stream for the chat-first home surface.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import pino from 'pino';

import {
  AnthropicAdapter,
  OpenAIAdapter,
} from '@borjie/brain-llm-router/universal-client';
import type {
  BrainLLMClient,
  BrainLLMRequest,
  BrainLLMResponse,
} from '@borjie/brain-llm-router';
import {
  verifySupabaseJwt,
  extractBearer,
  principalToBrainContexts,
  SupabaseAuthError,
  loadBrainEnv,
} from '@borjie/ai-copilot';

import {
  BORJIE_HOME_TEACHING_SYSTEM_PROMPT_EN,
  BORJIE_HOME_TEACHING_SYSTEM_PROMPT_SW,
  DeepSeekAdapter,
  extractCitations,
  chunkText,
  extractText,
} from './public-chat.hono';
import { createAdaptiveStreamController } from '../services/brain/sse-adaptive.js';
import {
  extractSpawnTabs,
  parseInlineBlocks,
  extractAutoAuthorized,
} from '@borjie/owner-os-tabs';
import { extractTabTags } from '@borjie/central-intelligence';
import { processTabTagsForOwner } from '../services/tab-crud/index.js';
import { parseBoardElements } from './board-element-parser';
import { parseSuperpowers } from './ui-navigate-parser';
import {
  isHighStakes,
  runDebate,
  type DebateContender,
  type DebateResult,
} from '../services/brain-debate/index.js';
import {
  inferMindState,
  createAffectiveAccumulator,
  renderMindStateDirectiveWithProfile,
  type AffectiveProfile,
} from '@borjie/central-intelligence';
import {
  getMemory,
  recordObservation,
  renderMemoryDirective,
  type MemorySnapshot,
} from '../services/advisor-memory/index.js';
import { getDb } from '../composition/db-client.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'brain-teach',
});

// ─── Request validation ─────────────────────────────────────────────

const TeachChatSchema = z
  .object({
    message: z.string().min(1).max(4000).optional(),
    query: z.string().min(1).max(4000).optional(),
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          text: z.string().min(1).max(8000),
        }),
      )
      .max(40)
      .optional(),
    language: z.enum(['en', 'sw']).optional().default('en'),
    sessionId: z.string().min(1).max(120).optional(),
    /** Lesson step the client thinks the owner is on (1-5). */
    step: z.number().int().min(1).max(5).optional(),
  })
  .refine((d) => Boolean(d.message ?? d.query), {
    message: 'message or query is required',
    path: ['message'],
  });

// ─── Auth ────────────────────────────────────────────────────────────

let envCache: ReturnType<typeof loadBrainEnv> | null = null;
function env() {
  if (envCache) return envCache;
  envCache = loadBrainEnv(process.env);
  return envCache;
}

interface OwnerAuthContext {
  readonly tenant: {
    readonly tenantId: string;
    readonly tenantName: string;
    readonly environment: 'production' | 'staging' | 'development';
  };
  readonly actor: {
    readonly type: 'user';
    readonly id: string;
    readonly email?: string;
    readonly roles: ReadonlyArray<string>;
  };
}

async function authenticate(c: {
  req: { header: (k: string) => string | undefined };
}): Promise<OwnerAuthContext> {
  const token = extractBearer(c.req.header('authorization'));
  if (!token) throw new SupabaseAuthError('missing_authorization_header', 401);
  const principal = await verifySupabaseJwt(token, {
    jwtSecret: env().SUPABASE_JWT_SECRET,
    defaultEnvironment: 'production',
  });
  const ctx = principalToBrainContexts(principal);
  return ctx as unknown as OwnerAuthContext;
}

// ─── Providers ───────────────────────────────────────────────────────

interface Providers {
  readonly anthropic: AnthropicAdapter | null;
  readonly openai: OpenAIAdapter | null;
  readonly deepseek: DeepSeekAdapter | null;
}

function buildProviders(): Providers {
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  return {
    anthropic: anthropicKey ? new AnthropicAdapter({ apiKey: anthropicKey }) : null,
    openai: openaiKey ? new OpenAIAdapter({ apiKey: openaiKey }) : null,
    deepseek: deepseekKey ? new DeepSeekAdapter({ apiKey: deepseekKey }) : null,
  };
}

let providersCache: Providers | null = null;
function providers(): Providers {
  if (!providersCache) providersCache = buildProviders();
  return providersCache;
}

// ─── Reasoning pipelines (Wave BRAIN-DEPTH) ─────────────────────────
//
// Wakes the kernel's stateful theory-of-mind accumulator + the
// persistent advisor memory + a ladder-failure tracker for the
// degraded-brain badge. All three are process-global singletons so a
// warm api-gateway carries owner-affective state across turns within
// the 24h TTL of the kernel accumulator.

const affectiveAccumulator = createAffectiveAccumulator();

/**
 * Sliding window of recent ladder outcomes per (tenant, user). When two
 * consecutive turns end in `all_providers_failed`, the next turn
 * surfaces a degraded-brain badge.
 *
 * Capped at 1024 keys via FIFO eviction so a misbehaving caller can't
 * grow the map indefinitely.
 */
const ladderFailureStreaks = new Map<string, number>();
const LADDER_STREAK_CAP = 1024;

function bumpLadderStreak(key: string, failed: boolean): number {
  const prev = ladderFailureStreaks.get(key) ?? 0;
  const next = failed ? prev + 1 : 0;
  if (next === 0) {
    ladderFailureStreaks.delete(key);
    return 0;
  }
  ladderFailureStreaks.set(key, next);
  if (ladderFailureStreaks.size > LADDER_STREAK_CAP) {
    // Drop oldest insertion (Map preserves insertion order).
    const oldest = ladderFailureStreaks.keys().next().value;
    if (oldest !== undefined) ladderFailureStreaks.delete(oldest);
  }
  return next;
}

function inferEngagementHint(
  history: ReadonlyArray<{ readonly role: string; readonly text: string }>,
  ladderFailed: boolean,
): 'continue' | 'accept' | 'bounce' {
  if (ladderFailed) return 'bounce';
  // Owner provided a follow-up message → continue.
  if (history.length >= 2) return 'continue';
  // Fresh thread, no prior signal → treat as continue (neutral).
  return 'continue';
}

/**
 * Classify the question kind from the message. Free-form short tag the
 * brain uses for routing + observation. Pure heuristic — no model
 * call, no DB.
 */
function classifyQuestionKind(message: string): string {
  const m = message.toLowerCase();
  if (/(how much|earned|revenue|profit|sales|made)/.test(m)) return 'finance.summary';
  if (/(licen[cs]e|pml|permit|expir)/.test(m)) return 'compliance.licence';
  if (/(royalt|tra)/.test(m)) return 'compliance.tax';
  if (/(hire|fire|worker|payroll)/.test(m)) return 'hr.staffing';
  if (/(buyer|price|sell|offtake)/.test(m)) return 'marketplace.deal';
  if (/(safe|accident|incident|nemc|spill)/.test(m)) return 'risk.incident';
  if (/(remind|notify|set up)/.test(m)) return 'workflow.reminder';
  return 'general';
}

/**
 * Heuristic owner local hour. Uses the persisted timezone preference
 * when available (`Africa/Dar_es_Salaam` by default) so observations
 * record an hour-of-day that matches the owner's real wall clock.
 */
function localHourForTimezone(tz: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hour12: false,
      timeZone: tz,
    });
    const parts = formatter.formatToParts(new Date());
    const hourPart = parts.find((p) => p.type === 'hour');
    const n = hourPart ? Number(hourPart.value) : NaN;
    if (Number.isFinite(n) && n >= 0 && n <= 23) return n;
  } catch {
    /* fall through to UTC hour */
  }
  return new Date().getUTCHours();
}

/**
 * Detect routine action from a user message. Pure heuristic, conservative.
 * Returns a routine descriptor only when the message is unambiguously a
 * confirmation of an action being taken (e.g. "filed royalty for May").
 */
function detectRoutineAction(message: string): { action: string; dom?: number } | null {
  const m = message.toLowerCase();
  const filed = /(filed|paid|submitted|sent)\s+(royalty|royalt)/.test(m);
  if (filed) {
    const today = new Date();
    return { action: 'royalty_file', dom: today.getUTCDate() };
  }
  if (/(scheduled|booked|reserved)\s+(safety|toolbox|inspection)/.test(m)) {
    return { action: 'safety_toolbox_schedule' };
  }
  return null;
}

/**
 * Detect rejection in the user message. Conservative — false negatives
 * are fine; false positives would slowly bias the model toward avoiding
 * useful recommendations.
 */
function detectRejectedRecommendation(message: string): string | null {
  const m = message.toLowerCase();
  if (/(don'?t|do not|won'?t|no thanks|skip)\s+(hire|fire|sell|buy|change|move)/.test(m)) {
    const action = m.match(/(hire|fire|sell|buy|change|move)/)?.[0];
    if (action) return `${action}_action`;
  }
  return null;
}

// ─── UI-block extraction ────────────────────────────────────────────

const ALLOWED_BLOCK_TYPES = new Set([
  'concept_card',
  'metric_strip',
  'decision_card',
  'step_progress',
  // Surface picker emitted on the first turn of a fresh session so the
  // owner can self-classify their literacy level — see the EN/SW
  // teaching prompts in public-chat.hono.ts (search for "level_select").
  'level_select',
  // Side-quest doc work the professor assigns when the owner is missing
  // a regulatory document (NEMC EIA, BRELA renewal, etc.).
  'doc_quest',
]);

const ALLOWED_INLINE_TONES = new Set(['positive', 'neutral', 'warning']);

interface ParsedUiBlock {
  readonly type: string;
  readonly [key: string]: unknown;
}

interface ParsedInlineMetric {
  readonly label: string;
  readonly value: string;
  readonly tone: 'positive' | 'neutral' | 'warning';
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Find and remove a single primary <ui_block>{...}</ui_block> from the
 * model's text. Returns the parsed block (if any) plus the body with the
 * tag stripped. Only the first valid block is honoured; extras are
 * silently dropped to keep the renderer deterministic.
 */
function extractUiBlock(text: string): {
  readonly body: string;
  readonly block: ParsedUiBlock | null;
} {
  let block: ParsedUiBlock | null = null;
  const body = text.replace(
    /<ui_block>\s*(\{[\s\S]*?\})\s*<\/ui_block>/i,
    (_m, json: string) => {
      if (block) return ''; // already captured
      const parsed = safeParseJson(json);
      if (isRecord(parsed) && typeof parsed.type === 'string' && ALLOWED_BLOCK_TYPES.has(parsed.type)) {
        block = parsed as ParsedUiBlock;
      }
      return '';
    },
  );
  return { body, block };
}

/**
 * Strip and capture up to TWO <inline_metric>{...}</inline_metric>
 * tags from the body. Extras dropped quietly. Each metric requires a
 * label + value; tone defaults to "neutral".
 */
function extractInlineMetrics(text: string): {
  readonly body: string;
  readonly metrics: ReadonlyArray<ParsedInlineMetric>;
} {
  const found: ParsedInlineMetric[] = [];
  const body = text.replace(
    /<inline_metric>\s*(\{[\s\S]*?\})\s*<\/inline_metric>/gi,
    (_m, json: string) => {
      if (found.length >= 2) return '';
      const parsed = safeParseJson(json);
      if (!isRecord(parsed)) return '';
      const label = typeof parsed.label === 'string' ? parsed.label.trim() : '';
      const value = typeof parsed.value === 'string' ? parsed.value.trim() : '';
      const rawTone = typeof parsed.tone === 'string' ? parsed.tone.toLowerCase() : 'neutral';
      const tone: 'positive' | 'neutral' | 'warning' = ALLOWED_INLINE_TONES.has(rawTone)
        ? (rawTone as 'positive' | 'neutral' | 'warning')
        : 'neutral';
      if (!label || !value) return '';
      found.push({ label, value, tone });
      return '';
    },
  );
  return { body, metrics: found };
}

// ─── Hono app ───────────────────────────────────────────────────────

const teachApp = new Hono();

teachApp.post('/teach', zValidator('json', TeachChatSchema), async (c) => {
  const body = c.req.valid('json');
  const message = (body.message ?? body.query ?? '').trim();
  const language = body.language ?? 'en';
  const history = body.history ?? [];
  const sessionId = body.sessionId ?? null;
  const clientStep = body.step ?? 1;
  const startedAt = Date.now();

  let auth: OwnerAuthContext;
  try {
    auth = await authenticate(c);
  } catch (err) {
    if (err instanceof SupabaseAuthError) {
      return c.json({ error: err.message, code: 'AUTH' }, err.status);
    }
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'brain-teach: auth failed',
    );
    return c.json({ error: 'authentication_failed', code: 'AUTH' }, 401);
  }

  const { anthropic, openai, deepseek } = providers();

  return streamSSE(c, async (stream) => {
    const abort = new AbortController();
    stream.onAbort(() => abort.abort());

    await stream.writeSSE({
      event: 'turn.accepted',
      data: JSON.stringify({
        mode: 'teach',
        step: clientStep,
        language,
        sessionId,
        tenantId: auth.tenant.tenantId,
        at: new Date().toISOString(),
      }),
    });

    if (!anthropic && !openai && !deepseek) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          kind: 'no_provider_configured',
          message:
            'No LLM provider configured (ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY).',
          retryable: false,
        }),
      });
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ at: new Date().toISOString(), error: true }),
      });
      return;
    }

    const basePrompt =
      language === 'sw'
        ? BORJIE_HOME_TEACHING_SYSTEM_PROMPT_SW
        : BORJIE_HOME_TEACHING_SYSTEM_PROMPT_EN;

    // Wave BRAIN-DEPTH: wake the sleeping reasoning pipelines.
    //
    // 1) Theory-of-mind sensor — infer per-turn mind state from the
    //    user message, accumulate into the stateful affective profile
    //    keyed by (tenant, user).
    // 2) Advisor memory — read persisted preferences + observed patterns
    //    so the brain remembers WHO the owner is across sessions.
    // 3) Degraded badge — if the last 2 turns from this user ended with
    //    every provider failing, surface a yellow pill ahead of the
    //    response so the owner sees the brain is operating degraded.
    const tenantId = auth.tenant.tenantId;
    const userId = auth.actor.id ?? 'anon';
    const ladderKey = `${tenantId}:${userId}`;
    const turnAtIso = new Date().toISOString();

    const mindState = inferMindState(message);
    let affectiveProfile: AffectiveProfile | null = null;
    try {
      affectiveProfile = affectiveAccumulator.observe(tenantId, userId, {
        mindState,
        capturedAt: turnAtIso,
      });
    } catch {
      affectiveProfile = null;
    }

    // Memory snapshot — never blocks the turn; falls back to defaults.
    const memoryDb = getDb();
    let memorySnapshot: MemorySnapshot | null = null;
    if (memoryDb) {
      try {
        memorySnapshot = await getMemory(memoryDb, tenantId);
      } catch {
        memorySnapshot = null;
      }
    }

    const degradedStreak = ladderFailureStreaks.get(ladderKey) ?? 0;
    const degradedBrain = degradedStreak >= 2;
    if (degradedBrain) {
      await stream.writeSSE({
        event: 'brain_state',
        data: JSON.stringify({
          degraded: true,
          consecutiveFailures: degradedStreak,
          label: language === 'sw' ? 'Ubongo umepungua nguvu' : 'Brain operating in degraded mode',
          at: turnAtIso,
        }),
      });
    }

    // Inject the owner's tenant context BEFORE the teaching prompt so
    // the model can reference real data ("Your PML 0241/2023 expires in
    // 47 days") instead of LitFin's generic anchors. The actor name
    // doubles as the salutation hook (the model may use it once, but
    // the system prompt explicitly forbids opening with "Good morning").
    const ownerCtx = {
      tenantId,
      tenantName: auth.tenant.tenantName,
      fullName: auth.actor.email ?? null,
      country: process.env.DEFAULT_TENANT_COUNTRY?.trim() || 'TZ',
      language,
      step: clientStep,
    };

    const ownerStateDirective = renderMindStateDirectiveWithProfile(
      mindState,
      affectiveProfile,
    );
    const memoryDirective = memorySnapshot ? renderMemoryDirective(memorySnapshot) : '';

    const systemPromptParts: string[] = [
      `<owner_context>${JSON.stringify(ownerCtx)}</owner_context>`,
      '',
    ];
    if (ownerStateDirective) {
      systemPromptParts.push('## OWNER_STATE');
      systemPromptParts.push(ownerStateDirective);
      systemPromptParts.push('');
    }
    if (memoryDirective) {
      systemPromptParts.push('## OWNER_MEMORY');
      systemPromptParts.push(memoryDirective);
      systemPromptParts.push('');
    }
    systemPromptParts.push(basePrompt);
    const systemPrompt = systemPromptParts.join('\n');

    const messages = [
      ...history.map((h) => ({
        role: h.role,
        content: [{ type: 'text' as const, text: h.text }],
      })),
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: message }],
      },
    ];

    // 3-rung provider ladder. Latest flagship per provider as of 2026-05.
    interface LadderEntry {
      readonly model: string;
      readonly client: BrainLLMClient;
      readonly providerName: 'anthropic' | 'openai' | 'deepseek';
    }
    const ladder: LadderEntry[] = [];
    const anthropicModel =
      process.env.BORJIE_HOME_ANTHROPIC_MODEL?.trim() ||
      process.env.BORJIE_CHAT_ANTHROPIC_MODEL?.trim() ||
      process.env.CLAUDE_MODEL_DEFAULT?.trim() ||
      'claude-sonnet-4-6';
    const openaiModel =
      process.env.BORJIE_HOME_OPENAI_MODEL?.trim() ||
      process.env.BORJIE_CHAT_OPENAI_MODEL?.trim() ||
      process.env.OPENAI_MODEL_DEFAULT?.trim() ||
      'gpt-5';
    const deepseekModel =
      process.env.BORJIE_HOME_DEEPSEEK_MODEL?.trim() ||
      process.env.BORJIE_CHAT_DEEPSEEK_MODEL?.trim() ||
      'deepseek-chat';

    if (anthropic) {
      ladder.push({
        model: anthropicModel,
        client: anthropic,
        providerName: 'anthropic',
      });
    }
    if (openai) {
      ladder.push({
        model: openaiModel,
        client: openai,
        providerName: 'openai',
      });
    }
    if (deepseek) {
      ladder.push({
        model: deepseekModel,
        client: deepseek,
        providerName: 'deepseek',
      });
    }

    interface Attempt {
      readonly provider: string;
      readonly model: string;
      readonly error?: string;
      readonly latencyMs: number;
    }
    const attempts: Attempt[] = [];
    let response: BrainLLMResponse | null = null;
    let winningProvider: string | null = null;
    let depth = -1;
    let debateResult: DebateResult | null = null;

    // Accuracy mode — when the user message matches a high-stakes intent
    // (regulator filing, royalty submission, payment, hire/fire, contract
    // sign), fan out across every available provider, judge them, and
    // pick the winner. The single-shot ladder below is the fallback if
    // every contender fails.
    const highStakes = isHighStakes(message);
    if (highStakes && ladder.length >= 2) {
      const contenders: DebateContender[] = ladder.map((entry) => ({
        provider: entry.providerName,
        model: entry.model,
        client: entry.client,
      }));
      try {
        debateResult = await runDebate(contenders, {
          messages,
          system: systemPrompt,
          maxTokens: 1200,
          temperature: 0.7,
        });
        response = debateResult.winner.response;
        winningProvider = debateResult.winner.provider;
        depth = ladder.findIndex(
          (entry) => entry.providerName === debateResult!.winner.provider,
        );
        for (const r of debateResult.trace.responses) {
          attempts.push({
            provider: r.provider,
            model: r.model,
            latencyMs: r.latencyMs,
            ...(r.error ? { error: r.error } : {}),
          });
        }
      } catch (err) {
        // Debate failed entirely; fall through to single-shot ladder.
        attempts.push({
          provider: 'debate',
          model: 'multi',
          error: err instanceof Error ? err.message : String(err),
          latencyMs: 0,
        });
      }
    }

    for (let i = 0; response === null && i < ladder.length; i++) {
      const entry = ladder[i]!;
      const t0 = Date.now();
      try {
        response = await entry.client.invoke({
          model: entry.model,
          messages,
          system: systemPrompt,
          // 2-3 paragraphs + a JSON ui_block + actions ≈ 700-1100 tokens.
          maxTokens: 1200,
          // Higher temperature so the opener varies turn-to-turn — owners
          // should never see the same "Good morning" boilerplate twice.
          temperature: 0.85,
        });
        attempts.push({
          provider: entry.providerName,
          model: entry.model,
          latencyMs: Date.now() - t0,
        });
        winningProvider = entry.providerName;
        depth = i;
        break;
      } catch (err) {
        attempts.push({
          provider: entry.providerName,
          model: entry.model,
          error: err instanceof Error ? err.message : String(err),
          latencyMs: Date.now() - t0,
        });
      }
    }

    if (!response) {
      bumpLadderStreak(ladderKey, true);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          kind: 'all_providers_failed',
          message: `All ${ladder.length} provider(s) failed`,
          attempts,
          retryable: true,
        }),
      });
      // Best-effort: record bounce so future turns reflect the
      // engagement signal even when the response itself failed.
      if (memoryDb) {
        await recordObservation(memoryDb, {
          tenantId,
          userId,
          responseLengthChars: 0,
          localHour: localHourForTimezone(
            memorySnapshot?.preferences.timeZone ?? 'Africa/Dar_es_Salaam',
          ),
          questionKind: classifyQuestionKind(message),
          normalizedQuestion: message,
          engagement: 'bounce',
        }).catch(() => {});
      }
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          at: new Date().toISOString(),
          error: true,
          latencyMs: Date.now() - startedAt,
        }),
      });
      return;
    }

    // Successful provider response — reset the consecutive-failure
    // streak so a healthy turn clears the degraded-brain badge for
    // the next turn.
    bumpLadderStreak(ladderKey, false);

    const rawText = extractText(response);
    if (!rawText) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          kind: 'empty_response',
          message: 'Model returned no text content.',
          retryable: true,
          attempts,
        }),
      });
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ at: new Date().toISOString(), error: true }),
      });
      return;
    }

    // Order of stripping matters: spawn_tabs first (free-form JSON object
    // that may contain commas/braces that confuse later regexes), then
    // CT-1 dynamic tab tags (self-closing XML — quote-safe), then
    // auto_authorized (sibling of confirmation_card), then board_add
    // (the blackboard primitives — own free-form JSON), then INLINE
    // blocks (Flow A — the inline-first catalog), then the legacy
    // primary ui_block (teaching blocks — Flow A escape hatch), then
    // inline metrics, then actions+citations.
    const spawnResult = extractSpawnTabs(rawText);
    const tabTagsResult = extractTabTags(spawnResult.body);
    const autoAuthResult = extractAutoAuthorized(tabTagsResult.body);
    const boardResult = parseBoardElements(autoAuthResult.body);
    const inlineResult = parseInlineBlocks(boardResult.body);
    const uiResult = extractUiBlock(inlineResult.body);
    const metricsResult = extractInlineMetrics(uiResult.body);
    // Wave SUPERPOWERS - strip the 6 chip families AFTER all other
    // primitives so an accidental `<ui_share>` inside a teaching
    // ui_block is left intact.
    const superpowersResult = parseSuperpowers(metricsResult.body);
    const { clean, ids, actions } = extractCitations(superpowersResult.body);

    // CT-3 / CT-4 — pipe parsed tab tags into the persistence layer.
    // We process them server-side BEFORE streaming so the FE sees the
    // SSE event AFTER the database row + cockpit-bus broadcast land
    // (avoids the FE racing the bus reconciliation). Failures are
    // surfaced as `tab_tag_error` events without halting the reply.
    const tabActions = await processTabTagsForOwner({
      tags: tabTagsResult.tags,
      dropped: tabTagsResult.dropped,
      tenantId,
      userId,
      logger,
    });

    // Emit debate metadata BEFORE the message_chunks so the FE renders
    // the "Verified ✓ 3-model debate" badge above the assistant bubble
    // as soon as the first token paints.
    if (debateResult) {
      await stream.writeSSE({
        event: 'debate_metadata',
        data: JSON.stringify({
          verified: debateResult.verified,
          winner: {
            provider: debateResult.winner.provider,
            model: debateResult.winner.model,
          },
          scores: debateResult.scores,
          trace: {
            judgeProvider: debateResult.trace.judgeProvider,
            winnerReason: debateResult.trace.winnerReason,
            responses: debateResult.trace.responses.map((r) => ({
              provider: r.provider,
              model: r.model,
              latencyMs: r.latencyMs,
              ...(r.error ? { error: r.error } : {}),
            })),
          },
          at: new Date().toISOString(),
        }),
      });
    }

    // Stream the cleaned text first so the renderer can paint
    // progressively before the ui_block lands at the end of the bubble.
    //
    // Roadmap R10 — adaptive stream rate composition hook. The
    // controller batches chunks when a slow client falls behind and
    // micro-streams when it is keeping up. Client signals its last
    // displayed chunkNo via the `?lastChunk=N` query parameter on
    // reconnect (the FE today still pulls greedily so the lag stays
    // 0 and micro mode applies — but the seam is in place so a slow
    // 3G client batched by the controller will get coarse chunks
    // without any further server-side change).
    const chunks = chunkText(clean);
    const lastChunkParam = c.req.query('lastChunk');
    const initialAck =
      lastChunkParam !== undefined && /^\d+$/.test(lastChunkParam)
        ? Number.parseInt(lastChunkParam, 10)
        : 0;
    const adaptive = createAdaptiveStreamController();
    if (initialAck > 0) adaptive.ack(initialAck);
    for (const piece of chunks) {
      adaptive.push(piece);
    }
    let emitted = 0;
    const total = chunks.length;
    while (!abort.signal.aborted) {
      const next = adaptive.pull();
      if (next === null) break;
      emitted += 1;
      const isLast = emitted === total;
      await stream.writeSSE({
        event: 'message_chunk',
        data: JSON.stringify({
          text: next.text,
          chunkNo: next.chunkNo,
          batched: next.batched,
          evidence_ids: isLast ? ids : [],
          confidence: isLast ? 0.95 : null,
          done: false,
        }),
      });
      const delay = adaptive.recommendedDelayMs();
      if (delay > 0) {
        await new Promise<void>((r) => setTimeout(r, delay));
      }
    }

    // Blackboard elements — emit each as its own SSE event so the FE
    // blackboard store can append them. Document-order is preserved so
    // the owner sees the lesson build in the order Mr. Mwikila chose.
    for (const element of boardResult.elements) {
      if (abort.signal.aborted) break;
      await stream.writeSSE({
        event: 'board_element',
        data: JSON.stringify({ element, at: new Date().toISOString() }),
      });
    }

    // Inline metrics — emit each as its own SSE event so the renderer
    // can attach them as chips inside the assistant bubble.
    for (const metric of metricsResult.metrics) {
      if (abort.signal.aborted) break;
      await stream.writeSSE({
        event: 'inline_metric',
        data: JSON.stringify({ metric, at: new Date().toISOString() }),
      });
    }

    // Inline blocks (Flow A — INLINE-FIRST) — emit each as its own SSE
    // frame in document order. The FE renders these inside the bubble.
    // Cap at 8 enforced by the parser; further duplication is dropped.
    for (const block of inlineResult.blocks) {
      if (abort.signal.aborted) break;
      await stream.writeSSE({
        event: 'inline_block',
        data: JSON.stringify({
          block,
          at: new Date().toISOString(),
        }),
      });
    }

    // Auto-authorized companion — fired BEFORE the audit chain is
    // written. The FE renders the rationale without buttons; the server
    // is responsible for executing the action and writing the audit row.
    if (autoAuthResult.autoAuthorized) {
      await stream.writeSSE({
        event: 'auto_authorized',
        data: JSON.stringify({
          payload: autoAuthResult.autoAuthorized,
          at: new Date().toISOString(),
        }),
      });
    }

    // Primary ui_block (teaching) — emit after text so the renderer can
    // place it directly under the assistant bubble.
    if (uiResult.block) {
      await stream.writeSSE({
        event: 'ui_block',
        data: JSON.stringify({
          block: uiResult.block,
          at: new Date().toISOString(),
        }),
      });
    }

    // Suggested action chips — same envelope as marketing, but framed
    // as next / deeper / wider by the system prompt.
    if (actions.length > 0) {
      await stream.writeSSE({
        event: 'suggested_actions',
        data: JSON.stringify({ actions, at: new Date().toISOString() }),
      });
    }

    // Wave SUPERPOWERS - emit one SSE event per parsed chip family.
    // Order: navigates first (cheapest), then prefills, then highlights,
    // then shares, bulks, bookmarks. The FE renders each as its own
    // chip beneath the assistant bubble.
    for (const navigate of superpowersResult.navigates) {
      if (abort.signal.aborted) break;
      await stream.writeSSE({
        event: 'ui_navigate',
        data: JSON.stringify({ chip: navigate, at: new Date().toISOString() }),
      });
    }
    for (const prefill of superpowersResult.prefills) {
      if (abort.signal.aborted) break;
      await stream.writeSSE({
        event: 'ui_prefill',
        data: JSON.stringify({ chip: prefill, at: new Date().toISOString() }),
      });
    }
    for (const highlight of superpowersResult.highlights) {
      if (abort.signal.aborted) break;
      await stream.writeSSE({
        event: 'ui_highlight',
        data: JSON.stringify({ chip: highlight, at: new Date().toISOString() }),
      });
    }
    for (const share of superpowersResult.shares) {
      if (abort.signal.aborted) break;
      await stream.writeSSE({
        event: 'ui_share',
        data: JSON.stringify({ chip: share, at: new Date().toISOString() }),
      });
    }
    for (const bulk of superpowersResult.bulks) {
      if (abort.signal.aborted) break;
      await stream.writeSSE({
        event: 'ui_bulk',
        data: JSON.stringify({ chip: bulk, at: new Date().toISOString() }),
      });
    }
    for (const bookmark of superpowersResult.bookmarks) {
      if (abort.signal.aborted) break;
      await stream.writeSSE({
        event: 'ui_bookmark',
        data: JSON.stringify({ chip: bookmark, at: new Date().toISOString() }),
      });
    }

    // Spawn-tab candidates — the brain emitted one or more <spawn_tabs>
    // intents alongside its primary teaching block. The FE renders these
    // as "Suggested tab" chips under the assistant bubble; clicking
    // routes through the dynamic tab registry to spawn or augment the
    // matching tab.
    if (spawnResult.batch.tabs.length > 0) {
      await stream.writeSSE({
        event: 'spawn_tabs',
        data: JSON.stringify({
          batch: spawnResult.batch,
          at: new Date().toISOString(),
        }),
      });
    }

    // CT-3 / CT-5 — dynamic tab CRUD tags. Emit one SSE event per
    // processed action so the FE chat-side parser can render the
    // appropriate chip (spawn/update/remove/proposal) AND reconcile
    // its local tab strip with the server-side persistence we just
    // wrote in `processTabTagsForOwner`. Errors are surfaced as
    // `tab_tag_error` events without halting the reply.
    for (const action of tabActions) {
      if (abort.signal.aborted) break;
      await stream.writeSSE({
        event: action.event,
        data: JSON.stringify({
          payload: action.payload,
          at: new Date().toISOString(),
        }),
      });
    }

    // Wave BRAIN-DEPTH: record the observation so the next turn sees
    // the engagement signal, the question kind, and any detected
    // routine / aversion in the persistent advisor memory. Never
    // blocks the SSE — failures are swallowed inside the recorder.
    if (memoryDb) {
      const observation = {
        tenantId,
        userId,
        responseLengthChars: clean.length,
        localHour: localHourForTimezone(
          memorySnapshot?.preferences.timeZone ?? 'Africa/Dar_es_Salaam',
        ),
        questionKind: classifyQuestionKind(message),
        normalizedQuestion: message,
        engagement: inferEngagementHint(history, false),
      } as Parameters<typeof recordObservation>[1];
      const routine = detectRoutineAction(message);
      if (routine) {
        Object.assign(observation, {
          detectedRoutineAction: routine.action,
          ...(routine.dom !== undefined ? { routineDayOfMonth: routine.dom } : {}),
        });
      }
      const rejected = detectRejectedRecommendation(message);
      if (rejected) {
        Object.assign(observation, { rejectedRecommendationKind: rejected });
      }
      await recordObservation(memoryDb, observation).catch(() => {});
    }

    await stream.writeSSE({
      event: 'done',
      data: JSON.stringify({
        at: new Date().toISOString(),
        provider: winningProvider,
        depth,
        latencyMs: Date.now() - startedAt,
        attempts: attempts.length,
        actions_count: actions.length,
        ui_block: uiResult.block ? uiResult.block.type : null,
        inline_metrics: metricsResult.metrics.length,
        inline_blocks: inlineResult.blocks.length,
        inline_block_types: inlineResult.blocks.map((b) => b.type),
        auto_authorized: autoAuthResult.autoAuthorized
          ? autoAuthResult.autoAuthorized.action
          : null,
        spawn_tabs: spawnResult.batch.tabs.length,
        tab_tags: {
          parsed: tabTagsResult.tags.length,
          dropped: tabTagsResult.dropped.length,
          actions: tabActions.length,
        },
        board_elements: boardResult.elements.length,
        board_element_types: boardResult.elements.map((e) => e.type),
        board_dropped: boardResult.dropped,
        superpowers: {
          navigates: superpowersResult.navigates.length,
          prefills: superpowersResult.prefills.length,
          highlights: superpowersResult.highlights.length,
          shares: superpowersResult.shares.length,
          bulks: superpowersResult.bulks.length,
          bookmarks: superpowersResult.bookmarks.length,
          dropped: superpowersResult.dropped,
        },
        brain_state: {
          degraded: degradedBrain,
          consecutiveFailures: degradedStreak,
        },
        sensors: {
          mindState: mindState,
          affectiveTurns: affectiveProfile?.turns ?? 0,
          memory: memorySnapshot ? memorySnapshot.patterns.length : null,
        },
        debate: debateResult
          ? {
              verified: debateResult.verified,
              contenders: debateResult.trace.responses.length,
            }
          : null,
      }),
    });
  });
});

export { teachApp as brainTeachRouter };
export default teachApp;
