/**
 * Public Borjie Marketing Chat — /api/v1/public/chat
 *
 * MIRRORS LitFin's /api/marketing/explain register:
 *   - Marketing assistant tone, NOT stepper-onboarding.
 *   - ≤100 words per response.
 *   - Helpful + encouraging + concrete.
 *   - Inline citations the renderer turns into chips.
 *
 * The authenticated HOME chat (apps/owner-web home, served from
 * brain.hono.ts) is a SEPARATE surface with a DIFFERENT system
 * prompt — stepper-learning with concept_card / ui_block blocks à
 * la LitFin's /api/chat/exploration. The two prompts intentionally
 * do not share. Marketing sells; Home teaches.
 *
 * Provider ladder (every entry tried regardless of error class):
 *   1. Anthropic claude-sonnet-4-5     — latest Anthropic flagship
 *   2. OpenAI gpt-4o-2024-11-20         — latest stable OpenAI
 *   3. DeepSeek deepseek-chat (V3.x)    — OpenAI-compatible API
 *
 * Wire shape (SSE):
 *   event: turn.accepted   { mode, language, sessionId, at }
 *   event: message_chunk   { text, evidence_ids[], confidence, done }
 *   event: done            { at, provider, depth, latencyMs, attempts }
 *   event: error           { kind, message, retryable }
 *
 * NO fallback to curated FAQ. If all 3 providers fail, the SSE
 * stream emits a real `error` event.
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import {
  AnthropicAdapter,
  OpenAIAdapter,
} from '@borjie/brain-llm-router/universal-client';
import type {
  BrainLLMClient,
  BrainLLMRequest,
  BrainLLMResponse,
  ContentBlock,
} from '@borjie/brain-llm-router';

const PublicChatSchema = z
  .object({
    query: z.string().min(1).max(2000).optional(),
    message: z.string().min(1).max(2000).optional(),
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          text: z.string().min(1).max(4000),
        }),
      )
      .max(20)
      .optional(),
    mode: z
      .enum([
        'build',
        'strategy',
        'operations',
        'document',
        'finance',
        'risk',
        'board-investor',
        'compliance',
      ])
      .optional()
      .default('build'),
    language: z.enum(['en', 'sw']).optional().default('en'),
    sessionId: z.string().min(1).max(120).optional(),
  })
  .refine((d) => Boolean(d.query ?? d.message), {
    message: 'query or message is required',
    path: ['query'],
  });

// ─── MARKETING system prompt (LitFin /marketing/explain register) ───
//
// Short, sales-helpful, concrete. ≤100 words. The marketing surface
// is for visitors evaluating Borjie — answer their question, show
// them a relevant capability, point them at the pilot. NOT a deep
// onboarding stepper.

export const BORJIE_MARKETING_SYSTEM_PROMPT_EN = `You are Mr. Mwikila — Borjie's AI Mining Operations Manager — speaking on the public marketing site to a visitor evaluating Borjie. Your job is to explain Borjie clearly and concisely, point at the most relevant capability for whatever they ask about, and gently invite them to start the 90-day free pilot.

Borjie is an AI-native operating system for Tanzanian mining. It runs the licence calendar (PML / ML / SML), drafts monthly royalty filings in Tumemadini format, runs the FX/USD-gold-window treasury desk, matches ore parcels to vetted buyers on the marketplace, supervises workforce shifts/attendance with a field mobile app, and ships a compliance pack (Tumemadini, NEMC, BoT). Multi-tenant, Tanzania-region storage, hash-chain audited. Bilingual sw/en.

Rules:
- KEEP RESPONSES UNDER 100 WORDS. Do not lecture. Be useful in 2-4 short sentences.
- Concrete operating vocabulary only (licence, royalty, parcel, shift, drill-hole, FX window, LBMA, BRELA, TRA, Tumemadini, NEMC). No corporate-deck slop. Banned: "AI-powered", "revolutionize", "synergize", "next-generation", "leverage".
- Append citation markers like [royalties] [licences] [marketplace] [workers] [fx] [pricing] [pilot] [security] [autopilot] [advisor] [who-for] [languages] [sign-up] at the end of any capability claim. The renderer attaches chips. Don't invent ids.
- Helpful + encouraging tone. End most turns with a single soft next step: "Want the 90-day pilot, or a quick human follow-up?"
- If asked about a feature not in the list above, say "I don't have that yet — want a Borjie human to follow up?"
- No markdown headings, no bullet lists, no bold, no code blocks. Plain text only.`;

export const BORJIE_MARKETING_SYSTEM_PROMPT_SW = `Wewe ni Bw. Mwikila — Meneja wa AI wa Shughuli za Mgodi wa Borjie — unazungumza kwenye tovuti ya umma na mgeni anayepima Borjie. Kazi yako: kueleza Borjie kwa ufupi, kuelekeza uwezo unaohusiana na swali lake, na kumkaribisha jaribio la siku 90 bure.

Borjie ni mfumo wa uendeshaji wa AI kwa madini Tanzania. Inaendesha kalenda ya leseni (PML/ML/SML), inaandika mrabaha wa mwezi katika muundo wa Tumemadini, dawati la fedha za kigeni, soko la wanunuzi, konsoli ya wafanyakazi, na seti ya kanuni (Tumemadini, NEMC, BoT). Mfumo wa watumiaji wengi, uhifadhi Tanzania, ukaguzi wa hash. Kiswahili na Kiingereza.

Sheria:
- MAJIBU CHINI YA MANENO 100. Sentensi 2-4 fupi. Usitoe hotuba.
- Maneno mahususi (leseni, mrabaha, kifurushi, zamu, shimo, dirisha la fedha, LBMA, BRELA, TRA, Tumemadini, NEMC). Hakuna "AI-powered", "revolutionize".
- Weka vitambulisho kati ya mabano mwisho wa madai: [royalties] [licences] [marketplace] [workers] [fx] [pricing] [pilot] [security] [autopilot] [advisor] [who-for] [languages] [sign-up].
- Sauti msaada na kuhamasisha. Maliza kwa hatua moja: "Je, ungependa jaribio la siku 90, au mtu wa Borjie akupigie?"
- Ukiulizwa kitu kisicho hapo juu: "Bado sina hilo — ungependa mtu wa Borjie akupigie?"
- Maandishi ya kawaida tu, hakuna vichwa, hakuna orodha.`;

// ─── DeepSeek adapter (OpenAI-compatible API) ───────────────────────

class DeepSeekAdapter implements BrainLLMClient {
  public readonly provider = 'openai' as const; // OpenAI-compat wire
  private readonly inner: OpenAIAdapter;

  constructor(config: { readonly apiKey: string }) {
    this.inner = new OpenAIAdapter({
      apiKey: config.apiKey,
      baseUrl: 'https://api.deepseek.com',
    });
  }

  async invoke(req: BrainLLMRequest): Promise<BrainLLMResponse> {
    return this.inner.invoke(req);
  }
}

// ─── Adapters built once ────────────────────────────────────────────

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

// ─── Citation extraction ────────────────────────────────────────────

const VALID_CITATIONS = new Set([
  'who-am-i',
  'what-is-borjie',
  'autopilot',
  'advisor',
  'workers',
  'royalties',
  'licences',
  'marketplace',
  'fx',
  'pricing',
  'pilot',
  'who-for',
  'security',
  'languages',
  'sign-up',
]);

function extractCitations(text: string): {
  readonly clean: string;
  readonly ids: readonly string[];
} {
  const ids: string[] = [];
  const clean = text.replace(/\[([a-z][a-z0-9-]{1,40})\]/gi, (_m, id: string) => {
    if (VALID_CITATIONS.has(id.toLowerCase())) {
      ids.push(`borjie:${id.toLowerCase()}`);
    }
    return '';
  });
  return {
    clean: clean
      .replace(/\s+([.,!?])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim(),
    ids: Array.from(new Set(ids)),
  };
}

function chunkText(text: string, chunkSize = 40): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    out.push(text.slice(i, i + chunkSize));
  }
  return out;
}

function extractText(response: BrainLLMResponse): string {
  const parts: string[] = [];
  for (const block of response.content as readonly ContentBlock[]) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('').trim();
}

// ─── Hono app ───────────────────────────────────────────────────────

const app = new Hono();

app.post('/chat', zValidator('json', PublicChatSchema), async (c) => {
  const body = c.req.valid('json');
  const query = body.query ?? body.message ?? '';
  const language = body.language ?? 'en';
  const mode = body.mode ?? 'build';
  const history = body.history ?? [];
  const sessionId = body.sessionId ?? null;
  const startedAt = Date.now();

  const { anthropic, openai, deepseek } = providers();

  return streamSSE(c, async (stream) => {
    const abort = new AbortController();
    stream.onAbort(() => abort.abort());

    await stream.writeSSE({
      event: 'turn.accepted',
      data: JSON.stringify({
        mode,
        language,
        sessionId,
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

    const systemPrompt =
      language === 'sw'
        ? BORJIE_MARKETING_SYSTEM_PROMPT_SW
        : BORJIE_MARKETING_SYSTEM_PROMPT_EN;

    const messages = [
      ...history.map((h) => ({
        role: h.role,
        content: [{ type: 'text' as const, text: h.text }],
      })),
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: query }],
      },
    ];

    // 3-rung provider ladder — try every rung regardless of error class.
    interface LadderEntry {
      readonly model: string;
      readonly client: BrainLLMClient;
      readonly providerName: 'anthropic' | 'openai' | 'deepseek';
    }
    const ladder: LadderEntry[] = [];
    if (anthropic) {
      ladder.push({
        model: 'claude-sonnet-4-5',
        client: anthropic,
        providerName: 'anthropic',
      });
    }
    if (openai) {
      ladder.push({
        model: 'gpt-4o-2024-11-20',
        client: openai,
        providerName: 'openai',
      });
    }
    if (deepseek) {
      ladder.push({
        model: 'deepseek-chat',
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
          maxTokens: 400, // ≤100 words → ~250-400 tokens cap
          temperature: 0.7,
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

    const text = extractText(response);
    if (!text) {
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

    const { clean, ids } = extractCitations(text);
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
      await new Promise<void>((r) => setTimeout(r, 18));
    }

    await stream.writeSSE({
      event: 'done',
      data: JSON.stringify({
        at: new Date().toISOString(),
        provider: winningProvider,
        depth,
        latencyMs: Date.now() - startedAt,
        attempts: attempts.length,
      }),
    });
  });
});

export default app;
