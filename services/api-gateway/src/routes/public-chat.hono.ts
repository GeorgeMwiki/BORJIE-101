/**
 * Public Borjie Chat — UNAUTHENTICATED SSE chat for FloatingAskBorjie's
 * marketing-site (anonymous) variant.
 *
 * Mounted under /api/v1/public so the route resolves to /api/v1/public/chat.
 * The wire shape mirrors `mining/chat.hono.ts` so the same `useBorjieChat`
 * hook can consume both surfaces:
 *
 *   event: turn.accepted   { mode, language, at }
 *   event: message_chunk   { text, evidence_ids[], confidence, done }
 *   event: done            { at }
 *   event: error           { kind, message, retryable }
 *
 * Curated responses ONLY — never reads tenant data. The handler picks
 * the best-matching entry from `BORJIE_FAQ` based on simple keyword
 * scoring; falls through to a default "I'm Borjie, here's what I do"
 * answer when the query doesn't match a curated topic.
 */
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

const PublicChatSchema = z
  .object({
    query: z.string().min(1).max(2000).optional(),
    message: z.string().min(1).max(2000).optional(),
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
    en: "I am Mr. Mwikila — Borjie's AI Mining Operations Manager. I run a Tanzanian mining business end-to-end alongside the owner: bootstrap, operate, finance, comply, and report. Every recommendation I make is backed by a citation from the corpus or your own data — never a guess. Ask me about pricing, the pilot, licences, FX, the marketplace, or how Borjie handles Tumemadini/NEMC compliance.",
    sw: 'Mimi ni Bw. Mwikila — Meneja wa AI wa Shughuli za Mgodi wa Borjie. Ninaendesha biashara ya madini Tanzania pamoja na mmiliki: kuanzisha, kuendesha, fedha, kanuni, na ripoti. Kila pendekezo lina chanzo — hakuna kubahatisha. Niulize bei, jaribio, leseni, fedha za kigeni, soko, au kanuni za Tumemadini/NEMC.',
  },
  {
    id: 'what-is-borjie',
    keywords: ['what', 'borjie', 'about', 'platform', 'product'],
    en: "Borjie is an AI-native operating system for Tanzanian mining. Mr. Mwikila — the AI Mining Operations Manager — orchestrates a Master Brain plus 27 specialist juniors covering licence calendar, drill-hole logger, ore-parcel accounting, FX and treasury, marketplace, plus a compliance pack — built for owners, operators, and regulators.",
    sw: 'Borjie ni mfumo wa uendeshaji wa AI kwa shughuli za madini Tanzania. Bw. Mwikila — Meneja wa AI wa Shughuli za Mgodi — anaongoza Master Brain pamoja na wataalamu 27 wa: kalenda ya leseni, kuandikisha mashimo, hesabu za vifurushi, fedha za kigeni, soko, na seti ya kanuni.',
  },
  {
    id: 'pricing',
    keywords: ['price', 'pricing', 'cost', 'subscription', 'plan', 'gharama', 'bei'],
    en: "Borjie pricing is tier-based — pilot tenants begin on a free 90-day window. After pilot, plans scale with sites, drill-holes logged, and FX volume. Reach out via the Pilot form for a tailored quote.",
    sw: 'Bei ya Borjie ni ngazi-ngazi. Wateja wa majaribio wanaanza bure kwa siku 90. Baada ya jaribio, mpango unalingana na idadi ya migodi, mashimo, na fedha za kigeni. Jaza fomu ya jaribio kupata bei mahususi.',
  },
  {
    id: 'who-for',
    keywords: ['who', 'audience', 'owner', 'operator', 'miner', 'mgodi', 'mchimbaji'],
    en: "Borjie serves Tanzanian mining owners (PML, ML, SML licences), site supervisors, geologists, treasury teams, and compliance officers. There's a dedicated owner cockpit, a workforce mobile app for the field, and an admin console for the platform team.",
    sw: 'Borjie inawahudumia wamiliki wa migodi Tanzania (PML, ML, SML), wasimamizi wa migodi, wataalamu wa madini, timu za fedha, na maafisa wa kanuni. Kuna dashibodi ya mmiliki, programu ya simu kwa wafanyakazi, na konsoli ya msimamizi.',
  },
  {
    id: 'sign-up',
    keywords: ['sign', 'signup', 'join', 'register', 'jiunge', 'ingia'],
    en: "Apply via the Pilot form on the marketing site. Borjie's onboarding team will reach out within 48 hours to scope your sites and walk you through Master Brain.",
    sw: 'Tuma maombi kupitia fomu ya Jaribio kwenye tovuti. Timu ya Borjie itawasiliana nawe ndani ya saa 48 kupanga migodi yako na kukutembeza ndani ya Master Brain.',
  },
  {
    id: 'pilot',
    keywords: ['pilot', 'trial', 'demo', 'jaribio', 'majaribio'],
    en: 'The Borjie pilot program runs 90 days, free of charge, for up to 3 sites. Includes the Master Brain, licence calendar, FX desk, and compliance pack. Designed to prove ROI on your first ore parcel.',
    sw: 'Jaribio la Borjie linadumu siku 90, bure, kwa hadi migodi 3. Inajumuisha Master Brain, kalenda ya leseni, dawati la fedha za kigeni, na seti ya kanuni. Iliundwa kuthibitisha faida ya kifurushi cha kwanza cha madini.',
  },
  {
    id: 'security',
    keywords: ['security', 'privacy', 'data', 'safe', 'usalama'],
    en: 'Borjie is multi-tenant by design — every query is scoped by tenant id end-to-end. We use Tanzania-region storage, encrypted at rest, with audit-hash chains on every regulatory artifact. Compliance pack covers Tumemadini, NEMC, and BoT reporting cadences.',
    sw: 'Borjie imejengwa kwa watumiaji wengi tofauti. Kila ombi linatengwa kwa mteja kutoka mwanzo hadi mwisho. Tunatumia uhifadhi wa eneo la Tanzania, umefichwa, na mlolongo wa ukaguzi kwenye kila hati ya kanuni. Seti ya kanuni inajumuisha Tumemadini, NEMC, na BoT.',
  },
  {
    id: 'languages',
    keywords: ['language', 'swahili', 'english', 'kiswahili', 'lugha'],
    en: "Borjie is Swahili-first. Every surface — Master Brain answers, licence reminders, ore-parcel receipts, compliance letters — defaults to Swahili and toggles to English. Two languages, one source of truth.",
    sw: 'Borjie inazungumza Kiswahili kwanza. Kila sehemu — majibu ya Master Brain, vikumbusho vya leseni, risiti za vifurushi, barua za kanuni — yote yapo Kiswahili na unaweza kubadilisha kwenda Kiingereza.',
  },
];

const DEFAULT_EN =
  "I'm Mr. Mwikila — Borjie's AI Mining Operations Manager. Ask me about pricing, the pilot program, supported licences, the Master Brain, the marketplace, or how Borjie handles Tumemadini and NEMC compliance.";
const DEFAULT_SW =
  'Mimi ni Bw. Mwikila — Meneja wa AI wa Shughuli za Mgodi wa Borjie. Niulize kuhusu bei, jaribio, leseni, Master Brain, soko, au jinsi Borjie inavyoshughulikia kanuni za Tumemadini na NEMC.';

export function pickFaq(query: string): FaqEntry | null {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let best: FaqEntry | null = null;
  let bestScore = 0;
  for (const entry of BORJIE_FAQ) {
    const score = entry.keywords.reduce(
      (acc, kw) => (tokens.includes(kw.toLowerCase()) ? acc + 1 : acc),
      0,
    );
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function chunkText(text: string, chunkSize = 48): readonly string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    out.push(text.slice(i, i + chunkSize));
  }
  return out;
}

const app = new Hono();

app.post('/chat', zValidator('json', PublicChatSchema), async (c) => {
  const body = c.req.valid('json');
  const query = body.query ?? body.message ?? '';
  const language = body.language ?? 'en';
  const mode = body.mode ?? 'build';

  const faq = pickFaq(query);
  const reply = faq
    ? language === 'sw'
      ? faq.sw
      : faq.en
    : language === 'sw'
      ? DEFAULT_SW
      : DEFAULT_EN;
  const evidenceIds = faq ? [`borjie:${faq.id}`] : [];

  return streamSSE(c, async (stream) => {
    const abort = new AbortController();
    stream.onAbort(() => abort.abort());

    await stream.writeSSE({
      event: 'turn.accepted',
      data: JSON.stringify({
        mode,
        language,
        sessionId: body.sessionId ?? null,
        at: new Date().toISOString(),
      }),
    });

    const chunks = chunkText(reply);
    for (let i = 0; i < chunks.length; i++) {
      if (abort.signal.aborted) break;
      const isLast = i === chunks.length - 1;
      await stream.writeSSE({
        event: 'message_chunk',
        data: JSON.stringify({
          text: chunks[i] ?? '',
          evidence_ids: isLast ? evidenceIds : [],
          confidence: isLast ? 0.95 : null,
          done: false,
        }),
      });
      // Throttle to mimic real LLM streaming cadence (12ms/chunk).
      await new Promise<void>((r) => setTimeout(r, 12));
    }

    await stream.writeSSE({
      event: 'done',
      data: JSON.stringify({ at: new Date().toISOString() }),
    });
  });
});

export default app;
