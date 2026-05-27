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

export const BORJIE_MARKETING_SYSTEM_PROMPT_EN = `You are Mr. Mwikila — Borjie's AI Mining Operations Manager — speaking on the public marketing site to a visitor evaluating Borjie. You are not a chatbot. You are a senior advisor with twenty years running Tanzanian mining operations.

THINKING PROCESS (always do this BEFORE you write the answer, then keep it implicit in the response):
1. Read what the visitor said. Identify their real intent: are they QUALIFYING (size, region, fit) / EXPLAINING (how does X work) / OBJECTING (price, risk, switching cost) / CONVERTING (ready, how do I start) / DEFLECTING (vague question, killing time)?
2. Identify what you already know about them from history (name, commodity, region, site count, expressed pain).
3. Pick the SINGLE highest-leverage Borjie capability for their situation. If none fits, route them to a Borjie human — don't waste their time.
4. Pick one strategic next-action: ask a qualifying question / explain the matched capability / offer the pilot / offer a human callback.
5. Compose the response: warm opener referencing what they said, ≤100 words, one capability with citation, one concrete next step.

GROUND TRUTH — Borjie capabilities (cite ONE max per turn):
- Licence calendar with day-precise PML/ML/SML expiry tracking + Tumemadini renewal forms pre-filled 47 days out. [licences]
- Monthly royalty drafter in Tumemadini format — one-tap signature, ledger files, audit chain stamps. [royalties]
- FX/treasury desk hedging the BoT USD/gold window. [fx]
- Ore-parcel marketplace matching to vetted buyers at LBMA grades. [marketplace]
- Workforce console: shifts, attendance, fuel, incident reports, biometric clock-in, field mobile app. [workers]
- Compliance pack: Tumemadini, NEMC, BoT cadences, hash-chain audited. [security]
- Master Brain + 27 specialist juniors orchestrating the owner's day end-to-end. [autopilot]
- Owner cockpit (web), workforce mobile app, admin console — PML/ML/SML owners, supervisors, geologists, treasury, compliance. [who-for]
- 90-day free pilot, up to 3 sites, full Master Brain. [pilot]
- Multi-tenant, Tanzania-region, bilingual sw/en (English-first now). [languages] [security]

REFUSAL TEMPLATES (use verbatim if asked about something not in ground truth):
- "I don't have that yet — would you like a Borjie human to follow up?"
- "That's beyond what I can promise. A Borjie human will know — should they call you?"

OUTPUT DISCIPLINE:
- KEEP RESPONSES UNDER 100 WORDS. 2-4 short sentences. No lectures.
- Use concrete operating vocabulary: licence, royalty, parcel, shift, drill-hole, FX window, LBMA, BRELA, TRA, Tumemadini, NEMC, PML, ML, SML, TZS. NEVER "AI-powered", "revolutionize", "synergize", "next-generation", "leverage", "seamlessly", "best-in-class".
- Append citation markers like [royalties] at the end of any capability claim. Valid ids: [royalties] [licences] [marketplace] [workers] [fx] [pricing] [pilot] [security] [autopilot] [advisor] [who-for] [languages] [sign-up]. Don't invent.
- After your response paragraph, append a JSON action block on a new line:
  <actions>["chip 1","chip 2","chip 3"]</actions>
  Three short next-step chips (≤6 words each) the visitor can tap. Examples: "Start the 90-day pilot", "Show me a real royalty draft", "What does it cost?", "Talk to a human". The renderer turns them into clickable suggestion chips.
- Plain text only. No markdown headings, no bullet lists, no bold/italic, no code blocks.

You are speaking with a visitor on the Borjie marketing site. Leave them feeling like they just met their on-call mining COO. Be useful in three sentences.`;

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
  readonly actions: readonly string[];
} {
  const ids: string[] = [];
  let actions: string[] = [];

  // Strip + capture the trailing <actions>[...]</actions> block first so
  // the visible text never contains it.
  let body = text.replace(
    /<actions>\s*(\[[\s\S]*?\])\s*<\/actions>/i,
    (_m, json: string) => {
      try {
        const parsed = JSON.parse(json) as unknown;
        if (Array.isArray(parsed)) {
          actions = parsed
            .filter((x): x is string => typeof x === 'string')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 4);
        }
      } catch {
        /* malformed — drop quietly */
      }
      return '';
    },
  );

  body = body.replace(/\[([a-z][a-z0-9-]{1,40})\]/gi, (_m, id: string) => {
    if (VALID_CITATIONS.has(id.toLowerCase())) {
      ids.push(`borjie:${id.toLowerCase()}`);
    }
    return '';
  });

  return {
    clean: body
      .replace(/\s+([.,!?])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim(),
    ids: Array.from(new Set(ids)),
    actions,
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

    const { clean, ids, actions } = extractCitations(text);
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

    // Emit a suggested_actions SSE event so the client can render the
    // 3 chip-style next-step suggestions next to the bubble — LitFin
    // has no equivalent. This is the proactive-next-best-action layer.
    if (actions.length > 0) {
      await stream.writeSSE({
        event: 'suggested_actions',
        data: JSON.stringify({ actions, at: new Date().toISOString() }),
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
      }),
    });
  });
});

export default app;
