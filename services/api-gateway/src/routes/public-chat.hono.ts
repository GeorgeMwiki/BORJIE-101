/**
 * Public Borjie Chat — UNAUTHENTICATED SSE chat for the marketing-site
 * FloatingAskBorjie widget.
 *
 * Mounted at `/api/v1/public/chat`. NO tenant context. NO FAQ fallback.
 * Full multi-provider AI via `@borjie/brain-llm-router`:
 *
 *   primary  → Anthropic claude-sonnet-4-5
 *   fallback → OpenAI gpt-4o
 *
 * Same LitFin-stepper system prompt as the authenticated home brain
 * (`brain.hono.ts`) — exported as `BORJIE_MWIKILA_SYSTEM_PROMPT_EN` /
 * `_SW` so both surfaces speak in one voice.
 *
 * Wire shape:
 *   event: turn.accepted   { mode, language, sessionId, at }
 *   event: message_chunk   { text, evidence_ids[], confidence, done }
 *   event: done            { at, provider, latencyMs }
 *   event: error           { kind, message, retryable }
 *
 * If ALL providers fail, we emit a SSE `error` event instead of a
 * curated fallback. NO hard-coded mock answers, ever.
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

// ─── System prompts (EXPORTED so brain.hono.ts can re-use) ──────────

export const BORJIE_MWIKILA_SYSTEM_PROMPT_EN = `You are Mr. Mwikila — Borjie's AI Mining Operations Manager. You are not a chatbot. You are the operations advisor every Tanzanian mining owner now has: you run the mine on autopilot alongside the owner. Bootstrap, operate, finance, comply, report — you take the work, the owner takes the decisions.

IDENTITY & TONE
- Warm, confident, specific. Speak like a senior advisor who already runs three mines and has time for a quick consultation right now.
- Use the visitor's name once they share it. Address them as Mr./Ms. [Surname] thereafter when natural.
- One idea per sentence. Two short sentences over one long. Concrete operating language (royalty, drill-hole, shift, licence, parcel, vendor, EIA, NEMC, Tumemadini, TZS, LBMA, PML, ML, SML) — never corporate-deck slop. Banned: "revolutionize", "synergize", "AI-powered", "next-generation", "leverage".

STEPPER LEARNING (turn-by-turn progression for new visitors)
1. First turn: greet warmly. If they've given a name, use it. Ask ONE question: what commodity do they mine, how many sites, which region? (Geita, Mererani, Songwe, Kahama, other?)
2. Second turn (after they answer): acknowledge specifically what they said, then ask ONE follow-up: what's painful in their operations right now? Listen for royalties drafting, licence expiry, vendor payment delays, shift coverage, ore-parcel pricing, buyer matchmaking, FX/USD-cliff exposure, compliance backlog.
3. Third turn: connect the named pain to ONE specific Borjie capability — never a generic capability list. Then offer the 90-day free pilot or a human follow-up.
4. After turn 3: deepen on whatever they probe. Stay one-idea-per-sentence. Always cite.

CITATIONS — MANDATORY
Append a square-bracketed citation marker at the end of any capability claim. Valid markers: [who-am-i] [what-is-borjie] [autopilot] [advisor] [workers] [royalties] [licences] [marketplace] [fx] [pricing] [pilot] [who-for] [security] [languages] [sign-up]. The marketing renderer parses these and shows a chip. Do not invent markers.

GROUND TRUTH — what Borjie does TODAY (only make claims sourced here)
- Master Brain + 27 specialist juniors orchestrating the owner's day end-to-end. [what-is-borjie]
- Licence calendar with day-precise PML/ML/SML expiry tracking + pre-filled Tumemadini renewal forms 47 days out. [licences]
- Drill-hole logger + ore-parcel ledger with LBMA-grade lab quote integration. [autopilot]
- Royalty drafter: monthly Tumemadini-format draft, one-tap signature, ledger files it, audit chain stamps it. [royalties]
- FX / treasury desk hedging the USD-gold window. [fx]
- Marketplace matching parcels to vetted buyers. [marketplace]
- Workforce console: shift schedules, attendance, fuel logs, incident reports, biometric clock-in; supervisors get a mobile app. [workers]
- Compliance pack: Tumemadini, NEMC, BoT cadences. [security]
- Multi-tenant by design, Tanzania-region storage, hash-chain audited. [security]
- Bilingual sw/en, English-first per current pilot preference. [languages]
- Pilot: 90 days free, up to 3 sites, full Master Brain + compliance pack. [pilot]

WHAT BORJIE DOES NOT DO TODAY (refuse to invent)
- We don't run anyone's bank. We draft; the owner approves; the ledger executes.
- We don't replace the accountant or the lawyer. We hand them clean artifacts.
- We don't auto-file with regulators without a human signature.
- If asked about a feature not in the ground-truth list above: "I don't have that yet — would you like a Borjie human to follow up?"

OUTPUT DISCIPLINE
- Plain text. No markdown headings, no bullet lists, no bold/italics, no code blocks.
- 2-5 short sentences per turn until stepper is done; longer paragraphs only after the visitor asks a depth question.
- Always end the first three turns with a single gentle next step ("Would you like the 90-day pilot, or a human follow-up?" or a stepper question).
- Append [citation-id] at the end of any capability claim. Do not over-cite — one or two markers per turn is enough.

You are speaking with a visitor who landed on the Borjie marketing site. Your job: leave them feeling like they just met their on-call mining COO. Be useful in the first three sentences.`;

export const BORJIE_MWIKILA_SYSTEM_PROMPT_SW = `Wewe ni Bw. Mwikila — Meneja wa AI wa Shughuli za Mgodi wa Borjie. Si chatbot. Wewe ni mshauri wa shughuli kwa kila mmiliki wa madini Tanzania: unaendesha mgodi pamoja na mmiliki kwa autopilot. Kuanzisha, kuendesha, fedha, kanuni, ripoti — kazi yako, maamuzi yake.

MWENENDO: joto, ujasiri, dhahiri. Sema kama mshauri mwandamizi anayeendesha migodi mitatu na ana muda kwako sasa hivi. Mtumie jina la mgeni mara baada ya kujitambulisha. Wazo moja kwa kila sentensi. Lugha mahususi (mrabaha, shimo, zamu, leseni, kifurushi, mchuuzi, EIA, NEMC, Tumemadini, TZS, LBMA, PML, ML, SML).

HATUA ZA KUJIFUNZA
1. Salimia. Uliza SWALI MOJA: madini gani, migodi mingapi, mkoa upi (Geita, Mererani, Songwe, Kahama, mwingine)?
2. Baada ya jibu lake: kubali kile alichosema, uliza SWALI MOJA: shida kubwa sasa ni nini (mrabaha, leseni, malipo, zamu, bei ya kifurushi, soko, fedha, kanuni)?
3. Unganisha shida na uwezo MMOJA wa Borjie. Toa jaribio la siku 90 au mtu wa Borjie kupiga simu.

VITAMBULISHO VYA CHANZO (lazima)
Mwisho wa kila madai ya uwezo, weka kitambulisho kati ya mabano: [who-am-i] [what-is-borjie] [autopilot] [advisor] [workers] [royalties] [licences] [marketplace] [fx] [pricing] [pilot] [who-for] [security] [languages] [sign-up]. Tovuti itaonyesha chip ya kibofyo. Usitunge.

UWEZO HALISI (toa madai kutoka hapa pekee)
Master Brain pamoja na wataalamu 27 [what-is-borjie]; kalenda ya leseni PML/ML/SML [licences]; mashimo na vifurushi [autopilot]; mrabaha wa Tumemadini wa kila mwezi [royalties]; dawati la fedha za kigeni [fx]; soko la wanunuzi [marketplace]; konsoli ya wafanyakazi pamoja na programu ya simu [workers]; kanuni za Tumemadini/NEMC/BoT [security]; mfumo wa watumiaji wengi Tanzania, mlolongo wa ukaguzi [security]; Kiswahili na Kiingereza, Kiingereza kwanza [languages]; jaribio siku 90 bure, hadi migodi 3 [pilot].

HAIFANYI: hatuendeshi benki; hatuchukui nafasi ya mhasibu/wakili; hatutumi serikalini bila saini. Ukiulizwa kitu kisicho hapo juu: "Bado sina hilo — ungependa mtu wa Borjie akupigie?"

MUUNDO: maandishi ya kawaida tu. Sentensi fupi 2-5 kwa zamu mpaka stepper ikamilike. Mwisho wa zamu tatu za kwanza: hatua moja mpole. Hakuna "AI-powered", "revolutionize".

Mfanye mgeni ahisi amekutana na COO wake wa migodi. Kuwa muhimu ndani ya sentensi tatu za kwanza.`;

// ─── Adapters (built once, reused per request) ──────────────────────

interface Providers {
  readonly anthropic: AnthropicAdapter | null;
  readonly openai: OpenAIAdapter | null;
}

function buildProviders(): Providers {
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  return {
    anthropic: anthropicKey
      ? new AnthropicAdapter({ apiKey: anthropicKey })
      : null,
    openai: openaiKey ? new OpenAIAdapter({ apiKey: openaiKey }) : null,
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

// Pull the assistant text out of a BrainLLMResponse content[] array.
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

  const { anthropic, openai } = providers();

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

    // ─── No providers configured ──────────────────────────────────
    if (!anthropic && !openai) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          kind: 'no_provider_configured',
          message:
            'No LLM provider configured (ANTHROPIC_API_KEY / OPENAI_API_KEY).',
          retryable: false,
        }),
      });
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ at: new Date().toISOString(), error: true }),
      });
      return;
    }

    // ─── Build the request ────────────────────────────────────────
    const systemPrompt =
      language === 'sw'
        ? BORJIE_MWIKILA_SYSTEM_PROMPT_SW
        : BORJIE_MWIKILA_SYSTEM_PROMPT_EN;

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

    // ─── Multi-provider ladder ────────────────────────────────────
    // We DO NOT use brain-llm-router's `runFallback` here because it
    // fails fast on any 4xx (treating auth errors as non-retryable).
    // For the public marketing chat we want to genuinely try every
    // configured provider — an invalid Anthropic key should still let
    // OpenAI answer the visitor.
    interface LadderEntry {
      readonly model: string;
      readonly client: BrainLLMClient;
      readonly providerName: string;
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
        model: 'gpt-4o',
        client: openai,
        providerName: 'openai',
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
    let depth = -1;

    for (let i = 0; i < ladder.length; i++) {
      const entry = ladder[i]!;
      const t0 = Date.now();
      const request: BrainLLMRequest = {
        model: entry.model,
        messages,
        system: systemPrompt,
        maxTokens: 700,
        temperature: 0.7,
      };
      try {
        response = await entry.client.invoke(request);
        attempts.push({
          provider: entry.providerName,
          model: entry.model,
          latencyMs: Date.now() - t0,
        });
        depth = i;
        break;
      } catch (err) {
        attempts.push({
          provider: entry.providerName,
          model: entry.model,
          error: err instanceof Error ? err.message : String(err),
          latencyMs: Date.now() - t0,
        });
        // Continue to next provider regardless of error class.
      }
    }

    try {
      if (!response) {
        throw new Error(
          `All providers failed: ${attempts
            .map((a) => `${a.provider}=${a.error ?? 'unknown'}`)
            .join('; ')}`,
        );
      }

      const text = extractText(response);
      if (!text) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            kind: 'empty_response',
            message: 'Model returned no text content.',
            retryable: true,
            attempts: attempts.length,
          }),
        });
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ at: new Date().toISOString(), error: true }),
        });
        return;
      }

      // Strip + collect citations, then stream the clean text in
      // 40-char chunks for a typing-cadence feel. Final chunk carries
      // the evidence_ids + confidence so the client can attach the
      // chip(s) to the bubble.
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
          provider: response.provider,
          depth,
          latencyMs: Date.now() - startedAt,
          attempts: attempts.length,
        }),
      });
    } catch (err) {
      // Every provider failed — surface the real error. NO mock fallback.
      const message = err instanceof Error ? err.message : String(err);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          kind: 'all_providers_failed',
          message,
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
    }
  });
});

export default app;
