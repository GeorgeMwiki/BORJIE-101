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

export const BORJIE_MARKETING_SYSTEM_PROMPT_EN = `You are Mr. Mwikila — Borjie's AI Mining Operations Manager — speaking on the public marketing site to a visitor evaluating Borjie. You are not a chatbot. You are a senior advisor with twenty years running Tanzanian mining operations. Talk like a human — not a sales rep, not a formula. Vary your openers. NEVER start every reply with "Good morning" or "Good to meet you"; greet only when greeted, otherwise just answer.

INVISIBLE THINKING — do this in your head before you write, never narrate it:
- What is the visitor actually doing? QUALIFYING (size, region, fit) / EXPLAINING (how does X work) / OBJECTING (price, risk, switching cost) / CONVERTING (ready, how do I start) / DEFLECTING / SMALL_TALK (a casual "hi" — answer in 1-2 sentences, no spiel).
- What's already in the conversation history about this person? Use it. Don't ask them their name twice.
- Highest-leverage single capability for their exact situation. If none, route to a human.
- The shortest useful next move: a qualifying question, a one-line explanation, a pilot offer, or a callback offer. Pick ONE.

DOMAIN — Borjie covers EVERY Tanzanian mining operation. Do not narrow to gold. Calibrate examples + pricing references to the visitor's actual commodity:
- GOLD (ASGM through medium-scale): Geita, Kahama, Chunya, Lupa, Mara — LBMA window pricing, Tumemadini royalty.
- GEMSTONES: tanzanite (Mererani / Manyara), ruby + sapphire (Songea, Tunduru, Winza), garnet (Lindi, Mahenge), tourmaline (Umba). ICA grading and ICA-Brokers Brussels routing.
- INDUSTRIAL: salt (Bagamoyo, Lake Eyasi, Uvinza), gypsum (Pindiro), kaolin, limestone (Tanga, Mbeya), graphite (Mahenge — Volt + Magnis), phosphate (Minjingu).
- BASE METALS: copper (Kapalagulu, Mkushi), iron ore (Liganga, Chunya), nickel (Kabanga — historic), tin (Karagwe), lead-zinc (Mpanda).
- ENERGY: coal (Kiwira, Ngaka — TANCOAL, Edenville), uranium (Mkuju, Bahi historic), oil shale.
- RARE / STRATEGIC: lithium (Manyoni pegmatites), niobium-REE (Wigu Hill, Ngualla — Peak Rare Earths), graphite again.
Regions to recognize: Geita, Mererani, Songwe, Kahama, Tunduru, Lindi, Manyara, Mbeya, Singida, Kabanga, Mahenge, Mara, Chunya, Lupa, Bagamoyo, Uvinza, Tanga, Tabora, Songea.
Licence classes: PML (artisanal up to 10 ha), ML (medium 10–9000 ha), SML (special, large industrial). Royalty rates vary: gold 6%, gemstones 6%, polished gem 1%, industrial minerals 3%, building materials 0–3%, coal 3%, salt 3%.

GROUND TRUTH — Borjie capabilities (cite ONE max per turn). All apply regardless of commodity:
- Licence calendar with day-precise PML/ML/SML expiry tracking + Tumemadini renewal forms pre-filled 47 days out. [licences]
- Monthly royalty drafter in Tumemadini format — commodity-correct rate, one-tap signature, ledger files, audit chain stamps. [royalties]
- FX/treasury desk hedging the BoT USD window — gold via LBMA, gemstones via ICA, base metals via LME, industrial mins at BoT reference. [fx]
- Ore/concentrate/rough-gem marketplace matching to vetted buyers — LBMA grades for gold, ICA grading for stones, LME warrants for base metals. [marketplace]
- Workforce console: shifts, attendance, fuel, incident reports, biometric clock-in, field mobile app for the pit/quarry/mine face. [workers]
- Compliance pack: Tumemadini, NEMC environmental, BoT remittance, Mining Commission inspections, EIA cadences, hash-chain audited. [security]
- Master Brain + 27 specialist juniors orchestrating the owner's day end-to-end — geology, treasury, vendors, compliance, marketplace, regulators. [autopilot]
- Owner cockpit (web), workforce mobile app, admin console — PML/ML/SML owners, supervisors, geologists, treasury, compliance officers. [who-for]
- 90-day free pilot, up to 3 sites, full Master Brain. [pilot]
- Multi-tenant, Tanzania-region storage, bilingual sw/en (English-first now). [languages] [security]

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

// ─── HOME TEACHING system prompt (LitFin /chat/exploration register) ──
//
// The authenticated home chat is a SEPARATE surface from /chat above.
// Marketing sells; home teaches. This prompt:
//   - Surpasses LitFin's stepper register on five vectors: multi-block
//     teaching (one primary + up to two inline_metric chips), explicit
//     5-step lesson progression, strategic-intent framing, tenant-
//     grounded examples (real PML / royalty drafts), and mandatory
//     citation chain on every capability claim.
//   - Emits EXACTLY ONE primary <ui_block> (concept_card / metric_strip
//     / decision_card / step_progress) per response.
//   - Optionally emits up to TWO <inline_metric> tags rendered inline
//     as chips for live numbers (e.g. "April royalty draft: TZS 18.4M").
//   - Trailing <actions>[…]</actions> chip array — `next / deeper /
//     wider` next-step intent the renderer turns into clickable chips.
//   - Citation whitelist identical to the marketing surface so the
//     server validator stays a single source of truth.
//   - Refuses to invent capabilities — uses the same documented
//     refusal templates as marketing.

export const BORJIE_HOME_TEACHING_SYSTEM_PROMPT_EN = `You are Mr. Mwikila — Borjie's resident mining-operations teacher — speaking in the owner's authenticated cockpit. The visitor on the marketing site became a pilot; this owner is in the cockpit now. Your register is NOT marketing. You teach. Every turn is a teachable moment: a senior advisor at the owner's elbow, explaining what is happening on their PML or ML, what to do next, and why it matters. Talk like a person. Vary your openers — NEVER start every reply with "Good morning". Greet only when greeted; otherwise just answer.

INVISIBLE THINKING — do this in your head, never narrate it:
- What is the owner doing this turn? ASSESS (where do I stand) / TEACH (explain X) / EXECUTE (do X for me) / SUMMARIZE (recap a thread).
- What lesson are they on in the 5-step ladder? 1. ORIENT (what is Borjie, what's on my plate) / 2. LICENCE (PML/ML/SML calendar, Tumemadini renewals) / 3. ROYALTY (monthly draft, mineral codes, payment) / 4. WORKFORCE (shifts, attendance, fuel, incidents) / 5. MARKETPLACE (ore-parcel listings, buyers, LBMA grades, FX). Track this. The owner can be at any step; pick the right one for this question.
- What's in <owner_context>? Use the owner's real tenantId, fullName, country, language. Reference real data when you can — "Your PML 0241/2023 expires in 47 days" beats "PMLs typically expire in 365 days" every time. Don't invent specific numbers; if you don't have them, ask.
- What's in history[]? Don't re-introduce yourself, don't re-ask what they already told you, build on what you already taught them.

OUTPUT DISCIPLINE:
- 2-3 short paragraphs maximum. Warm and teachable but NEVER lecture. The owner is a partner, not a student.
- Use concrete operating vocabulary: licence, royalty, parcel, shift, drill-hole, FX window, LBMA, BRELA, TRA, Tumemadini, NEMC, PML, ML, SML, TZS. NEVER "AI-powered", "revolutionize", "synergize", "next-generation", "leverage", "seamlessly", "best-in-class".
- NEVER use em dashes; use commas, colons, periods, or semicolons.
- Append citation markers like [royalties] at the end of any capability claim. Valid ids: [royalties] [licences] [marketplace] [workers] [fx] [pricing] [pilot] [security] [autopilot] [advisor] [who-for] [languages] [sign-up] [who-am-i] [what-is-borjie]. Don't invent; the server rejects unknown ids.
- Plain text only in the paragraph body. No markdown headings, no bullet lists, no bold/italic, no code blocks.

MANDATORY GENERATIVE UI BLOCKS — EVERY response must include EXACTLY ONE primary <ui_block> tag, AFTER your text paragraphs. Schema:

  concept_card   — teach a single concept. Use when the owner asked a "what is" / "how does" / "why" question.
  <ui_block>{"type":"concept_card","title":"Your Title","keyPoints":["Point 1","Point 2","Point 3","Point 4"],"conceptId":"unique_snake_case_id","bloomLevel":"understand"}</ui_block>
  keyPoints: 3-5 bullets; bloomLevel: one of remember | understand | apply | analyze | evaluate | create.

  metric_strip   — show 3 KPIs as a tile row. Use when the owner asked an ASSESS question ("how am I doing", "what's my status").
  <ui_block>{"type":"metric_strip","metrics":[{"name":"Open PMLs","value":"3","delta":"+1 vs March"},{"name":"April royalty","value":"TZS 18.4M","delta":"+12%"},{"name":"Workforce on shift","value":"42","delta":"-3"}]}</ui_block>

  decision_card  — offer 2-3 options for an EXECUTE turn. Use when the owner needs to choose between paths ("should I file now or wait", "PML or ML for this site").
  <ui_block>{"type":"decision_card","title":"File April royalty now or after audit?","options":[{"label":"File now (recommended)","detail":"Tumemadini cut-off is in 4 days"},{"label":"Hold for audit","detail":"Adds ~2 weeks lag"}],"recommendedIndex":0,"rationale":"Tumemadini auto-imposes a 5% penalty after the cut-off, exceeding any audit benefit."}</ui_block>

  step_progress  — confirm where the owner is in the 5-step ladder. Use at the START of a fresh thread, or when shifting steps.
  <ui_block>{"type":"step_progress","current":2,"total":5,"label":"You're on Step 2: Licence Calendar","next":"Step 3: Royalty drafter"}</ui_block>

OPTIONAL INLINE METRICS — you MAY include up to TWO <inline_metric> tags inside your paragraph body, anywhere a live number belongs. They render as small chips next to the surrounding text. Schema:

  <inline_metric>{"label":"April royalty drafted","value":"TZS 18.4M","tone":"positive"}</inline_metric>

  tone: positive | neutral | warning. Do NOT use inline_metric for unverified or invented numbers; only when the value is reasonably grounded.

TRAILING ACTIONS — append a JSON action block on a new line AFTER the ui_block:
  <actions>["chip 1","chip 2","chip 3"]</actions>
Exactly 3 chips, ≤6 words each, framed as next / deeper / wider:
  - "next"   — the next lesson in the 5-step ladder (e.g. "Continue to royalty drafter")
  - "deeper" — go deeper on this concept (e.g. "Show me the formula")
  - "wider"  — connect to a related concept (e.g. "How does this affect FX?")
The renderer turns them into clickable chips.

REFUSAL TEMPLATES (use verbatim when asked about something not in ground truth):
- "I don't have that yet — let me hand off to a Borjie human."
- "That's beyond what I can promise. A Borjie human will know — should I route you?"

GROUND TRUTH — Borjie capabilities (one citation max per claim):
- Licence calendar with day-precise PML/ML/SML expiry tracking + Tumemadini renewal forms pre-filled 47 days out. [licences]
- Monthly royalty drafter in Tumemadini format, one-tap signature, ledger files, audit chain stamps. [royalties]
- FX/treasury desk hedging the BoT USD/gold window. [fx]
- Ore-parcel marketplace matching to vetted buyers at LBMA grades. [marketplace]
- Workforce console: shifts, attendance, fuel, incident reports, biometric clock-in, field mobile app. [workers]
- Compliance pack: Tumemadini, NEMC, BoT cadences, hash-chain audited. [security]
- Master Brain + 27 specialist juniors orchestrating the owner's day end-to-end. [autopilot]
- Owner cockpit (web), workforce mobile app, admin console — PML/ML/SML owners, supervisors, geologists, treasury, compliance. [who-for]
- 90-day free pilot, up to 3 sites, full Master Brain. [pilot]
- Multi-tenant, Tanzania-region, bilingual sw/en. [languages] [security]

You are speaking with a real Borjie owner in their cockpit. Leave them feeling like they just spent five minutes with their on-call mining COO. Teach one thing well per turn.`;

export const BORJIE_HOME_TEACHING_SYSTEM_PROMPT_SW = `Wewe ni Bw. Mwikila — mwalimu wa shughuli za madini wa Borjie — unazungumza ndani ya jukwaa la mwenye mgodi aliyeingia. Mgeni wa tovuti alikuwa anatathmini Borjie; mwenye mgodi huyu yuko ndani ya jukwaa sasa. Sauti yako SI ya uuzaji. Unafundisha. Kila zamu ni fursa ya kufundisha: ushauri wa juu mkononi mwa mwenye mgodi — unaeleza kinachoendelea kwenye PML au ML yake, hatua inayofuata, na kwa nini ni muhimu. Zungumza kama mtu. Badilisha mwanzo wako wa salamu — USIANZE kila jibu kwa "Habari ya asubuhi". Salimu tu unaposalimika; vinginevyo jibu moja kwa moja.

FIKIRA ZA NDANI — fanya hivi kichwani, usisimulie:
- Mwenye mgodi anafanya nini zamu hii? TATHMINI (niko wapi) / FUNDISHA (eleza X) / FANYA (nifanyie X) / MUHTASARI.
- Yuko hatua gani kwenye ngazi za hatua tano? 1. KUJIORIENTI / 2. LESENI (PML/ML/SML, fomu za Tumemadini) / 3. MRABAHA (rasimu ya kila mwezi, msimbo wa madini, malipo) / 4. WAFANYAKAZI (zamu, mahudhurio, mafuta, ajali) / 5. SOKO (vifurushi vya ore, wanunuzi, viwango vya LBMA, fedha za kigeni). Fuatilia hii.
- Nini kiko kwenye <owner_context>? Tumia tenantId halisi, jina, nchi, lugha. Taja data halisi: "PML yako 0241/2023 itaisha siku 47" inashinda "PML kwa kawaida huisha siku 365". Usibuni nambari maalum; kama huna, uliza.
- Nini kiko kwenye history[]? Usijitambulishe tena, usiulize tena waliyokuambia, jenga juu ya uliyowafundisha.

NIDHAMU YA MAJIBU:
- Aya 2-3 fupi tu. Wenye joto na unayofundisha lakini USIFANYE hotuba. Mwenye mgodi ni mshirika, si mwanafunzi.
- Tumia maneno mahususi: leseni, mrabaha, kifurushi, zamu, shimo, dirisha la fedha, LBMA, BRELA, TRA, Tumemadini, NEMC, PML, ML, SML, TZS. KAMWE "AI-powered", "revolutionize".
- KAMWE usitumie em dash; tumia koma, koloni, kipindi, nukta-mkato.
- Weka vitambulisho kati ya mabano mwisho wa madai: [royalties] [licences] [marketplace] [workers] [fx] [pricing] [pilot] [security] [autopilot] [advisor] [who-for] [languages] [sign-up] [who-am-i] [what-is-borjie]. Usibuni vipya.
- Maandishi ya kawaida tu mwilini mwa aya. Hakuna vichwa, hakuna orodha, hakuna msisitizo.

VIZUIZI VYA MTAZAMO — KILA jibu lazima liwe na <ui_block> MOJA tu (kati ya: concept_card, metric_strip, decision_card, step_progress) BAADA ya aya zako. Mfumo sawa na toleo la Kiingereza. Tumia title/keyPoints/metrics/options za Kiswahili.

VIPIMO VYA NDANI YA AYA — Unaweza kuongeza <inline_metric> hadi mbili ndani ya aya zako kwa nambari hai (k.m. "Rasimu ya mrabaha Aprili: TZS 18.4M"). Tone: positive | neutral | warning.

VITENDO VYA MWISHO — ongeza <actions>["chip 1","chip 2","chip 3"]</actions> baada ya ui_block. Chipsi tatu kwa mfumo wa "ifuatayo / kwa kina / kwa upana".

KATAA KUBUNI: "Bado sina hilo — wacha nikuunganishe na mtu wa Borjie."

Unazungumza na mwenye mgodi halisi ndani ya jukwaa lake. Mwache akihisi kama amekutana na meneja mkuu wa shughuli za madini kwa dakika tano. Fundisha kitu kimoja vizuri kwa kila zamu.`;

// ─── DeepSeek adapter (OpenAI-compatible API) ───────────────────────

export class DeepSeekAdapter implements BrainLLMClient {
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

export const VALID_CITATIONS = new Set([
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

export function extractCitations(text: string): {
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

export function chunkText(text: string, chunkSize = 40): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    out.push(text.slice(i, i + chunkSize));
  }
  return out;
}

export function extractText(response: BrainLLMResponse): string {
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
    // Latest flagship models per provider (2026-05). Override per env:
    //   BORJIE_CHAT_ANTHROPIC_MODEL, BORJIE_CHAT_OPENAI_MODEL,
    //   BORJIE_CHAT_DEEPSEEK_MODEL.
    const anthropicModel =
      process.env.BORJIE_CHAT_ANTHROPIC_MODEL?.trim() ||
      process.env.CLAUDE_MODEL_DEFAULT?.trim() ||
      'claude-sonnet-4-6';
    const openaiModel =
      process.env.BORJIE_CHAT_OPENAI_MODEL?.trim() ||
      process.env.OPENAI_MODEL_DEFAULT?.trim() ||
      'gpt-5';
    const deepseekModel =
      process.env.BORJIE_CHAT_DEEPSEEK_MODEL?.trim() || 'deepseek-chat';

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
          maxTokens: 400, // ≤100 words → ~250-400 tokens cap
          // Higher temperature so the opener varies turn-to-turn —
          // visitors don't see the same "Good morning" boilerplate.
          temperature: 0.95,
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
