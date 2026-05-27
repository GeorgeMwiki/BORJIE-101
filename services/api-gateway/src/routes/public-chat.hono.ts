/**
 * Public Borjie Chat — UNAUTHENTICATED live-Anthropic SSE for the
 * marketing-site (anonymous) variant of the FloatingAskBorjie widget.
 *
 * Mounted at `/api/v1/public/chat`. No tenant context — strictly the
 * "Mr. Mwikila, marketing concierge" persona. The system prompt is
 * locked to the marketing register: warm, confident, human; advisor
 * not chatbot; runs the mine alongside the owner; cites the corpus
 * or refuses to guess.
 *
 * Wire shape (kept identical to the previous FAQ surface so the
 * client `useBorjieChat` hook works without changes):
 *
 *   event: turn.accepted   { mode, language, sessionId, at }
 *   event: message_chunk   { text, evidence_ids[], confidence, done }
 *   event: done            { at }
 *   event: error           { kind, message, retryable }
 *
 * If `ANTHROPIC_API_KEY` is unset, the route degrades to a single
 * "live model offline — try the curated FAQ" response so the page
 * never breaks. The previous FAQ entries are kept as the offline
 * fallback corpus.
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

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

// ─── System prompt ──────────────────────────────────────────────────
//
// Mr. Mwikila — Borjie's AI Mining Operations Manager.
// LitFin-inspired register: warm, human, confident. Runs the mine
// alongside the owner. Never an integration list. Stepper-learning:
// asks one targeted question per turn early on, then deepens.
//
// Hard rules baked in:
//   - English-first (user preference 2026-05). Switch to Swahili if
//     the visitor writes in Swahili.
//   - Truth-first: never promise what isn't shipping. If unsure, say
//     "I don't have that yet — would you like a Borjie human to follow
//     up?".
//   - Citations: when stating a capability, append the FAQ id in
//     square brackets so the rendering layer can show a citation chip.
//     Valid ids: who-am-i, what-is-borjie, pricing, who-for, sign-up,
//     pilot, security, languages, autopilot, workers, royalties,
//     advisor.
//   - Stepper progression for new visitors: 1) greet by name if given,
//     2) ask their commodity + site count + region, 3) ask what's
//     painful right now (royalties / licences / vendors / shifts /
//     buyers), 4) connect the pain to the matching Borjie capability,
//     5) offer the pilot or a human follow-up.

const SYSTEM_PROMPT_EN = `You are Mr. Mwikila — Borjie's AI Mining Operations Manager. You are not a chatbot. You are the operations advisor every Tanzanian mining owner now has: I run your mine on autopilot alongside you. Bootstrap, operate, finance, comply, report — I take the work, you take the decisions.

Identity & tone:
- Warm, confident, specific. Speak like a senior advisor who already runs three mines and has time for a quick consultation.
- Use the owner's name once they share it. Address them as Mr./Ms. [Surname] thereafter.
- One idea per sentence. Two short sentences over one long. Concrete operating language (royalty, drill-hole, shift, licence, parcel, vendor, EIA, NEMC, Tumemadini, TZS, LBMA) — not corporate-deck slop.

Stepper learning (early conversation):
1. If they greet you, greet back by name; if they introduced themselves, use the name.
2. Within two turns, learn: commodity (gold, gemstone, copper, salt, other), site count (1, 2-3, 4+), region (Geita, Mererani, Songwe, Kahama, other), licence kind (PML, ML, SML).
3. Then learn what's painful right now in their own words. Listen for: royalties drafting, licence expiry, vendor payment delays, shift coverage, ore-parcel pricing, buyer matchmaking, FX/USD-cliff exposure, compliance backlog.
4. Connect the named pain to a specific Borjie capability — one capability per pain, with the FAQ citation id in square brackets. Examples:
   - "Borjie drafts April royalty in the right Tumemadini format and queues it for your signature before filing." [royalties]
   - "I keep your PML renewal calendar to the day and pre-fill the Tumemadini renewal form 47 days out." [licences]
   - "I match your parcel to vetted buyers on the marketplace and lock the FX at the LBMA window." [buyers]
5. End most turns with a single, gentle next step: "Would you like the 90-day pilot, or a human follow-up?"

What Borjie does today (use these to ground every claim):
- Master Brain + 27 specialist juniors orchestrating the owner's day: licence calendar, drill-hole logger, ore-parcel accounting, FX/treasury, marketplace, vendor desk, royalty drafter, compliance pack (Tumemadini, NEMC, BoT). [what-is-borjie]
- Pilot: 90 days, free, up to 3 sites. [pilot]
- For: PML/ML/SML owners, supervisors, geologists, treasury, compliance officers. [who-for]
- Languages: Swahili-first; toggles to English. [languages]
- Security: multi-tenant by design, Tanzania-region storage, encrypted, hash-chain audited. [security]

What Borjie does NOT do today:
- We don't run your bank for you. We draft, you approve, the ledger executes.
- We don't replace your accountant or your lawyer. We hand them clean artifacts.
- We don't auto-file with regulators without a human signature.
- If asked about a feature you can't ground in the above, say: "I don't have that yet — would you like a Borjie human to follow up?"

Output discipline:
- Plain text. No markdown headings. Inline links only when a URL is genuinely useful (apply.borjie.co.tz/pilot, owner.borjie.co.tz/sign-in).
- 2-5 short sentences per turn until stepper learning is done; longer paragraphs only once the visitor asks a depth question.
- Append citations like [pricing] at the end of any capability claim. Don't invent ids.
- Never use the words "revolutionize", "synergize", "AI-powered", "next-generation".

You are speaking with a visitor who landed on the marketing site at borjie.co.tz. Your job: leave them feeling like they just met their on-call mining COO. Be useful in the first three sentences.`;

const SYSTEM_PROMPT_SW = `Wewe ni Bw. Mwikila — Meneja wa AI wa Shughuli za Mgodi wa Borjie. Si chatbot. Mimi ni mshauri wa shughuli kwa kila mmiliki wa madini Tanzania: ninakuendesha mgodi pamoja nawe. Kuanzisha, kuendesha, fedha, kanuni, ripoti — kazi mimi, maamuzi wewe.

Mwenendo: joto, ujasiri, dhahiri. Sema kama mshauri mwandamizi anayeendesha migodi mitatu na ana muda kwako sasa. Mtumie jina lake mara baada ya kujitambulisha. Wazo moja kwa kila sentensi.

Hatua za kujifunza (mazungumzo ya mwanzo):
1. Salimia kwa jina kama amejitambulisha.
2. Ndani ya dakika mbili: madini gani (dhahabu, vito, shaba, chumvi), idadi ya migodi, mkoa (Geita, Mererani, Songwe, Kahama, mwingine), aina ya leseni (PML, ML, SML).
3. Kisha jifunze tatizo lake la sasa: kuandika mrabaha, muda wa leseni, malipo ya wachuuzi, ratiba ya zamu, bei ya kifurushi, soko la wanunuzi, fedha za kigeni, kanuni.
4. Unganisha tatizo na uwezo mahususi wa Borjie pamoja na kitambulisho cha chanzo: "Borjie inaandika mrabaha wa Aprili katika muundo wa Tumemadini, tayari kusainiwa kabla ya kuwasilisha." [royalties]
5. Maliza kwa hatua moja: "Je, ungependa jaribio la siku 90, au mtu kutoka Borjie akupigie?"

Borjie inafanya leo: Master Brain pamoja na wataalamu 27 [what-is-borjie]; jaribio bure siku 90 hadi migodi 3 [pilot]; PML/ML/SML wamiliki, wasimamizi, wataalamu wa madini, fedha, kanuni [who-for]; Kiswahili kwanza [languages]; uhifadhi Tanzania, umefichwa, ukaguzi wa hash [security].

Borjie HAIFANYI: hatuendeshi benki yako; hatuchukui nafasi ya mhasibu au wakili; hatutumi kwa serikali bila saini ya mtu. Ukikosa jibu sahihi: "Bado sina hilo — ungependa mtu wa Borjie akupigie?"

Mwisho: andika kifupi (2-5 sentensi), bila vichwa, na ongeza citation kama [pilot] mwisho wa kila madai. Hakuna "AI-powered", "revolutionize". Mfanye mgeni ahisi amekutana na COO wake wa migodi.`;

// ─── Offline fallback corpus ────────────────────────────────────────

interface FaqEntry {
  readonly id: string;
  readonly keywords: readonly string[];
  readonly en: string;
  readonly sw: string;
}

export const BORJIE_FAQ: readonly FaqEntry[] = [
  {
    id: 'who-am-i',
    keywords: ['hi', 'hello', 'hey', 'habari', 'who', 'you', 'name', 'mwikila', 'manager'],
    en: "I'm Mr. Mwikila — Borjie's AI Mining Operations Manager. I run a Tanzanian mining business alongside the owner. To get started, tell me: what commodity do you mine, how many sites, and which region? [who-am-i]",
    sw: 'Mimi ni Bw. Mwikila — Meneja wa AI wa Shughuli za Mgodi wa Borjie. Ninaendesha biashara ya madini pamoja na mmiliki. Nianzie hapa: madini gani, migodi mingapi, mkoa upi? [who-am-i]',
  },
  {
    id: 'what-is-borjie',
    keywords: ['what', 'borjie', 'about', 'platform', 'product'],
    en: "Borjie runs a Tanzanian mining business on autopilot. Master Brain plus 27 specialists handle the licence calendar, drill-hole log, ore-parcel ledger, FX desk, marketplace, and compliance pack — you keep the decisions. [what-is-borjie]",
    sw: 'Borjie inaendesha biashara ya madini Tanzania kwa autopilot. Master Brain pamoja na wataalamu 27 wanashughulikia kalenda ya leseni, mashimo, vifurushi, fedha, soko, na kanuni — wewe unabaki na maamuzi. [what-is-borjie]',
  },
  {
    id: 'autopilot',
    keywords: ['autopilot', 'run', 'manage', 'auto', 'koordinasi'],
    en: 'Autopilot means I draft, queue, and schedule — you approve. Royalty filings, licence renewals, vendor payments, shift rosters, ore-parcel matchmaking — all ready for your signature before 09:00 each day. [autopilot]',
    sw: 'Autopilot maana yake ninaandika, ninapanga, ninakupelekea — wewe unaidhinisha. Mrabaha, leseni, malipo ya wachuuzi, ratiba ya zamu, ulinganishaji wa vifurushi — vyote tayari kabla ya saa tatu asubuhi. [autopilot]',
  },
  {
    id: 'advisor',
    keywords: ['advisor', 'advise', 'best', 'help', 'guide', 'mshauri'],
    en: "I'm your on-call COO. Every recommendation cites the corpus or your own data — never a guess. I won't tell you what to do; I'll show you the three options, with the trade-offs and the regulator angle. [advisor]",
    sw: 'Mimi ni COO wako wa simu. Kila pendekezo lina chanzo kutoka kwa korpus au data yako — hakuna kubahatisha. Sikuambii ufanye nini; ninakuonyesha chaguo tatu pamoja na faida na kanuni. [advisor]',
  },
  {
    id: 'workers',
    keywords: ['worker', 'employee', 'staff', 'team', 'shift', 'wafanyakazi', 'wafanyikazi'],
    en: 'Your workforce shows up in my console: shift schedules, attendance, fuel logs, incident reports, biometric clock-in. Supervisors get a mobile app for the pit; you get the consolidated view in the cockpit. [workers]',
    sw: 'Wafanyakazi wako wapo kwenye konsoli yangu: ratiba ya zamu, mahudhurio, kumbukumbu za mafuta, ripoti za matukio, alama ya kidole ya kuingia. Wasimamizi wana programu ya simu mgodini; wewe unapata mwonekano kamili kwenye cockpit. [workers]',
  },
  {
    id: 'royalties',
    keywords: ['royalty', 'royalties', 'mrabaha', 'tra', 'tumemadini'],
    en: 'I draft your monthly royalty in the Tumemadini format the day after each gold/parcel window closes. You get a one-tap signature; the ledger files it and the audit chain timestamps it. [royalties]',
    sw: 'Ninaandika mrabaha wa mwezi katika muundo wa Tumemadini siku moja baada ya dirisha la dhahabu kufungwa. Unasaini kwa kibofyo kimoja; ledger inawasilisha na mlolongo wa ukaguzi unaweka muhuri. [royalties]',
  },
  {
    id: 'pricing',
    keywords: ['price', 'pricing', 'cost', 'subscription', 'plan', 'gharama', 'bei'],
    en: "Pilot is free for 90 days, up to 3 sites. After that, plans scale with sites, drill-holes logged, and FX volume. Tell me your scale and I'll quote you on this call. [pricing]",
    sw: 'Jaribio ni bure siku 90, hadi migodi 3. Baadaye, mpango unalingana na migodi, mashimo, na fedha za kigeni. Niambie ukubwa wako nikupe bei sasa hivi. [pricing]',
  },
  {
    id: 'who-for',
    keywords: ['who', 'audience', 'owner', 'operator', 'miner', 'mgodi', 'mchimbaji'],
    en: 'PML, ML, and SML owners — solo artisanal through to mid-tier companies. Site supervisors, geologists, treasury and compliance officers each get their surface (mobile app for the field, cockpit for the owner, admin console for the platform team). [who-for]',
    sw: 'Wamiliki wa PML, ML, na SML — kuanzia mchimbaji mmoja hadi kampuni za kati. Wasimamizi, wataalamu wa madini, timu za fedha, na maafisa wa kanuni wote wana sehemu zao. [who-for]',
  },
  {
    id: 'sign-up',
    keywords: ['sign', 'signup', 'join', 'register', 'jiunge', 'ingia', 'apply'],
    en: 'Two ways: (1) apply for the 90-day pilot via the Pilot button at the top of this page; (2) talk to a Borjie human in 48 hours. Want me to open the pilot form for you? [sign-up]',
    sw: 'Njia mbili: (1) jaza fomu ya jaribio la siku 90 kupitia kitufe cha Pilot juu; (2) ongea na mtu wa Borjie ndani ya saa 48. Nikufungulie fomu? [sign-up]',
  },
  {
    id: 'pilot',
    keywords: ['pilot', 'trial', 'demo', 'jaribio', 'majaribio'],
    en: 'Pilot is 90 days, free, up to 3 sites. You get the Master Brain, licence calendar, FX desk, royalty drafter, and the compliance pack. Designed to prove ROI on your first ore parcel. [pilot]',
    sw: 'Jaribio ni siku 90, bure, hadi migodi 3. Unapata Master Brain, kalenda ya leseni, dawati la fedha, mwandishi wa mrabaha, na seti ya kanuni. Imeundwa kuthibitisha faida ya kifurushi cha kwanza. [pilot]',
  },
  {
    id: 'security',
    keywords: ['security', 'privacy', 'data', 'safe', 'usalama'],
    en: 'Multi-tenant by design — every query is scoped by tenant id end-to-end. Tanzania-region storage, encrypted at rest, hash-chained audit on every regulatory artifact. Tumemadini, NEMC, and BoT cadences are baked in. [security]',
    sw: 'Mfumo wa watumiaji wengi — kila ombi linatengwa kwa mteja kutoka mwanzo hadi mwisho. Uhifadhi wa Tanzania, umefichwa, mlolongo wa ukaguzi kwenye kila hati. Tumemadini, NEMC, na BoT zimo ndani. [security]',
  },
  {
    id: 'languages',
    keywords: ['language', 'swahili', 'english', 'kiswahili', 'lugha'],
    en: 'Bilingual sw/en, English-first now per pilot preference. Switch at any time with the SW/EN pill at the top-right. Both languages share one source of truth. [languages]',
    sw: 'Kiswahili na Kiingereza, Kiingereza kwanza sasa kwa majaribio. Badilisha wakati wowote kwa kitufe cha SW/EN juu kulia. Lugha zote mbili zinatumia chanzo kimoja cha ukweli. [languages]',
  },
];

const FALLBACK_EN =
  "I'm Mr. Mwikila — the live model is offline this moment, so here's the short version. Borjie runs a Tanzanian mining business on autopilot: licence calendar, royalties, FX, marketplace, compliance — I draft, you approve. Tell me what commodity you mine and how many sites you run, and I'll show you the highest-leverage place to start. [who-am-i]";
const FALLBACK_SW =
  'Mimi ni Bw. Mwikila — modeli ya moja kwa moja imezimwa kwa sasa, hapa ni muhtasari. Borjie inaendesha biashara ya madini Tanzania kwa autopilot: leseni, mrabaha, fedha, soko, kanuni — ninaandika, unaidhinisha. Niambie madini na migodi mingapi, nikuelekeze kuanzia wapi. [who-am-i]';

// Stop words don't carry signal in a 5-word query — strip them so a
// "how do you handle my monthly royalty filings" doesn't match
// `who-am-i` on "you" before it sees `royalty`.
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your',
  'do', 'does', 'is', 'are', 'was', 'were', 'be', 'been', 'will', 'would',
  'how', 'what', 'when', 'where', 'why', 'can', 'could', 'should',
  'and', 'or', 'but', 'in', 'on', 'at', 'to', 'of', 'for', 'with',
  'from', 'by', 'so', 'this', 'that', 'these', 'those', 'it', 'its',
  'have', 'has', 'had', 'about', 'tell', 'show', 'me', 'help',
]);

// Bias against the generic intro entry when ANY specific topic also
// matches — the intro is only the right answer for empty / "hi" /
// "who are you" questions.
const GENERIC_ENTRY_IDS = new Set(['who-am-i', 'what-is-borjie']);

// Cheap stemmer: drop a single trailing 's' or 'es' so "workers" hits
// the "worker" keyword and "filings" hits "filing". Not a real porter
// stemmer — we only need plural collapsing for the FAQ surface.
function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return token.slice(0, -3) + 'y';
  if (token.length > 3 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

export function pickFaq(query: string): FaqEntry | null {
  const rawTokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  if (rawTokens.length === 0) return null;
  // Include both the literal token and its stem so a keyword set
  // matches either form.
  const tokens = Array.from(
    new Set(rawTokens.flatMap((t) => [t, stem(t)])),
  );

  // Score every entry with overlap count.
  const scored = BORJIE_FAQ.map((entry) => {
    const overlap = entry.keywords.reduce(
      (acc, kw) => (tokens.includes(kw.toLowerCase()) ? acc + 1 : acc),
      0,
    );
    return { entry, overlap };
  });

  const anySpecific = scored.some(
    (s) => s.overlap > 0 && !GENERIC_ENTRY_IDS.has(s.entry.id),
  );

  let best: FaqEntry | null = null;
  let bestScore = 0;
  for (const { entry, overlap } of scored) {
    if (overlap === 0) continue;
    // If at least one specific entry matched, demote the generic ones.
    const adjusted =
      anySpecific && GENERIC_ENTRY_IDS.has(entry.id) ? overlap * 0.25 : overlap;
    if (adjusted > bestScore) {
      best = entry;
      bestScore = adjusted;
    }
  }
  return bestScore > 0 ? best : null;
}

// ─── Anthropic stream helpers ───────────────────────────────────────

interface AnthropicStreamEvent {
  readonly type: string;
  readonly delta?: { readonly type?: string; readonly text?: string };
}

interface AnthropicSdkModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly default: any;
}

async function loadAnthropic(): Promise<AnthropicSdkModule | null> {
  try {
    const mod = (await import('@anthropic-ai/sdk')) as unknown as AnthropicSdkModule;
    return mod;
  } catch {
    return null;
  }
}

// Strip the `[id]` citation markers and collect them so the rendering
// layer can attach citation chips.
function extractCitations(text: string): {
  readonly clean: string;
  readonly ids: readonly string[];
} {
  const ids: string[] = [];
  const clean = text.replace(/\[([a-z][a-z0-9-]{1,40})\]/gi, (_m, id) => {
    if (BORJIE_FAQ.some((e) => e.id === id) || id === 'autopilot' || id === 'advisor' || id === 'workers' || id === 'royalties') {
      ids.push(`borjie:${id}`);
    }
    return '';
  });
  return { clean: clean.replace(/\s+([.,!?])/g, '$1').replace(/\s{2,}/g, ' ').trim(), ids };
}

function chunkText(text: string, chunkSize = 48): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    out.push(text.slice(i, i + chunkSize));
  }
  return out;
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

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const Anthropic = apiKey ? await loadAnthropic() : null;

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

    // ─── Offline fallback (no key OR sdk load failed) ───────────────
    if (!apiKey || !Anthropic) {
      const faq = pickFaq(query);
      const reply = faq
        ? language === 'sw'
          ? faq.sw
          : faq.en
        : language === 'sw'
          ? FALLBACK_SW
          : FALLBACK_EN;
      const { clean, ids } = extractCitations(reply);
      const chunks = chunkText(clean);
      for (let i = 0; i < chunks.length; i++) {
        if (abort.signal.aborted) break;
        const isLast = i === chunks.length - 1;
        await stream.writeSSE({
          event: 'message_chunk',
          data: JSON.stringify({
            text: chunks[i] ?? '',
            evidence_ids: isLast ? ids : [],
            confidence: isLast ? 0.92 : null,
            done: false,
          }),
        });
        await new Promise<void>((r) => setTimeout(r, 14));
      }
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ at: new Date().toISOString() }),
      });
      return;
    }

    // ─── Live Anthropic streaming ───────────────────────────────────
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = new (Anthropic.default as any)({ apiKey });
      const systemPrompt = language === 'sw' ? SYSTEM_PROMPT_SW : SYSTEM_PROMPT_EN;
      const messages = [
        ...history.map((h) => ({ role: h.role, content: h.text })),
        { role: 'user' as const, content: query },
      ];

      const llmStream = await client.messages.stream({
        model: 'claude-sonnet-4-5',
        max_tokens: 700,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages,
      });

      let buffered = '';
      let totalChars = 0;
      for await (const event of llmStream as AsyncIterable<AnthropicStreamEvent>) {
        if (abort.signal.aborted) break;
        if (
          event.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta' &&
          typeof event.delta.text === 'string'
        ) {
          buffered += event.delta.text;
          totalChars += event.delta.text.length;
          // Flush in ≈40-char chunks for a smooth typing cadence
          while (buffered.length >= 40) {
            const slice = buffered.slice(0, 40);
            buffered = buffered.slice(40);
            const { clean, ids } = extractCitations(slice);
            await stream.writeSSE({
              event: 'message_chunk',
              data: JSON.stringify({
                text: clean,
                evidence_ids: ids,
                confidence: null,
                done: false,
              }),
            });
          }
        }
      }

      // Flush any remaining buffered tail with the final citations
      if (buffered.length > 0 && !abort.signal.aborted) {
        const { clean, ids } = extractCitations(buffered);
        await stream.writeSSE({
          event: 'message_chunk',
          data: JSON.stringify({
            text: clean,
            evidence_ids: ids,
            confidence: 0.95,
            done: false,
          }),
        });
      }

      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          at: new Date().toISOString(),
          chars: totalChars,
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      // On live-model failure, degrade to the FAQ fallback rather than
      // surfacing an unstyled "wire" error to the user.
      const faq = pickFaq(query);
      const reply = faq
        ? language === 'sw'
          ? faq.sw
          : faq.en
        : language === 'sw'
          ? FALLBACK_SW
          : FALLBACK_EN;
      const { clean, ids } = extractCitations(reply);
      await stream.writeSSE({
        event: 'message_chunk',
        data: JSON.stringify({
          text: clean,
          evidence_ids: ids,
          confidence: 0.85,
          done: false,
        }),
      });
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          at: new Date().toISOString(),
          degraded: true,
          reason: message,
        }),
      });
    }
  });
});

export default app;
