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
import {
  extractSpawnTabs,
  parseInlineBlocks,
  extractAutoAuthorized,
} from '@borjie/owner-os-tabs';

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

    // Inject the owner's tenant context BEFORE the teaching prompt so
    // the model can reference real data ("Your PML 0241/2023 expires in
    // 47 days") instead of LitFin's generic anchors. The actor name
    // doubles as the salutation hook (the model may use it once, but
    // the system prompt explicitly forbids opening with "Good morning").
    const ownerCtx = {
      tenantId: auth.tenant.tenantId,
      tenantName: auth.tenant.tenantName,
      fullName: auth.actor.email ?? null,
      country: process.env.DEFAULT_TENANT_COUNTRY?.trim() || 'TZ',
      language,
      step: clientStep,
    };
    const systemPrompt = [
      `<owner_context>${JSON.stringify(ownerCtx)}</owner_context>`,
      '',
      basePrompt,
    ].join('\n');

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

    for (let i = 0; i < ladder.length; i++) {
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
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          kind: 'all_providers_failed',
          message: `All ${ladder.length} provider(s) failed`,
          attempts,
          retryable: true,
        }),
      });
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
    // auto_authorized (sibling of confirmation_card), then INLINE blocks
    // (Flow A — the inline-first catalog), then the legacy primary
    // ui_block (teaching blocks — Flow A escape hatch), then inline
    // metrics, then actions+citations.
    const spawnResult = extractSpawnTabs(rawText);
    const autoAuthResult = extractAutoAuthorized(spawnResult.body);
    const inlineResult = parseInlineBlocks(autoAuthResult.body);
    const uiResult = extractUiBlock(inlineResult.body);
    const metricsResult = extractInlineMetrics(uiResult.body);
    const { clean, ids, actions } = extractCitations(metricsResult.body);

    // Stream the cleaned text first so the renderer can paint
    // progressively before the ui_block lands at the end of the bubble.
    const chunks = chunkText(clean);
    for (let i = 0; i < chunks.length; i++) {
      if (abort.signal.aborted) break;
      const isLast = i === chunks.length - 1;
      await stream.writeSSE({
        event: 'message_chunk',
        data: JSON.stringify({
          text: chunks[i] ?? '',
          evidence_ids: isLast ? ids : [],
          confidence: isLast ? 0.95 : null,
          done: false,
        }),
      });
      await new Promise<void>((r) => setTimeout(r, 14));
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
      }),
    });
  });
});

export { teachApp as brainTeachRouter };
export default teachApp;
