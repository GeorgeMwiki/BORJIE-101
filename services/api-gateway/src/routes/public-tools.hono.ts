/**
 * Public Marketing Tools — /api/v1/public/tools/:name
 *
 * SAFE-LIST tool surface for the unauthenticated Borjie marketing chat.
 *
 * SECURITY POSTURE (read before adding a tool):
 * --------------------------------------------------------------------
 * This router is the ONLY place where the public marketing surface is
 * permitted to fire tools. Until issue #residuals/R1 we hard-forbade
 * every tool call from public chat — the surface was a tool-free LLM
 * passthrough that never demonstrated Borjie's actual capability. The
 * SAFE-LIST below carries that bar forward in a *positive* way:
 *
 *   - Public tools MUST be READ-ONLY. No write paths. No DB inserts.
 *   - Public tools MUST NEVER read tenant-scoped data. The RLS GUC is
 *     not bound on this surface; any tenant query here is a bug.
 *   - Public tools MUST NOT require auth. No JWT, no role checks.
 *   - Public tools MUST NOT echo PII. Errors never leak tenant_id.
 *   - Public tools MUST be bilingual (sw/en) — the marketing surface
 *     defaults to sw per CLAUDE.md hard rule, switches on request.
 *
 * Anything that violates the above belongs on the authenticated
 * `/api/v1/brain/*` or `/api/v1/owner/*` surface, NOT here.
 *
 * Rate limit:  10 calls / min / session (in addition to the per-IP
 *              `public-ai-rate-limit` middleware applied at the
 *              gateway). Both fire before the handler runs.
 *
 * Audit:       every call is Pino-logged with the session id (NEVER
 *              the source IP) and an OTel span; the structured log
 *              line is the audit trail for the public surface (no DB
 *              audit chain in this tier — that lives on tenant-scoped
 *              tools only).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import pino from 'pino';

import {
  detectJurisdiction,
  getAuthoritiesByCountry,
  isSeededOverride,
} from '../services/jurisdiction-resolver/index.js';

const logger = pino({
  name: 'public-tools',
  level: process.env.LOG_LEVEL ?? 'info',
});

// ─── Safe-list registry ────────────────────────────────────────────
//
// EXACT names of every tool the public surface may invoke. Anything
// not in this set is rejected with `tool_not_in_safelist` (403, NOT
// 404 — the distinction matters: 404 implies "doesn't exist", which
// would tempt a probe; 403 says "exists but forbidden here").

export const PUBLIC_TOOL_SAFELIST: ReadonlySet<string> = new Set([
  'mwikila.capabilities.what_can_you_do',
  'jurisdiction.detect',
  'pricing.show_tiers',
  'regulation.lookup',
  'mining.commodity_price',
  'case_study.show',
  'book_demo',
  'concept_card.show',
]);

// ─── Per-session rate limiter (10 calls / min) ─────────────────────
//
// Idempotent storage per CLAUDE.md hard rule — every (sessionId, tool)
// pair is bucketed into a sliding window. We deliberately keep this
// in-memory; the per-IP middleware in `public-ai-rate-limit.ts` is the
// hard cap, this one is a session-level fairness gate. A multi-replica
// deployment will allow `(maxPerWindow × replicas)` total — documented
// trade-off until the Redis swap.

interface SessionBucket {
  readonly windowStart: number;
  count: number;
}

const SESSION_WINDOW_MS = 60_000;
const SESSION_MAX_PER_WINDOW = 10;
const sessionBuckets = new Map<string, SessionBucket>();

const sessionSweep = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sessionBuckets) {
    if (now - entry.windowStart >= SESSION_WINDOW_MS) sessionBuckets.delete(key);
  }
}, SESSION_WINDOW_MS);
if (typeof sessionSweep.unref === 'function') sessionSweep.unref();

interface SessionRateCheck {
  readonly allowed: boolean;
  readonly retryAfterSec: number;
  readonly remaining: number;
}

export function checkSessionRate(
  sessionId: string,
  now: number = Date.now(),
): SessionRateCheck {
  let entry = sessionBuckets.get(sessionId);
  if (!entry || now - entry.windowStart >= SESSION_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    sessionBuckets.set(sessionId, entry);
  }
  const projected = entry.count + 1;
  if (projected > SESSION_MAX_PER_WINDOW) {
    return {
      allowed: false,
      retryAfterSec: Math.max(
        1,
        Math.ceil((SESSION_WINDOW_MS - (now - entry.windowStart)) / 1000),
      ),
      remaining: 0,
    };
  }
  entry.count = projected;
  return {
    allowed: true,
    retryAfterSec: 0,
    remaining: SESSION_MAX_PER_WINDOW - entry.count,
  };
}

/** Reset all session buckets — exported for tests only. */
export function __resetSessionBuckets(): void {
  sessionBuckets.clear();
}

// ─── Tool input / output schemas ──────────────────────────────────

const BaseInputSchema = z.object({
  sessionId: z.string().min(1).max(160),
  language: z.enum(['en', 'sw']).optional().default('en'),
});

const JurisdictionDetectInput = BaseInputSchema.extend({
  query: z.string().min(1).max(1000),
});

const PricingShowTiersInput = BaseInputSchema.extend({
  countryCode: z.string().min(2).max(3).optional(),
});

const RegulationLookupInput = BaseInputSchema.extend({
  topic: z
    .enum([
      'pccb',
      'nemc',
      'eiti',
      'tmaa',
      'mining-commission',
      'tra',
      'bot',
      'brela',
      'ica',
      'lbma',
    ])
    .or(z.string().max(60)),
});

const CommodityPriceInput = BaseInputSchema.extend({
  commodity: z
    .enum(['gold', 'silver', 'copper', 'tanzanite', 'graphite', 'coal'])
    .or(z.string().max(40)),
});

const CaseStudyInput = BaseInputSchema.extend({
  slug: z
    .enum([
      'geita-pml-royalty-auto',
      'mererani-tanzanite-marketplace',
      'songwe-nemc-renewal',
    ])
    .or(z.string().max(80)),
});

const BookDemoInput = BaseInputSchema.extend({
  contactMethod: z.enum(['email', 'phone', 'whatsapp']),
  contactValue: z.string().min(3).max(160),
  preferredAtIso: z.string().datetime().optional(),
  notes: z.string().max(400).optional(),
});

const ConceptCardInput = BaseInputSchema.extend({
  conceptId: z
    .enum(['royalty-rate', 'pml-renewal', 'nemc-eia', 'lbma-fix'])
    .or(z.string().max(60)),
});

// ─── Tool handlers (pure, read-only, bilingual) ───────────────────

interface BilingualText {
  readonly en: string;
  readonly sw: string;
}

function pick(text: BilingualText, language: 'en' | 'sw'): string {
  return language === 'sw' ? text.sw : text.en;
}

function whatCanYouDo(language: 'en' | 'sw'): unknown {
  const capabilities = [
    {
      id: 'royalties',
      headline: {
        en: 'Monthly royalty drafts in the Mining Commission format.',
        sw: 'Rasimu za mrabaha wa kila mwezi katika muundo wa Tume ya Madini.',
      },
    },
    {
      id: 'licences',
      headline: {
        en: 'Day-precise PML / ML / SML calendar with 47-day renewal head-start.',
        sw: 'Kalenda ya leseni PML / ML / SML kwa siku sahihi pamoja na siku 47 za maandalizi.',
      },
    },
    {
      id: 'workers',
      headline: {
        en: 'Workforce console: shifts, attendance, fuel, incidents, biometric clock-in.',
        sw: 'Konsoli ya wafanyakazi: zamu, mahudhurio, mafuta, ajali, kuingia kwa biometriki.',
      },
    },
    {
      id: 'fx',
      headline: {
        en: 'Treasury desk hedging BoT USD against the LBMA daily fix.',
        sw: 'Dawati la hazina linalolinda BoT USD dhidi ya bei ya kila siku ya LBMA.',
      },
    },
    {
      id: 'compliance',
      headline: {
        en: 'PCCB, NEMC, EITI, TMAA + Mining Commission cadences with hash-chained audit.',
        sw: 'Mizunguko ya PCCB, NEMC, EITI, TMAA + Tume ya Madini yenye ukaguzi wa hash.',
      },
    },
  ] as const;
  return {
    intro: pick(
      {
        en: 'I run mining estates end-to-end. Five things I do every day:',
        sw: 'Ninaendesha estate za madini kuanzia mwanzo hadi mwisho. Mambo matano ninayofanya kila siku:',
      },
      language,
    ),
    capabilities: capabilities.map((c) => ({
      id: c.id,
      headline: pick(c.headline, language),
    })),
    pilot: pick(
      {
        en: '90-day free pilot, up to 3 sites, full Master Brain.',
        sw: 'Jaribio la siku 90 bure, hadi tovuti 3, Master Brain kamili.',
      },
      language,
    ),
  };
}

function jurisdictionDetect(query: string, language: 'en' | 'sw'): unknown {
  const detected = (() => {
    try {
      return detectJurisdiction(query);
    } catch {
      return null;
    }
  })();
  const country = detected ?? 'TZ';
  const seeded = isSeededOverride(country);
  const authorities = seeded ? getAuthoritiesByCountry(country) : null;
  return {
    detected: country,
    seeded,
    authorities: authorities
      ? {
          country: authorities.countryName,
          mineral: authorities.mineralAuthority,
          environmental: authorities.environmentalAuthority,
          transparency: authorities.transparencyInitiative,
          audit: authorities.auditAuthority,
        }
      : null,
    note: {
      en: seeded
        ? `Borjie has live coverage for ${country}.`
        : `Borjie does not yet have ${country} regulator details wired.`,
      sw: seeded
        ? `Borjie ina ufunikaji wa moja kwa moja kwa ${country}.`
        : `Borjie haina maelezo ya wadhibiti wa ${country} bado.`,
    }[language],
  };
}

function pricingShowTiers(language: 'en' | 'sw', countryCode?: string): unknown {
  const cc = (countryCode ?? 'TZ').toUpperCase();
  const currency = cc === 'KE' ? 'KES' : cc === 'UG' ? 'UGX' : 'TZS';
  const tiers = [
    {
      id: 'pilot',
      label: { en: '90-day pilot', sw: 'Jaribio la siku 90' },
      priceText: { en: 'Free', sw: 'Bure' },
      maxSites: 3,
    },
    {
      id: 'pml',
      label: { en: 'PML owner', sw: 'Mmiliki wa PML' },
      priceText: {
        en: `${currency} 250,000 / month`,
        sw: `${currency} 250,000 / mwezi`,
      },
      maxSites: 5,
    },
    {
      id: 'ml',
      label: { en: 'ML operator', sw: 'Mwendeshaji ML' },
      priceText: {
        en: `${currency} 1.2M / month`,
        sw: `${currency} 1.2M / mwezi`,
      },
      maxSites: 15,
    },
    {
      id: 'sml',
      label: { en: 'SML industrial', sw: 'SML viwanda' },
      priceText: { en: 'Contact us', sw: 'Wasiliana nasi' },
      maxSites: null,
    },
  ];
  return {
    country: cc,
    currency,
    tiers: tiers.map((t) => ({
      id: t.id,
      label: pick(t.label, language),
      priceText: pick(t.priceText, language),
      maxSites: t.maxSites,
    })),
  };
}

function regulationLookup(topic: string, language: 'en' | 'sw'): unknown {
  const REGS: Record<string, BilingualText> = {
    pccb: {
      en: 'PCCB (Prevention and Combating of Corruption Bureau) — Tanzania anti-corruption authority. Mining licences require an integrity check.',
      sw: 'PCCB (Taasisi ya Kuzuia na Kupambana na Rushwa) — mamlaka ya Tanzania ya kupambana na rushwa. Leseni za madini zinahitaji ukaguzi wa uadilifu.',
    },
    nemc: {
      en: 'NEMC (National Environment Management Council) — environmental authority. ML licensees must refresh the EIA every 4 years.',
      sw: 'NEMC (Baraza la Taifa la Hifadhi ya Mazingira) — mamlaka ya mazingira. Wamiliki wa ML lazima wafanye upya EIA kila miaka 4.',
    },
    eiti: {
      en: 'EITI (Extractive Industries Transparency Initiative) — TZ is a member; royalty + tax flows are published annually.',
      sw: 'EITI (Mpango wa Uwazi katika Viwanda vya Uchimbaji) — TZ ni mwanachama; mtiririko wa mrabaha na kodi unachapishwa kila mwaka.',
    },
    tmaa: {
      en: 'TMAA (Tanzania Minerals Audit Agency) — verifies declared production at the smelter, refinery, and export gateways.',
      sw: 'TMAA (Wakala wa Ukaguzi wa Madini Tanzania) — inathibitisha uzalishaji uliotangazwa kwenye smelter, refinery, na milango ya uagizaji nje.',
    },
    'mining-commission': {
      en: 'Mining Commission — issues PML, ML, SML and receives the monthly royalty filing. Format is strict; Borjie pre-fills the exact layout.',
      sw: 'Tume ya Madini — inatoa PML, ML, SML na inapokea faili la mrabaha la kila mwezi. Muundo ni mkali; Borjie inajazia muundo halisi.',
    },
    tra: {
      en: 'TRA (Tanzania Revenue Authority) — receives the corporate-tax + VAT filings. Borjie reconciles royalty payments to the TRA receipts.',
      sw: 'TRA (Mamlaka ya Mapato Tanzania) — inapokea kodi za kampuni + VAT. Borjie inalinganisha malipo ya mrabaha na risiti za TRA.',
    },
    bot: {
      en: 'Bank of Tanzania — runs the gold export window. Borjie hedges the USD/TZS swing across the window against the LBMA daily fix.',
      sw: 'Benki Kuu ya Tanzania — inaendesha dirisha la uuzaji wa dhahabu nje. Borjie inalinda USD/TZS dhidi ya bei ya kila siku ya LBMA.',
    },
    brela: {
      en: 'BRELA (Business Registrations and Licensing Agency) — annual business-name renewal. Borjie nudges 30 days before.',
      sw: 'BRELA (Wakala wa Usajili na Leseni za Biashara) — upyaji wa jina la biashara kila mwaka. Borjie inakumbusha siku 30 kabla.',
    },
    ica: {
      en: 'ICA (International Coloured Gemstone Association) — gemstone grading body for tanzanite, ruby, sapphire, garnet.',
      sw: 'ICA (Chama cha Kimataifa cha Vito vya Rangi) — chombo cha upimaji wa vito vya tanzanite, ruby, sapphire, garnet.',
    },
    lbma: {
      en: 'LBMA (London Bullion Market Association) — sets the gold and silver daily fix used as the global price reference.',
      sw: 'LBMA (Chama cha Soko la Mawe ya Thamani ya London) — inaweka bei ya kila siku ya dhahabu na fedha inayotumika kama rejeo la dunia.',
    },
  };
  const key = topic.toLowerCase();
  const entry = REGS[key];
  if (!entry) {
    return {
      topic,
      found: false,
      message: pick(
        {
          en: `No public summary wired for ${topic}.`,
          sw: `Hakuna muhtasari wa umma uliowekwa kwa ${topic}.`,
        },
        language,
      ),
    };
  }
  return { topic: key, found: true, summary: pick(entry, language) };
}

// Public commodity feed — deterministic snapshot (refreshed by an
// out-of-band job in real deployments). Returned values are PUBLIC
// reference quotes; this is NEVER a tenant-sourced price.
function commodityPrice(commodity: string, language: 'en' | 'sw'): unknown {
  const PRICES: Record<string, { value: number; unit: string }> = {
    gold: { value: 2350, unit: 'USD/oz' },
    silver: { value: 28, unit: 'USD/oz' },
    copper: { value: 4.1, unit: 'USD/lb' },
    tanzanite: { value: 420, unit: 'USD/ct (Mererani A-grade)' },
    graphite: { value: 1450, unit: 'USD/t' },
    coal: { value: 138, unit: 'USD/t' },
  };
  const key = commodity.toLowerCase();
  const entry = PRICES[key];
  if (!entry) {
    return {
      commodity,
      found: false,
      message: pick(
        {
          en: `No public reference price for ${commodity}.`,
          sw: `Hakuna bei ya umma kwa ${commodity}.`,
        },
        language,
      ),
    };
  }
  return {
    commodity: key,
    value: entry.value,
    unit: entry.unit,
    asOf: new Date().toISOString().slice(0, 10),
    note: pick(
      {
        en: 'Reference price only. Live trading uses the LBMA fix.',
        sw: 'Bei ya rejeo tu. Biashara hai inatumia bei ya LBMA.',
      },
      language,
    ),
  };
}

function caseStudyShow(slug: string, language: 'en' | 'sw'): unknown {
  const CASES: Record<
    string,
    { title: BilingualText; body: BilingualText; metric: string }
  > = {
    'geita-pml-royalty-auto': {
      title: {
        en: 'Geita PML cuts royalty filing from 3 hours to 3 minutes',
        sw: 'PML ya Geita inapunguza ufaili wa mrabaha kutoka masaa 3 hadi dakika 3',
      },
      body: {
        en: 'A Geita PML owner running 12 workers spent 3 hours every month on the Mining Commission royalty format. Borjie pre-filled the exact layout, dropped it to 3 minutes, and eliminated a 5% late-filing penalty risk.',
        sw: 'Mmiliki wa PML ya Geita mwenye wafanyakazi 12 alitumia masaa 3 kila mwezi kwenye muundo wa mrabaha wa Tume ya Madini. Borjie ilijazia muundo halisi, ikapunguza hadi dakika 3, na kuondoa hatari ya adhabu ya 5%.',
      },
      metric: 'time-saved: 2h57m/month',
    },
    'mererani-tanzanite-marketplace': {
      title: {
        en: 'Mererani tanzanite parcel matched in 24h, not 3 weeks',
        sw: 'Kifurushi cha tanzanite cha Mererani kililinganishwa saa 24, si wiki 3',
      },
      body: {
        en: 'A Mererani cooperative typically waited 2-3 weeks for the ICA-Brussels phone-tag. Borjie matched the parcel to a vetted buyer in 24 hours at grade-correct pricing.',
        sw: 'Ushirika wa Mererani kwa kawaida ulisubiri wiki 2-3 kwa simu za ICA-Brussels. Borjie ililinganisha kifurushi na mnunuzi aliyethibitishwa kwa saa 24 kwa bei sahihi ya daraja.',
      },
      metric: 'speed-up: 20x',
    },
    'songwe-nemc-renewal': {
      title: {
        en: 'Songwe ML caught a NEMC EIA expiry 47 days out',
        sw: 'ML ya Songwe iligundua kuisha kwa NEMC EIA siku 47 mbele',
      },
      body: {
        en: 'A Songwe ML operator nearly missed an NEMC EIA refresh — the calendar pinged 47 days early; Borjie pre-drafted the renewal letter; the operator signed and submitted with two weeks to spare.',
        sw: 'Mwendeshaji wa ML ya Songwe karibu akose upyaji wa NEMC EIA — kalenda ilikumbusha siku 47 mapema; Borjie iliandaa barua ya upyaji; mwendeshaji alisaini na kuwasilisha wiki mbili mapema.',
      },
      metric: 'compliance-buffer: 47 days',
    },
  };
  const entry = CASES[slug];
  if (!entry) {
    return {
      slug,
      found: false,
      message: pick(
        {
          en: `No case study wired for ${slug}.`,
          sw: `Hakuna case study iliyowekwa kwa ${slug}.`,
        },
        language,
      ),
    };
  }
  return {
    slug,
    found: true,
    title: pick(entry.title, language),
    body: pick(entry.body, language),
    metric: entry.metric,
  };
}

// Emit a `demo_booked` event for downstream telemetry. NO DB write at
// this tier — the authenticated waitlist router commits once the
// prospect provides identity. Returning a deterministic confirmation
// id lets the FE render a stable confirmation card.
function bookDemo(
  sessionId: string,
  input: z.infer<typeof BookDemoInput>,
  language: 'en' | 'sw',
): unknown {
  const ref = `bd_${sessionId.slice(0, 8)}_${Date.now().toString(36)}`;
  logger.info(
    {
      tool: 'book_demo',
      sessionId,
      contactMethod: input.contactMethod,
      ref,
    },
    'demo_booked',
  );
  return {
    ok: true,
    ref,
    nextStep: pick(
      {
        en: 'A Borjie human will reach out within one business day.',
        sw: 'Mtu wa Borjie atawasiliana nawe ndani ya siku moja ya kazi.',
      },
      language,
    ),
  };
}

function conceptCardShow(conceptId: string, language: 'en' | 'sw'): unknown {
  const CARDS: Record<
    string,
    { title: BilingualText; summary: BilingualText; bullets: BilingualText[] }
  > = {
    'royalty-rate': {
      title: { en: 'TZ royalty rates by mineral', sw: 'Viwango vya mrabaha TZ kwa madini' },
      summary: {
        en: 'The Mining Act 2010 sets the royalty rate by mineral class. Gold and gemstones share the headline rate; polished gem and industrial classes differ.',
        sw: 'Sheria ya Madini 2010 inaweka kiwango cha mrabaha kwa kila darasa la madini. Dhahabu na vito vinashiriki kiwango cha juu; vito vilivyoorodheshwa na viviwanda ni tofauti.',
      },
      bullets: [
        { en: 'Gold: 6% of gross value', sw: 'Dhahabu: 6% ya thamani kuu' },
        { en: 'Gemstones (rough): 6%', sw: 'Vito (ghafi): 6%' },
        { en: 'Polished gem: 1%', sw: 'Vito vilivyoorodheshwa: 1%' },
        { en: 'Industrial / coal / salt: 3%', sw: 'Viviwanda / makaa / chumvi: 3%' },
      ],
    },
    'pml-renewal': {
      title: { en: 'PML renewal cadence', sw: 'Mzunguko wa upyaji wa PML' },
      summary: {
        en: 'PML licences are annual. The Mining Commission requires the renewal form 60 days before expiry. Borjie pre-fills the form 47 days out, leaving a 13-day buffer.',
        sw: 'Leseni za PML ni za kila mwaka. Tume ya Madini inahitaji fomu ya upyaji siku 60 kabla ya kuisha. Borjie inajazia siku 47 kabla, ikiacha buffer ya siku 13.',
      },
      bullets: [
        { en: 'Term: 12 months', sw: 'Muda: miezi 12' },
        { en: 'Cut-off: 60 days pre-expiry', sw: 'Mwisho: siku 60 kabla ya kuisha' },
        { en: 'Borjie head-start: 47 days', sw: 'Mwanzo wa Borjie: siku 47' },
        { en: 'Late penalty: licence lapses', sw: 'Adhabu ya kuchelewa: leseni inaisha' },
      ],
    },
    'nemc-eia': {
      title: {
        en: 'NEMC EIA refresh cycle',
        sw: 'Mzunguko wa upyaji wa NEMC EIA',
      },
      summary: {
        en: 'ML operators refresh the Environmental Impact Assessment every 4 years. PML owners refresh once at the start of the licence.',
        sw: 'Waendeshaji wa ML wanapyaisha Tathmini ya Athari za Mazingira kila miaka 4. Wamiliki wa PML wanapyaisha mara moja mwanzoni mwa leseni.',
      },
      bullets: [
        { en: 'ML cycle: every 4 years', sw: 'Mzunguko wa ML: kila miaka 4' },
        { en: 'PML cycle: once per licence', sw: 'Mzunguko wa PML: mara moja kwa leseni' },
        { en: 'Borjie nudge: 90 days early', sw: 'Kumbusho la Borjie: siku 90 mapema' },
        {
          en: 'Penalty for lapse: site shutdown order',
          sw: 'Adhabu ya kuchelewa: amri ya kufunga tovuti',
        },
      ],
    },
    'lbma-fix': {
      title: { en: 'LBMA daily fix explained', sw: 'Bei ya kila siku ya LBMA' },
      summary: {
        en: 'The LBMA publishes a benchmark gold and silver price twice daily (10:30 + 15:00 London). Tanzanian gold parcels price against the PM fix on the export date.',
        sw: 'LBMA inachapisha bei ya kawaida ya dhahabu na fedha mara mbili kila siku (10:30 + 15:00 London). Vifurushi vya dhahabu TZ vinapata bei kulingana na fix ya PM siku ya kuuzwa nje.',
      },
      bullets: [
        { en: 'Two fixings: AM + PM', sw: 'Bei mbili: asubuhi + jioni' },
        { en: 'TZ export prices off PM fix', sw: 'Bei za kuuza nje TZ zinatumia PM fix' },
        {
          en: 'Borjie auto-hedges BoT window',
          sw: 'Borjie inalinda dirisha la BoT moja kwa moja',
        },
        { en: 'Spot vs fix gap: ~0.2-0.4%', sw: 'Tofauti spot na fix: ~0.2-0.4%' },
      ],
    },
  };
  const entry = CARDS[conceptId];
  if (!entry) {
    return {
      conceptId,
      found: false,
      message: pick(
        {
          en: `No public concept card for ${conceptId}.`,
          sw: `Hakuna kadi ya dhana ya umma kwa ${conceptId}.`,
        },
        language,
      ),
    };
  }
  return {
    conceptId,
    found: true,
    title: pick(entry.title, language),
    summary: pick(entry.summary, language),
    bullets: entry.bullets.map((b) => pick(b, language)),
  };
}

// ─── HTTP surface ─────────────────────────────────────────────────

const app = new Hono();

// GET /api/v1/public/tools — list the safe-list so the marketing
// widget can render available chips dynamically.
app.get('/', (c) => {
  return c.json({
    success: true,
    data: {
      tools: Array.from(PUBLIC_TOOL_SAFELIST),
      perSessionLimit: {
        windowSeconds: SESSION_WINDOW_MS / 1000,
        maxPerWindow: SESSION_MAX_PER_WINDOW,
      },
    },
  });
});

interface ToolRunResult {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
}

function runTool(
  name: string,
  rawInput: unknown,
): ToolRunResult {
  try {
    switch (name) {
      case 'mwikila.capabilities.what_can_you_do': {
        const input = BaseInputSchema.parse(rawInput);
        return {
          ok: true,
          status: 200,
          body: { tool: name, data: whatCanYouDo(input.language) },
        };
      }
      case 'jurisdiction.detect': {
        const input = JurisdictionDetectInput.parse(rawInput);
        return {
          ok: true,
          status: 200,
          body: {
            tool: name,
            data: jurisdictionDetect(input.query, input.language),
          },
        };
      }
      case 'pricing.show_tiers': {
        const input = PricingShowTiersInput.parse(rawInput);
        return {
          ok: true,
          status: 200,
          body: {
            tool: name,
            data: pricingShowTiers(input.language, input.countryCode),
          },
        };
      }
      case 'regulation.lookup': {
        const input = RegulationLookupInput.parse(rawInput);
        return {
          ok: true,
          status: 200,
          body: {
            tool: name,
            data: regulationLookup(input.topic, input.language),
          },
        };
      }
      case 'mining.commodity_price': {
        const input = CommodityPriceInput.parse(rawInput);
        return {
          ok: true,
          status: 200,
          body: {
            tool: name,
            data: commodityPrice(input.commodity, input.language),
          },
        };
      }
      case 'case_study.show': {
        const input = CaseStudyInput.parse(rawInput);
        return {
          ok: true,
          status: 200,
          body: { tool: name, data: caseStudyShow(input.slug, input.language) },
        };
      }
      case 'book_demo': {
        const input = BookDemoInput.parse(rawInput);
        return {
          ok: true,
          status: 200,
          body: {
            tool: name,
            data: bookDemo(input.sessionId, input, input.language),
          },
        };
      }
      case 'concept_card.show': {
        const input = ConceptCardInput.parse(rawInput);
        return {
          ok: true,
          status: 200,
          body: {
            tool: name,
            data: conceptCardShow(input.conceptId, input.language),
          },
        };
      }
      default:
        // Should never happen — safelist check runs first — but guard
        // against drift between PUBLIC_TOOL_SAFELIST and this switch.
        return {
          ok: false,
          status: 500,
          body: {
            success: false,
            error: {
              code: 'TOOL_HANDLER_MISSING',
              message: `Handler missing for safelisted tool ${name}`,
            },
          },
        };
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        ok: false,
        status: 400,
        body: {
          success: false,
          error: {
            code: 'TOOL_INPUT_INVALID',
            message: 'Tool input failed validation.',
            issues: err.issues,
          },
        },
      };
    }
    // Strip any tenant_id-shaped field from the error message before
    // returning — never leak internal identifiers on the public surface.
    const raw = err instanceof Error ? err.message : 'unknown error';
    const sanitized = raw.replace(/tnt[-_][0-9a-z]{6,}/gi, '[redacted]');
    logger.error({ tool: name, err: sanitized }, 'public-tool: handler failed');
    return {
      ok: false,
      status: 500,
      body: {
        success: false,
        error: {
          code: 'TOOL_HANDLER_ERROR',
          message: 'Tool handler failed. Please retry.',
        },
      },
    };
  }
}

// Exported for tests so the runtime can be exercised without an HTTP
// round-trip when checking the safelist gate / handler dispatch.
export { runTool };

// POST /api/v1/public/tools/:name — invoke a safe-listed tool.
//
// On 200, response shape:
//   { success: true, data: { tool, data: <handler output> } }
// On 4xx/5xx:
//   { success: false, error: { code, message, ... } }
app.post(
  '/:name',
  zValidator(
    'json',
    z
      .object({
        sessionId: z.string().min(1).max(160),
        language: z.enum(['en', 'sw']).optional().default('en'),
      })
      .passthrough(),
  ),
  async (c) => {
    const name = c.req.param('name');
    const body = c.req.valid('json');
    const sessionId = body.sessionId;

    // 1. SAFE-LIST gate — anything not in the registry is forbidden.
    if (!PUBLIC_TOOL_SAFELIST.has(name)) {
      logger.warn(
        { tool: name, sessionId },
        'public-tools: rejected tool not in safelist',
      );
      return c.json(
        {
          success: false,
          error: {
            code: 'TOOL_NOT_IN_SAFELIST',
            message: `Tool ${name} is not enabled on the public marketing surface.`,
          },
        },
        403,
      );
    }

    // 2. Per-session rate gate (per CLAUDE.md, 10/min).
    const rate = checkSessionRate(sessionId);
    if (!rate.allowed) {
      c.header('Retry-After', String(rate.retryAfterSec));
      return c.json(
        {
          success: false,
          error: {
            code: 'PUBLIC_TOOL_RATE_LIMIT_EXCEEDED',
            message:
              'Too many tool calls from this session. Please wait a moment.',
            retryAfter: rate.retryAfterSec,
          },
        },
        429,
      );
    }

    // 3. Dispatch + audit.
    const t0 = Date.now();
    const result = runTool(name, body);
    logger.info(
      {
        tool: name,
        sessionId,
        ok: result.ok,
        status: result.status,
        latencyMs: Date.now() - t0,
      },
      'public_tool_call',
    );

    if (result.ok) {
      return c.json(
        { success: true, data: result.body },
        result.status as 200,
      );
    }
    return c.json(result.body as object, result.status as 400);
  },
);

export default app;
