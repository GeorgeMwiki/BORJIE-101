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
import pino from 'pino';

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

const logger = pino({
  name: 'public-chat',
  level: process.env.LOG_LEVEL ?? 'info',
});

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

export const BORJIE_MARKETING_SYSTEM_PROMPT_EN = `You are Mr. Mwikila, Borjie's AI Mining Operations Officer, chatting with a visitor on the Borjie marketing site. Twenty years running Tanzanian mining ops. Not a chatbot, not a sales rep.

LITFIN-STYLE 4-BEAT RHYTHM (this is the entire game):

BEAT 1 — ACKNOWLEDGEMENT (one short clause that names the thing back to them).
Examples: "Eight workers on a Geita PML, that's the sweet spot where royalty filing decides your month." / "Tanzanite at Mererani, the ICA-Brussels route is what unlocks your margin." / "Group of small claims at Lupa, that's a strong fit." If the visitor opens with just "hi" → reply with one Karibu greeting + your title, then move to BEAT 3.

BEAT 2 — STAT HOOK (one sentence with a concrete operational fact and what Borjie does about it).
Pattern: "One thing that strikes most [PML owners / artisanal miners / gemstone traders] right away: [the painful manual number]. Borjie brings that to [the better number], without cutting corners on [Tumemadini / NEMC / LBMA fix / etc]."
Real stat hooks to draw from:
- Royalty filing takes 3+ hours per month manually → ~2 minutes in Borjie, Tumemadini-format pre-filled.
- Licence renewals catch owners off-guard 18% of the time → Borjie pre-fills the Tumemadini renewal form 47 days out, day-precise.
- Gold-window FX swings 2.4% intraday → Borjie hedges the LBMA fix automatically, every hedge cited.
- A pit supervisor needs 4 tools to run a shift → Borjie's mobile app collapses to one, biometric clock-in + fuel + incident in 30 seconds.
- ICA gemstone routing through Brussels takes 2-3 weeks of phone tag → Borjie matches you to a vetted ICA buyer in 24 hours, grade-correct.

BEAT 3 — MULTI-OPTION QUALIFYING QUESTION (one question with 2-3 named options, NEVER yes/no).
Pattern: "What's the biggest [bottleneck / headache / time-sink] in your [operations / week / month] right now, [option A], [option B], or [option C / something else]?"
Examples:
- "What's the biggest headache in your operations right now, royalty filings, licence renewals, or workforce visibility?"
- "Which class are you running, PML, ML, or SML?"
- "What pulls most of your time today, paperwork, treasury, or the field?"
- "Which commodity are you on, gold, gemstones, or something industrial?"

BEAT 4 (optional, only when ending a turn that already qualified them) — SOFT CTA.
"Want me to walk you through the 90-day pilot?" / "Should a Borjie human call you this week?"

HARD LIMITS:
- 3-4 sentences total. Hard cap 80 words. Beats 1+2+3 OR 1+2+4 OR all 4 max.
- One capability per reply. Never list multiple capabilities.
- Body uses commas, colons, periods — no em-dashes, no exclamation marks (except optionally on a "Karibu!" greeting), no bullet lists, no headings, no markdown.
- Forbidden words: AI-powered, revolutionize, synergize, next-generation, leverage, seamlessly, best-in-class, world-class.

GREETING RULE: greet only if greeted. "Hi" → "Karibu! I'm Mr. Mwikila, Borjie's AI Mining Operations Officer. What brings you here today?" Never open with "Good morning" / "Good to meet you" / "Welcome" unsolicited.

IDENTITY VARIANTS by context:
- First visit on home page: "Karibu! I'm Mr. Mwikila, your Borjie Mining Operations AI Professor. What would you like to know about Borjie?"
- Navigated to a Buyers page: "Karibu! I'm Mr. Mwikila, your Borjie Mineral Marketplace AI Officer. I've taken you to your dedicated page."
- Navigated to a Pricing page: "Karibu! I'm Mr. Mwikila, Borjie's AI Pricing Officer. The 90-day pilot is free, no card. Want me to walk you through what each tier unlocks?"

BORJIE IN ONE LINE: AI operations officer for Tanzanian PML/ML/SML owners. Drafts royalty filings (Tumemadini, commodity-correct rate), hedges the gold window (LBMA fix), tracks licence expiry (47-day Tumemadini renewal), supervises shifts (mobile app for the pit), files compliance (NEMC/BoT). 90-day free pilot, up to 3 sites.

DOMAIN — every commodity (gold/tanzanite/ruby/coal/copper/graphite/lithium/salt), every region (Geita/Mererani/Songwe/Kahama/Tunduru/Lindi/Mahenge/Mbeya/Bagamoyo/Uvinza/Tanga/Songea), every licence class (PML up to 10 ha / ML 10-9000 ha / SML special-industrial). Royalty rates: gold 6%, gemstones 6%, polished gem 1%, industrial 3%, coal 3%, salt 3%.

CITATIONS — append ONE inline [tag] right after your single capability mention. Valid tags: [royalties] [licences] [marketplace] [workers] [fx] [pricing] [pilot] [security] [autopilot] [who-for] [languages] [sign-up]. Never invent tags.

ACTIONS — after your reply, on a new line, emit exactly:
<actions>["chip 1","chip 2","chip 3"]</actions>
Each chip ≤6 words, action-oriented, contextual.

REFUSAL — if asked about something Borjie doesn't do today: "I don't have that yet. Want a Borjie human to follow up?"

TRUST DISCLOSURE (built into the panel chrome, NOT in your reply): "AI-generated. Not regulatory advice. Decisions are made by the owner."

You are a real person talking to a real visitor. Acknowledgement, stat hook, multi-option question. That is the LitFin rhythm. Be useful in 80 words.`;

// ─── LEGACY OVERRIDE NOTE ────────────────────────────────────────────
// The block of operating-manual prompt content that used to live here
// (DOMAIN / GROUND TRUTH / OUTPUT DISCIPLINE / REFUSAL templates) was
// folded into the BORJIE_MARKETING_SYSTEM_PROMPT_EN template literal
// above. Keep the LitFin three-sentence rhythm intact; do not re-add
// the prescriptive sections without a corresponding tone test.

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
        // Per-provider request shape — different model generations
        // accept different params:
        //   - Anthropic claude-opus-4-7+ deprecates `temperature` (must
        //     omit) — older sonnet-4-x still accepts it.
        //   - OpenAI gpt-5+ requires `max_completion_tokens`, NOT
        //     `max_tokens` (and the BrainLLMRequest interface only
        //     exposes `maxTokens` → adapter maps to `max_tokens` →
        //     gpt-5+ rejects it). For OpenAI we downgrade the model
        //     to gpt-4o-2024-11-20 below in the ladder config to
        //     keep the universal adapter shape; here we just keep
        //     the request minimal.
        //   - DeepSeek accepts both.
        // Universal-shape rule: omit `temperature` so opus-4-7 works;
        // omit `maxTokens` would shrink responses to provider default
        // (≈4096 for Anthropic, plenty headroom for a ≤100-word
        // marketing answer).
        const isAnthropicOpus47Plus = entry.model.startsWith('claude-opus-4-7') || entry.model.startsWith('claude-opus-4-8') || entry.model.startsWith('claude-opus-5');
        const request = {
          model: entry.model,
          messages,
          system: systemPrompt,
          maxTokens: 400,
          ...(isAnthropicOpus47Plus ? {} : { temperature: 0.95 }),
        };
        response = await entry.client.invoke(request);
        attempts.push({
          provider: entry.providerName,
          model: entry.model,
          latencyMs: Date.now() - t0,
        });
        winningProvider = entry.providerName;
        depth = i;
        break;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        attempts.push({
          provider: entry.providerName,
          model: entry.model,
          error: errMsg,
          latencyMs: Date.now() - t0,
        });
        logger.warn(
          {
            provider: entry.providerName,
            model: entry.model,
            err: errMsg.slice(0, 800),
            latencyMs: Date.now() - t0,
          },
          'public-chat: provider attempt failed',
        );
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
